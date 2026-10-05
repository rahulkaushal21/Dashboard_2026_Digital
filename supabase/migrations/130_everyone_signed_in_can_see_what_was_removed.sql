-- 130 — everyone signed in can see what was removed
--
-- Vested / CMIC Webflow Support, 5 Oct 2026: removed on the Project sheet page at 07:18,
-- recorded in ledger_deletions, gone from every view in the SQL editor — and still on
-- the dashboard's November column an hour later, after reloads.
--
-- The ledger view (web_project_ledger) and the in-force list are security_invoker: they
-- read ledger_deletions AS THE PERSON LOOKING. ledger_deletions has row security on and
-- no policy at all, so a signed-in user reads zero deletions, the ledger hides nothing
-- for them, and the "Removed lines" list on the page is empty for everyone but the SQL
-- editor. The sheet-writer uses the service key, bypasses row security, and was the only
-- reader that honoured a removal — which is why the spreadsheet showed Deleted while the
-- dashboard did not.
--
-- Reading a deletion is not sensitive: it is a line's name, who removed it and why, all
-- of which the page already shows to admins. Writing stays with delete_ledger_row and
-- restore_ledger_row (SECURITY DEFINER, admin-only).

create policy ledger_deletions_read on public.ledger_deletions
  for select to anon, authenticated using (true);
