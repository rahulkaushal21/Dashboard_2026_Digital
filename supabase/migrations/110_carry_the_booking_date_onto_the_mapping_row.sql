-- 110 — carry the booking date onto the mapping row
--
-- "sept is still this, from last 4 updates this is not getting fixed i dnt know why"
-- (Rahul, 1 Oct 2026). The Invoice mapping tab shows $185,673 where the invoice app shows
-- $179,511, and I had answered it three times with a sentence about the two answering
-- different questions. A sentence was not the answer. The arithmetic is.
--
-- Neither reading of that card produces $179,511, and it is worth writing down why:
--
--   Invoiced against September's sheet rows, any booking month   $185,673.17
--   ... of which the app books in ANOTHER month                  -$27,558.09
--   September invoices with no September sheet row at all        +$29,122.14
--   voided in September (the app credits the month of the void)   -$6,545.93
--   recorded amendments (migration 108)                           -$1,180.16
--   = the invoice app's September booking figure                 $179,511.13
--
-- Exact, to the cent. The two numbers are both right and are never going to be equal:
-- one is about September's SHEET ROWS, the other about September's INVOICES, and the
-- overlap is partial in both directions.
--
-- The only term the page could not measure was the second one — it had no idea when the
-- app books a matched invoice. So invoice_mapping now returns invoice_booked_at beside
-- invoice_date, and the page derives nothing: it subtracts what it can see. A bridge
-- computed as a residual would have balanced by construction and told nobody anything.
--
-- Requires DROP rather than CREATE OR REPLACE: the return type changes.

do $do$
declare d text; o text;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname = 'invoice_mapping';

  o := 'invoice_date date, invoice_status text';
  if position(o in d) = 0 then raise exception 'coldef anchor'; end if;
  d := replace(d, o, 'invoice_date date, invoice_booked_at date, invoice_status text');

  o := '         i.status, i.invoice_at::date as d, date_trunc(''month'', coalesce(i.booking_at, i.invoice_at))::date as im,';
  if position(o in d) = 0 then raise exception 'I anchor'; end if;
  d := replace(d, o, '         i.status, i.invoice_at::date as d,
         coalesce(i.booking_at, i.invoice_at)::date as bd,
         date_trunc(''month'', coalesce(i.booking_at, i.invoice_at))::date as im,');

  o := '  group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status, i.invoice_at';
  if position(o in d) = 0 then raise exception 'groupby anchor'; end if;
  d := replace(d, o, '  group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status, i.invoice_at, i.booking_at');

  o := '  I.invoice_no, I.d, I.status, I.client, I.usd, I.services, G.grp,';
  if position(o in d) = 0 then raise exception 'sheet select anchor'; end if;
  d := replace(d, o, '  I.invoice_no, I.d, I.bd, I.status, I.client, I.usd, I.services, G.grp,');

  o := '  I.invoice_no, I.d, I.status, I.client, I.usd, I.services, null, null,';
  if position(o in d) = 0 then raise exception 'orphan select anchor'; end if;
  d := replace(d, o, '  I.invoice_no, I.d, I.bd, I.status, I.client, I.usd, I.services, null, null,');

  execute 'drop function if exists public.invoice_mapping(date)';
  execute d;
  execute 'revoke execute on function public.invoice_mapping(date) from public, anon';
  execute 'grant execute on function public.invoice_mapping(date) to authenticated';
end $do$;
