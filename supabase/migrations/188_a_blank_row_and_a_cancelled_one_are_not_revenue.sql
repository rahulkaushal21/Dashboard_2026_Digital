-- A blank row and a cancelled one are not revenue
--
-- Two lines of the revenue tab reached the new sheet with no Month-Year, and neither
-- could be given one honestly, because neither records money:
--
--   raw:182  a spacer. Forty cells, one of them non-empty, no project, no id, no date.
--            It exists because somebody pressed Enter in the old hand-typed sheet.
--
--   raw:512  Trent Electrical Website (PRJ190625220446 / QUT190625220446, WEB-UK,
--            Wordpress, New Development, agency Fluid Ideas, Mukund Basita).
--            Project Status = Cancelled. Quote GBP 2,000, USD Conversion $0, and no
--            Confirmation Date - the work was never confirmed and never billed.
--
-- Filling Month-Year on either would mean filing a month nobody chose, and leaving it
-- blank leaves the sheet's own reports with two holes in them. So the rows go.
--
-- Deleted here rather than marked: the dashboard's delete (ledger_deletions) deliberately
-- KEEPS the line and stamps Deleted / Cancelled on it, because a removed deal should stay
-- visible as evidence. That is right for a deal somebody entered wrongly; it is wrong for
-- a spacer and for a cancelled quote worth $0, which would still sit in the grid with the
-- same blank Month-Year that started this. The record of what they were is this file.
--
-- Safe now, and only now, in two ways:
--   1. Nothing points at them. Checked before deleting: no sheet_row_overrides row, no
--      ledger_deletions row, no sheet_invoice_entries ref, no opportunity on that quote
--      id. Row identity in the sheet is the position (raw:<row_index>), and these two
--      positions are unclaimed.
--   2. Nothing will put them back. sheet-raw-revenue (cron jobid 10) is retired, so
--      sheet_raw is a frozen snapshot and no ingest re-reads the tab.
--
-- row_index of the surviving rows is NOT renumbered. It is the stored identity of each
-- row, not its ordinal, so removing 182 and 512 leaves every other ref - and the 121
-- overrides, the deletions and the accounts team's invoice numbers hanging off them -
-- pointing exactly where they did. The grid simply has two fewer lines.
--
-- No money moves: web_project_ledger derives booking_month and value from the
-- confirmation date and the USD column, and these two carry $0 between them.

delete from public.sheet_raw
 where tab = 'revenue'
   and row_index = 182
   -- Still the spacer, not a row somebody has since typed into.
   and (select count(*) from jsonb_array_elements_text(values) e where btrim(e) <> '') <= 1;

delete from public.sheet_raw
 where tab = 'revenue'
   and row_index = 512
   -- Still Trent Electrical: the same quote, still cancelled, still undated and unbilled.
   and btrim(coalesce(values->>1, '')) = 'QUT190625220446'
   and btrim(coalesce(values->>13, '')) ilike 'cancel%'
   and btrim(coalesce(values->>6, '')) = '';

-- Both predicates fail safe: if either row has changed since it was read, nothing is
-- deleted and the blanks come back in the next check, which is the outcome to prefer
-- over removing a line that now means something.

-- web_project_ledger reads sheet_raw through web_sheet_rows -> web_sheet_rows_mv, which is
-- MATERIALISED. Deleting the rows is not enough: until the snapshot is rebuilt the ledger
-- still serves both lines, with in_sheet = true and a sheet_raw_id that no longer resolves.
refresh materialized view concurrently public.web_sheet_rows_mv;
