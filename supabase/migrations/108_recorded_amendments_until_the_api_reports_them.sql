-- 108 — recorded amendments, until the API reports them · and a 15-minute sync
--
-- Two things Rahul asked for on 1 Oct 2026, both of which are bridges to the API change
-- the invoice app team will ship in about a week.
--
-- ---------------------------------------------------------------------------
-- 1. SEPTEMBER MUST READ $179,511.13
--
-- Migration 107 got the month to $180,691.29 against the app's $179,511.13. The $1,180.16
-- left is four invoices that were AMENDED after being raised. The app books each amendment
-- as its own dated event; GetInvoices returns only an invoice's final state, so the
-- amendment leaves no trace we can read. It cannot be derived. It can only be recorded.
--
-- So it is recorded — explicitly, one row per amendment, each carrying the app's own reason
-- and naming the report it was copied from:
--
--   INV130826203820    DF&Co                 -1,994.19  "date has been updated"
--   INV110326211023_1  Vericast                 660.42  "To add prepayment discount"
--   INV130826233117_1  Layer 8 Training         233.34  "to uncheck Start & End date"
--   INV060626001413_4  Searchmarketingpros      -79.73  "updated the scale up resource cost"
--
-- The last one is the app splitting that invoice's $239.20 discount EQUALLY across its
-- three services — $79.73 each — where we attribute only our own service lines.
--
-- THE RULE FOR THIS TABLE, because a table like this is how a number quietly becomes
-- fiction: a row is only ever added with the app's own report as its source, naming the
-- invoice and the app's reason. Never to make a total come out right. If an adjustment
-- cannot be pointed at a specific invoice in the app's report, it does not go in.
--
-- It is deliberately a separate table and a separate `kind` in the view, not an edit to
-- any invoice, so that on the day the API exposes booking events the whole thing is one
-- DROP and every number moves back to being derived.
--
-- Result: September ties to the app's report exactly, and so does every department —
--   LP/HUB $51,555.56 · WEB-US $51,341.93 · WEB-UK $45,685.21 · WEB-AU $26,484.43 ·
--   AI & Automation $4,444.00 · total $179,511.13.
--
-- ---------------------------------------------------------------------------
-- 2. SYNC EVERY 15 MINUTES
--
-- Hourly was too slow to be trusted as the system of record. Until MODIFIEDSINCE exists
-- every run still re-pulls a rolling 120 days, so this costs four times the API calls for
-- the same work — accepted deliberately, and worth revisiting the moment the API can tell
-- us what changed.
--
--   :00 :15 :30 :45  quote-api-sync
--   :03 :18 :33 :48  mark-deleted-invoices   (after the pull, so "missing" means missing)
--   :05 :20 :35 :50  refresh-invoice-sources (after the marking, so the matviews see it)
-- ---------------------------------------------------------------------------

create table if not exists invoice_booking_adjustments (
  adjustment_key text primary key,
  invoice_no     text not null,
  booking_month  date not null,
  amount         numeric not null,
  service        text not null,
  reason         text,
  source         text not null,
  recorded_by    text,
  recorded_at    timestamptz not null default now()
);

comment on table invoice_booking_adjustments is
  'Amendments the invoice app books as their own event and GetInvoices cannot report. TEMPORARY: every row here is a hand-recorded fact copied from the app''s own booking report, and the whole table retires when the API exposes booking events. A row is only ever added with the app report as its source — never to make a total come out right.';

alter table invoice_booking_adjustments enable row level security;
drop policy if exists invoice_booking_adjustments_read on invoice_booking_adjustments;
create policy invoice_booking_adjustments_read on invoice_booking_adjustments
  for select to authenticated using (true);

insert into invoice_booking_adjustments
  (adjustment_key, invoice_no, booking_month, amount, service, reason, source, recorded_by)
values
  ('INV130826203820:2026-09',   'INV130826203820',   '2026-09-01', -1994.19, 'Development - Web',
   'date has been updated',              'Invoice app Booking Data report, 1 Oct 2026', 'Rahul Kaushal'),
  ('INV110326211023_1:2026-09', 'INV110326211023_1', '2026-09-01',   660.42, 'Development - Web',
   'To add prepayment discount',         'Invoice app Booking Data report, 1 Oct 2026', 'Rahul Kaushal'),
  ('INV130826233117_1:2026-09', 'INV130826233117_1', '2026-09-01',   233.34, 'Development - Web',
   'to uncheck Start & End date',        'Invoice app Booking Data report, 1 Oct 2026', 'Rahul Kaushal'),
  ('INV060626001413_4:2026-09', 'INV060626001413_4', '2026-09-01',   -79.73, 'Development - Web',
   'updated the scale up resource cost — the app splits the invoice''s $239.20 discount equally across its three services',
                                         'Invoice app Booking Data report, 1 Oct 2026', 'Rahul Kaushal')
on conflict (adjustment_key) do update
  set amount = excluded.amount, reason = excluded.reason, source = excluded.source;

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
       our_usd as amount, 'booking'::text as kind, null::text as reason
from ours
where status <> 'Draft' and our_usd is not null and booking_at is not null
union all
select invoice_no, project_id, client, geo, sales_person, pc, status, services,
       invoice_at::date, void_at::date,
       date_trunc('month', void_at)::date,
       -our_usd, 'reversal', 'Voided'
from ours
where status = 'Void' and void_at is not null and our_usd is not null
union all
select a.invoice_no, o.project_id, o.client, o.geo, o.sales_person, o.pc, o.status, a.service,
       o.invoice_at::date, a.booking_month, a.booking_month, a.amount, 'adjustment', a.reason
from invoice_booking_adjustments a
left join ours o on o.invoice_no = a.invoice_no;

create or replace view web_invoice_booking_months
with (security_invoker = true) as
select
  booking_month,
  round(sum(amount), 2)                                                 as booked_usd,
  count(*) filter (where kind = 'booking')                              as invoices,
  round(coalesce(sum(amount) filter (where kind = 'reversal'), 0), 2)   as reversals_usd,
  round(coalesce(sum(amount) filter (where kind = 'adjustment'), 0), 2) as adjustments_usd
from web_invoice_bookings
where booking_month is not null
group by booking_month;

comment on view web_invoice_booking_months is
  'The invoice app''s own monthly booking figure, month by month. September 2026 ties to it exactly, $179,511.13, and so does every department.';

select cron.schedule('quote-api-sync', '0,15,30,45 * * * *',
  (select command from cron.job where jobname = 'quote-api-sync'));
select cron.schedule('mark-deleted-invoices', '3,18,33,48 * * * *',
  $$select public.mark_deleted_invoices();$$);
select cron.schedule('refresh-invoice-sources', '5,20,35,50 * * * *',
  $$select refresh_invoice_sources();$$);
