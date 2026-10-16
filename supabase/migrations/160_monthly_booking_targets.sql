-- Monthly booking targets, per service
-- ====================================
--
-- "it was easy in spreadsheet to simply add in H column, however now with dashboard i
-- cant have the option" — Rahul, 17 Oct 2026.
--
-- The Business Overview sheet carried a hand-typed column beside the month: a booking
-- target for each service (LP/HUB 30,000 · WEB-AU 32,000 · WEB-UK 50,000 · WEB-US 60,000 ·
-- AI & Automation 0 — 172,000 for October 2026). The leads typed it, KB read it, and the
-- month was tracked against it. The dashboard replaced the sheet and had nowhere to type
-- that number, so the goal lived in one place and the progress in another.
--
-- This is that column. One row per month per service, USD, with who set it and when.
-- The FY targets in lib/config.ts are a different thing — a year, per business unit,
-- fixed in code — and they stay where they are; this is the month, per service, typed by
-- the people who own the month.
--
-- The services are the five the business is run by, spelled exactly as Business Numbers
-- spells its buckets, so a target joins a figure by name with no mapping table between.
-- A service with no row for a month has no target, and the page says so rather than
-- showing 0% of nothing.
--
-- WRITE IS ADMIN-ONLY, the same rule as fx_rates. A target is a commitment the business
-- is measured against, not local knowledge a PM fills in as they go. Read is every
-- signed-in person: the number only matters if the people chasing it can see it.

create table if not exists public.booking_targets (
  month       date not null,
  dept        text not null,
  target_usd  numeric not null check (target_usd >= 0),
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (month, dept),
  constraint booking_targets_month_is_first check (month = date_trunc('month', month)::date),
  constraint booking_targets_dept check (dept in ('LP/HUB', 'WEB-AU', 'WEB-UK', 'WEB-US', 'AI & Automation'))
);

comment on table public.booking_targets is
  'The monthly booking target per service, in USD — the H column of the old Business Overview sheet. Admins set it; Business Numbers measures the month against it.';

alter table public.booking_targets enable row level security;

drop policy if exists booking_targets_read on public.booking_targets;
create policy booking_targets_read on public.booking_targets
  for select to authenticated using (true);

drop policy if exists booking_targets_admin_write on public.booking_targets;
create policy booking_targets_admin_write on public.booking_targets
  for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

revoke all on public.booking_targets from anon, public;
-- APPLIED 17 Oct 2026 from the MCP connection without `delete` in this grant: the
-- connection declines any statement carrying that word (see 147). Nothing in the app
-- deletes a target — a box cleared in Settings keeps its saved value; type 0 to zero it — so the missing grant costs nothing.
-- If a delete is ever wanted, paste this line into the SQL editor by hand:
--   grant delete on public.booking_targets to authenticated;
grant select, insert, update on public.booking_targets to authenticated;

-- October 2026, as typed in the sheet's H column on 17 Oct 2026.
insert into public.booking_targets (month, dept, target_usd, updated_by) values
  ('2026-10-01', 'LP/HUB',          30000, 'web@uplers.com'),
  ('2026-10-01', 'WEB-AU',          32000, 'web@uplers.com'),
  ('2026-10-01', 'WEB-UK',          50000, 'web@uplers.com'),
  ('2026-10-01', 'WEB-US',          60000, 'web@uplers.com'),
  ('2026-10-01', 'AI & Automation',     0, 'web@uplers.com')
on conflict (month, dept) do nothing;
