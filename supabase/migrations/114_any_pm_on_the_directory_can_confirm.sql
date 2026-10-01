-- 114 — any PM on the directory can confirm a deal
--
-- Rahul Jain opened Poloko, a deal whose pm_owner is "Rahul Jain", and was told "This
-- deal belongs to another PM." Two people tried; both were refused.
--
-- can_confirm_opportunity() (062) decides by switching on pm_directory.team, with arms
-- for 'web' and 'nbd' and `else false`. The directory's teams are now LP/HUB, WEB-AU,
-- WEB-UK and WEB-US, so every non-admin falls through to false. Since the pods were
-- renamed, no PM has been able to confirm anything: the named owner included.
--
-- Rahul's call on the rule itself: do not tie a deal to one owner. Many accounts are
-- worked by both LP/HUB and Web, and whoever has the client in front of them should be
-- able to confirm. So the rule is now simply: an admin, or anyone active on the PM
-- directory. The directory stays the gate - it is an authorisation table, and a Google
-- account that is not on it still confirms nothing. The actor is recorded on the deal
-- (confirmed_by) and in opportunity_events, so who did it is never in doubt.
--
-- The move-to-month and recurring-draft paths still check the line's own PM/SME via
-- directory_owner_match(), which never had the team switch and keeps working.
--
-- Applied to the live project 1 Oct 2026, with Rahul's explicit go-ahead.

create or replace function public.can_confirm_opportunity(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.jwt_email() is null then false
    when public.is_dashboard_admin() then true
    else exists (select 1 from public.opportunities o where o.id = p_id)
         and exists (select 1 from public.pm_directory d
                      where d.active and d.email = public.jwt_email())
  end
$$;

revoke execute on function public.can_confirm_opportunity(bigint) from public, anon;
grant  execute on function public.can_confirm_opportunity(bigint) to authenticated, service_role;
