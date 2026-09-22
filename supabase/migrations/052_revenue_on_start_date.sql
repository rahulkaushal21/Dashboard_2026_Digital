-- The dashboard dates revenue on the START DATE, like the rest of the business.
--
-- Until now the Dashboard home, Business Trend, Forecast, the PM scorecards and the
-- quarter-over-quarter review all read `web_revenue`, the sheet aggregate, which carries
-- only a booking month. Business Numbers and Web, Hub & LP had already been moved onto
-- the start date, so the same September read $110,561 in one place and $106,980 in the
-- other and there was no way to tell which was the real number.
--
-- This view is `web_revenue` shaped, but built from the line-item ledger and dated on
-- the start date, so pointing the readers at it converts all of them at once instead of
-- rewriting six pages to agree with each other.
--
-- Two things worth knowing before reading a diff of the numbers:
--
--  * Exactly ONE row in the whole history has a start date in a different month from its
--    booking month (Impel.ai, $650, booked to September and started 3 August). That
--    single row is the entire basis difference. It is small today and that is precisely
--    why it was easy to miss.
--
--  * Seven old rows have no start date at all, so they fall back to their booking month
--    rather than vanishing. Two rows are blank or zero in every column and are dropped.
--
-- Row grain changes: the ledger holds 3,221 lines where the aggregate merged them into
-- 2,476. Revenue per month is identical either way, but anything COUNTING rows will read
-- higher — and it now matches what Web, Hub & LP and Business Numbers have been showing
-- all along, which is the point.

create or replace view public.web_revenue_start
with (security_invoker = true) as
select
  l.source_id::bigint                                                 as id,
  l.company_name,
  l.contact_email,
  l.amount_usd                                                        as booking_amount,
  -- The month a row belongs to is now the month its work STARTS.
  date_trunc('month', coalesce(l.start_date, l.booking_month))::date  as booking_month,
  coalesce(l.start_date, l.booking_month)                             as booking_date,
  l.service_dept                                                      as service_name,
  l.geo,
  l.pm_owner                                                          as sme,
  l.sales_person,
  l.technology,
  l.engagement_model
from public.web_project_ledger l
where coalesce(l.start_date, l.booking_month) is not null;

comment on view public.web_revenue_start is
  'web_revenue shaped, built from web_project_ledger and dated on start date. The single source of monthly revenue for the dashboard.';

grant select on public.web_revenue_start to anon, authenticated;
