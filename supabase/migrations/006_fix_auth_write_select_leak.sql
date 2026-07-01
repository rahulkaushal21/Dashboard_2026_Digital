-- ============================================================================
-- 006 — close the allowlist bypass. The pre-existing "auth write" policies were
-- cmd=ALL with using(auth.role()='authenticated'). Because RLS policies are
-- OR'd, that ALL policy also granted SELECT to ANY authenticated user, letting
-- a logged-in-but-not-allowlisted account read every table. The browser never
-- writes these tables (service-role edge functions do), so drop them outright.
-- app_settings is the one table the admin Settings page writes -> admin-only.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','bookings','clients','email_signals','escalations','feedback',
    'opportunities','quote_conversions','quotes','sql_leads','sync_runs','web_revenue'
  ] loop
    execute format('drop policy if exists "auth write" on public.%I', t);
  end loop;
end $$;

-- Only browser write path: admin saving Settings. (Read stays via "authed read".)
create policy "admin write" on public.app_settings for all
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());
