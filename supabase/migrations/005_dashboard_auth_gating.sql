-- ============================================================================
-- 005 — gate the whole dashboard behind login (Phase 1 + 2).
-- Real security boundary = RLS. The anon key is public (shipped in the static
-- GitHub Pages JS), so data is protected by requiring an authenticated session
-- whose email is on the dashboard_users allowlist. web@uplers.com is super admin.
-- Per-page "who can see what" is enforced in the UI (Sidebar + route guard)
-- against dashboard_users.allowed_pages; the RLS gate above is the hard wall
-- that stops any non-allowlisted request from reading data at all.
-- ============================================================================

-- 1) Allowlist helpers. SECURITY DEFINER so they can read dashboard_users even
--    though that table's own RLS is locked down. STABLE + pinned search_path.
create or replace function public.is_dashboard_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dashboard_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.is_active
      and (u.access_expires_at is null or u.access_expires_at > now())
  );
$$;

create or replace function public.is_dashboard_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dashboard_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.is_active and u.role = 'admin'
      and (u.access_expires_at is null or u.access_expires_at > now())
  );
$$;

-- 2) Flip every data table from public-read (using true) to allowlisted-read.
--    Writers use the service role, which bypasses RLS, so ingestion is unaffected.
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','bookings','clients','email_signals','escalations','feedback',
    'opportunities','quote_conversions','quotes','sql_leads','sync_runs','web_revenue'
  ] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "authed read" on public.%I for select using (public.is_dashboard_user())', t);
  end loop;
end $$;

drop policy if exists "public read sentiment_history" on public.sentiment_history;
create policy "authed read" on public.sentiment_history for select using (public.is_dashboard_user());

-- client_industry had RLS on with no select policy (only the definer view could
-- read it). The view is about to become security_invoker, so add an explicit
-- allowlisted-read policy.
create policy "authed read" on public.client_industry for select using (public.is_dashboard_user());

-- 3) web_clients is the curated feed the dashboard reads. As SECURITY DEFINER it
--    bypassed the RLS above; switch to security_invoker so it enforces the
--    allowlisted-read policies on web_revenue / clients / client_industry.
alter view public.web_clients set (security_invoker = true);

-- 4) dashboard_users: a signed-in user may read their OWN row (to resolve role +
--    allowed_pages); admins may read all rows and manage the allowlist.
drop policy if exists "self read" on public.dashboard_users;
create policy "self or admin read" on public.dashboard_users for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_dashboard_admin());
create policy "admin manage" on public.dashboard_users for all
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

-- 5) Guarantee the super admin exists and is an active admin.
insert into public.dashboard_users (email, full_name, role, is_active)
values ('web@uplers.com', 'Web PM', 'admin', true)
on conflict (email) do update set role = 'admin', is_active = true;
