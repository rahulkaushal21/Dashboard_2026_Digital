-- One September, not two.
--
-- The Dashboard home read $110,561 for September and Business Numbers read $106,980, and
-- nothing on either page said why. Two separate causes, stacked:
--
--   $650  — the Dashboard read `web_revenue` (the sheet aggregate, dated on the Month
--           column) while Business Numbers dated on Start Date. Exactly ONE row in the
--           whole history falls in different months on the two bases: Impel.ai, $650,
--           Month = September, Start Date = 3 August. That single row is the entire
--           basis difference, which is why it went unnoticed for so long.
--
-- $2,931  — Business Numbers stopped at today for a like-for-like comparison; the
--           Dashboard's "this month" ran to the 30th. Four jobs starting 23–30 Sep.
--
-- THE MONTH COLUMN WINS. $110,561 is the current-month number the web revenue sheet
-- reports and the number the business runs on, so both pages show it. The start date is
-- kept alongside it, because a Month column cannot answer "how are we doing to the 12th"
-- and a day-level comparison needs a day. From 1 October the new spreadsheet becomes the
-- source and this basis moves with it.
--
-- This view is the old `web_revenue` shape, built from the line-item ledger instead of
-- the merged aggregate. Revenue per month is identical; row counts read higher (3,221
-- lines against 2,476) and now match what Web, Hub & LP has been showing all along.

drop view if exists public.web_revenue_start;

create or replace view public.web_revenue_lines
with (security_invoker = true) as
select
  l.source_id::bigint                        as id,
  l.company_name,
  l.contact_email,
  l.amount_usd                               as booking_amount,
  l.booking_month,                           -- the sheet's Month column: decides the month
  coalesce(l.start_date, l.booking_month)    as booking_date,  -- for ranges inside a month
  l.service_dept                             as service_name,
  l.geo,
  l.pm_owner                                 as sme,
  l.sales_person,
  l.technology,
  l.engagement_model
from public.web_project_ledger l
where l.booking_month is not null or l.start_date is not null;

comment on view public.web_revenue_lines is
  'Line-item revenue. booking_month is the sheet Month column and decides which month a row belongs to; booking_date is the start date, for ranges narrower than a month.';

grant select on public.web_revenue_lines to anon, authenticated;
