# Opportunities scan — manual mode

The dashboard home page shows an **"Opportunities scan"** freshness line
(app/page.tsx → reads the `email-opportunities-scan` heartbeat from `sync_runs`).

This scan is **manual by choice**. It does NOT tick on the 30-min sheet→Opportunities
sync (a separate cron) or on direct edits — only when the email opportunity
classification actually runs. So the figure climbs (1d, 2d, 3d…) until a scan is run.

## Refresh the freshness clock (I've reviewed the pipeline myself)

Supabase dashboard → project → **SQL Editor** → run:

```sql
insert into sync_runs (source, ok, rows_upserted, message)
values ('email-opportunities-scan', true, 0, 'Manual refresh');
```

The "Opportunities scan" line flips back to **0m ago** on the next page load.
⚠️ This only stamps "scanned just now" — it does NOT read the mailbox.

## Run a REAL scan (actually read new email + update opportunities)

Reading the mailbox, catching off-sheet opportunities, and refreshing deal
status/%/next-step needs Gmail access + classification — that's done via Claude.
Just say: **"run the opportunities scan"** and it does the full pass and writes
the heartbeat at the end.

## Notes
- Source string MUST be `email-opportunities-scan` (the dashboard reads exactly this).
- The `web-revenue` / sheet syncs are independent crons and stay fresh on their own.
- To make this auto-refresh later (drop the manual step): either a free hourly
  claude.ai cloud routine wired to the Supabase MCP connector, or a pg_cron +
  edge function that classifies via the Anthropic API (needs an API key).
