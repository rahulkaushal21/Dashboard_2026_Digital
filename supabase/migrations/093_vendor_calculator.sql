-- The Vendor Calculator's saved calculations.
--
-- The calculator itself runs in the browser (PM Tools → Vendor Calculator) and needs no
-- data. What is kept is the calculation somebody chose to SAVE against a project: the
-- vendor's quote in rupees, the rate it was converted at, the client price and the
-- margin that came out. sheet-writer dumps this table to a hidden "Vendor Calculator"
-- tab in the output spreadsheet, so the numbers sit next to the projects they priced
-- without cluttering the tabs people read.
--
-- Every input is stored, not only the results: a margin is meaningless a month later
-- without the exchange rate it was worked out at.
create table if not exists public.vendor_calculations (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  created_by   text default (auth.jwt() ->> 'email'),
  project      text,
  client       text,
  vendor       text,
  vendor_inr   numeric not null check (vendor_inr > 0),
  usd_inr      numeric not null check (usd_inr > 0),
  aud_rate     numeric,
  vendor_usd   numeric,
  vendor_aud   numeric,
  client_usd   numeric not null check (client_usd > 0),
  client_aud   numeric,
  margin_pct   numeric,
  margin_inr   numeric,
  note         text
);

alter table public.vendor_calculations enable row level security;

-- Same rule as contractors: anybody signed in can read, a registered PM or an admin can
-- save. Nobody edits a saved calculation — a changed price is a new calculation.
drop policy if exists vendor_calculations_read on public.vendor_calculations;
create policy vendor_calculations_read on public.vendor_calculations
  for select using (true);
drop policy if exists vendor_calculations_insert on public.vendor_calculations;
create policy vendor_calculations_insert on public.vendor_calculations
  for insert with check (is_registered_pm() or is_dashboard_admin());
drop policy if exists vendor_calculations_delete on public.vendor_calculations;
create policy vendor_calculations_delete on public.vendor_calculations
  for delete using (is_dashboard_admin() or created_by = (auth.jwt() ->> 'email'));
