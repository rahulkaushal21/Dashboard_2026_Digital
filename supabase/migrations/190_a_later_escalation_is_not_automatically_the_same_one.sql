-- A later escalation is not automatically the same one
--
-- The watch counted every undismissed escalation raised after a learning was written as a
-- repeat OF THAT LESSON, and the card said so in red: "The lesson has not held."
--
-- It cannot know that. MGS Marketing is the case that showed it. The learning is about a
-- Serano Bakery site hacked through an out-of-date WordPress, which broke mobile checkout
-- and which the client found before we did. The escalation it was marked against, on
-- 21 Nov 2026, is Marinos asking why about half of recent orders show as cancelled and
-- whether something changed with PayPal — a payments question on the same shop. Same
-- client, same site, different problem. The card told four people a lesson about patching
-- and monitoring had failed, on the evidence of an escalation that lesson was never about.
--
-- Same client is all the data supports, so that is all the card may now say. The view
-- carries what the later escalation actually was - its own summary, subject, signal type
-- and date - and the card prints it and lets the reader judge. Nothing is re-counted and
-- no escalation is hidden: still_escalating and repeats_since are unchanged, because a
-- client escalating again after a lesson is worth surfacing whatever it turns out to be.
-- Only the verdict goes.
--
-- repeat_threads stops being NULL::text[] while we are here - it was dropped to a literal
-- in 171 when the key moved to the client - and now carries the real thread ids, newest
-- first, so a reader can open the escalation the banner is talking about.

create or replace view public.web_escalation_learning_watch as
with later as (
  select l.client_key,
         count(*)::integer as repeats,
         max(e.first_flagged_date) as last_repeat,
         min(e.first_flagged_date) as first_repeat,
         array_agg(e.thread_id order by e.first_flagged_date desc, e.created_at desc) as repeat_threads
    from escalation_learnings l
    join critical_escalations e
      on client_key(e.company_name) = l.client_key
     and coalesce(e.dismissed, false) = false
     and e.first_flagged_date > l.created_at::date
   group by l.client_key
), newest as (
  -- The most recent of those, in its own words. distinct on, not a max(), because the
  -- point is to carry one escalation's sentence intact rather than the newest value of
  -- each column separately - which could describe no escalation that ever happened.
  select distinct on (l.client_key)
         l.client_key,
         e.escalation_summary as last_repeat_summary,
         e.source_subject     as last_repeat_subject,
         e.signal_type        as last_repeat_signal
    from escalation_learnings l
    join critical_escalations e
      on client_key(e.company_name) = l.client_key
     and coalesce(e.dismissed, false) = false
     and e.first_flagged_date > l.created_at::date
   order by l.client_key, e.first_flagged_date desc, e.created_at desc
)
select null::text                          as thread_id,
       l.company_name,
       l.learning,
       l.author_email,
       l.created_at,
       l.updated_at,
       l.ai_summary,
       l.ai_actions,
       l.ai_at,
       coalesce(later.repeats, 0)          as repeats_since,
       later.first_repeat,
       later.last_repeat,
       later.repeat_threads,
       later.repeats is not null           as still_escalating,
       l.ai_summary is null                as summary_pending,
       l.client_key,
       newest.last_repeat_summary,
       newest.last_repeat_subject,
       newest.last_repeat_signal
  from escalation_learnings l
  left join later  on later.client_key  = l.client_key
  left join newest on newest.client_key = l.client_key;
