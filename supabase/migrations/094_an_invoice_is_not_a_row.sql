-- 094 — an invoice is not a row
--
-- 093 keyed quote_api_invoices on InvoiceNumber and assumed that was one invoice. It is
-- not. GetInvoices returns ONE ROW PER LINE ITEM, and every invoice-level field is
-- repeated on each line. September: 577 rows, 489 invoices, one invoice carrying 11 lines.
--
-- The fields that repeat per line are Status, TotalInvoiceAmountInUSD, ProjectId, DueDate,
-- PaidDate, QuoteNumber, BUType and Currency — checked across six months, none of them
-- ever varies within a single InvoiceNumber. The fields that differ per line are Service,
-- ServiceAmount, ServiceAmountInUSD, ProjectName, UniqueId and StartDate.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MATTERS ENOUGH TO REDO THE TABLE
--
-- Two things break if lines are treated as invoices:
--
-- 1. MONEY DOUBLES. TotalInvoiceAmountInUSD is the INVOICE total, repeated on every line.
--    Summing it per row gives September $1,953,497 against a true $963,211 — a little
--    over 2x. Summing ServiceAmountInUSD instead gives $963,210, which reconciles to the
--    invoice totals to within a dollar of rounding.
--
-- 2. SCOPE BREAKS. 29 of the 58 multi-line September invoices mix one of our two services
--    with something else — a Development-Web line and a Search-SEO line on one invoice.
--    So "is this invoice ours" cannot be answered from a single Service value, and the
--    revenue that is OURS is the sum of our LINES, not the invoice total. Collapsing to
--    one row per invoice and filtering on whichever Service survived would have both
--    mis-scoped the invoice and overstated it.
--
-- 093's loader happened to dedupe on InvoiceNumber, so it never double-counted — it
-- silently dropped 88 of 577 lines instead, keeping an arbitrary one. Neither is right.
--
-- ---------------------------------------------------------------------------
-- THE LINE KEY
--
-- UniqueId is '<lineId>_<invoiceId>' and is nearly unique: 576 distinct across 577
-- September rows. The one collision is a pair of lines both carrying line id 0 — a
-- 'Paypal Fee' of $105 and a 'Wallet' of $3,000 on the same invoice, distinguished only
-- by Service. So the key is the triple (InvoiceNumber, UniqueId, Service).
-- ---------------------------------------------------------------------------

-- Line-level fields move out of the header. They were only ever populated with whichever
-- line happened to win the dedupe.
alter table quote_api_invoices drop column if exists service;
alter table quote_api_invoices drop column if exists service_amount_usd;
alter table quote_api_invoices drop column if exists project_name;
alter table quote_api_invoices drop column if exists start_at;
alter table quote_api_invoices drop column if exists end_at;
alter table quote_api_invoices drop column if exists technology;

create table if not exists quote_api_invoice_lines (
  line_key        text primary key,   -- invoice_no | unique_id | service
  invoice_no      text not null references quote_api_invoices(invoice_no) on delete cascade,
  unique_id       text,
  service         text,
  project_name    text,
  technology      text,
  type_of_work    text,
  amount          numeric,
  amount_usd      numeric,            -- ServiceAmountInUSD — the figure that is safe to sum
  outsource_amount numeric,
  execution_type  text,
  frequency       text,
  start_at        date,
  end_at          date,
  payload         jsonb not null,
  synced_at       timestamptz not null default now()
);
create index if not exists quote_api_invoice_lines_invoice on quote_api_invoice_lines(invoice_no);
create index if not exists quote_api_invoice_lines_service on quote_api_invoice_lines(service);

alter table quote_api_invoice_lines enable row level security;
drop policy if exists quote_api_invoice_lines_read on quote_api_invoice_lines;
create policy quote_api_invoice_lines_read on quote_api_invoice_lines
  for select to authenticated using (true);

-- An invoice is ours if ANY of its lines is, and only our lines' money is ours.
create or replace view web_invoice_scope
with (security_invoker = true) as
select
  i.invoice_no,
  i.project_id,
  i.status,
  i.total_usd,
  coalesce(sum(l.amount_usd) filter (where quote_api_is_ours(l.service)), 0) as ours_usd,
  coalesce(sum(l.amount_usd), 0)                                            as lines_usd,
  count(l.line_key)                                                          as line_count,
  bool_or(quote_api_is_ours(l.service))                                      as is_ours,
  bool_or(quote_api_is_ours(l.service)) and bool_or(not quote_api_is_ours(l.service)) as is_mixed,
  array_agg(distinct l.service) filter (where l.service is not null)         as services
from quote_api_invoices i
left join quote_api_invoice_lines l on l.invoice_no = i.invoice_no
group by i.invoice_no, i.project_id, i.status, i.total_usd;
