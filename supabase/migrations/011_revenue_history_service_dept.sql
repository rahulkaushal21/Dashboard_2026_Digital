-- ============================================================================
-- revenue_history.service_dept — the Web / HUB / LP split the business reports on.
--
-- The historical sheet has no Service Department column (the live sheet does),
-- so it is derived from Technology:
--     Hubspot*                     -> HUB
--     LP*  or  Banner*             -> LP
--     everything else              -> Web
--
-- Verified against the reported FY24-25 figures: HUB lands within $3 of
-- $239,610 and LP within $42 of $296,037. Banner work belongs to LP — folding
-- it into Web instead left LP $145k short and Web $122k over, which is how the
-- rule was found rather than guessed.
-- ============================================================================

alter table public.revenue_history add column if not exists service_dept text;

comment on column public.revenue_history.service_dept is
  'Derived from technology: Hubspot->HUB, LP*/Banner*->LP, else Web. The source sheet has no department column.';

create index if not exists revenue_history_dept_idx
  on public.revenue_history (service_dept, booking_month);
