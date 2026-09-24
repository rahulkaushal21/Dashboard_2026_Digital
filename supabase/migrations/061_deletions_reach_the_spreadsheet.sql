-- A deletion made in the dashboard has to reach the spreadsheet too.
--
-- Until now delete_ledger_row() only filtered web_project_ledger, so a line removed here
-- kept appearing in the sheet the writer rebuilds every hour. Two places disagreeing
-- about what was booked is the same failure as the $21,357 / $21,057 split, and worse:
-- nobody can correct the sheet by hand, because nothing but the automation may write to
-- it.
--
-- THE ROW IS MARKED, NOT REMOVED. The writer stamps a "Deleted" column instead of
-- dropping the line, because the spreadsheet is the only copy the team can read for
-- themselves and a row that silently disappears from it is indistinguishable from one
-- that was never written. Marked, the money stops counting everywhere (it is already out
-- of web_project_ledger, which every page and every figure is built on) and the evidence
-- of what was removed, by whom and why stays where people can see it.
--
-- WHAT COUNTS AS DELETED IS NOT RESTATED HERE. A deletion carries a fingerprint and stops
-- applying if the sheet row it was made against has moved — see 059. Re-implementing that
-- rule in the edge function would be a second definition free to drift from the first, so
-- this view derives it: a deletion is in force exactly when its row_key is no longer in
-- the ledger. One rule, in one place, and the writer reads the answer.

create or replace view public.web_ledger_deletions_in_force as
select d.row_key, d.reason, d.deleted_by, d.deleted_at
from public.ledger_deletions d
where not exists (
  select 1 from public.web_project_ledger l where l.row_key = d.row_key
);

comment on view public.web_ledger_deletions_in_force is
  'Deletions that are actually hiding a line right now. A deletion whose fingerprint no longer matches its sheet row has lapsed and is absent here, so the line is back in the ledger and the sheet must stop showing it as deleted.';

alter view public.web_ledger_deletions_in_force set (security_invoker = true);

grant select on public.web_ledger_deletions_in_force to anon, authenticated;
