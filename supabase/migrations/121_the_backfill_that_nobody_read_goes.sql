-- 121 — the backfill that nobody read goes
--
-- After migration 120 the database sat at 330 MB, two thirds of it email_inbox.
-- Of the inbox's 119k rows, 86k were captured before 1 Aug 2026 and hold no body:
-- the Apr–Jun backfill (57,976 messages imported and flagged processed without ever
-- being read, see 'Backfilled months were never read') plus the Jul live capture
-- whose bodies were emptied on 1 Oct.
--
-- Rahul's call on 1 Oct 2026: delete the ones that carry no signal. A row is KEPT if
--   - its thread_id is on an opportunity, email_signal, feedback or escalation
--     (the dashboard links back to the thread),
--   - its subject, stripped of Re:/Fwd:, matches an opportunity's source_subject
--     (email_subject_touch / email_thread_signals key on that for quote_intent),
--   - it is a notetaker report (web_meeting_reports parses read.ai / fireflies /
--     fathom / otter / tldv mail by sender),
--   - its subject is QBR evidence (web_qbr_evidence's own pattern),
--   - it still has a body, or is not yet processed.
-- Counted before writing: 85,985 rows before Aug, 13,317 kept, 72,628 deleted.
--
-- What changes on the pages: nothing visible. The kept rows are exactly the ones
-- the views can reach; the deleted ones were only ever counted.
--
-- The heap does not shrink on DELETE. Afterwards, by hand (cannot run in a transaction):
--   vacuum full public.email_inbox;
--   select public.refresh_quote_intent_sources();   -- rebuilds the three email matviews

create temp table _keep_threads as
  select thread_id from public.opportunities  where thread_id is not null
  union select thread_id from public.email_signals where thread_id is not null
  union select thread_id from public.feedback      where thread_id is not null
  union select thread_id from public.escalations   where thread_id is not null;

create temp table _keep_subj as
  select distinct lower(regexp_replace(coalesce(source_subject,''), '^((re|fw|fwd)\s*:\s*)+', '', 'i')) k
  from public.opportunities where length(trim(coalesce(source_subject,''))) > 12;

delete from public.email_inbox e
where e.msg_date < '2026-08-01'
  and e.body is null
  and e.processed
  and e.thread_id not in (select thread_id from _keep_threads)
  and e.from_addr !~* 'read\.ai|fireflies|fathom|otter\.ai|tldv'
  and e.subject !~* '\mQBR\M|quarterly business review|quarterly review|\mQ[1-4] (business )?review'
  and lower(regexp_replace(coalesce(e.subject,''), '^((re|fw|fwd)\s*:\s*)+', '', 'i')) not in (select k from _keep_subj);

drop table _keep_threads;
drop table _keep_subj;
