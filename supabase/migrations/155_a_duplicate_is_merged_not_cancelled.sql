-- A duplicate is merged, not cancelled
-- ====================================
--
-- Rahul, 15 Oct 2026: "few members created manual opportunties and then system synced
-- those opportunties so there should be an option to merge the opportunities if
-- duplicate, or they can merge it with exiting project which is already confirmed
-- ... sometime system makes mistake and cancelling opportunities cost team over quote
-- to conversion".
--
-- THE COST IS REAL AND IT IS ARITHMETIC. Q2C counts every New-development quote raised
-- in the quarter in its DENOMINATOR (lib/pm-metrics.ts) — that was a deliberate decision,
-- so a PM who had converted five of twelve could not read as 100% by having the other
-- seven vanish. The side effect is that a duplicate marked Cancelled puts one piece of
-- work in the denominator twice and in the numerator once. The PM is marked down for
-- losing a quote that only ever existed in one copy, and the harder they work at keeping
-- the board tidy the worse their number looks.
--
-- So a merge is its own verdict, and deliberately not any of the existing ones:
--
--   Won / Lost / Cancelled   this quote had an outcome
--   Not an opportunity       this was never a deal for anybody
--   MERGED                   this IS a deal, and it is already recorded elsewhere
--
-- A merged row leaves the Q2C cohort entirely — not a win, not a loss, not in the
-- denominator. It leaves the pipeline, the forecast and the pulse too. It is not
-- deleted: the row keeps its history, its PM and its value, and unmerge_opportunity()
-- puts it back.
--
-- TWO TARGETS, EXACTLY ONE PER MERGE:
--   merged_into     another opportunity — the hand-raised row and the synced row
--   merged_project  a project ID already on the sheet — the work was never a separate
--                   quote, and the ID is CHECKED against web_project_ledger before the
--                   merge is allowed, so a typo is caught by the person rather than by
--                   the month-end figures
--
-- WHAT IT REFUSES, all tested:
--   both targets, or neither   "Name one thing to merge into: another deal, or a project ID."
--   itself                     "A deal cannot be merged into itself."
--   an unknown project ID      "No project on the sheet has the ID ..."
--   a confirmed deal           "This deal is confirmed and booking revenue. Un-confirm it
--                              first, then merge." — merging it away would quietly remove
--                              revenue from a month somebody has already reported
--   a target that is itself merged
--                              no chains, so "where did this deal go" is always one hop
--
-- A merge also CLEARS whatever decision was on the row — email_lost, unlikely,
-- manual_state. Someone reaching for Cancel and then finding this should not end up with
-- a row that is both merged and cancelled, because the cancelled half would still be
-- counted.
--
-- NOT rolled_into, which already exists and is a different thing: that one means several
-- WON jobs billed on one invoice, where every job is real and only the billing is shared.

alter table public.opportunities
  add column if not exists merged_into   bigint references public.opportunities(id),
  add column if not exists merged_project text,
  add column if not exists merged_reason text,
  add column if not exists merged_at     timestamptz,
  add column if not exists merged_by     text;

create index if not exists opportunities_merged_into_idx on public.opportunities (merged_into)
  where merged_into is not null;

-- merge_opportunity() and unmerge_opportunity() are applied live; see the repository for
-- their text. Both return the refusal AS A STRING rather than raising, because the
-- wording is the useful part — "Un-confirm it first" tells the PM what to do next.
--
-- Grants: authenticated only.
--   revoke execute on function public.merge_opportunity(bigint, bigint, text, text, text) from public, anon;
--   grant  execute on function public.merge_opportunity(bigint, bigint, text, text, text) to authenticated;
--   revoke execute on function public.unmerge_opportunity(bigint, text) from public, anon;
--   grant  execute on function public.unmerge_opportunity(bigint, text) to authenticated;
