-- 098 — what the invoice app has and the revenue sheet does not
--
-- The sheet is NOT a superset of the invoice app. Across Jan 2025 – Sep 2026, 722 invoices
-- worth $790,256 — 18% of our invoiced value — exist in the app with no matching row in
-- the sheet. Roughly half of that is one mechanism:
--
--   The sheet books a dedicated/retainer engagement ONCE, at contract.
--   The app raises ONE INVOICE PER MONTH against it.
--
-- So every month the app holds revenue the sheet has never seen, and the amount differs
-- month to month. Geek Town USA (PRJ010526195400, $4,800 × 5 months), Tanium
-- (PRJ110526162138, $1,230 × 4), Screendollars ($9,231 in May and again in June),
-- caddie digital, ChowNow and Compass are all this shape. The largest single unmatched
-- item is Irixs PRJ220726200047, $10,706, Paid in July.
--
-- The reverse direction is small: Apr–Aug the sheet had only 5 rows / $1,084 with no
-- invoice, plus 15 rows / $10,019 carrying no project id at all. The gap runs one way.
create or replace view web_invoice_reconciliation
with (security_invoker = true) as
select
  i.invoice_no,
  i.project_id,
  coalesce(nullif(btrim(i.company_name),''), i.zoho_company) as client,
  i.status,
  i.invoice_at::date as invoice_date,
  i.due_at::date     as due_date,
  i.paid_at::date    as paid_date,
  i.sales_person, i.pc, i.geo, i.invoice_pattern, i.payment_term,
  sum(l.amount_usd)  as our_usd,
  i.total_usd        as invoice_total_usd,
  string_agg(distinct l.service, ', ' order by l.service) as services,
  string_agg(distinct l.project_name, ' | ')              as project_names,
  -- The _N suffix is the app's partial/instalment counter.
  (i.invoice_no ~ '_[0-9]+$') as is_instalment,
  exists (select 1 from web_project_ledger g
          where ledger_project_key(g.project_id) = i.project_id) as in_sheet
from quote_api_invoices i
join quote_api_invoice_lines l on l.invoice_no = i.invoice_no
where quote_api_is_ours(l.service)
group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status,
         i.invoice_at, i.due_at, i.paid_at, i.sales_person, i.pc, i.geo,
         i.invoice_pattern, i.payment_term, i.total_usd;

-- Materialised for the same reason as 096: it reads web_project_ledger, which parses
-- sheet_raw column by column.
create materialized view if not exists invoice_reconciliation_mv as
  select * from web_invoice_reconciliation;
create unique index if not exists invoice_reconciliation_mv_key on invoice_reconciliation_mv(invoice_no);
create index if not exists invoice_reconciliation_mv_date on invoice_reconciliation_mv(invoice_date);
create index if not exists invoice_reconciliation_mv_insheet on invoice_reconciliation_mv(in_sheet);

create or replace function refresh_invoice_sources() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently project_invoice_status_mv;
  refresh materialized view concurrently deal_lifecycle_mv;
  refresh materialized view concurrently invoice_reconciliation_mv;
end $$;
revoke execute on function refresh_invoice_sources() from public, anon, authenticated;
