-- 093 — the deal before the invoice
--
-- The Custom Dashboard API at quote.uplers.net exposes four endpoints that are, it turns
-- out, four views of ONE object moving through a funnel: GetOpportunity, GetRFQ,
-- GetQuote, GetInvoices. Until now the dashboard only knew about the last of those, and
-- only via whatever finance had typed into the sheet's invoice_no column by hand.
--
-- ---------------------------------------------------------------------------
-- THE JOIN KEY IS A TIMESTAMP, AND NOBODY DOCUMENTED IT
--
-- Every identifier the system issues is a three-letter prefix followed by the moment the
-- record was created, DDMMYYhhmmss:
--
--     OPP280926181227   the opportunity
--     RFQ280926181227   the RFQ raised from it
--     QUT280926181227   the quote
--     PRJ280926181227   the project
--     INV280926181227_1 the invoice (the _N suffix is the partial-invoice counter)
--
-- All five share the suffix. That suffix — `deal_key` below — is the only thing linking
-- an opportunity to an RFQ, because the RFQ record carries no OpportunityNumber and the
-- opportunity record carries no RFQNumber. Checked against a full month of live data:
--
--     RFQ suffix == Quote suffix                        373 of 373
--     opportunities with an RFQCreatedDate reaching
--       an RFQ by suffix                                146 of 146
--     invoice ProjectId suffix present in the quotes    321 of 331
--
-- The last gap is not an error — those are quotes raised before the window opened.
--
-- Where an EXPLICIT link exists it is preferred over the suffix: the invoice row carries
-- its own QuoteNumber, so invoices join to quotes on that, and the suffix is only used
-- upstream of the quote, where nothing else exists.
--
-- ---------------------------------------------------------------------------
-- PIPELINE AND RFQ ARE NOT A FUNNEL
--
-- The obvious reading is that a deal goes opportunity → pipeline → RFQ. It does not
-- always. Of 225 live opportunities:
--
--     Opportunity     75   no pipeline date, no RFQ date
--     Pipeline        29   both
--     Pipeline Won   101   both
--     Pipeline Won     4   NEITHER — won without either date being set
--     RFQ Submitted   16   RFQ raised with NO pipeline date
--
-- So "pipeline raised" and "RFQ raised" are two independent facts, each with its own
-- date, and neither implies the other. They are stored as two separate nullable
-- timestamps and derived as two separate booleans. Collapsing them into one funnel
-- position would silently lose the 16 + 4.
--
-- ---------------------------------------------------------------------------
-- THREE DATE FORMATS IN ONE PAYLOAD
--
-- DealCloseDate is 'DD/MM/YYYY'. DealDate is 'DD/MM/YYYY hh:mm:ss AM'. RenewedDate is
-- ISO-8601. Parsing happens in the edge function, which writes real timestamps here, so
-- nothing downstream has to know that.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- RAW MIRRORS
--
-- Each keeps the whole API record in `payload` alongside the columns we read. The API has
-- no "changed since" parameter, so sync re-pulls a rolling window and upserts; keeping the
-- payload means a field we did not think to extract today is still recoverable tomorrow
-- without a backfill.
-- ===========================================================================

create table if not exists quote_api_opportunities (
  opportunity_no   text primary key,
  deal_key         text generated always as (substring(opportunity_no from 4)) stored,
  company_name     text,
  project_name     text,
  client_email     text,
  service          text,
  bu_type          text,
  geo              text,
  am               text,
  geo_head         text,
  technology       text,
  engagement_model text,
  currency         text,
  amount           numeric,
  amount_usd       numeric,
  status           text,          -- always 'Active' so far; kept in case it ever is not
  stage            text,          -- Opportunity | Pipeline | Pipeline Won | RFQ Submitted
  final_stage      text,          -- Pending | Won | Lost | Hold | Deleted
  deal_created_at  timestamptz,
  deal_at          timestamptz,
  deal_close_on    date,
  pipeline_at      timestamptz,   -- NULL = pipeline never raised
  rfq_created_at   timestamptz,   -- NULL = RFQ never raised
  dead_at          timestamptz,
  deleted_at       timestamptz,
  deleted_by       text,
  renewed_at       timestamptz,
  payload          jsonb not null,
  synced_at        timestamptz not null default now()
);
create index if not exists quote_api_opportunities_deal_key on quote_api_opportunities(deal_key);
create index if not exists quote_api_opportunities_service on quote_api_opportunities(service);

-- RFQ and Quote are one row here, not two. The two endpoints returned 373 records each,
-- one-to-one on QuoteNumber, with the same Status on both sides — they are the same
-- object. GetRFQ contributes the RFQ number, the cancellation date, SME and TypeOfWork;
-- GetQuote contributes the authorise/approve/decline dates.
create table if not exists quote_api_quotes (
  quote_no          text primary key,
  rfq_no            text,
  deal_key          text generated always as (substring(quote_no from 4)) stored,
  company_name      text,
  project_name      text,
  client_email      text,
  service           text,
  bu_type           text,
  geo               text,
  am                text,
  geo_head          text,
  pc                text,
  sme               text,
  type_of_work      text,
  engagement_model  text,
  currency          text,
  amount            numeric,
  amount_usd        numeric,
  status            text,         -- Invoice Created | Quote Submitted | Assigned | Cancelled | …
  created_at        timestamptz,
  modified_at       timestamptz,
  authorized_at     timestamptz,
  approved_at       timestamptz,
  declined_at       timestamptz,
  rfq_cancelled_at  timestamptz,
  payload           jsonb not null,
  synced_at         timestamptz not null default now()
);
create index if not exists quote_api_quotes_deal_key on quote_api_quotes(deal_key);
create index if not exists quote_api_quotes_rfq_no on quote_api_quotes(rfq_no);

-- The invoice is keyed on InvoiceNumber, NOT on project: 63 projects carry more than one
-- invoice and 63 invoices span more than one project, so anything keyed on project_id
-- would drop rows.
create table if not exists quote_api_invoices (
  invoice_no          text primary key,
  project_id          text,
  order_project_id    text,
  quote_no            text,
  deal_key            text generated always as (
                        case when project_id is not null then substring(project_id from 4) end) stored,
  company_name        text,
  project_name        text,
  client_email        text,
  service             text,
  bu_type             text,
  geo                 text,
  sales_person        text,
  pc                  text,
  technology          text,
  engagement_model    text,
  zoho_company        text,
  zoho_invoice_no     text,
  status              text,       -- Draft | Sent | Paid | Partially Paid | Overdue | Void
  currency            text,
  conversion_rate     numeric,
  total_usd           numeric,
  service_amount_usd  numeric,
  partially_paid_usd  numeric,
  write_off_usd       numeric,
  is_partial          boolean,
  invoice_pattern     text,
  payment_term        text,
  created_at          timestamptz,
  invoice_at          timestamptz,
  booking_at          timestamptz,
  sent_at             timestamptz,
  due_at              timestamptz,
  paid_at             timestamptz,
  void_at             timestamptz,
  refund_at           timestamptz,
  archived_at         timestamptz,
  start_at            date,
  end_at              date,
  payload             jsonb not null,
  synced_at           timestamptz not null default now()
);
create index if not exists quote_api_invoices_project_id on quote_api_invoices(project_id);
create index if not exists quote_api_invoices_quote_no on quote_api_invoices(quote_no);
create index if not exists quote_api_invoices_status on quote_api_invoices(status);

-- Service is the scope filter, NOT BUType. 'Digital BU' is the whole digital group —
-- over six months it held Development-Email 854, Search-SEM 445, Search-SEO 284 and
-- assorted IGST and PayPal fee lines alongside our work. Filtering on BUType made the
-- project-id match rate look like 23%; filtering on Service it is 85%.
create or replace function quote_api_is_ours(service text) returns boolean
language sql immutable as $$
  select service in ('Development - Web', 'Development - LP/Hub');
$$;

-- ===========================================================================
-- READ MODEL
-- ===========================================================================

-- One row per deal, carrying the five facts the funnel is actually made of, each with its
-- own date. `*_raised` is derived from the DATE being present rather than from Stage,
-- because Stage disagrees with the dates on 20 of 225 records and the date is the thing
-- that can be put on a timeline.
create or replace view web_deal_lifecycle
with (security_invoker = true) as
with inv as (
  select
    coalesce(i.deal_key, q.deal_key)            as deal_key,
    count(*)                                    as invoice_count,
    min(i.invoice_at)                           as first_invoice_at,
    max(i.invoice_at)                           as last_invoice_at,
    min(i.due_at)                               as earliest_due_at,
    max(i.paid_at)                              as last_paid_at,
    sum(i.total_usd)                            as invoiced_usd,
    sum(i.total_usd) filter (where i.status = 'Paid')          as paid_usd,
    sum(i.partially_paid_usd)                   as partially_paid_usd,
    bool_or(i.status = 'Overdue')               as any_overdue,
    bool_or(i.status = 'Draft')                 as any_draft,
    bool_or(i.status = 'Void')                  as any_void,
    -- The worst live state wins, so a project with one paid and one overdue invoice reads
    -- as overdue. Void sorts last: an invoice that was voided is not a problem, it is a
    -- non-event, and letting it outrank Overdue would hide money.
    (array_agg(i.status order by case i.status
        when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
        when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end))[1] as worst_status,
    array_agg(distinct i.project_id) filter (where i.project_id is not null) as project_ids,
    array_agg(distinct i.invoice_no)                                         as invoice_nos
  from quote_api_invoices i
  left join quote_api_quotes q on q.quote_no = i.quote_no
  group by 1
)
select
  coalesce(o.deal_key, q.deal_key, inv.deal_key)              as deal_key,
  coalesce(o.company_name, q.company_name)                    as company_name,
  coalesce(o.project_name, q.project_name)                    as project_name,
  coalesce(o.service, q.service)                              as service,
  coalesce(o.bu_type, q.bu_type)                              as bu_type,
  coalesce(o.geo, q.geo)                                      as geo,
  coalesce(o.am, q.am)                                        as am,
  q.pc,
  coalesce(o.amount_usd, q.amount_usd)                        as value_usd,

  -- 1. opportunity
  o.opportunity_no,
  (o.opportunity_no is not null)                              as opportunity_raised,
  o.deal_created_at                                           as opportunity_at,
  o.stage, o.final_stage,
  o.deal_close_on,

  -- 2. pipeline — independent of the RFQ below
  (o.pipeline_at is not null)                                 as pipeline_raised,
  o.pipeline_at,

  -- 3. RFQ
  coalesce(q.rfq_no is not null, o.rfq_created_at is not null) as rfq_raised,
  q.rfq_no,
  coalesce(o.rfq_created_at, q.created_at)                     as rfq_at,
  q.rfq_cancelled_at,

  -- 4. quote
  q.quote_no,
  (q.quote_no is not null)                                    as quote_raised,
  q.created_at                                                as quote_at,
  q.approved_at                                               as quote_approved_at,
  q.declined_at                                               as quote_declined_at,
  q.status                                                    as quote_status,

  -- 5. invoice
  coalesce(inv.invoice_count, 0) > 0                          as invoice_raised,
  coalesce(inv.invoice_count, 0)                              as invoice_count,
  inv.invoice_nos,
  inv.project_ids,
  inv.worst_status                                            as invoice_status,
  inv.first_invoice_at, inv.last_invoice_at,
  inv.earliest_due_at, inv.last_paid_at,
  inv.invoiced_usd, inv.paid_usd, inv.partially_paid_usd,
  coalesce(inv.any_overdue, false)                            as any_overdue,
  coalesce(inv.any_draft,   false)                            as any_draft,
  coalesce(inv.any_void,    false)                            as any_void,

  quote_api_is_ours(coalesce(o.service, q.service))           as is_our_service
from quote_api_opportunities o
full join quote_api_quotes q using (deal_key)
full join inv               using (deal_key);

-- Per project id, for the Project sheet — the shape a ledger row wants to join to.
-- Left of the join is the LEDGER, so a delivered project with no invoice still appears:
-- "raised nothing" is the state that costs money and it has to be visible, not absent.
create or replace view web_project_invoice_status
with (security_invoker = true) as
select
  l.project_id,
  l.row_key,
  l.company_name,
  l.project_name,
  l.booking_month,
  l.amount_usd                                  as ledger_usd,
  count(i.invoice_no)                           as invoice_count,
  coalesce(sum(i.total_usd), 0)                 as invoiced_usd,
  coalesce(sum(i.total_usd) filter (where i.status = 'Paid'), 0) as paid_usd,
  array_agg(i.status order by case i.status
      when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
      when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end)
    filter (where i.invoice_no is not null)     as statuses,
  min(i.due_at)                                 as earliest_due_at,
  max(i.paid_at)                                as last_paid_at,
  -- The seventh state. Six come from the API; this one is ours, and it is the only one
  -- that says money has not been asked for.
  case
    when count(i.invoice_no) = 0 then 'Not raised'
    else (array_agg(i.status order by case i.status
            when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
            when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end))[1]
  end                                           as status
from web_project_ledger l
left join quote_api_invoices i on i.project_id = l.project_id
where coalesce(btrim(l.project_id), '') <> ''
group by l.project_id, l.row_key, l.company_name, l.project_name, l.booking_month, l.amount_usd;

-- ===========================================================================
-- ACCESS
--
-- Written by the service role only. Readable by signed-in users, matching every other
-- table here — the known Tier 2 gap, not a new one.
-- ===========================================================================
alter table quote_api_opportunities enable row level security;
alter table quote_api_quotes        enable row level security;
alter table quote_api_invoices      enable row level security;

drop policy if exists quote_api_opportunities_read on quote_api_opportunities;
create policy quote_api_opportunities_read on quote_api_opportunities for select to authenticated using (true);
drop policy if exists quote_api_quotes_read on quote_api_quotes;
create policy quote_api_quotes_read on quote_api_quotes for select to authenticated using (true);
drop policy if exists quote_api_invoices_read on quote_api_invoices;
create policy quote_api_invoices_read on quote_api_invoices for select to authenticated using (true);

-- The RFQ pass and the quote pass write the same row in that order. A quote arriving
-- without its RFQ must still insert, so payload is nullable, and the quote's own body
-- gets its own column rather than overwriting the RFQ's.
alter table quote_api_quotes alter column payload drop not null;
alter table quote_api_quotes alter column payload set default '{}'::jsonb;
alter table quote_api_quotes add column if not exists quote_payload jsonb;

-- Hourly at :55 — after refresh-unit-sources at :52, so a run that lands new invoices does
-- not collide with the unit materialised views rebuilding.
select cron.schedule(
  'quote-api-sync',
  '55 * * * *',
  $$select net.http_get(
      url := 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/quote-sync?token=ingestQuoteApi_5d1b83',
      timeout_milliseconds := 120000
  );$$
);
