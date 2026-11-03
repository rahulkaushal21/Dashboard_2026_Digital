-- A cron job is not an API
-- ========================
--
-- close_booking_month() and reconcile_booking_months() are SECURITY DEFINER - they run
-- as postgres - and both were EXECUTABLE BY anon. Neither contains an authorisation
-- check of any kind: no jwt_email(), no is_dashboard_admin(). Anyone holding the
-- publishable key could POST /rest/v1/rpc/close_booking_month and write a month's
-- closing snapshot, or run the drift reconciliation, from outside.
--
-- They are cron-only (jobs 25 and 26) and nothing in app/, components/, lib/, scripts/
-- or the edge functions calls either. They were never meant to be reachable.
--
-- update_project_fields is on the same advisor list and is NOT in this migration: it
-- raises 'Sign in to edit this row.' when jwt_email() is null and then checks the row's
-- PM, so anon gets nothing. The difference is the point - a SECURITY DEFINER function
-- exposed to anon is only safe if it checks, and these two never did.
--
-- Tier 1 (anonymous writes) was closed on 16 Sep 2026. This is the part of it that was
-- missed, because it is not a table policy and no RLS lint covers it.
--
-- NOT CHANGED HERE, deliberately: the advisor also reports 12 materialized views served
-- over the API. That is Tier 2 - anon can already read most tables - which is a standing
-- decision, not a regression, and closing it belongs with the per-PM scoping work rather
-- than a one-line revoke.

revoke execute on function public.close_booking_month(date) from public, anon, authenticated;
revoke execute on function public.reconcile_booking_months() from public, anon, authenticated;
