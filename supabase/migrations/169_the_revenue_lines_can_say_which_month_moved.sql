-- The revenue lines can say which month moved
-- ===========================================
--
-- 167 did this for the project ledger. web_revenue_lines is the other half: 3,484 rows
-- across 22 months, read by getBookingsFull(), which feeds the home page, Client 360, the
-- PM scorecards, Business Trend, Last Year and Revenue History. Every total on the
-- dashboard comes from those six, and each of them pulled all 22 months of history to add
-- up one or two of them - 6,794 calls at 733 ms.
--
-- That is the cost Rahul meant by "load time is increasing day by day": it grows with
-- history whether or not anything happened. With the digest it grows with CHANGE instead,
-- and nothing changes in a month that closed a year ago.
--
-- The hash covers EVERY column, although getBookingsFull() selects twelve. That direction
-- matters and only that direction: a digest wider than the fetch can cause a needless
-- re-fetch, which costs a request. A digest narrower than the fetch would miss an edit to
-- a column the page reads, and the browser would go on showing the old value with nothing
-- on screen to say so.
--
-- Verified: 22 months, every month's filter returns exactly the rows its digest counted,
-- 3,484 in all.

create or replace view public.web_revenue_lines_month_digest
with (security_invoker = true) as
select coalesce(to_char(t.booking_month, 'YYYY-MM'), 'none') as month,
       count(*)::int                                          as n_rows,
       sum(t.booking_amount)                                  as total_usd,
       md5(string_agg(t::text, '|' order by t.id))             as digest
from public.web_revenue_lines t
group by 1;

comment on view public.web_revenue_lines_month_digest is
  'One row per booking month of web_revenue_lines, with an md5 over EVERY column of every row in it - deliberately a superset of the columns getBookingsFull() selects, so a change to a column the page does not read can only cause a needless re-fetch, never a missed one.';
