-- The heartbeat should not read the whole log
-- ===========================================
--
-- sync_runs has 39,434 rows and ONE index, on the primary key. Every "when did X last
-- run" lookup on the dashboard is
--
--     select ran_at from sync_runs where source = $1 order by ran_at desc limit 1
--
-- which no index could serve, so it seq-scanned all 39,434 rows and sorted them to
-- return a single value:
--
--     Seq Scan on sync_runs (actual rows=1870)
--       Rows Removed by Filter: 37564
--     Execution Time: 182.719 ms
--
-- 183 ms on an idle database. The recorded average across 4,859 calls was 987-1,028 ms,
-- because it is usually competing with a cron job. pg_stat_user_tables agrees:
-- seq_scan 6,957, idx_scan 4.
--
-- The cheapest thing on the whole board - the dot that says a job is alive was costing
-- more than the page it sits on. (source, ran_at desc) serves all three shapes the
-- dashboard asks for, including the one that also filters on ok.
--
--     Execution Time: 182.719 ms -> 4.407 ms, by Index Only Scan.

create index if not exists sync_runs_source_ran_at_idx
  on public.sync_runs (source, ran_at desc);

analyze public.sync_runs;
