-- ============================================================================
-- 007 — switch to email-only (no-password, no-email) login. Since there is no
-- real auth session, RLS-by-JWT can't gate reads, so data returns to public
-- read (anon key can read it). "Login" is a UI check against the allowlist.
-- The allowlist table stays NOT bulk-readable by the anon key; login + admin
-- management go through SECURITY DEFINER functions instead.
-- ============================================================================

-- 1) Data tables back to public read (writes still service-role only).
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','bookings','clients','email_signals','escalations','feedback',
    'opportunities','quote_conversions','quotes','sql_leads','sync_runs','web_revenue',
    'sentiment_history','client_industry'
  ] loop
    execute format('drop policy if exists "authed read" on public.%I', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
  end loop;
end $$;

-- app_settings is also written from the browser Settings page (no session now).
drop policy if exists "admin write" on public.app_settings;
drop policy if exists "public write" on public.app_settings;
create policy "public write" on public.app_settings for all using (true) with check (true);

-- 2) LOGIN: returns the allowlist row for one email (active only).
create or replace function public.dashboard_check(p_email text)
returns table(email text, full_name text, role text, is_active boolean, allowed_pages text[])
language sql stable security definer set search_path = public as $$
  select email, full_name, role, is_active, allowed_pages
  from public.dashboard_users
  where lower(email) = lower(trim(p_email))
    and is_active
    and (access_expires_at is null or access_expires_at > now());
$$;

-- 3) ADMIN LIST: full allowlist, only if p_actor is an active admin.
create or replace function public.dashboard_list(p_actor text)
returns table(email text, full_name text, role text, is_active boolean, allowed_pages text[])
language sql stable security definer set search_path = public as $$
  select u.email, u.full_name, u.role, u.is_active, u.allowed_pages
  from public.dashboard_users u
  where exists (
    select 1 from public.dashboard_users a
    where lower(a.email) = lower(trim(p_actor)) and a.is_active and a.role = 'admin'
  )
  order by u.created_at;
$$;

-- 4) ADMIN UPSERT: add/update a user; only an active admin may call.
create or replace function public.dashboard_upsert_user(
  p_actor text, p_email text, p_full_name text, p_role text, p_pages text[], p_active boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.dashboard_users
                 where lower(email) = lower(trim(p_actor)) and is_active and role = 'admin') then
    raise exception 'not authorized';
  end if;
  insert into public.dashboard_users (email, full_name, role, is_active, allowed_pages)
  values (lower(trim(p_email)), nullif(p_full_name, ''), coalesce(p_role, 'viewer'),
          coalesce(p_active, true),
          case when p_role = 'admin' then null else coalesce(p_pages, '{}') end)
  on conflict (email) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active,
    allowed_pages = excluded.allowed_pages;
end $$;

-- 5) ADMIN DELETE: only an active admin; the super admin can't be removed.
create or replace function public.dashboard_delete_user(p_actor text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.dashboard_users
                 where lower(email) = lower(trim(p_actor)) and is_active and role = 'admin') then
    raise exception 'not authorized';
  end if;
  delete from public.dashboard_users
  where lower(email) = lower(trim(p_email)) and lower(email) <> 'web@uplers.com';
end $$;

grant execute on function public.dashboard_check(text)        to anon, authenticated;
grant execute on function public.dashboard_list(text)         to anon, authenticated;
grant execute on function public.dashboard_upsert_user(text, text, text, text, text[], boolean) to anon, authenticated;
grant execute on function public.dashboard_delete_user(text, text) to anon, authenticated;
