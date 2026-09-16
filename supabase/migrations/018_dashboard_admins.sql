-- Who may see the whole PM Team section.
--
-- Everything else in the dashboard is open to any signed-in mavlers/uplers
-- account. PM KPI is the exception: an admin sees every PM, a PM sees only
-- themselves, and anyone who is neither sees none of it.
--
-- This is the FIRST authorisation table here that cannot be spoofed from the
-- browser. The old dashboard_users RPCs took the actor's email as an argument,
-- so the client could simply claim to be somebody else. These policies read the
-- email out of the Google JWT instead, which the client cannot forge.

create table if not exists public.dashboard_admins (
  email    text primary key,
  added_by text not null,
  added_at timestamptz not null default now(),
  note     text
);

alter table public.dashboard_admins enable row level security;

-- The owner is fixed in a function rather than stored as a row, so the last
-- admin can never be deleted and lock everyone out of admin management.
create or replace function public.dashboard_owner_email() returns text
language sql immutable parallel safe as $$ select 'web@uplers.com'::text $$;

-- The signed-in Google address, lower-cased. NULL when nobody is signed in.
create or replace function public.jwt_email() returns text
language sql stable as $$
  select lower(nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''))
$$;

create or replace function public.is_dashboard_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() is not null
     and (public.jwt_email() = public.dashboard_owner_email()
          or exists (select 1 from public.dashboard_admins a where a.email = public.jwt_email()))
$$;

-- Any signed-in user may READ the list: the app needs it to decide what to show,
-- and knowing who the admins are is not sensitive. anon gets nothing.
drop policy if exists admins_read on public.dashboard_admins;
create policy admins_read on public.dashboard_admins
  for select to authenticated using (true);

-- Only the owner may CHANGE the list. Admins can see it, not edit it.
drop policy if exists admins_owner_write on public.dashboard_admins;
create policy admins_owner_write on public.dashboard_admins
  for all to authenticated
  using (public.jwt_email() = public.dashboard_owner_email())
  with check (public.jwt_email() = public.dashboard_owner_email());

revoke all on public.dashboard_admins from anon;
grant select, insert, update, delete on public.dashboard_admins to authenticated;
grant execute on function public.is_dashboard_admin()   to authenticated;
grant execute on function public.dashboard_owner_email() to authenticated;
grant execute on function public.jwt_email()            to authenticated;

insert into public.dashboard_admins (email, added_by, note)
values ('rahul.k@mavlers.com', 'web@uplers.com', 'Rahul Kaushal — the owner''s own named account.')
on conflict (email) do nothing;
