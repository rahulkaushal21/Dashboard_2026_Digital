-- 100 — the gap was mostly my matching, not the sheet
--
-- Reported gap since April 2026: 130 invoices, $226,723. REAL gap: 38 invoices, $57,964 —
-- 3.8% of invoiced value. Three separate errors, all mine, and Rahul spotted it from the
-- data ("caddie digital is already added in revenue sheet ... i dont see soo many gaps").
--
-- 1. MATCHED ON PROJECT ID ONLY. The project id is RE-ISSUED when a recurring contract
--    renews, so the sheet and the app legitimately hold different ids for one engagement.
--    Caddie is in the sheet EVERY month since Apr 2025; the sheet says PRJ030426100128,
--    the app invoiced PRJ230726064109. The sheet's own invoice_no column already held the
--    answer — 'INV230726064109_2' sits on the August row. I had dismissed that column
--    earlier because it is only about half filled. Half filled is useless as a primary key
--    and decisive as a second route: it recovers 35 invoices, $76,775.
--
-- 2. NO CLIENT-NAME MATCHING. client_canonical_name('caddie digital') is 'caddie digital'
--    and client_canonical_name('Caddie') is 'Caddie', so any third route keyed on the
--    canonical name could never fire. Matching on a 5-character stem instead recovers 18
--    invoices, $37,565 — the renewals where neither id lines up.
--
-- 3. COUNTED THE FUTURE AS MISSING. 133 invoices worth $334,461 carry a date AFTER today:
--    scheduled instalments of live recurring contracts, four of Caddie's six among them
--    (Oct, Nov, Dec 2026). The sheet books a month when it happens, so those rows cannot
--    exist yet and their absence is not a discrepancy. This was the largest single error.
--
-- Result, April 2026 onward: 926 matched on project id, 35 on invoice number, 18 on
-- client + month + value, 39 unmatched but future-dated, 38 genuinely absent. 92.7%.
--
-- THE LESSON, because it will recur: one identifier is not a reconciliation. Match on
-- every key both systems independently record, and never count a future-dated row as a
-- missing one.
create or replace function client_stem(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]', '', 'g');
$$;

-- Materialised because the three-way test over web_project_ledger TIMED OUT: that view
-- parses sheet_raw column by column and this asks it three questions per invoice.
create materialized view if not exists ledger_match_keys_mv as
select
  l.row_key,
  ledger_project_key(l.project_id)         as project_key,
  upper(btrim(coalesce(l.invoice_no, '')))  as invoice_key,
  client_canonical_name(l.company_name)     as client_key,
  l.booking_month,
  round(coalesce(l.amount_usd, 0))          as usd_round
from web_project_ledger l;
create unique index if not exists ledger_match_keys_mv_key on ledger_match_keys_mv(row_key);
create index if not exists ledger_match_keys_mv_pid on ledger_match_keys_mv(project_key);
create index if not exists ledger_match_keys_mv_inv on ledger_match_keys_mv(invoice_key);
create index if not exists ledger_match_keys_mv_cam
  on ledger_match_keys_mv(client_key, booking_month, usd_round);

drop materialized view if exists invoice_reconciliation_mv;
drop view if exists web_invoice_reconciliation;

create view web_invoice_reconciliation
with (security_invoker = true) as
with inv as (
  select
    i.invoice_no, i.project_id,
    coalesce(nullif(btrim(i.company_name),''), i.zoho_company) as client,
    i.status, i.invoice_at::date as invoice_date, i.due_at::date as due_date,
    i.paid_at::date as paid_date, i.sales_person, i.pc, i.geo,
    i.invoice_pattern, i.payment_term,
    sum(l.amount_usd) as our_usd,
    i.total_usd as invoice_total_usd,
    string_agg(distinct l.service, ', ' order by l.service) as services,
    string_agg(distinct l.project_name, ' | ') as project_names,
    (i.invoice_no ~ '_[0-9]+$') as is_instalment
  from quote_api_invoices i
  join quote_api_invoice_lines l on l.invoice_no = i.invoice_no
  where quote_api_is_ours(l.service)
  group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status,
           i.invoice_at, i.due_at, i.paid_at, i.sales_person, i.pc, i.geo,
           i.invoice_pattern, i.payment_term, i.total_usd
)
select
  inv.*,
  (inv.invoice_date > current_date) as is_future,
  -- In order, cheapest and most certain first. The label is kept so a row can always say
  -- WHY it is considered matched — a reconciliation nobody can audit is not one.
  case
    when exists (select 1 from ledger_match_keys_mv k where k.project_key = inv.project_id)
      then 'project id'
    when exists (select 1 from ledger_match_keys_mv k where k.invoice_key = upper(inv.invoice_no))
      then 'invoice no'
    when exists (select 1 from ledger_match_keys_mv k
                 where k.booking_month = date_trunc('month', inv.invoice_date)::date
                   and abs(k.usd_round - round(inv.our_usd)) <= 1
                   and (client_stem(k.client_key) like left(client_stem(inv.client),5) || '%'
                     or client_stem(inv.client) like left(client_stem(k.client_key),5) || '%'))
      then 'client + month + value'
  end as matched_by
from inv;

create materialized view invoice_reconciliation_mv as
  select *, (matched_by is not null) as in_sheet from web_invoice_reconciliation;
create unique index invoice_reconciliation_mv_key on invoice_reconciliation_mv(invoice_no);
create index invoice_reconciliation_mv_date on invoice_reconciliation_mv(invoice_date);
create index invoice_reconciliation_mv_insheet on invoice_reconciliation_mv(in_sheet);
create index invoice_reconciliation_mv_future on invoice_reconciliation_mv(is_future);

-- ledger_match_keys_mv is refreshed FIRST and not concurrently: it has no dependents mid
-- refresh and the three that follow all read it.
create or replace function refresh_invoice_sources() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view ledger_match_keys_mv;
  refresh materialized view concurrently project_invoice_status_mv;
  refresh materialized view concurrently deal_lifecycle_mv;
  refresh materialized view concurrently invoice_reconciliation_mv;
end $$;
revoke execute on function refresh_invoice_sources() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- VOID INVOICES ARE NOT A GAP EITHER (added 29 Sep 2026)
--
-- Irixs showed why. PRJ310326221639 / INV310326221639 was raised 31 Mar for $9,900 and
-- VOIDED; the work was re-invoiced in July as PRJ220726200047 / INV220726200047 for
-- $10,705.82, Paid. The sheet still pointed at the voided one, which is why the live
-- invoice read as absent.
--
-- Once the sheet was repointed at the live invoice, the VOIDED one fell into the gap and
-- looked like a brand new problem. It is the opposite of one: a cancelled invoice has no
-- revenue and must never have a sheet row. Void is excluded from the gap in the page for
-- the same reason future-dated rows are — their absence is correct.
--
-- Gap since April after both exclusions: 34 invoices, $36,906 — 2.4% of invoiced value.
-- ---------------------------------------------------------------------------
