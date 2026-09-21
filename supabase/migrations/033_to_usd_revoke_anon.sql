-- to_usd() shipped callable by anon.
--
-- 020 spells out why and this is the same slip: Postgres grants EXECUTE on a new
-- function to PUBLIC by default and `anon` inherits it, so granting to `authenticated`
-- adds nothing unless PUBLIC is revoked first. Every other function added since 021
-- revoked from public first; this one only granted.
--
-- The exposure is small — it multiplies a number by a rate and discloses the rate table,
-- which is not sensitive — but an anonymous caller has no reason to reach it, and a
-- function that is open by accident is worth closing whether or not it matters.
revoke execute on function public.to_usd(numeric, text) from public, anon;
grant  execute on function public.to_usd(numeric, text) to authenticated, service_role;
