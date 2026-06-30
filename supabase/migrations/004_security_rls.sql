-- ============================================================================
-- 004 — security hardening (in response to Supabase advisor / "table publicly
-- accessible" email). Applied to project hsmuxmvhgteexanssigc.
-- ============================================================================

-- 1) Tables that were exposed via PostgREST with RLS disabled (anyone with the
--    anon key could read/write/delete). None are read by the dashboard; their
--    writers use the service role, which bypasses RLS. Enabling RLS with NO
--    policy fully denies anon/authenticated access. user_sessions held a
--    session_token column — this was the most sensitive exposure.
alter table public.user_sessions   enable row level security;
alter table public.role_permissions enable row level security;
alter table public.email_whitelist  enable row level security;
alter table public.client_industry  enable row level security;

-- 2) Drop unused leftover views flagged as SECURITY DEFINER (not referenced by
--    the app or other objects).
drop view if exists public.v_client_revenue;
drop view if exists public.v_quote_funnel;
drop view if exists public.v_revenue_by_month;
drop view if exists public.v_industry_revenue;

-- 3) Pin a fixed search_path on functions that had a role-mutable one.
alter function public.rebuild_clients()         set search_path = public;
alter function public.compute_client_sentiment() set search_path = public;
alter function public.norm(text)                set search_path = public;

-- NOTE (intentionally not changed):
--   * public.web_clients stays a SECURITY DEFINER view — it is the curated
--     read-only feed for the public dashboard; the data it serves is already
--     public via the embedded anon key, so definer adds no real exposure.
--   * pg_net stays in the public schema — moving it would break the pg_cron
--     job that calls net.http_post for the hourly web-revenue sync.
