-- 199 — the old-sheet capture spells Maintenance too
--
-- Migration 198 corrected the misspelling in every table and made the ledger view read the
-- old spelling correctly, but the sheet-writer builds the Web, Hub & LP tab's old lines
-- VERBATIM from sheet_raw (the JSON capture of the old revenue sheet), not from the ledger.
-- So the Google Sheet kept "Maintanance" on 477 old lines after Pratik fixed the dropdown
-- list, and every one showed a red corner mark. (26 Nov 2026.)
--
-- Project Type is element 4 of the captured row (column E). Only the exact misspelling is
-- touched; nothing else in the capture is changed. The sheet-raw job is retired, so nothing
-- re-reads the old sheet and brings the old word back; if it ever is re-run, apply this again.
update public.sheet_raw
   set "values" = jsonb_set("values", '{4}', '"Maintenance"')
 where tab = 'revenue' and "values" ->> 4 = 'Maintanance';
