# Writing the new spreadsheet

`sheet-writer` is the step that closes the loop: from 1 Oct the dashboard is the record
and the spreadsheet is its dump.

## It writes to a NEW spreadsheet, never the existing one

The current business sheet is still an INPUT — `sync-web-revenue` and the Apps Script
both read it. Writing to a sheet we also read would create a loop where the system's own
output becomes its next input. Point `TARGET_SHEET_ID` at a new file, always.

## Setup

1. **Create the spreadsheet.** Its id is the long string in the URL:
   `docs.google.com/spreadsheets/d/<THIS>/edit`. Tabs are created automatically.

2. **Create a service account** in Google Cloud (any project), then **enable the Google
   Sheets API** for that project. Create a JSON key and download it.

3. **Share the spreadsheet with the service account's `client_email` as Editor.**
   This is the step people skip. The key will be perfectly valid and the file simply
   invisible — the function turns that 403 into a message saying exactly this.

4. **Set two secrets** (Supabase → Edge Functions → Secrets):
   - `TARGET_SHEET_ID` — the id from step 1
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the whole key file, pasted as-is

5. **Dry run first.** It builds all three tabs and reports the row counts without
   touching Google:
   `curl ".../functions/v1/sheet-writer?token=<TOKEN>&dry=1"`

6. **Then run it for real**, and schedule it:
   ```sql
   select cron.schedule('sheet-writer', '47 * * * *',
     $$select net.http_get(url:='https://<project>.supabase.co/functions/v1/sheet-writer?token=<TOKEN>')$$);
   ```
   Live since 21 Sep 2026, hourly at :47 — six minutes after `sheet-raw-revenue` at :41,
   so the raw copy is always refreshed before it is written out.

## Never echo a secret's value, whatever the variable is called

A throwaway diagnostic here printed `TARGET_SHEET_ID` back verbatim on the reasoning that
a spreadsheet id is not sensitive. The two secrets had been crossed: that variable held
the service-account private key, and printing it leaked the key, which then had to be
rotated.

The rule is not "guard the variable named like a secret". A setup check exists precisely
because a variable may not hold what its name says, so it must report only SHAPE — set or
missing, length, whether it parses — and never the value. `sheet-writer` now also refuses
a `TARGET_SHEET_ID` longer than 120 characters or containing whitespace, because that is
not a sheet id and is a sign the wrong value is in it.

## What each tab holds

| Tab | Contents |
|---|---|
| `Web, Hub & LP` | the source tab verbatim from `sheet_raw` (all 40 columns, every row), plus everything confirmed in the dashboard mapped into the same columns and marked `Confirmed (dashboard)` in Project Status |
| `Quotes` | the `quotes` table, plus deals that exist only here (entered by hand, or found in email) |
| `Feedback` | the `feedback` table |

## Decisions worth knowing

**Full replace, not append.** These are dumps. An append has to remember what it wrote
last time, and any disagreement between that memory and the sheet leaves duplicates
nobody can untangle. Replacing is idempotent — run it twice, get the same sheet.

**`RAW`, not `USER_ENTERED`.** A project name starting with `=` or `+` would otherwise be
parsed as a formula, and a reference with a leading zero would lose it.

**Column positions are read from the tab's own header row**, not hard-coded. If someone
inserts a column in the source, a fixed index would silently write every later field one
place to the left.

**Money is written to two decimals.** The current export rounds to whole dollars, which is
why dashboard monthly totals sit a dollar or two under the sheet's own figures.

**Dates are real dates, not text.** RAW stores a string as a string, so until 25 Sep 2026
every date landed as the text `'1-Apr-2025` — it would not sort, filter by range or pivot
by month. The date columns (Confirmation Date, Start Date, Delivery Date, Internal
Delivery, Added Date) and month columns (Month-Year, the unnamed column after it, Month
year) are now sent as spreadsheet serial numbers and formatted `d-mmm-yyyy` /
`mmm-yyyy`, so they still read `1-Apr-2025` and `Apr-2025`. A value that does not parse
(a blank, `#REF!`) is written as the text it is.

**Numbers are real numbers too**, for the same reason (a text `$1,000` does not SUM):
Quote Price, Confirmed Price, Invoice Amount and Estimated Cost as `#,##0.00` (the
currency is in the row's own currency column); USD Conversion and Outsource Price (USD)
as `$#,##0.00`; Internal hrs, Actual hrs and Confirmed in Days as plain numbers;
Optimization as a percentage. Hand-typed Invoice Amounts that are not a single figure
(`1000 + 825`, `Rs.103,168.58`, `CAD`) stay exactly as typed.

**Outsource Price stays text** on purpose: it is in the contractor's currency (₹ in the
source) and the tab has no column saying so — a bare number would lose that. Add up
Outsource Price (USD) instead.

Columns are found by header name through `COLUMN_KINDS` in `index.ts`; a new date or
number column needs a line there. `Week Start` ("Sep 2026 Week 3") is a label, not a
date, and stays text.

**Recurring entries use `source_date`, not `confirmed_at`.** A retainer is added in one
month FOR another; using the confirmation date would file October's retainers under
September.
