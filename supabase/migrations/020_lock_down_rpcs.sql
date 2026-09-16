-- Tier 1: stop anonymous callers from CHANGING the business data.
--
-- Every function below is SECURITY DEFINER, so it runs with the owner's rights
-- and ignores RLS entirely. All of them were callable by `anon` — i.e. by anyone
-- holding the publishable key, which necessarily ships inside the browser bundle.
-- The Google sign-in we added gates the user interface; it never gated these.
-- A stranger could mark deals won or lost, clear escalations, or kick off the
-- heavy reconcile jobs, straight from the REST API with no session at all.
--
-- THE IMPORTANT DETAIL: Postgres grants EXECUTE on a new function to PUBLIC by
-- default, and `anon` inherits that. Revoking from `anon` alone leaves the
-- function callable through the PUBLIC grant, so every statement here revokes
-- from PUBLIC first and then grants back only to the roles that need it.
--
-- Reads are deliberately untouched — that is Tier 2, and it needs an app-side
-- check first. This migration is about writes, which is the half that lets
-- somebody corrupt the numbers rather than merely read them.

-- ---------------------------------------------------------------------------
-- 1. Drop the legacy user-management RPCs outright.
-- ---------------------------------------------------------------------------
-- These pre-date Google SSO and take the ACTOR'S EMAIL AS A PARAMETER, so the
-- caller simply declares who they are — `dashboard_delete_user('web@uplers.com',
-- 'someone')` was an unauthenticated admin action. Nothing in the app has called
-- them since access moved to the Google JWT (see lib/access.ts); grep confirms
-- the client only ever calls the seven RPCs kept below. Dropping beats revoking:
-- a function that cannot be fixed should not survive as a loaded gun.
drop function if exists public.dashboard_upsert_user(text, text, text, text, text[], boolean);
drop function if exists public.dashboard_delete_user(text, text);
drop function if exists public.dashboard_list(text);
drop function if exists public.dashboard_check(text);

-- ---------------------------------------------------------------------------
-- 2. The seven RPCs the dashboard genuinely uses: signed-in callers only.
-- ---------------------------------------------------------------------------
-- They still trust their `p_actor` argument for the audit trail, which is worth
-- fixing later, but requiring a session already removes the anonymous attacker.
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_opportunity_confirmed(bigint, boolean, text, text)',
    'public.set_opportunity_lost(bigint, boolean, text, text)',
    'public.set_opportunity_unlikely(bigint, boolean, text, text)',
    'public.mark_escalations_status(text[], text, text, text)',
    'public.dismiss_escalations(text[], text, text)',
    'public.request_scan(text)',
    'public.latest_scan_request()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant  execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Older single-row variants the UI no longer calls. Kept (the edge functions
--    may still reach for them) but closed to anonymous callers.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.mark_escalation_status(text, text, text, text)',
    'public.dismiss_escalation(text, text, text, text)',
    'public.restore_escalation(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant  execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Scheduled jobs: nobody with a browser should be able to start these.
-- ---------------------------------------------------------------------------
-- These are pg_cron work. They rewrite large parts of the dataset and are
-- expensive, so an open EXECUTE is both a data-integrity risk and a way to run
-- up the bill. cron runs them as the table owner, which ignores these grants,
-- so revoking from `authenticated` too costs nothing.
--
-- capture_critical_escalation() is a TRIGGER function; triggers fire as the
-- table owner regardless of EXECUTE, so removing the grant cannot stop capture.
do $$
declare f text;
begin
  foreach f in array array[
    'public.reconcile_sheet_drift()',
    'public.refresh_quote_intent_sources()',
    'public.capture_critical_escalation()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant  execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Predicates that must stay callable.
-- ---------------------------------------------------------------------------
-- is_dashboard_admin() is referenced inside the RLS policies on app_settings and
-- dashboard_users. Those policies are evaluated AS THE QUERYING ROLE, so if anon
-- loses EXECUTE the policy raises a permission error instead of simply returning
-- false — turning a clean "no rows" into a broken page. It takes no arguments and
-- only reports on the caller's own JWT, so it discloses nothing: an anonymous
-- caller gets `false`, which is exactly the answer.
grant execute on function public.is_dashboard_admin()    to anon, authenticated, service_role;
grant execute on function public.jwt_email()             to anon, authenticated, service_role;
grant execute on function public.dashboard_owner_email() to anon, authenticated, service_role;

-- is_dashboard_user() belongs to the retired allowlist model and is in no policy.
revoke execute on function public.is_dashboard_user() from public, anon;
grant  execute on function public.is_dashboard_user() to authenticated, service_role;
