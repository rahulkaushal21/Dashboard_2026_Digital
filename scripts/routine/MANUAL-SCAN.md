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
3. **Reconcile across sources** — link the same client across opportunities /
   sheet quotes / `web_revenue` and pull values through:
   ```sql
   select reconcile_opportunities();
   ```
   - Runs automatically every :07/:37 (pg_cron `reconcile-opps`).
   - **Value backfill (safe/auto):** an open, value-less opp inherits its price
     from the sheet quote of the same client — but only when that client has one
     unambiguous quote value, so it never guesses between projects.
   - **Name mismatches:** when a deal is booked/quoted under a different name than
     the opportunity (e.g. **OHK** booked as **Holloway**), add a row to
     `opp_aliases (alias, canonical)` so the link is found:
     ```sql
     insert into opp_aliases(alias,canonical,note) values ('ohk','holloway','...');
     ```
   - **Won-promotion is NOT automated** — repeat clients (e.g. Telfer: $198k booked
     but 12 genuinely-open new deals) would be wrongly closed. Marking Won is a
     per-deal judgement made in step 4 by checking `web_revenue` + the sheet against
     that specific project.
4. **Read the mailbox + classify + cross-check** — catch off-sheet opportunities,
   refresh status/%/next-step, and for each active deal check whether it's already
   **confirmed in the sheet** or **booked in web_revenue** (via alias) → set Won +
   value if so. Gmail + reasoning → done by Claude.
5. **Write the heartbeat** (`email-opportunities-scan`) so the dashboard shows fresh.

Steps 1–3 are the sheet/data half (safe to run anytime in the SQL Editor); step 4
is the email + reasoning half that needs Claude.

## Notes
- Source string MUST be `email-opportunities-scan` (the dashboard reads exactly this).
- The `web-revenue` / sheet syncs are independent crons and stay fresh on their own.
- To make this auto-refresh later (drop the manual step): either a free hourly
  claude.ai cloud routine wired to the Supabase MCP connector, or a pg_cron +
  edge function that classifies via the Anthropic API (needs an API key).
