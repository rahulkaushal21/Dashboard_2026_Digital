-- 126 — the old revenue sheet is read-only history, so stop re-reading it
--
-- Rahul, 4 Oct 2026: "lets not do every 30 mins sync to old revenue, the data is frozen
-- now so lets save that and lets remove that trigger so system is trigger lesser and
-- saving time and system load. the data is important but its not required edit now, so
-- the data is locked."
--
-- From 1 Oct the dashboard is the record and the project sheet is its dump. The ledger
-- proves the cutover landed: web_project_ledger carries source='raw' for August and
-- September (from the old sheet) and source='dashboard' from October on. Nothing has
-- written an October row into the old sheet and nothing will.
--
-- Four jobs were still reading it every half hour for no new information:
--   1  sheet-sync-2h                 :00/:30  Bookings tab  -> bookings      (3,124 rows)
--   2  web-revenue-fullsync-hourly   :17      revenue sheet -> web_revenue   (2,528 rows)
--   7  canonicalise-after-revenue-sync :20    only existed to follow job 2
--   10 sheet-raw-revenue             :11/:41  revenue sheet -> sheet_raw     (3,297 rows)
-- That is 144 job runs a day rewriting three tables with bytes identical to what they
-- already held.
--
-- DISABLED, NOT DROPPED. cron.alter_job(..., active := false) keeps the definition, so
-- re-reading the old sheet is one statement away if a correction ever has to come from it.
--
-- WHAT DOES NOT CHANGE. Disabling a job does not empty its table. Verified immediately
-- after: sheet_raw 3,297, web_revenue 2,528, bookings 3,124, ledger raw 3,297 +
-- dashboard 27, and Aug $215,177 / Sep $194,448 / Oct $50,843.36 / Nov $600 — identical
-- on both sides of the change.
--
-- ONE CONSEQUENCE WORTH KNOWING. Job 1 also called rebuild_clients() and
-- compute_client_sentiment() after loading bookings, so those ran 48 times a day. They
-- now run on job 15 (rebuild-clients-hourly, :22) alone, 24 times a day. That is enough:
-- the pair only has to catch up with deals confirmed on the dashboard, and an hour is
-- well inside how fast anybody reads the Clients page.
--
-- AND ONE WARNING. August and September history in the ledger is READ FROM sheet_raw,
-- which is now frozen rather than refreshed. The old spreadsheet must not be deleted:
-- if it goes and sheet_raw is ever rebuilt empty, two months of history leave the
-- dashboard with it. Freezing the sync is not the same as archiving the data, and the
-- archiving has not been done.

select cron.alter_job(1,  active := false);   -- sheet-sync-2h
select cron.alter_job(2,  active := false);   -- web-revenue-fullsync-hourly
select cron.alter_job(7,  active := false);   -- canonicalise-after-revenue-sync
select cron.alter_job(10, active := false);   -- sheet-raw-revenue
