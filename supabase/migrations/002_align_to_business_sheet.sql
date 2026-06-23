-- ============================================================================
-- 002 — align schema to the real Business Sheet tabs
-- Safe to run on the empty DB: drops the earlier guessed tables and recreates
-- them to match the actual sheet columns. Run AFTER 001 in the SQL editor.
-- ============================================================================
drop table if exists revenue_monthly cascade;
drop table if exists opportunities  cascade;
drop table if exists quotes         cascade;
drop table if exists sql_leads       cascade;
drop table if exists escalations     cascade;
drop table if exists client_sentiment cascade;
drop table if exists clients          cascade;

-- BOOKINGS (Booking Data_Master)  — the revenue source
create table bookings (
  id              bigserial primary key,
  invoice_number  text,
  order_number    text,
  invoice_date    date,
  order_date      date,
  booking_date    date,
  booking_month   date,
  company_name    text,
  contact_email   text,
  booking_amount  numeric(14,2),
  service_name    text,
  sales_person    text,
  geo_head        text,
  engagement_model text,            -- Recurring | P2P | Dedicated FTE
  geo             text,
  sme             text,
  src_row_hash    text unique
);
create index on bookings(booking_month);
create index on bookings(company_name);

-- QUOTES (Quotes tab) — the quote funnel
create table quotes (
  id              bigserial primary key,
  quote_id        text,
  added_date      date,
  service_dept    text,
  technology      text,
  subject_project text,
  agency          text,
  client_email    text,
  pc_sme          text,
  project_type    text,
  currency_type   text,
  estimated_cost  numeric(14,2),
  usd_value       numeric(14,2),
  status          text,             -- Quote Shared | Cancelled | Waiting… | Confirmed
  notes           text,
  geo             text,
  business_type   text,             -- New | Repeat
  sales_person    text,
  confirmed_in_days integer,
  src_row_hash    text unique
);
create index on quotes(status);
create index on quotes(added_date);

-- SQL LEADS (Web Sqls tab)
create table sql_leads (
  id            bigserial primary key,
  month         text,
  year          integer,
  venture       text,               -- Mavlers | Uplers | Mavlers Agency …
  lead_date     date,
  email_address text,
  industry      text,
  persona       text,
  prospect_city text,
  prospect_region text,
  assigned_to   text,
  company_name  text,
  employees     text,
  query_about   text,
  services_bifurcation text,
  esp           text,
  comment       text,
  src_row_hash  text unique
);
create index on sql_leads(month, year);

-- ESCALATIONS (EMAIL SCAN, stringent — sheet escalation tab is stale)
create table escalations (
  id            bigserial primary key,
  raised_by     text,
  tracking_date date,
  month         text,
  week          text,
  service_type  text,
  company_name  text,
  geo           text,
  deal_type     text,
  email_subject text,
  link          text,
  project_name  text,
  reference_id  text,
  situation_type text,              -- Functional | Technical
  source        text,
  escalation_type text,             -- Major | Not An Escalation
  business_impact text,             -- Low | Medium | High
  source_sender text,
  source_date   date,
  evidence      text,               -- short quote of the escalation line
  thread_id     text unique
);
create index on escalations(month);

-- FEEDBACK (EMAIL SCAN, stringent — sheet feedback tab is stale)
create table feedback (
  id            bigserial primary key,
  added_date    date,
  service_dept  text,
  pc_sme        text,
  feedback_type text,
  visibility    text,               -- Publishable | Non-Publishable
  nature        text,               -- Positive | Negative | Neutral
  agency        text,
  geo           text,
  client_email  text,
  project_names text,
  csat          integer,            -- from Automatic Feedback (1–5), null for text
  comments      text,
  month_year    date,
  source_sender text,
  evidence      text,
  thread_id     text unique
);

-- OPPORTUNITIES (EMAIL SCAN only — new RFQs/business not yet logged in the sheet)
create table opportunities (
  id             bigserial primary key,
  company_name   text,
  is_new_client  boolean,
  repeat_of      text,
  rfq            boolean default false,
  rfq_status     text,              -- received | pending | quoted | won | lost
  geo            text,
  sales_person   text,
  source_subject text,
  source_sender  text,
  source_date    timestamptz,
  thread_id      text unique,
  summary        text
);

-- QUOTE CONVERSIONS (EMAIL SCAN, stringent) — won/lost outcome the sheet lacks
create table quote_conversions (
  id            bigserial primary key,
  company_name  text,
  quote_ref     text,               -- matched Quotes.quote_id when confident, else null
  outcome       text,               -- won | lost   (only when explicitly confirmed)
  lost_reason   text,
  amount_usd    numeric(14,2),
  decided_at    date,
  evidence      text,               -- short quote of the confirming line
  source_sender text,
  thread_id     text unique,
  summary       text
);
create index on quote_conversions(outcome);

-- CLIENTS (DERIVED) — one row per company, enriched from the tabs above
create table clients (
  id            bigserial primary key,
  company_name  text unique not null,
  client_type   text,               -- Agency | Direct/End | Enterprise
  industry      text,
  geo           text,
  pc_sme        text,
  sales_person  text,
  ltv_usd       numeric(14,2),      -- sum of bookings
  last_booking_month date,
  sentiment     text,               -- latest from feedback
  rag_status    text default 'Green',
  client_status text                -- active | on-notice | churned
);

-- ---- Views the dashboard reads ----
create or replace view v_revenue_by_month as
select booking_month as month, sum(booking_amount) revenue, count(distinct company_name) clients
from bookings group by booking_month order by booking_month;

create or replace view v_client_revenue as
select company_name, sum(booking_amount) revenue
from bookings group by company_name order by revenue desc;

create or replace view v_quote_funnel as
select status, count(*) n, sum(usd_value) value, avg(confirmed_in_days) avg_days
from quotes group by status;

create or replace view v_industry_revenue as
select c.industry, sum(b.booking_amount) revenue, count(distinct b.company_name) clients
from clients c join bookings b on b.company_name = c.company_name
where c.industry is not null group by c.industry order by revenue desc;

-- ---- RLS (public read, authenticated write) ----
do $$ declare t text; begin
  foreach t in array array['bookings','quotes','sql_leads','escalations',
    'feedback','opportunities','quote_conversions','clients'] loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$create policy "public read" on %I for select using (true);$f$, t);
    execute format($f$create policy "auth write" on %I for all
      using (auth.role()='authenticated') with check (auth.role()='authenticated');$f$, t);
  end loop;
end $$;
