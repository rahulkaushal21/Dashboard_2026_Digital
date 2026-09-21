-- The PM roster, as data the DATABASE can read.
--
-- WHY THIS EXISTS
-- ---------------
-- From 1 Oct 2026 a PM may confirm a deal they own, and only a deal they own.
-- That rule has to be enforced where it cannot be bypassed — in the database,
-- against the Google JWT — which means the database needs to know who the PMs
-- are and which spellings of their name belong to whom.
--
-- Today the roster lives in lib/pm-team.ts, in the app bundle. SQL cannot read
-- it, and a joiner or leaver needs a deploy. This table is seeded from that file
-- verbatim and becomes the authority for WHO MAY WRITE. lib/pm-team.ts stays as
-- the source of the display data the scorecards need (last-year averages, the
-- quarterly overrides), which is presentation and does not gate anything.
--
-- THE ALIASES ARE DELIBERATELY LITERAL, NOT FUZZY. `opportunities.pm_owner` is
-- free text typed by hand, so one person appears under several spellings. The
-- temptation is to match on first name. Do not: 'Rahul Jain' and 'Rahul Kaushal'
-- are different people who both appear as owners, and a bare 'rahul' match hands
-- one person's deals — and the right to confirm them — to the other. lib/nbd.ts
-- and lib/pm-team.ts both make the same choice for the same reason.

create table if not exists public.pm_directory (
  email     text primary key,
  name      text not null,
  slug      text not null unique,
  -- Lower-cased spellings this person appears under in pm_owner / sme columns.
  aliases   text[] not null default '{}',
  active    boolean not null default true,
  added_by  text,
  added_at  timestamptz not null default now(),
  note      text
);

alter table public.pm_directory enable row level security;

-- Any signed-in user may read it: the dashboard needs it to decide which buttons
-- to show, and the roster is not sensitive. anon gets nothing.
drop policy if exists pm_directory_read on public.pm_directory;
create policy pm_directory_read on public.pm_directory
  for select to authenticated using (true);

-- Only admins may change it. This is an AUTHORISATION table — anyone who can add
-- a row can grant themselves the right to confirm somebody else's revenue — so it
-- is written exactly as tightly as dashboard_admins.
drop policy if exists pm_directory_admin_write on public.pm_directory;
create policy pm_directory_admin_write on public.pm_directory
  for all to authenticated
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());

revoke all on public.pm_directory from anon, public;
grant select, insert, update, delete on public.pm_directory to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving a free-text owner to a person
-- ---------------------------------------------------------------------------

-- Normalise the way the rest of the schema does: trim, fold case, collapse runs
-- of whitespace. `norm()` already exists but also strips punctuation, which would
-- merge names we want kept apart, so this is its own thing.
create or replace function public.pm_norm(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select nullif(regexp_replace(lower(trim(coalesce(t,''))), '\s+', ' ', 'g'), '')
$$;

-- The work email of the PM a free-text owner name refers to, or NULL.
--
-- Exact alias match only, against ACTIVE members. NULL means "not a PM we know",
-- which every caller must treat as "nobody may confirm this as its owner" rather
-- than as "anybody may" — see can_confirm_opportunity() below.
create or replace function public.pm_email_for(p_owner text) returns text
language sql stable security definer set search_path = public as $$
  select d.email from public.pm_directory d
   where d.active and public.pm_norm(p_owner) = any (d.aliases)
   limit 1
$$;

-- Is the person signed in right now a registered, active PM?
create or replace function public.is_registered_pm() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() is not null
     and exists (select 1 from public.pm_directory d
                  where d.active and d.email = public.jwt_email())
$$;

-- May the CALLER confirm this deal?
--
-- Admins may confirm anything. A PM may confirm a deal whose pm_owner resolves to
-- their own address. Everyone else — including a signed-in PM looking at a
-- colleague's deal, and including an unassigned deal with no owner — may not.
--
-- An unowned deal resolving to NULL is the case worth being explicit about: it
-- returns false for every PM and stays admin-only, so an ownerless deal creates
-- pressure to assign it rather than quietly becoming confirmable by anyone.
create or replace function public.can_confirm_opportunity(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.jwt_email() is null then false
    when public.is_dashboard_admin() then true
    else exists (
      select 1 from public.opportunities o
       where o.id = p_id
         and public.pm_email_for(o.pm_owner) = public.jwt_email())
  end
$$;

revoke execute on function public.pm_email_for(text)            from public, anon;
revoke execute on function public.is_registered_pm()            from public, anon;
revoke execute on function public.can_confirm_opportunity(bigint) from public, anon;
grant execute on function public.pm_norm(text)                    to anon, authenticated, service_role;
grant execute on function public.pm_email_for(text)               to authenticated, service_role;
grant execute on function public.is_registered_pm()               to authenticated, service_role;
grant execute on function public.can_confirm_opportunity(bigint)  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed: the eleven members of lib/pm-team.ts, aliases verbatim.
-- ---------------------------------------------------------------------------
-- `do nothing` on conflict, so re-running never reverts an edit made in the app.
insert into public.pm_directory (email, name, slug, aliases, added_by, note) values
  ('afzal@mavlers.com',    'Afzal Multani',         'afzal-multani',         array['afzal multani','afzal'],                         'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('bonny@mavlers.com',    'Bonny Chhatbar',        'bonny-chhatbar',        array['bonny chhatbar','bonny chhatbhar','bonny'],      'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('gagandeep@mavlers.com','Gagandeep Singh',       'gagandeep-singh',       array['gagandeep singh','gagandeep'],                   'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('gaurav@mavlers.com',   'Gaurav Pardeshi',       'gaurav-pardeshi',       array['gaurav pardeshi','gaurav'],                      'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('madhav@mavlers.com',   'Madhav Maheshwari',     'madhav-maheshwari',     array['madhav maheshwari','madhav'],                    'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('maitri@mavlers.com',   'Maitri Shah',           'maitri-shah',           array['maitri shah','maitri'],                          'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('malay@mavlers.com',    'Malay Shrivastava',     'malay-shrivastava',     array['malay shrivastava','malay srivastava','malay'],  'web@uplers.com', 'Revenue sheet also spells him Srivastava'),
  ('nitin@mavlers.com',    'Nitin Mishra',          'nitin-mishra',          array['nitin mishra','nitin'],                          'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('paryusha@mavlers.com', 'Paryusha Jain',         'paryusha-jain',         array['paryusha jain','paryusha'],                      'web@uplers.com', 'Seeded from lib/pm-team.ts'),
  ('rahul.j@mavlers.com',  'Rahul Jain',            'rahul-jain',            array['rahul jain'],                                    'web@uplers.com', 'NO bare "rahul" alias — Rahul Kaushal is a different person who also owns rows.'),
  ('sankalp@mavlers.com',  'Sankalp Waman Bhoyar',  'sankalp-waman-bhoyar',  array['sankalp waman bhoyar','sankalp bhoyar','sankalp'],'web@uplers.com','Seeded from lib/pm-team.ts')
on conflict (email) do nothing;
