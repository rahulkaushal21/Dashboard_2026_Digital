-- Two teams in the directory, and ownership that reflects how each one is named
-- on a deal.
--
-- THE BUG THIS FIXES: 021 decided ownership from `pm_owner` alone. That is right
-- for a web PM and wrong for NBD, who are named in `sales_person` — they open the
-- business, they do not project-manage it. Checked against live data, Malav Modi
-- has 17 OPEN deals as sales_person and none as pm_owner, so under the old rule
-- no NBD member could confirm anything at all.
--
-- So a directory row now carries the team it belongs to, and ownership is tested
-- against the column that team is actually named in.
alter table public.pm_directory
  add column if not exists team text not null default 'web';

alter table public.pm_directory drop constraint if exists pm_directory_team_chk;
alter table public.pm_directory add constraint pm_directory_team_chk check (team in ('web','nbd'));

-- Does this person appear among the owners named in a free-text cell?
--
-- One cell can carry several people — 'Malav Modi / Kalgi Shah' — so it is split
-- on the same separators lib/nbd.ts splits on before matching. Each part must
-- match an alias EXACTLY; substring matching is what the aliases exist to avoid.
--
-- Verified against the live rows: 'Malav Modi / Kalgi Shah' matches Malav, bare
-- 'Nevilson' matches Nevilson Christian, 'Kaustubh Kulkarni' matches nobody
-- (he is not Kaustubh Agrawal), and 'Rahul Kaushal, Krunal' does NOT match
-- Rahul Jain — the collision lib/pm-team.ts has warned about from the start.
create or replace function public.directory_owner_match(p_owners text, p_email text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pm_directory d,
      lateral unnest(regexp_split_to_array(coalesce(p_owners,''), '\s*(,|/|&|\band\b)\s*')) as t(part)
     where d.active and d.email = p_email
       and public.pm_norm(t.part) = any (d.aliases)
  )
$$;

-- Admins confirm anything. Everyone else must be named on the deal, in the
-- column their team is named in. A person on neither team, and an unowned deal,
-- both fall through to false — admin-only, which is the safe default.
create or replace function public.can_confirm_opportunity(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.jwt_email() is null then false
    when public.is_dashboard_admin() then true
    else exists (
      select 1
        from public.opportunities o
        join public.pm_directory d
          on d.active and d.email = public.jwt_email()
       where o.id = p_id
         and case d.team
               when 'web' then public.directory_owner_match(o.pm_owner,     d.email)
               when 'nbd' then public.directory_owner_match(o.sales_person, d.email)
               else false
             end)
  end
$$;

revoke execute on function public.directory_owner_match(text, text) from public, anon;
grant  execute on function public.directory_owner_match(text, text) to authenticated, service_role;

-- NBD members. Emails taken from real mail traffic rather than guessed from the
-- name, for the reason lib/pm-team.ts records: a guessed address either fails to
-- match or, worse, matches somebody else.
--
-- NOT ADDED, deliberately, and each one confirmed as out of scope for web:
--   Tejal Vyas      — Design team
--   Dhrumi Mehta    — SEO/SEM PM
--   Pratik Bhatt    — LP/Hub owner; those deals belong to Nitin or Madhav
--   Harshal Mehuriya — 22 deals, all quiet since 3 Apr 2026
--
-- STILL OUTSTANDING: Dhruti Dave (NBD, 1 open deal) has no address anywhere in
-- the mail corpus. She is NOT dhrumi@mavlers.com (Dhrumi Mehta, excluded above)
-- and NOT dhrumil@uplers.com — three similar names, so this one waits for a
-- confirmed address rather than being guessed.
insert into public.pm_directory (email, name, slug, aliases, team, added_by, note) values
  ('nevilson@mavlers.com', 'Nevilson Christian', 'nevilson-christian', array['nevilson christian','nevilson'], 'nbd', 'web@uplers.com', 'NBD head. Email confirmed from mail traffic.'),
  ('malav@mavlers.com',    'Malav Modi',         'malav-modi',         array['malav modi','malav'],            'nbd', 'web@uplers.com', 'NBD. Older mail also shows malav@uplers.com; mavlers is current.')
on conflict (email) do nothing;
