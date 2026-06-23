-- ============================================================================
-- Mavlers CRM Dashboard — consolidated schema
-- Source-of-truth notes per table noted inline.
--   BUSINESS SHEET  = the published Google Sheet with all business + client data
--   EMAIL SCAN      = the Claude routine scanning the central PM/client inbox
--   COMPUTED        = derived in SQL views / the app from the above
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CLIENTS  (BUSINESS SHEET)  — one row per client, the spine of everything
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id                bigserial primary key,
  client_name       text not null unique,
  bifurcation       text,                 -- 'Agency' | 'Client'
  industry          text,                 -- for Industry Focus section
  geo               text,
  pm                text,
  am                text,
  past_pm           text,
  past_am           text,
  current_engagements text,
  tenure_months     integer,
  ltv_usd           numeric(14,2),
  hiring            boolean default false, -- Hiring Yes/No
  cross_sell        text,                  -- cross-sell opportunity note
  pdc               text,                  -- "PDC" field — confirm meaning
  rag_status        text default 'Green',  -- Green | Amber | Red (health)
  client_status     text,                  -- active | churned | on-notice
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 2. REVENUE  (BUSINESS SHEET)  — monthly revenue per client, drives trends
-- ----------------------------------------------------------------------------
create table if not exists revenue_monthly (
  id            bigserial primary key,
  client_name   text not null,
  month         date not null,             -- first of month, YYYY-MM-01
  amount_usd    numeric(14,2) default 0,
  engagement_type text,                    -- recurring | one-off | retainer
  service       text,                      -- service / technology line
  new_vs_repeat text,                      -- new | repeat
  unique (client_name, month, service)
);
create index if not exists idx_rev_month   on revenue_monthly(month);
create index if not exists idx_rev_client  on revenue_monthly(client_name);

-- ----------------------------------------------------------------------------
-- 3. OPPORTUNITIES  (EMAIL SCAN)  — RFQs / new + repeat business from the inbox
-- ----------------------------------------------------------------------------
create table if not exists opportunities (
  id              bigserial primary key,
  client_name     text,
  is_new_client   boolean,                 -- new client vs repeat
  repeat_of       text,                    -- if repeat, which client/engagement
  rfq             boolean default false,
  rfq_status      text,                    -- received | pending | quoted | won | lost
  pm              text,
  am              text,
  geo             text,
  tenure_with_ltv text,
  source_subject  text,
  source_sender   text,
  source_date     timestamptz,
  thread_id       text unique,             -- dedup key from Gmail
  summary         text,
  created_at      timestamptz default now()
);
create index if not exists idx_opp_client on opportunities(client_name);
create index if not exists idx_opp_status on opportunities(rfq_status);

-- ----------------------------------------------------------------------------
-- 4. QUOTES  (EMAIL SCAN + BUSINESS SHEET)  — the quote funnel
-- ----------------------------------------------------------------------------
create table if not exists quotes (
  id                 bigserial primary key,
  client_name        text,
  opportunity_id     bigint references opportunities(id),
  status             text,                 -- shared | won | lost
  amount_usd         numeric(14,2),
  lost_reason        text,
  shared_at          timestamptz,
  decided_at         timestamptz,
  opp_to_quote_days  integer,              -- opportunity -> quote shared
  quote_to_conv_days integer,             -- quote shared -> conversion
  service            text,
  geo                text,
  pm                 text,
  new_vs_repeat      text,
  thread_id          text,
  created_at         timestamptz default now()
);
create index if not exists idx_quote_status on quotes(status);

-- ----------------------------------------------------------------------------
-- 5. SQL_LEADS  (EMAIL SCAN)  — sales-qualified leads
-- ----------------------------------------------------------------------------
create table if not exists sql_leads (
  id           bigserial primary key,
  lead_name    text,
  geo          text,
  owner        text,
  persona      text,
  decision     text,                       -- accepted | rejected | pending
  source_date  timestamptz,
  thread_id    text unique,
  summary      text,
  created_at   timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 6. ESCALATIONS  (EMAIL SCAN)  — escalation triggers
-- ----------------------------------------------------------------------------
create table if not exists escalations (
  id           bigserial primary key,
  client_name  text,
  origin       text,                       -- internal | external
  gap_category text,                       -- categorised major gap
  severity     text,                       -- low | medium | high
  quarter      text,                       -- e.g. FY26-Q1 (for >3/quarter rule)
  resolved     boolean default false,
  subject      text,
  source_date  timestamptz,
  thread_id    text unique,
  summary      text,
  created_at   timestamptz default now()
);
create index if not exists idx_esc_quarter on escalations(quarter);

-- ----------------------------------------------------------------------------
-- 7. SENTIMENT  (EMAIL SCAN)  — rolling client sentiment (last quarter)
-- ----------------------------------------------------------------------------
create table if not exists client_sentiment (
  id           bigserial primary key,
  client_name  text,
  sentiment    text,                       -- positive | neutral | negative
  quarter      text,
  source_date  timestamptz,
  thread_id    text,
  snippet      text
);

-- ----------------------------------------------------------------------------
-- 8. SYNC_RUNS  (ROUTINE)  — health/heartbeat of the 2-hourly job
-- ----------------------------------------------------------------------------
create table if not exists sync_runs (
  id           bigserial primary key,
  ran_at       timestamptz default now(),
  source       text,                       -- 'business_sheet' | 'email_scan'
  rows_upserted integer,
  ok           boolean,
  message      text
);

-- ============================================================================
-- COMPUTED VIEWS
-- ============================================================================

-- Monthly revenue totals (Business Trend: this month vs last)
create or replace view v_revenue_by_month as
select month, sum(amount_usd) as revenue, count(distinct client_name) as clients
from revenue_monthly group by month order by month;

-- Top clients (feeds 20/80 / Pareto)
create or replace view v_client_revenue as
select client_name, sum(amount_usd) as revenue
from revenue_monthly group by client_name order by revenue desc;

-- Industry weightage (Industry Focus)
create or replace view v_industry_revenue as
select c.industry, sum(r.amount_usd) as revenue, count(distinct c.client_name) as clients
from clients c join revenue_monthly r on r.client_name = c.client_name
where c.industry is not null group by c.industry order by revenue desc;

-- Quote funnel rollup (Quotes)
create or replace view v_quote_funnel as
select status, count(*) as n, sum(amount_usd) as value,
       avg(opp_to_quote_days) as avg_opp_to_quote,
       avg(quote_to_conv_days) as avg_quote_to_conv
from quotes group by status;

-- ============================================================================
-- ROW LEVEL SECURITY  (mirror of the reference: public read, auth write)
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'clients','revenue_monthly','opportunities','quotes','sql_leads',
    'escalations','client_sentiment','sync_runs'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$create policy "public read" on %I for select using (true);$f$, t);
    execute format($f$create policy "auth write" on %I for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');$f$, t);
  end loop;
end $$;

-- Access-control allowlist (who can log in + which pages they see)
create table if not exists dashboard_users (
  id                bigserial primary key,
  email             text unique not null,
  full_name         text,
  role              text default 'viewer',   -- admin | viewer
  is_active         boolean default true,
  access_expires_at timestamptz,
  allowed_pages     text[],                  -- null = all pages
  created_at        timestamptz default now()
);
alter table dashboard_users enable row level security;
create policy "self read" on dashboard_users for select using (true);
