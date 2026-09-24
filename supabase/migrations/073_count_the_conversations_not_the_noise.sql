-- "705 unread" is true and useless. Count the conversations a person would actually read.
--
-- Of 607 unread messages, 301 involve anyone outside the company at all, and 248 of those
-- are not a machine talking — 67 conversations. That is the number worth putting on a
-- dashboard: 705 is a figure nobody can act on, 67 is an afternoon.
--
-- WHAT IS EXCLUDED IS DELIBERATELY NARROW, and only ever things that are unambiguously
-- automatic: senders that announce themselves as machines, calendar invitations, alert
-- subjects, out-of-office replies, and our own daily digest. Vendor marketing from a real
-- person's address still counts. That is the right direction to be wrong in — this number
-- exists to show what has NOT been read, so over-counting costs a moment's scanning while
-- under-counting hides a client, which is the exact failure the number was added for.
--
-- has_external is the first gate: a thread with nobody outside the company on it is not a
-- deal. Internal senders are NOT excluded — Dhruti's BOLT Marketing estimate went out from
-- mavlers.agency, and the three deals in that mailbox on 24 Sep 2026 were all ours to send.
create or replace view public.web_email_review_state as
with last as (
  select max(ran_at) as at
    from public.sync_runs
   where source = 'email-opportunities-scan' and ok
),
waiting as (
  select thread_id, msg_date
    from public.email_inbox
   where not processed
     and has_external
     and from_addr !~* '(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?@|mailer-daemon|postmaster|newsletter|bounce|calendar-notification)'
     and subject   !~* '^\s*(re:\s*|fwd?:\s*)*(invitation|updated invitation|accepted|declined|cancelled|canceled|notification):'
     and subject   !~* '^\s*(re:\s*|fwd?:\s*)*(alert!|automatic reply|out of office|ooo\b)'
     and subject   !~* 'daily digest'
)
select
  (select at from last)                             as last_reviewed,
  (select count(distinct thread_id) from waiting)   as waiting_threads,
  (select count(*) from waiting)                    as waiting_msgs,
  (select count(*) from waiting
    where msg_date > coalesce((select at from last), '-infinity'::timestamptz)) as arrived_since,
  (select min(msg_date) from waiting)               as oldest_waiting,
  (select count(*) from public.email_inbox where not processed) as unread_total;

comment on view public.web_email_review_state is
  'Counts only, never content: when the mailbox was last read, and how many client conversations are waiting. Definer by design - email_inbox is closed to everyone but the service role.';

revoke all on public.web_email_review_state from public, anon, authenticated;
grant select on public.web_email_review_state to anon, authenticated;
