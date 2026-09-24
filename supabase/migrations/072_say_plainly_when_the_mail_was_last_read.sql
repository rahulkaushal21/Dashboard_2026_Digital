-- Email review is a person reading the mailbox. Say so, and say how far behind it is.
--
-- The dashboard carried an "Opportunities scan · auto hourly + on-demand" line and a
-- "Run scan" button. Neither was true. The button queued a request into scan_requests
-- for a runner to claim, and request #1 on 10 Jul 2026 is the only one ever claimed:
-- Krunal, Hiren and Rahul all pressed it between July and September and nothing
-- consumed a single one. Meanwhile the line implied the mail was being watched hourly.
--
-- On 24 Sep 2026 that cost two deals in one day. Sticker Ninja arrived at 09:30 UTC,
-- was read by the 15:10 review and missed by judgement. BOLT Marketing's USD 1,100
-- estimate arrived at 16:19 UTC — 69 minutes AFTER that review — and was never read at
-- all. Same symptom on the page, completely different cause, and no way to tell them
-- apart because the page reported neither.
--
-- Rahul's decision: keep it manual, and stop pretending. The button goes; the page
-- states when the mail was last read and how much has landed since.
--
-- SECURITY DEFINER ON PURPOSE — the one place in this schema that is not invoker.
-- email_inbox has RLS on and NO policy, so only the service role can read it: the
-- mailbox holds clients' own words and stays shut. This view returns three integers and
-- a timestamp and never a message, a subject or an address, which is exactly what the
-- dashboard needs to be honest about its own freshness.
create or replace view public.web_email_review_state as
with last as (
  select max(ran_at) as at
    from public.sync_runs
   where source = 'email-opportunities-scan' and ok
)
select
  (select at from last)                                                  as last_reviewed,
  (select count(*) from public.email_inbox where not processed)          as unread,
  (select count(*) from public.email_inbox
    where not processed
      and msg_date > coalesce((select at from last), '-infinity'::timestamptz)) as arrived_since,
  (select min(msg_date) from public.email_inbox where not processed)     as oldest_unread;

comment on view public.web_email_review_state is
  'Counts only, never content: when the mailbox was last read and how much has landed since. Definer by design — email_inbox is closed to everyone but the service role.';

revoke all on public.web_email_review_state from public, anon, authenticated;
grant select on public.web_email_review_state to anon, authenticated;

-- And close the queue that nothing drains. The button is gone from the page, but this
-- is a static export: a browser holding an old bundle could still call the RPC and file
-- a request nobody will ever read. Better it refuses than pretends.
revoke execute on function public.request_scan(text) from public, anon, authenticated;

update public.scan_requests
   set status = 'cancelled',
       note = coalesce(note || ' | ', '') || 'Cancelled 24 Sep 2026: no runner ever claimed it. Email review is manual by decision; the Run scan button was removed.'
 where status = 'pending';
