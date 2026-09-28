-- 096 — materialise the invoice views, and shut a door I left open
--
-- Measured on the live data before any page was built:
--   web_project_invoice_status   2,430 ms
--   web_deal_lifecycle           4,696 ms
--
-- The first inherits web_project_ledger, which parses sheet_raw's jsonb column by column
-- on every read; the second full-joins three mirrors totalling ~32,000 rows. Neither is
-- fit to sit behind a page.
--
-- FOURTH occurrence of the same rule in this project, after 069 (Project sheet went
-- blank), 084 (QBR timeout) and 085 (opportunity dept, 2,726 ms). The rule: if a view
-- reads sheet_raw, or joins the quote_api mirrors, and a page loads it, MATERIALISE IT.
--
-- After: 34 ms and 150 ms.
create materialized view if not exists project_invoice_status_mv as
  select * from web_project_invoice_status;
create unique index if not exists project_invoice_status_mv_key
  on project_invoice_status_mv(row_key);
create index if not exists project_invoice_status_mv_status
  on project_invoice_status_mv(status);
create index if not exists project_invoice_status_mv_month
  on project_invoice_status_mv(booking_month);

create materialized view if not exists deal_lifecycle_mv as
  select * from web_deal_lifecycle;
create unique index if not exists deal_lifecycle_mv_key on deal_lifecycle_mv(deal_key);
create index if not exists deal_lifecycle_mv_ours on deal_lifecycle_mv(is_our_service);

-- CONCURRENTLY so a page reading mid-refresh sees the previous contents rather than an
-- empty table — the exact failure that made the Project sheet render blank in 069.
create or replace function refresh_invoice_sources() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently project_invoice_status_mv;
  refresh materialized view concurrently deal_lifecycle_mv;
end $$;

-- PostgREST exposes every public function as an RPC endpoint, so this was reachable at
-- /rest/v1/rpc/refresh_invoice_sources by an UNAUTHENTICATED caller, who could force two
-- full matview rebuilds on demand. It has to be SECURITY DEFINER to refresh matviews it
-- does not own, so the fix is to take the grant away instead. Only pg_cron calls it.
revoke execute on function refresh_invoice_sources() from public, anon, authenticated;

-- A mutable search_path lets anyone who can create objects shadow the tables a
-- SECURITY DEFINER function names.
alter function quote_api_is_ours(text)  set search_path = public;
alter function ledger_project_key(text) set search_path = public;

-- :57, two minutes after quote-sync lands new rows at :55.
select cron.schedule('refresh-invoice-sources', '57 * * * *',
  $$select refresh_invoice_sources();$$);
