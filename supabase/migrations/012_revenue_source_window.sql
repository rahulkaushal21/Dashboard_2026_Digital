-- ============================================================================
-- revenue_sources.month_from / month_to — the window of months a source is
-- authoritative for.
--
-- A spreadsheet usually carries rows outside the period it is meant to cover:
-- the Jan-2023-to-Mar-2025 file also holds a stray Sep-2022 row and the whole
-- of Q1 2023 before its intended start. Rather than trimming by hand after each
-- load, each source declares its window and the sync keeps only what falls
-- inside it — so re-running can never quietly widen a source's coverage.
--
-- This also keeps sources from overlapping as more years are added: give each
-- one a window and no month can be counted twice.
-- ============================================================================

alter table public.revenue_sources add column if not exists month_from date;
alter table public.revenue_sources add column if not exists month_to   date;

comment on column public.revenue_sources.month_from is 'First booking month this source is authoritative for (inclusive). Null = no lower bound.';
comment on column public.revenue_sources.month_to   is 'Last booking month this source is authoritative for (inclusive). Null = no upper bound.';

-- Apr 2023 - Mar 2025. Rows outside this (the Sep-2022 stray and Q1 2023) are
-- dropped on the next load. web_revenue is untouched and keeps owning Apr 2025
-- onward.
update public.revenue_sources
set label      = 'Apr 2023 - Mar 2025',
    month_from = '2023-04-01',
    month_to   = '2025-03-01'
where key = 'fy23-fy25q1';
