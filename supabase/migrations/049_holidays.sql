-- Public holidays in the regions we sell into. Applied live 22 Sep 2026.
--
-- The point is the CLIENT's country, not ours. A PM on WEB-UK needs to know the UK is
-- shut on the 25th; a chased approval that lands on a bank holiday costs a week, and
-- nobody checks another country's calendar unprompted.
--
-- A table rather than a runtime fetch: this is a static export with no server, so an
-- external call is a CORS problem and a dependency on somebody else's uptime for data
-- that changes once a year. Seeded from date.nager.at for 2026–2027 (50 rows) and
-- editable, so a date can be corrected or a regional day added by hand.
--
-- National days only. A holiday some counties or states observe and others do not is left
-- out rather than shown as if the whole country were closed — for the UK that means
-- England's list, which is where the client work sits. India is not covered by that
-- source and is not in here; the panel is about the client's country, not ours.
create table if not exists public.holidays (
  region   text not null,          -- 'UK' | 'US' | 'AU', matching the service departments
  on_date  date not null,
  name     text not null,
  primary key (region, on_date)
);

alter table public.holidays enable row level security;
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays for select using (true);
drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays for all
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

grant select on public.holidays to anon, authenticated;
revoke insert, update, delete on public.holidays from anon;

-- The seed itself is in supabase/seed/holidays_2026_2027.sql.
