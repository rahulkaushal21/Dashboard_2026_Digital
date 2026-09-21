-- The directory is the PM team only, and `team` becomes a pod label.
--
-- TWO CHANGES, and the second quietly undoes the design of 023.
--
-- 1. NBD members removed. Nevilson Christian, Malav Modi and Dhruti Dave are out at the
--    owner's direction: this list is the PM team.
--
-- 2. `team` no longer decides anything. In 023 it chose WHICH COLUMN ownership was read
--    from — web against pm_owner, nbd against sales_person. It is now a pod label
--    (LP/HUB, WEB-AU, WEB-UK, WEB-US) for grouping the team, and ownership is always
--    pm_owner. With no NBD members left there is nobody the sales_person branch would
--    have served, so the branch goes rather than sitting unreachable.
--
-- THE COST, recorded so it is not rediscovered as a bug: deals whose only recognisable
-- owner was an NBD account owner now resolve to nobody and are admin-only. That is 21
-- open deals, 17 of them Malav's, and it pushed the unowned share of the Needs-input
-- queue from 6 to 8. The fix, if those deals should be actionable by a PM, is to put a
-- PM in their pm_owner column - not to re-add the account owners here.
--
-- Everyone is left UNTAGGED. A pod is a label, and guessing which pod somebody belongs
-- to would put wrong data in front of people who would then trust it.

delete from public.pm_directory where team = 'nbd';

alter table public.pm_directory drop constraint if exists pm_directory_team_chk;
alter table public.pm_directory alter column team drop default;
alter table public.pm_directory alter column team drop not null;
update public.pm_directory set team = null where team in ('web','nbd');
alter table public.pm_directory add constraint pm_directory_team_chk
  check (team is null or team in ('LP/HUB','WEB-AU','WEB-UK','WEB-US'));

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
         and public.directory_owner_match(o.pm_owner, d.email))
  end
$$;

-- p_sales_person is kept in the signature, unused, so the view and every caller keep
-- working. Dropping the argument would mean rebuilding web_needs_input in the same
-- migration for no gain.
create or replace function public.opportunity_owner_email(p_pm_owner text, p_sales_person text)
returns text
language sql stable security definer set search_path = public as $$
  select d.email from public.pm_directory d
   where d.active and public.directory_owner_match(p_pm_owner, d.email)
   limit 1
$$;
