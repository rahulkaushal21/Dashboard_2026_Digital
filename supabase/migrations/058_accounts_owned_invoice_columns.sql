-- Invoice No, Invoice Currency and Invoice Amount belong to the accounts team.
--
-- Everything else about a line comes from the dashboard from 1 October. These three do
-- not: they are typed by hand, in the spreadsheet, after the work is delivered and
-- billed, and the dashboard has no opinion about them.
--
-- THE BUG THAT WOULD HAVE EATEN THEM. sheet-writer CLEARS the Web, Hub & LP tab and
-- rewrites it on every run. Old-sheet lines were safe by accident — they are copied
-- verbatim out of sheet_raw, which is itself synced from the old spreadsheet, so an
-- invoice typed there came back round. Dashboard-origin lines were not: they are built
-- from `opportunities`, which holds nothing in those columns, so an invoice typed against
-- one would have survived until the next hourly run and then silently vanished. From
-- 1 October every new line is dashboard-origin, so this would have started as a trickle
-- and become the normal case.
--
-- THE FIX, in three parts:
--
--   1. A "Dashboard Ref" column at the far right of the tab — raw:<row index> for a line
--      from the old sheet, opp:<id> for one confirmed in the dashboard. Rows cannot be
--      matched by position (the dashboard rows come back from Postgres in no guaranteed
--      order) nor by project name (people edit it), so they carry their own identity.
--
--   2. The writer READS those three columns out of the target sheet before it clears
--      anything, and writes back whatever it found. The sheet is the source for them and
--      the dashboard only copies them forward.
--
--   3. This table, the durable copy. It is the FLOOR, not the source: a failed read, a
--      hand-cleared tab or a tab recreated from scratch falls back to it rather than
--      writing blanks over somebody's work. Merged field by field, so clearing one cell
--      cannot drop the other two.
--
-- What the accounts team needs to know: keep typing into the same three columns, in the
-- new spreadsheet, and leave the Dashboard Ref column alone. Deleting a row's ref does
-- not lose the invoice — it is in this table — but that row stops being recognised and
-- would need matching by hand.
create table if not exists public.sheet_invoice_entries (
  ref              text primary key,
  invoice_no       text,
  invoice_currency text,
  invoice_amount   text,
  seen_at          timestamptz not null default now()
);

comment on table public.sheet_invoice_entries is
  'Invoice No / Currency / Amount as the accounts team typed them into the spreadsheet. The sheet is the source; this is the durable copy, so a cleared or recreated tab cannot lose them. Keyed by the Dashboard Ref column the writer stamps on every row.';

alter table public.sheet_invoice_entries enable row level security;

-- No policies on purpose. Only the edge function touches this, and it runs as the service
-- role, which bypasses RLS. anon and authenticated get nothing: these are finance
-- references and nothing in the browser needs them yet.
revoke all on public.sheet_invoice_entries from anon, authenticated;
