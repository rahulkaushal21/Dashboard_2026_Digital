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

## Run a REAL scan (refresh BOTH sources, then update opportunities)

A real scan checks the **sheet** AND the **email**, so it never relies on the
30-min cron happening to have just run. Say **"run the opportunities scan"** and
Claude does the full pass:

1. **Pull the Quotes sheet** into `quotes` (latest price/status/owner):
   ```sql
   select net.http_get(url:='https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/sheet-sync?token=syncWebHubLP_8f3a91');
   ```
2. **Merge sheet → opportunities** (stable-key upsert; won't duplicate or move dates):
   ```sql
   select sync_quotes_to_opportunities();
   ```
3. **Read the mailbox + classify** — catch off-sheet opportunities and refresh
   deal status / % / next-step (Gmail access + reasoning → done by Claude).
4. **Write the heartbeat** (`email-opportunities-scan`) so the dashboard shows fresh.

Steps 1–2 are the sheet half (safe to run anytime in the SQL Editor); step 3 is
the email half that needs Claude.

## Notes
- Source string MUST be `email-opportunities-scan` (the dashboard reads exactly this).
- The `web-revenue` / sheet syncs are independent crons and stay fresh on their own.
- To make this auto-refresh later (drop the manual step): either a free hourly
  claude.ai cloud routine wired to the Supabase MCP connector, or a pg_cron +
  edge function that classifies via the Anthropic API (needs an API key).
