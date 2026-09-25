-- The second sweep of the months nobody read, and the gap it exposed.
--
-- 93 more Apr-Jun messages matched softer praise ("really happy with", "love it",
-- "outstanding", "thrilled"). 76 of them were noise the first regex had no way to see:
-- "outstanding INVOICE", Read AI and Fathom meeting recaps, Semrush and Mindvalley
-- newsletters, an abandoned-cart email from a rum distillery. Excluding notification
-- senders and requiring "outstanding work/job/service" cut 93 to 17 real candidates.
--
-- Of those 17, ONE was a delight. The rest were bare acknowledgements — "Fabulous.",
-- "Love it. Please send invite", "Perfect!" — which is the bar working, not failing.
--
-- THE TRAP WORTH REMEMBERING. Ranking Carolina's thread matched on "one of the most
-- rewarding partnerships" and "incredibly professional" — OUR OWN departing PM praising
-- the CLIENT, quoted back down the thread. The client's actual reply was "we are super
-- bummed" and "there are some shoes to fill, and we hope that moving forward, the work
-- quality only gets better". Read as praise it is a delight; read properly it is a
-- retention risk. Praise found in a thread is often our own words.

-- An agency relaying its end client's reaction is praise too, and the commonest form of
-- it on this business's mail. It was in neither scoring function.
create or replace function public.praise_quality(p_text text)
returns integer language sql immutable as $$
  select case when coalesce(btrim(p_text),'') = '' then -99 else
      (case when p_text ~* '(amazing|brilliant|exceptional|outstanding|superb|fantastic|flawless|absolutely perfect|seamless|incredible|tremendous|blown away)' then 2 else 0 end)
    + (case when p_text ~* '(well done|commend|huge thank|massive thank|sincere thanks|deepest gratitude|thank you so much for all|thanks so much for all|cannot thank you enough|really appreciate all)' then 2 else 0 end)
    + (case when p_text ~* '(so impressed|really impressed|very impressed|attention to detail|communication|responsive|patience|lifesaver|made a (real |big |great )?difference|above and beyond|exceeded (our|my) expectations|keep up the)' then 2 else 0 end)
    + (case when p_text ~* '(gave .{0,30}your (contact|details)|recommend(ed)? you|referr(ed|ing) you|be in touch .{0,40}future work|use you (again|for))' then 2 else 0 end)
    + (case when p_text ~* '(client|customer)s? (is|was|are|were) (so|very|really|extremely|genuinely) (happy|pleased|thrilled|delighted)' then 2 else 0 end)
    - (case when p_text ~* '(invoice|payment|pricing|budget|proposal|\$[0-9])' then 4 else 0 end)
  end
$$;

-- A person read the thread and vouched for it.
--
-- ClearMind Graphics scores 2 against a bar of 4: an agency relaying "the client is so
-- happy with the result of your work" has exactly one praise dimension, and the write-up
-- of it says "quote the next phase" and "delivered", which trip the commercial and
-- delivery-note penalties. It is a real delight and no honest wording gets it over the
-- line — the only way was to word the summary so as to dodge the scorer, which is
-- writing to fool it.
--
-- The scan has always HAD a judgement step: step 4 is a person reading the mail. This
-- makes that judgement explicit and auditable rather than leaving it implicit in how a
-- summary happens to be phrased. Deliberately a NAME, not a boolean: an unattributable
-- override is how a bar stops meaning anything.
alter table public.email_signals add column if not exists verified_by text;
comment on column public.email_signals.verified_by is
  'Who read the thread and confirmed this is real praise. Bypasses the score; never set by automation.';

insert into public.email_signals
  (company_name, client_email, signal_type, sentiment, summary, client_quote,
   source_subject, source_sender, source_date, thread_id, verified_by)
values
 ('Clear Mind Graphics','sarah@clearmindgraphics.com','praise','Positive',
  $q$Sarah Murphy, Co-Owner and Web Director at ClearMind Graphics, wrote in unprompted a week after Afzal delivered the Ivorey integration, relaying her own client's reaction: "the client is so happy with the result of your work." She added that they expect to come back to Mavlers to quote the next phase of email workflows.$q$,
  $q$the client is so happy with the result of your work$q$,
  'Re: Checking In on Upcoming Project Needs','Sarah Murphy <sarah@clearmindgraphics.com>','2026-04-07','19d1c3a120d8e014',
  'web@uplers.com')
on conflict (thread_id) do nothing;

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
    AND (feedback_quality(s.summary) >= 5
         OR praise_quality(s.client_quote) >= 4
         OR COALESCE(btrim(s.verified_by), '') <> '')
UNION ALL
 SELECT 'manual'::text AS source, m.id, m.company_name, m.client_email, m.quote,
    NULL::text AS evidence, m.project, m.happened_on AS at, m.channel AS feedback_type,
    m.pm_owner AS pc_sme, NULL::text AS geo, NULL::integer AS score
   FROM manual_feedback m
  WHERE m.status = 'approved'::text;
