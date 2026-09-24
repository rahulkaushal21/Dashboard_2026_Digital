-- What counts as feedback, and what is just being polite.
--
-- The old bar was "a positive signal with a praise word in it", which let in "Amazing,
-- thank you!", "Video loop delivered perfectly." and a maintenance note that opens with
-- the client paying an invoice. None of those is a client telling you the work was good.
--
-- LENGTH CANNOT BE THE RULE. Two of the clearest real ones —
--   "Guy Smith wrote in unprompted under the subject "Amazing work" to praise Maitri and
--    Mital for last week's delivery."                                        (115 chars)
--   "Unsolicited 5-star feedback across three workstreams from Francis Malabanan, Senior
--    Graphic/Web Designer at ArtOne."                                        (115 chars)
-- are barely longer than one of the clearest non-ones:
--   "Client paid the invoice and is delighted with the maintenance — reports the site is
--    much faster than before."                                              (108 chars)
--
-- So it is scored on what the text DOES, not how long it is:
--
--   +3  they came to you           unprompted, unsolicited, wrote in, out of the blue
--   +2  they praise the work       amazing, brilliant, exceptional, seamless, 5-star…
--   +2  they praise the people     well done team, praise <name>, thanks to the team
--   +2  they name the effect       the client was impressed, attention to detail,
--                                  very happy with the results, made a great impact
--   +1  it has some substance      120+ characters
--   +1  it is more than a line     20+ words
--   -3  it is really about money   invoice, paid, pricing, quote, budget, proposal
--   -2  it is really about status  delivered, launched, approved, resolved — with no
--                                  actual praise alongside it
--   -2  it is a pleasantry         opens with thanks and stops inside 90 characters
--
-- Five or more is feedback. Checked against the eight examples Rahul judged by hand, it
-- now agrees with all eight: the two short real ones score 7 and 5, the long gratitude
-- note 8, the Lyons Wealth note 6, and the four that are not feedback score 4, -2, -3
-- and -2. The "+2 they name the effect" rule exists because of the Lyons one — it praises
-- the EFFECT of the work rather than using an unsolicited marker, and the first cut
-- scored it 4 and would have dropped it.
--
-- The Big Gun thread scores 4 and stays out on purpose: being impressed in the middle of
-- negotiating a monthly rate is a commercial thread with a compliment in it.

create or replace function public.feedback_quality(p_text text)
returns integer language sql immutable as $$
  select case when coalesce(btrim(p_text),'') = '' then -99 else
      (case when p_text ~* '(unprompted|unsolicited|wrote in|out of the blue|came back unprompted|reached out)' then 3 else 0 end)
    + (case when p_text ~* '(amazing|brilliant|exceptional|outstanding work|seamless|seamlessly|5[- ]star|five[- ]star|incredible|tremendous|gratitude|blown away|above and beyond|so impressed|really impressed|particularly impressed|delighted with the (work|delivery|outcome|result))' then 2 else 0 end)
    + (case when p_text ~* '(well done( team)?|praise|sincere thanks|deepest gratitude|thank(s| you)[^.]{0,40}(team|everyone)|pass on my)' then 2 else 0 end)
    + (case when p_text ~* '(attention to detail|the client (was|is|were)[^.]{0,30}(impressed|happy|thrilled|pleased)|very happy with the (result|outcome|work)|made a great impact|keep up the (excellent|great|good) work|elevated the)' then 2 else 0 end)
    + (case when length(p_text) >= 120 then 1 else 0 end)
    + (case when array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1) >= 20 then 1 else 0 end)
    - (case when p_text ~* '(invoice|\mpaid\M|payment|pricing|\mquote[ds]?\M|budget|proposal|per month|upsell|\$[0-9])' then 3 else 0 end)
    - (case when p_text ~* '(delivered|launched|approved|resolved|completed|go[- ]live)'
             and p_text !~* '(amazing|brilliant|exceptional|seamless|incredible|tremendous|so impressed|really impressed|well done|gratitude)' then 2 else 0 end)
    - (case when p_text ~* '^[^.!?]{0,20}(thank|thanks)' and length(p_text) < 90 then 2 else 0 end)
  end
$$;

comment on function public.feedback_quality(text) is
  'How strongly a piece of text reads as real client feedback. 5 or more is feedback; below that it is a pleasantry, a status note or a commercial thread.';

-- One list, two sources, one bar — so the Delights board and the PM scorecard can never
-- disagree about what counts.
--
-- A SCREENSHOT STANDS IN FOR WORDS, IT DOES NOT EXCUSE THEM. A Clutch or Text-Feedback
-- capture IS the feedback when the row has no text: there is nothing to score and the
-- picture is the client's own review. The first cut kept any row carrying a link, which
-- let "Thank you for the speedy work on this." (-2) back in on the strength of an
-- attachment.
create or replace view public.web_real_feedback as
select 'sheet'::text                    as source,
       f.id,
       f.agency                         as company_name,
       f.client_email,
       btrim(f.comments)                as quote,
       nullif(btrim(f.evidence),'')     as evidence,
       f.project_names                  as project,
       (f.added_date)::date             as at,
       f.feedback_type,
       f.pc_sme,
       f.geo,
       public.feedback_quality(f.comments) as score
from public.feedback f
where lower(coalesce(f.nature,'')) = 'positive'
  and (
    public.feedback_quality(f.comments) >= 5
    or (coalesce(btrim(f.comments),'') = '' and btrim(coalesce(f.evidence,'')) ~* '^https?://')
  )
union all
select 'email',
       s.id,
       s.company_name,
       s.client_email,
       btrim(s.summary),
       null,
       s.source_subject,
       (s.source_date)::date,
       s.signal_type,
       null,
       null,
       public.feedback_quality(s.summary)
from public.email_signals s
where s.sentiment = 'Positive'
  and public.feedback_quality(s.summary) >= 5;

comment on view public.web_real_feedback is
  'Client feedback that is actually feedback: scored at 5+ by feedback_quality(), or a review screenshot standing in for words. Pleasantries, delivery notes and commercial threads are out.';

alter view public.web_real_feedback set (security_invoker = true);
grant select on public.web_real_feedback to anon, authenticated;
