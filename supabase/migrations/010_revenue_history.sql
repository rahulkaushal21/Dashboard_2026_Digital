-- ============================================================================
-- Historical revenue: one table for the pre-FY25-26 years, plus a registry so
-- each further spreadsheet is a row of config rather than another hardcoded
-- CSV_URL constant and a redeploy.
--
-- Kept OUT of web_revenue on purpose. web_revenue is the spine of Dashboard,
-- Business Trend, Forecast, Last Year and Clients — dropping ~4,600 older rows
-- into it would silently move every one of those numbers (the Clients panel's
-- "Lifetime value (20mo)" is derived from min/max of web_revenue.booking_month
-- and would jump to ~48mo). Loading here changes nothing that already exists;
-- merging later is an insert-select once someone decides that is wanted.
--
-- Column names deliberately mirror web_revenue so that merge stays trivial.
-- ============================================================================

create table if not exists public.revenue_sources (
  key             text primary key,               -- 'fy23-fy25q1'
  label           text not null,
  csv_url         text not null,                  -- published "output=csv" URL
  -- Which column holds what, per source, because every year's sheet differs.
  -- Values are either a 0-based column index (numbers: positions are stable and
  -- unambiguous) or a header string (matched case-insensitively) where a sheet
  -- is better identified by name.
  column_map      jsonb not null default '{}'::jsonb,
  enabled         boolean not null default true,
  -- Once a historical year is loaded and reconciled it must not silently move.
  -- The sync refuses to overwrite an immutable source whose total has changed.
  immutable       boolean not null default false,
  last_synced_at  timestamptz,
  last_rows       int,
  last_total      numeric,
  last_message    text
);

create table if not exists public.revenue_history (
  id               bigserial primary key,
  source_key       text not null references public.revenue_sources(key) on delete cascade,
  company_name     text not null,
  booking_month    date not null,
  booking_amount   numeric(14,2) not null default 0,
  engagement_model text,          -- sheet "Project Type"
  technology       text,
  geo              text,
  -- Kept for audit rather than display: project_id is the sheet's own key (not
  -- unique — 4,297 present, 3,814 distinct, so projects span rows), and
  -- project_status is what the status filter acted on, which has to be
  -- inspectable if a total is ever questioned.
  project_id       text,
  project_status   text,
  client_name      text,          -- fallback when Agency is blank
  src_row_hash     text,
  created_at       timestamptz not null default now()
);

create index if not exists revenue_history_source_idx  on public.revenue_history (source_key);
create index if not exists revenue_history_month_idx   on public.revenue_history (booking_month);
create index if not exists revenue_history_company_idx on public.revenue_history (company_name);
create index if not exists revenue_history_model_idx   on public.revenue_history (engagement_model, booking_month);

-- Same posture as web_revenue / bookings / clients: readable with the anon key,
-- writes only via the service role inside the sync function.
alter table public.revenue_history enable row level security;
alter table public.revenue_sources enable row level security;
drop policy if exists "public read" on public.revenue_history;
drop policy if exists "public read" on public.revenue_sources;
create policy "public read" on public.revenue_history for select using (true);
create policy "public read" on public.revenue_sources for select using (true);

-- The first source: Jan 2023 - Mar 2025 (the sheet also carries one Sep-2022 row).
insert into public.revenue_sources (key, label, csv_url, column_map)
values (
  'fy23-fy25q1',
  'Jan 2023 - Mar 2025',
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTt7k_scrsuJ0YjUr5vHrkXY7aEfIqZpvYzLJmBcEe747fM35vIS7CuwV9YEQAIhi3PhQBIeZJq166c/pub?gid=0&single=true&output=csv',
  '{"agency":18,"client_name":17,"month":34,"amount":36,"model":3,"technology":16,"geo":24,"project_id":0,"status":11}'::jsonb
)
on conflict (key) do update
  set label = excluded.label, csv_url = excluded.csv_url, column_map = excluded.column_map;
