-- The matview must be as closed as the table it copies
-- ====================================================
--
-- 164 created web_sheet_rows_mv and it picked up the default grants for new objects in
-- public - so anon and authenticated could SELECT it directly, and PostgREST serves
-- anything in public that a role can read. sheet_raw itself is closed to anon
-- ("permission denied for table sheet_raw"), so for the few minutes between 164 and this,
-- the matview published the whole old revenue spreadsheet - every client, value, rate and
-- invoice number back to April 2025 - on an endpoint that did not exist the day before.
--
-- Caught by checking has_table_privilege() after the DDL rather than by anything going
-- wrong. Worth doing on every new object in public: a matview is a TABLE as far as grants
-- and PostgREST are concerned, however view-like its name is.
--
-- Nothing legitimate needs those grants. web_sheet_rows is not security_invoker and is
-- owned by postgres, so it reads the matview as postgres on the caller's behalf, exactly
-- as it read web_sheet_rows_src before. Verified after revoking: as `authenticated`,
-- web_project_ledger still returns all 3,517 rows and $4,166,500.42.

revoke all on public.web_sheet_rows_mv from anon, authenticated;
