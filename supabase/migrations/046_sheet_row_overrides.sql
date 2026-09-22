-- Filling in the blanks on a sheet row, without touching the sheet.
--
-- Project Id, Quote ID and Expert are missing on a lot of historical rows, and the team
-- wants to fill them in from this page. The obvious place to put the answer — sheet_raw —
-- is the one place it cannot go: that table is re-synced from the spreadsheet, so an edit
-- written there is gone by the next sync, silently and without an error.
--
-- So edits live BESIDE the sheet in an overlay, and the view lays them over the top. The
-- sheet stays the sheet; the dashboard's answer wins where there is one.
--
-- KEYED ON sheet_raw.id, WITH A FINGERPRINT GUARD. Rows are upserted on (tab, row_index),
-- so an id is stable while the tab only grows — but if rows are ever inserted or deleted
-- mid-sheet, every id below that point would shift onto a different project and this
-- overlay would quietly relabel somebody else's work. The fingerprint (agency, project
-- name, booking month) is stored with the edit and re-checked on read: if the row moved,
-- the override stops applying rather than attaching to the wrong project.
create table if not exists public.sheet_row_overrides (
  sheet_row_id       bigint primary key,
  fingerprint        text not null,
  project_id         text,
  quote_id           text,
  expert             text,
  contractor_name    text,
  outsource_currency text,
  outsource_price    numeric,
  project_status     text,
  start_date         date,
  delivery_date      date,
  internal_delivery  date,
  internal_hrs       numeric,
  actual_hrs         numeric,
  integration        text,
  invoice_no         text,
  invoice_currency   text,
  invoice_amount     numeric,
  updated_by         text not null,
  updated_at         timestamptz not null default now()
);

alter table public.sheet_row_overrides enable row level security;
drop policy if exists sheet_row_overrides_read on public.sheet_row_overrides;
create policy sheet_row_overrides_read on public.sheet_row_overrides for select using (true);
-- No write policy at all. Every write goes through update_sheet_row_fields, which checks
-- that the caller is the row's own PC/SME. A table-level write policy could not: it would
-- have to re-derive the owner from the sheet on every statement.
grant select on public.sheet_row_overrides to anon, authenticated;
revoke insert, update, delete on public.sheet_row_overrides from anon, authenticated, public;

-- The rest of this migration was applied to the live project in four steps and is
-- recorded here as the shape it left behind rather than re-pasted statement for
-- statement. Pull the current definitions with:
--   select pg_get_viewdef('public.web_sheet_rows'::regclass, true);
--   select pg_get_viewdef('public.web_project_ledger'::regclass, true);
--   select pg_get_viewdef('public.web_client_360'::regclass, true);
--   select pg_get_functiondef('public.update_sheet_row_fields'::regproc);
--
-- 1. web_sheet_rows was renamed to web_sheet_rows_src, so the 34 positional header
--    lookups keep their single definition and cannot drift.
-- 2. A new web_sheet_rows lays sheet_row_overrides over the top, coalescing each
--    editable column and joining ON THE FINGERPRINT as well as the id. It also exposes
--    contractor_name and outsource_currency, which the spreadsheet has no column for.
-- 3. web_project_ledger and web_client_360 were rebuilt on the new view. Verified
--    afterwards: 3,218 rows, 405 clients, $3,831,068 — unchanged.
-- 4. update_sheet_row_fields(...) writes the overlay. It refuses anybody who is not the
--    row's own PC/SME (directory_owner_match, the same helper the dashboard rows use) or
--    an admin, and treats a null parameter as "not sent" rather than "clear it", because
--    the inline editors send one field at a time.

-- ── 047 (applied 22 Sep 2026): re-keyed on the sheet's own row number ────────────────
-- 046 above assumed sheet_raw was upserted on (tab, row_index) and that an id was
-- therefore stable. IT IS NOT. The ingest replaces the tab wholesale — every row on the
-- revenue tab carries the same synced_at, to the second — so ids are reassigned on every
-- sync. Caught by a dry run: a row read as id 12869 an hour earlier no longer existed.
--
-- An id-keyed override would have detached from its row within the hour. The fingerprint
-- guard meant it would have failed SAFE (the edit stops showing) rather than landing on
-- somebody else's project, but a PM's edit silently vanishing is still the bug.
--
-- The key is now row_index — the row's position in the spreadsheet, which survives a full
-- rewrite and is unique per tab (3,221 of 3,221). The fingerprint stays as the guard,
-- because row_index does not survive a row being inserted mid-sheet, and it cannot be the
-- key itself: 25 rows share an (agency, project name, month) with another row.
--
-- web_project_ledger's row_key and source_id are now the row number too, and it carries
-- sheet_raw_id separately for copy_row_to_month, which acts on this minute's snapshot.
