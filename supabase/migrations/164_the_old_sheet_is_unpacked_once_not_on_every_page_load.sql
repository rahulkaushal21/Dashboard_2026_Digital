-- The old sheet is unpacked once, not on every page load
-- ======================================================
--
-- Reading web_project_ledger cost 1,133 ms on average across 5,617 calls, peaking at
-- 7,949 ms — against an 8 s statement timeout. Measured:
--
--     Planning Time:   404.9 ms      <- half the cost, before a row is read
--     Execution Time:  588.2 ms
--     Buffers:  shared hit=21725     <- ~170 MB touched to return 3,517 rows
--
-- Almost all of it is web_sheet_rows_src, which rebuilds the old revenue spreadsheet out
-- of sheet_raw's JSONB on every single read: 36 sub-plans to look up column positions by
-- name in the header row, then client_canonical_name() and canonical_person() per row,
-- over 3,297 rows.
--
-- Those 3,297 rows have not changed since 4 October 2026. The sheet-sync jobs that feed
-- sheet_raw are off by decision, and the Quotes-tab snapshot is frozen. So the dashboard
-- has been re-deriving a month-old, immutable spreadsheet from scratch, for every person,
-- on every page that touches the ledger - and the Project sheet pays it FIVE times on a
-- cold load, because 3,517 rows is four pages plus an exact count that runs the whole
-- view again just to count.
--
-- WHAT IS MATERIALISED, AND WHAT DELIBERATELY IS NOT.
--
--   sheet_raw JSONB -> columns        materialised. Immutable until a sheet sync runs.
--   sheet_row_overrides (PM edits)    LIVE. Stays in web_sheet_rows, joined on top.
--   opportunities (dashboard rows)    LIVE. Untouched - that half is 220 rows.
--   ledger_deletions                  LIVE. Untouched.
--
-- So a PM editing a sheet line still sees it immediately: their edit lands in
-- sheet_row_overrides, which is joined to the matview rather than baked into it. A new
-- client alias is live too, because web_sheet_rows applies client_canonical_name() on
-- its way out. What the matview freezes is the copy used to MATCH an override to its
-- row, so an alias added today reaches that match at the next hourly refresh.
--
-- MEASURED, same query, before and after:
--
--     Planning Time   404.9 ms  ->   5.3 ms
--     Execution Time  588.2 ms  -> 258.3 ms
--     total           993.1 ms  -> 263.6 ms        3.8x, and the Project sheet pays it
--                                                  five times on a cold load
--
-- Row for row identical: md5 over every column of all 3,517 ledger rows is unchanged
-- (d1fa3a0c41f802f831ddbcddfa13a9de), all 96 overrides still match, and the total is
-- still $4,166,500.42.
--
-- The 258 ms that remain are now almost entirely
-- client_canonical_name(client_canonical_name(...)) in the deletions filter, evaluated
-- twice per row over 3,519 rows. It is idempotent over all 408 names the sheet actually
-- holds, so the outer call could go - but only once the function resolves alias CHAINS
-- itself, because today A->B plus B->C is exactly what the second call is covering for.
--
-- web_sheet_rows is not security_invoker and is owned by postgres, so the matview needs
-- no grants of its own: the same people can read the same rows as before, and sheet_raw
-- stays closed.

create materialized view public.web_sheet_rows_mv as
  select * from public.web_sheet_rows_src;

-- Unique, so the refresh can run CONCURRENTLY and never blocks a reader.
create unique index web_sheet_rows_mv_row_index_idx on public.web_sheet_rows_mv (row_index);
-- The ledger orders by row_key, which is 'raw:' || row_index, and pages by month.
create index web_sheet_rows_mv_booking_month_idx on public.web_sheet_rows_mv (booking_month);

analyze public.web_sheet_rows_mv;


-- The same view, over the unpacked copy. Byte for byte the definition Postgres had,
-- with web_sheet_rows_src swapped for the matview and NOTHING else touched.
--
-- That includes the three canonicalising calls below, which re-apply over values _src
-- has already canonicalised once - the plan really does show
-- client_canonical_name(client_canonical_name(...)). Dropping the outer call would be
-- right if the function is idempotent and wrong if any alias maps A->B and B->C, and
-- this migration is not the place to find out. It is a separate question, worth asking,
-- after the measurement below is banked.
create or replace view public.web_sheet_rows as
 SELECT s.id,
    s.row_index,
    COALESCE(o.project_id, s.project_id) AS project_id,
    COALESCE(o.quote_id, s.quote_id) AS quote_id,
    COALESCE(o.service_dept, s.service_dept) AS service_dept,
    COALESCE(o.project_name, s.project_name) AS project_name,
    COALESCE(o.project_type, s.project_type) AS project_type,
    COALESCE(o.technology, s.technology) AS technology,
    s.confirmation_date,
    COALESCE(o.start_date, s.start_date) AS start_date,
    COALESCE(o.delivery_date, s.delivery_date) AS delivery_date,
    COALESCE(o.internal_delivery, s.internal_delivery) AS internal_delivery,
    COALESCE(o.internal_hrs, s.internal_hrs) AS internal_hrs,
    COALESCE(o.actual_hrs, s.actual_hrs) AS actual_hrs,
    COALESCE(o.project_status, s.project_status) AS project_status,
    COALESCE(o.service_type, s.service_type) AS service_type,
    COALESCE(o.delivery_type, s.delivery_type) AS delivery_type,
    canonical_person(s.pc_sme) AS pc_sme,
    COALESCE(o.expert, s.expert) AS expert,
    COALESCE(o.integration, s.integration) AS integration,
    client_canonical_name(s.agency) AS agency,
    s.client_name,
    s.client_email,
    COALESCE(o.client_type, s.client_type) AS client_type,
    COALESCE(o.geo, s.geo) AS geo,
    s.currency,
    s.quote_price,
    s.confirmed_price,
    s.usd_value,
    COALESCE(o.business_type, s.business_type) AS business_type,
    canonical_person(s.sales_person) AS sales_person,
    COALESCE(o.outsource_price, s.outsource_price) AS outsource_price,
    COALESCE(o.invoice_no, s.invoice_no) AS invoice_no,
    COALESCE(o.invoice_currency, s.invoice_currency) AS invoice_currency,
    COALESCE(o.invoice_amount, s.invoice_amount) AS invoice_amount,
    s.booking_month,
    o.contractor_name,
    o.outsource_currency,
    o.row_index IS NOT NULL AS has_override,
    o.updated_by AS override_by,
    o.updated_at AS override_at
   FROM public.web_sheet_rows_mv s
     LEFT JOIN public.sheet_row_overrides o
       ON o.row_index = s.row_index
      AND o.fingerprint = ((((lower(COALESCE(s.agency, ''::text)) || '|'::text)
                            || lower(COALESCE(s.project_name, ''::text))) || '|'::text)
                            || COALESCE(s.booking_month::text, ''::text));


-- Rebuild it. CONCURRENTLY, so a page loading mid-refresh gets the old copy rather than
-- an empty table or a wait.
create or replace function public.refresh_sheet_rows()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  refresh materialized view concurrently public.web_sheet_rows_mv;
end $function$;

revoke all on function public.refresh_sheet_rows() from public, anon;

-- Hourly, at :13. Nothing else runs then - :11 is retired, :07 finishes in about four
-- seconds and :15 is the quote-api sync. Anything that writes sheet_raw should call
-- refresh_sheet_rows() itself; this is the floor, not the mechanism.
select cron.schedule('refresh-sheet-rows', '13 * * * *', $$select public.refresh_sheet_rows();$$);


-- While we are here: refresh-deal-signals ran at :56 for 36 s on average and 64 s at
-- worst, EVERY hour - landing between the :52 matview refreshes and the :00 quote sync,
-- which is the single busiest minute of the dashboard's hour and the likeliest reason a
-- page load "sometimes" crawls. Moved to :09 past every second hour. Nothing else runs
-- at :09, and deal signals are read by a page nobody opens twice a minute.
select cron.alter_job((select jobid from cron.job where jobname = 'refresh-deal-signals'),
                      schedule => '9 */2 * * *');
