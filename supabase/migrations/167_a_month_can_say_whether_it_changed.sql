-- A month can say whether it changed
-- ==================================
--
-- The Project sheet downloads all 3,517 ledger rows - about 3.9 MB of JSON - to show one
-- month of roughly 180. Everything from September back is frozen: it is the old
-- spreadsheet, and sheet_raw has not moved since 4 October. So the same four megabytes
-- crossed the wire again on every load, for data that cannot have changed.
--
-- Rahul, 3 Nov 2026: "mostly there is no change in data from previous months, it should
-- be saved fixed so no need to refetch everytime, but with a provision if any data is
-- updated from dashboard then refresh should be done".
--
-- This is the provision. One row per booking month, with an md5 over EVERY COLUMN of
-- every row in it. The browser keeps the rows it has already seen and re-downloads only
-- the months whose digest has moved.
--
-- The digest is a hash of the rows themselves, not a count or a total or a timestamp. A
-- count would miss an edited invoice number; a total would miss a changed delivery date;
-- a timestamp would miss anything written without touching it, and the ledger has no
-- updated_at to trust. Hashing the row text is the only version of this that is safe to
-- build a cache on - if ANY field of ANY row in a month changes, that month comes down
-- again, and if nothing changed, nothing is fetched.
--
-- Cost: 311 ms and 23 rows, against roughly 1,300 ms and 3.9 MB for the five requests it
-- replaces (four pages plus an exact count that ran the whole view again just to count).
--
-- security_invoker, so it inherits web_project_ledger's rules exactly rather than
-- inventing its own: verified that `authenticated` can read it and `anon` is refused,
-- which is the same answer the ledger itself gives. See 166 for why that is checked by
-- hand every time now.

create or replace view public.web_ledger_month_digest
with (security_invoker = true) as
select coalesce(to_char(t.booking_month, 'YYYY-MM'), 'none') as month,
       count(*)::int                                          as n_rows,
       sum(t.amount_usd)                                      as total_usd,
       md5(string_agg(t::text, '|' order by t.row_key))        as digest
from public.web_project_ledger t
group by 1;

comment on view public.web_ledger_month_digest is
  'One row per booking month: how many ledger rows it holds and an md5 over every column of all of them. The dashboard fetches this first and re-downloads only the months whose digest has moved, so a settled month is transferred once and then read from the browser. Any edit to any field changes that month''s digest, which is what makes it safe to keep the rest.';
