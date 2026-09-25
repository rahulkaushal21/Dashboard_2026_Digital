-- "From last 6 months email read we don't have any feedback? That's strange."
--
-- It was. Three separate faults, and the scoring was the smallest of them.
--
-- 1. HALF THE SIX MONTHS WAS NEVER READ. April, May and June — 57,976 messages — were
--    backfilled between 21 Jul and 5 Aug, marked `processed` on arrival, and never read
--    for anything. They produced 59 signals between them. July, read live, produced 260
--    on its own: 60% of every signal ever extracted. The board was not showing six
--    months of client sentiment, it was showing about two.
--
-- 2. WHEN PRAISE IS FOUND, THE CLIENT'S WORDS ARE USUALLY LOST. Only 64 of 156 positive
--    signals contained any quoted client text; the rest are our paraphrase. "Client
--    appreciates the team's ongoing support" cannot go on a testimonial board no matter
--    what the scoring does. Hence client_quote: the summary is our write-up, this is
--    what they actually said, and only the latter is publishable.
--
-- 3. THE BAR WAS APPLIED TO THE WRONG TEXT. feedback_quality() was written to score a
--    client's testimonial but runs on our third-person summary, where narration like
--    "on the new website going live" trips its delivery-note penalty. Cazenove+Loyd
--    saying "a huge thank you for all your amazing work... so impressed with the
--    communication throughout" scored 4 against a bar of 5, and was thrown away.
--
--    Lowering the bar does NOT fix this — tested, and 2 or 3 lets straight back in what
--    migration 070 existed to stop ("Amazing, thank you!", "Great job!") plus an outright
--    false positive: "It would be amazing to have your help" is a request, not praise.
--    Scoring only the quoted words is worse still, because a genuine one-line quote is
--    short and loses the length bonuses.
--
--    praise_quality() scores the client's own words on CONTENT alone — no length bonus,
--    no delivery-note penalty — and the two bars are an OR, so nothing already on the
--    board can fall off it.

create or replace function public.praise_quality(p_text text)
returns integer language sql immutable as $$
  select case when coalesce(btrim(p_text),'') = '' then -99 else
      -- 1. The work itself, named as good.
      (case when p_text ~* '(amazing|brilliant|exceptional|outstanding|superb|fantastic|flawless|absolutely perfect|seamless|incredible|tremendous|blown away)' then 2 else 0 end)
      -- 2. Thanks that goes past an acknowledgement, or praise addressed to the team.
    + (case when p_text ~* '(well done|commend|huge thank|massive thank|sincere thanks|deepest gratitude|thank you so much for all|thanks so much for all|cannot thank you enough|really appreciate all)' then 2 else 0 end)
      -- 3. What the work DID, or the quality they singled out by name.
    + (case when p_text ~* '(so impressed|really impressed|very impressed|attention to detail|communication|responsive|patience|lifesaver|made a (real |big |great )?difference|above and beyond|exceeded (our|my) expectations|keep up the)' then 2 else 0 end)
      -- 4. The strongest thing a client can say: they will bring or send more work.
    + (case when p_text ~* '(gave .{0,30}your (contact|details)|recommend(ed)? you|referr(ed|ing) you|be in touch .{0,40}future work|use you (again|for))' then 2 else 0 end)
      -- Money talk is not praise, however warmly it is put.
    - (case when p_text ~* '(invoice|payment|pricing|budget|proposal|\$[0-9])' then 4 else 0 end)
  end
$$;

alter table public.email_signals add column if not exists client_quote text;
comment on column public.email_signals.client_quote is
  'The client''s own words, verbatim. The summary is OUR write-up; only this can go on a testimonial board.';

-- Recover the quotes already sitting inside existing summaries: 118 of 436 had one.
update public.email_signals s
set client_quote = q.said
from (
  select id, (select string_agg(m[1], ' … ') from regexp_matches(summary, '["“]([^"”]{6,})["”]', 'g') m) as said
  from public.email_signals
) q
where q.id = s.id and q.said is not null and s.client_quote is null;

-- Either bar, never a lower one.
create or replace view public.web_real_feedback
with (security_invoker = true) as
 SELECT 'sheet'::text AS source, f.id, f.agency AS company_name, f.client_email,
    btrim(f.comments) AS quote, NULLIF(btrim(f.evidence), ''::text) AS evidence,
    f.project_names AS project, f.added_date AS at, f.feedback_type, f.pc_sme, f.geo,
    feedback_quality(f.comments) AS score
   FROM feedback f
  WHERE lower(COALESCE(f.nature, ''::text)) = 'positive'::text
    AND (feedback_quality(f.comments) >= 5
         OR COALESCE(btrim(f.comments), ''::text) = ''::text AND btrim(COALESCE(f.evidence, ''::text)) ~* '^https?://'::text)
UNION ALL
 SELECT 'email'::text AS source, s.id, s.company_name, s.client_email,
    btrim(s.summary) AS quote, NULL::text AS evidence,
    s.source_subject AS project, s.source_date::date AS at, s.signal_type AS feedback_type,
    NULL::text AS pc_sme, NULL::text AS geo,
    greatest(feedback_quality(s.summary), praise_quality(s.client_quote)) AS score
   FROM email_signals s
  WHERE s.sentiment = 'Positive'::text
    AND (feedback_quality(s.summary) >= 5 OR praise_quality(s.client_quote) >= 4)
UNION ALL
 SELECT 'manual'::text AS source, m.id, m.company_name, m.client_email, m.quote,
    NULL::text AS evidence, m.project, m.happened_on AS at, m.channel AS feedback_type,
    m.pm_owner AS pc_sme, NULL::text AS geo, NULL::integer AS score
   FROM manual_feedback m
  WHERE m.status = 'approved'::text;

-- Five delights from the months nobody read, plus the quote Hunter PR's summary lost.
-- Read by hand out of 32 candidate messages; the other 27 were a vendor cold pitch, a
-- conference newsletter, thread logistics, and one client sentence quoted back through
-- eleven replies (Colliers) — which is why thread_id is UNIQUE.
insert into public.email_signals
  (company_name, client_email, signal_type, sentiment, summary, client_quote,
   source_subject, source_sender, source_date, thread_id)
values
 ('Neon Dynamo','mia@neondynamo.com','praise','Positive',
  $q$Mia Vierod wrote in after the project closed: "We were really impressed with the service and want to say a huge thank you to you and the team." She confirmed she had also submitted formal feedback.$q$,
  $q$We were really impressed with the service and want to say a huge thank you to you and the team.$q$,
  'Re: Project Delivery - Neon Dynamo','Mia Vierod <mia@neondynamo.com>','2026-04-07','19cd727e175bc4e0'),
 ('TiE Silicon Valley','kshitij@tiesv.ai','praise','Positive',
  $q$Kshitij Sharma opened the post-event thread with unprompted praise for the TiEcon 2026 delivery: "I wanted to send a huge thank you for all your hard work on TiEcon this year. Your help handling all those last-minute changes was a lifesaver and really made a difference in the final stretch."$q$,
  $q$I wanted to send a huge thank you for all your hard work on TiEcon this year. Your help handling all those last-minute changes was a lifesaver and really made a difference in the final stretch.$q$,
  'TiEcon 2026 Website Gallery Update','Kshitij Sharma <kshitij@tiesv.ai>','2026-05-14','19e27c8d098e5c48'),
 ('MyKey Funding (KFP)','Revel@mykeyfunding.com','praise','Positive',
  $q$Revel Stark, COO at Key Funding Partners, on the Pardot set-up thread: "Well done team. I love seeing the communication to get this campaign set up for Trey." Praise from the client's COO, singling out how the team communicated.$q$,
  $q$Well done team. I love seeing the communication to get this campaign set up for Trey.$q$,
  'Re: Pardot Set Up / Marketing Domain Warm Up','Revel Stark <Revel@mykeyfunding.com>','2026-05-15','19e18382bb5ab178'),
 ('Apple Print','sophia.bevan@appleprint.co.uk','praise','Positive',
  $q$Sophia Bevan signing off the WBTC phase 1 redesign with Bonny: "All looks absolutely perfect, thank you! And thank you so much for all your hard work and patience on this project!"$q$,
  $q$All looks absolutely perfect, thank you! And thank you so much for all your hard work and patience on this project!$q$,
  'Re: WBTC phase 1 Redesign and development','Sophia Bevan <sophia.bevan@appleprint.co.uk>','2026-05-18','19e209118761b716'),
 ('Colliers International','Alessandra.Leathart@colliers.com','praise','Positive',
  $q$Alessandra Leathart opened her final feedback round to Madhav with unprompted praise: "I really have to commend the team - amazing work on this." The same sentence was then quoted back through eleven later replies on the thread; this is the one that counts.$q$,
  $q$I really have to commend the team - amazing work on this.$q$,
  'RE: New Landing Page Brief','Leathart, Alessandra <Alessandra.Leathart@colliers.com>','2026-06-16','19e25f912554b4d5')
on conflict (thread_id) do nothing;

update public.email_signals
set client_quote = $q$It has been amazing working with you over the years and I will definitely be in touch outside of Hunter for future work. They will still use you for websites as well. I gave a few people your contact info$q$
where thread_id = '19f148c00e768ec3';
