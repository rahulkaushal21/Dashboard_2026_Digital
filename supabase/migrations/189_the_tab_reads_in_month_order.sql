-- The tab reads in month order
--
-- 551 of the revenue tab's 3,295 lines sat out of order, so Month-Year (column AI) went
-- Sep, Oct, Aug, Oct down the page and nobody could read a month off the sheet without
-- a pivot. This sorts it.
--
-- SORTED ON MONTH-YEAR, NOT ON THE CONFIRMATION DATE. Those two disagree on 73 lines,
-- and almost always in the same direction: the typed month is LATER (72 of 73), by one
-- month (58), and 51 of the 73 were confirmed on the 25th or later. That is a month-end
-- roll - work closed in the last days of a month and billed in the next - and it is a
-- human's call, not an error. Sorting on the date would have scattered those 73 back
-- through the column it was meant to tidy. So the order is Month-Year, then the
-- confirmation date inside each month, then the old position to break a tie. Not one
-- typed cell is rewritten; only the order changes.
--
-- HOW the sort happens, and why it is not done in Google Sheets: a row's identity in this
-- system IS its position. sheet-writer stamps "Dashboard Ref" = raw:<row_index>, and the
-- 121 dashboard overrides and 2,605 invoice numbers the accounts team types are keyed on
-- that ref. A sort done by hand in the spreadsheet would be rewritten, in position order,
-- within thirty minutes. So the order is changed where the writer reads it from
-- (.order("row_index") on sheet_raw) by renumbering row_index, and everything keyed on it
-- moves in the SAME STATEMENT - one snapshot, no window where a ref points at the wrong
-- line:
--   sheet_raw.row_index             3,295 rows
--   sheet_row_overrides.row_index     121 rows   (fingerprint guard still matches: it is
--                                                 content, agency|project|month, not a
--                                                 position - all 121 still in force)
--   sheet_invoice_entries.ref       2,605 rows
-- ledger_deletions needed nothing: both live deletions are opp: keys.
--
-- NUMBERED FROM 20001, NOT FROM 1. The new numbers must not collide with the ones still
-- printed in the spreadsheet, because the writer reads the accounts team's three invoice
-- columns BACK from the sheet, matched on that printed ref, and the sheet keeps the old
-- numbering until the next write. Renumbering into 1..N would have handed row 900's
-- invoice number to whichever deal had become row 900. A disjoint range cannot: an old
-- ref now matches nothing instead of matching the wrong thing. The number is cosmetic -
-- it is an identity, not an ordinal, and nothing adds it up.
--
-- The next write after this one reads a sheet full of refs that no longer resolve and
-- stores them, so the run leaves ~2,600 orphan rows in sheet_invoice_entries. They are
-- duplicates of live rows, checked before clearing (every orphan's invoice number and
-- amount also existed on a resolving ref; none held anything unique), and they must be
-- cleared, because the stored copy is the FLOOR the writer falls back to - an orphan left
-- at a number a future row could be given would hand that row somebody else's invoice.
-- The delete at the bottom is that sweep, and it is safe to re-run.

with k as (
  select id, row_index,
         case when btrim(coalesce(values->>34,'')) ~ '^[A-Za-z]{3}-\d{4}$'
                then to_date('01-' || btrim(values->>34), 'DD-Mon-YYYY') end as my_m,
         case when btrim(coalesce(values->>6,'')) ~ '^\d{1,2}-[A-Za-z]{3}-\d{4}$'
                then to_date(btrim(values->>6), 'DD-Mon-YYYY') end as conf_d
    from public.sheet_raw
   where tab = 'revenue'
), m as (
  select id, row_index as old_ri,
         -- A line with no month at all falls back to its confirmation date's month, and a
         -- line with neither goes last rather than first: an undated row at the top of the
         -- tab reads as the oldest work there is.
         20000 + (row_number() over (order by coalesce(my_m, date_trunc('month', conf_d)::date) nulls last,
                                              conf_d nulls last, row_index))::int as new_ri
    from k
), u1 as (
  update public.sheet_raw s set row_index = m.new_ri from m where s.id = m.id returning 1
), u2 as (
  update public.sheet_row_overrides o set row_index = m.new_ri from m where o.row_index = m.old_ri returning 1
), u3 as (
  update public.sheet_invoice_entries e set ref = 'raw:' || m.new_ri from m where e.ref = 'raw:' || m.old_ri returning 1
)
select (select count(*) from u1) as rows_renumbered,
       (select count(*) from u2) as overrides_moved,
       (select count(*) from u3) as invoice_refs_moved;

-- The ledger reads sheet_raw through a MATERIALISED view keyed on row_index. Without this
-- it serves the old order, and every override's fingerprint is matched against the wrong
-- line.
refresh materialized view concurrently public.web_sheet_rows_mv;

-- The orphan sweep described above.
delete from public.sheet_invoice_entries e
 where e.ref ~ '^raw:[0-9]+$'
   and not exists (select 1 from public.sheet_raw s
                    where s.tab = 'revenue' and s.row_index = (substring(e.ref from 5))::int);
