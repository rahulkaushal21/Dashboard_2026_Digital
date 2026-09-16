-- Settings: readable by everyone, writable only by a super admin or an admin.
--
-- Before this, app_settings carried a `public write` policy with no condition at
-- all — anyone holding the anon key, which ships in the browser bundle, could
-- rewrite the Business Sheet URL and point the entire routine at a spreadsheet
-- of their choosing. Every booking, quote and SQL figure on the dashboard comes
-- from that URL, so it is the single most valuable field in the system.
--
-- Read stays open: the sheet URL and the scan inbox are not secrets to the
-- business, and the Settings page shows them to everybody.

drop policy if exists "public write" on public.app_settings;
drop policy if exists "public read"  on public.app_settings;

create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);

create policy app_settings_admin_write on public.app_settings
  for all to authenticated
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());

revoke insert, update, delete on public.app_settings from anon;
grant select on public.app_settings to anon, authenticated;
grant insert, update, delete on public.app_settings to authenticated;
