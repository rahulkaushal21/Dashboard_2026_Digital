-- Manual feedback has been invisible since the day it shipped.
--
-- feedback_approvers and manual_feedback both had RLS ENABLED and NO POLICY. In Postgres
-- that denies every read. The grants were right, the six approver rows were there, and
-- the Add feedback dialog still said "No approver set for that department" — because it
-- could not see the table at all. The approval queue on Delights could never have shown
-- anything either.
--
-- Writes were fine throughout: they go through SECURITY DEFINER functions, which bypass
-- RLS. That is exactly why the end-to-end test on 24 Sep passed — it exercised
-- submit_manual_feedback and decide_manual_feedback and never once read the tables the
-- way the browser does. A test that only drives the write path cannot see a dark read
-- path. Worth remembering for the next feature that gets an RPC and a table together.
create policy "signed-in read" on public.feedback_approvers
  for select to authenticated using (true);
create policy "signed-in read" on public.manual_feedback
  for select to authenticated using (true);

-- Not the anonymous role. These carry a client's own words and the names of the people
-- who sign them off; everything else on this board is already behind a sign-in.
revoke select on public.feedback_approvers, public.manual_feedback from anon;
