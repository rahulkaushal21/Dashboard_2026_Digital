-- The incentive sheet has a named audience
-- ========================================
--
-- It began as one address. Rahul, 15 Oct 2026: also Krunal, Krunal S, Hiren and Pratik.
--
-- THE LIST IS DATA NOW, not a literal inside the gate. 149 and 151 compared v_actor to
-- 'rahul.k@mavlers.com' in the function body, which meant every change to the audience
-- was a rewrite of a 70-line function through the migration tool — the kind of change
-- that gets declined and then done in a hurry. Adding or removing somebody is now one
-- insert or one delete against incentive_viewers.
--
-- STILL NOT A ROLE. is_admin covers five dashboard admins and isOwner() covers
-- web@uplers.com, and people in both must remain outside this; the PMs the sheet is
-- about are outside it too. So the list enumerates individuals and nothing else, and
-- neither existing check could be reused.
--
-- Tested by impersonation, each in a single statement so the claim could not be lost
-- between them:
--
--   rahul.k, krunal, krunal.s, hiren, pratik   11 rows each
--   web@uplers.com                             refused   (owner)
--   rahul.j@mavlers.com                        refused   (a PM who is IN the table)
--
-- The browser copy of the list is INCENTIVE_EMAILS in lib/access, which decides the menu
-- entry and the route. Keep the two in step: somebody added there but not here reaches a
-- page that says "Nothing to show", which is a confusing way to be refused.
--
-- The addresses do ship in the public bundle, as the single address always did. That
-- says who may look. It does not say what they would see — the rates and the payouts
-- are still computed entirely in here and appear in zero files of the build.

create table if not exists public.incentive_viewers (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);
alter table public.incentive_viewers enable row level security;
revoke all on public.incentive_viewers from public, anon, authenticated;

insert into public.incentive_viewers (email, note) values
  ('rahul.k@mavlers.com', 'Asked for the sheet'),
  ('krunal@mavlers.com',  'Added 15 Oct 2026'),
  ('krunal.s@mavlers.com','Added 15 Oct 2026'),
  ('hiren@mavlers.com',   'Added 15 Oct 2026'),
  ('pratik@mavlers.com',  'Added 15 Oct 2026')
on conflict (email) do nothing;

-- Security definer, because the table it reads is readable by nobody.
create or replace function public.may_see_incentive(p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.incentive_viewers v
    where v.email = lower(btrim(coalesce(p_email, '')))
  );
$$;
revoke execute on function public.may_see_incentive(text) from public, anon, authenticated;

-- pm_incentive_sheet() keeps the body it had in 152; only its gate changed, from a
-- literal comparison to may_see_incentive(). Its text is applied live; see the function
-- definition in the database.
