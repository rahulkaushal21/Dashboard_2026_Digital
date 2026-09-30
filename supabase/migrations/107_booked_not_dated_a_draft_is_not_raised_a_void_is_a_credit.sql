-- 107 — booked not dated · a draft is not raised · a void is a credit
--
-- Settled against the invoice app's own September export, row by row (Rahul published the
-- "booking sept 2026" tab, 1 Oct 2026). Its total is $179,511.13. Ours was $205,466.12 on
-- the same scope — and the difference was not data, it was three rules.
--
-- 155 of the export's 162 invoices already agreed TO THE CENT once compared on the right
-- basis. LP/Hub matched exactly ($51,555.56) and AI & Automation matched exactly
-- ($4,444.00). Every one of the eleven that disagreed is explained below.
--
-- ---------------------------------------------------------------------------
-- 1. THE MONTH IS THE BOOKING MONTH, NOT THE INVOICE DATE
--
-- The export is keyed on BookingDate. INV110326211023_1 is DATED 13 March and BOOKS in
-- September. The revenue sheet's Month-Year is a booking month too, so matching an invoice
-- to a sheet row on its invoice date was looking in the wrong month entirely.
--
-- Checked for regression across every invoice since April: the client + month + value
-- route matched 666 either way. Identical — the two dates usually share a month, and when
-- they do not, the booking month is the right one.
--
-- 2. A DRAFT IS NOT RAISED, SO IT BOOKS NOTHING          (+$18,228.90 of September)
--
-- Four September drafts — Aurelian Vault $10,750, 2X $4,600, Global Gate Taxes $2,500,
-- Poloko $378.90 — were counted as invoiced and listed as gaps against sheet rows nobody
-- should have booked yet. They are out of the money and out of the gap.
--
-- They are NOT hidden. web_project_invoice_status keeps 'Draft' in its status array, so a
-- project whose only invoice is a draft still shows a Draft pill with no invoiced value —
-- which is the actionable truth: somebody has to raise it.
--
-- 3. A VOID IS A CREDIT IN THE MONTH IT WAS VOIDED        (-$6,545.93 of September)
--
-- We dropped voided invoices entirely. The app instead books a NEGATIVE in the month of
-- the void. Three Brandtech invoices raised in June and August were voided on 3 Sep
-- ("Both invoices were raised in advance for Oct"), and the export carries them as
-- -2,854.11, -1,846.76 and -1,845.06 against September — matching our figures to the cent.
--
-- This is the more honest treatment and the reason is timing: August's number was correct
-- when August closed. Dropping the invoice retrospectively rewrites a month that has
-- already been reported. A credit in the month it happened does not.
--
-- ---------------------------------------------------------------------------
-- WHAT IS LEFT, AND WHY IT IS NOT FIXED HERE
--
-- September now reads $180,691.29 against the export's $179,511.13 — $1,180.16, or 0.66%,
-- in three named pieces, none of which can be derived from what the API gives us:
--
--   -$1,994.19  DF&Co INV130826203820. Status Paid, no void date, reason "date has been
--               updated", and the export books a negative for it on 3 Sep. The API hands
--               us an invoice's CURRENT STATE, not a ledger of amendments, so an amount or
--               date correction leaves no trace we can read.
--   +$893.76    Vericast INV110326211023_1 and Layer 8 INV130826233117_1. The export says
--               they book on 08/09 and 01/09; GetInvoices returned 08/03 and 01/08 in the
--               same hour. Either the export's BookingDate is a different field or the API
--               is serving a stale value. One for the app team.
--   +$79.73     Searchmarketingpros INV060626001413_4. A -$239.20 Discount line split
--               EQUALLY across the invoice's three services — $79.73 each. We attribute
--               only our own service lines and ignore the discount entirely.
-- ---------------------------------------------------------------------------

-- One row per BOOKING EVENT, which is the unit the business reports on.
create or replace view web_invoice_bookings
with (security_invoker = true) as
with ours as (
  select i.invoice_no, i.project_id, i.status, i.booking_at, i.invoice_at, i.void_at,
         coalesce(nullif(btrim(i.company_name), ''), i.zoho_company) as client,
         i.geo, i.sales_person, i.pc,
         sum(li.amount_usd) filter (where quote_api_is_ours(li.service)) as our_usd,
         string_agg(distinct li.service, ', ' order by li.service)
           filter (where quote_api_is_ours(li.service)) as services
  from quote_api_invoices i
  join quote_api_invoice_lines li on li.invoice_no = i.invoice_no
  where i.deleted_at is null
  group by 1,2,3,4,5,6,7,8,9,10
)
select invoice_no, project_id, client, geo, sales_person, pc, status, services,
       invoice_at::date as invoice_date, booking_at::date as booking_date,
       date_trunc('month', booking_at)::date as booking_month,
       our_usd as amount, 'booking'::text as kind
from ours
where status <> 'Draft' and our_usd is not null and booking_at is not null
union all
select invoice_no, project_id, client, geo, sales_person, pc, status, services,
       invoice_at::date, void_at::date,
       date_trunc('month', void_at)::date,
       -our_usd, 'reversal'
from ours
where status = 'Void' and void_at is not null and our_usd is not null;

comment on view web_invoice_bookings is
  'Invoice money on a BOOKING basis, matching the invoice app''s own monthly report. Three rules, all confirmed against the app export for September 2026: the month is the booking month not the invoice date; a Draft books nothing; a Void books a negative in the month it was voided.';

-- Money tab: a Draft contributes nothing, but keeps its pill.
do $do$
declare d text;
begin
  select pg_get_viewdef('web_project_invoice_status'::regclass, true) into d;
  if position('COALESCE(sum(i.total_usd), 0::numeric) AS invoiced_usd' in d) = 0 then raise exception 'invoiced anchor'; end if;
  d := replace(d, 'COALESCE(sum(i.total_usd), 0::numeric) AS invoiced_usd',
                  'COALESCE(sum(i.total_usd) FILTER (WHERE i.status <> ''Draft''), 0::numeric) AS invoiced_usd');
  if position('count(i.invoice_no) AS invoice_count' in d) = 0 then raise exception 'count anchor'; end if;
  d := replace(d, 'count(i.invoice_no) AS invoice_count',
                  'count(i.invoice_no) FILTER (WHERE i.status <> ''Draft'') AS invoice_count');
  execute 'create or replace view web_project_invoice_status with (security_invoker = true) as ' || d;
end $do$;

-- Reconciliation: booking_date is now a column, the gap drops Drafts, and the
-- client + month + value route matches on the booking month.
drop materialized view if exists invoice_reconciliation_mv;
drop view if exists web_invoice_reconciliation;

create view web_invoice_reconciliation
with (security_invoker = true) as
with inv as (
  select
    i.invoice_no, i.project_id,
    coalesce(nullif(btrim(i.company_name),''), i.zoho_company) as client,
    i.status,
    i.invoice_at::date  as invoice_date,
    i.booking_at::date  as booking_date,
    i.due_at::date as due_date, i.paid_at::date as paid_date,
    i.sales_person, i.pc, i.geo, i.invoice_pattern, i.payment_term,
    sum(l.amount_usd) as our_usd,
    i.total_usd as invoice_total_usd,
    string_agg(distinct l.service, ', ' order by l.service) as services,
    string_agg(distinct l.project_name, ' | ') as project_names,
    (i.invoice_no ~ '_[0-9]+$') as is_instalment
  from quote_api_invoices i
  join quote_api_invoice_lines l on l.invoice_no = i.invoice_no
  where quote_api_is_ours(l.service)
    and i.deleted_at is null
    and coalesce(i.status, '') <> 'Draft'
  group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status,
           i.invoice_at, i.booking_at, i.due_at, i.paid_at, i.sales_person, i.pc, i.geo,
           i.invoice_pattern, i.payment_term, i.total_usd
)
select
  inv.*,
  (inv.invoice_date > current_date) as is_future,
  case
    when exists (select 1 from ledger_match_keys_mv k where k.project_key = inv.project_id)
      then 'project id'
    when exists (select 1 from ledger_match_keys_mv k where k.invoice_key = upper(inv.invoice_no))
      then 'invoice no'
    when exists (select 1 from ledger_match_keys_mv k
                 where k.booking_month = date_trunc('month', coalesce(inv.booking_date, inv.invoice_date))::date
                   and abs(k.usd_round - round(inv.our_usd)) <= 1
                   and (client_match_stem(k.client_key) like left(client_match_stem(inv.client),5) || '%'
                     or client_match_stem(inv.client) like left(client_match_stem(k.client_key),5) || '%'))
      then 'client + month + value'
  end as matched_by
from inv;

create materialized view invoice_reconciliation_mv as
  select *, (matched_by is not null) as in_sheet from web_invoice_reconciliation;
create unique index invoice_reconciliation_mv_key on invoice_reconciliation_mv(invoice_no);
create index invoice_reconciliation_mv_date on invoice_reconciliation_mv(invoice_date);
create index invoice_reconciliation_mv_booking on invoice_reconciliation_mv(booking_date);
create index invoice_reconciliation_mv_insheet on invoice_reconciliation_mv(in_sheet);
create index invoice_reconciliation_mv_future on invoice_reconciliation_mv(is_future);

-- Invoice mapping: same three rules.
do $do$
declare d text; o text;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname='invoice_mapping';

  o := 'i.status, i.invoice_at::date as d, date_trunc(''month'', i.invoice_at)::date as im,';
  if position(o in d)=0 then raise exception 'im anchor'; end if;
  d := replace(d, o, 'i.status, i.invoice_at::date as d, date_trunc(''month'', coalesce(i.booking_at, i.invoice_at))::date as im,');

  o := '    and i.invoice_at >= p.m - interval ''12 months''
    and i.invoice_at <  p.m + interval ''6 months''';
  if position(o in d)=0 then raise exception 'window anchor'; end if;
  d := replace(d, o, '    and coalesce(i.booking_at, i.invoice_at) >= p.m - interval ''12 months''
    and coalesce(i.booking_at, i.invoice_at) <  p.m + interval ''6 months''');

  o := '    and i.deleted_at is null';
  if position(o in d)=0 then raise exception 'deleted anchor'; end if;
  d := replace(d, o, '    and i.deleted_at is null
    and coalesce(i.status, '''') <> ''Draft''');

  execute d;
end $do$;

select refresh_invoice_sources();
