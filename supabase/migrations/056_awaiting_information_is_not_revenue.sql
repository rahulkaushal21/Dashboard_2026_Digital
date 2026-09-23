-- "Awaiting Information" is not revenue.
--
-- Found because LP/HUB read $21,357 on the dashboard and $21,057 in the revenue sheet.
-- The whole $300 was one line: Pointb, "Sleeq website - ad hoc - PointB", HUB, confirmed
-- and started 23 Sep, status Awaiting Information. The work is not agreed yet, so the
-- figure on it is a quote, not money — the sheet was right and the dashboard was not.
--
-- ONE PREDICATE, not a filter repeated in each view. Every revenue reader has to agree
-- about this or the two pages start disagreeing again, which is the exact failure this
-- is fixing.
--
-- The lines are NOT removed from web_project_ledger. Somebody still has to chase the
-- missing information, so they stay on Web, Hub & LP; they are kept out of the money
-- total there, and the total says so rather than quietly being short.
--
-- Rare, but not negligible: three rows in the whole history — $300 (Sep 2026), $250
-- (Mar 2026), $6,500 (Jul 2025).
--
-- STILL COUNTED, and deliberately left alone here: Cancelled (22 rows, $27,996 all time,
-- $3,347 since April) and On Hold (6 rows, $2,358). Both look like the same class of
-- error and neither was asked about. August — the month reconciled against the Business
-- Overview sheet exactly — contains none of these statuses, so that check cannot settle
-- whether the sheet counts them.
create or replace function public.counts_as_revenue(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') !~* 'awaiting';
$$;

comment on function public.counts_as_revenue(text) is
  'Whether a ledger line counts as revenue. Awaiting Information does not: the work is not agreed yet, so the figure is a quote, not money. One predicate so every revenue reader agrees.';

revoke execute on function public.counts_as_revenue(text) from public;
grant  execute on function public.counts_as_revenue(text) to anon, authenticated;

-- Applied to both revenue readers: web_revenue_lines (Dashboard, Business Trend,
-- Forecast, PM scorecards, Client 360, Quarter over Quarter) and business_numbers().
-- See migrations 052 and 053 for their full definitions; both now carry
--   and public.counts_as_revenue(l.delivery_status)
-- on the ledger scan.
