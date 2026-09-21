-- Every source tab, kept verbatim.
--
-- WHY: the existing feeds keep only what the dashboard needs. sync-web-revenue stores 11
-- fields out of the Web, Hub & LP tab's 39 and AGGREGATES — grouping by
-- company|month|service|technology|engagement — so 3,223 sheet rows become ~2,474 and 28
-- columns (Project Id, Quote ID, hours, invoice numbers, statuses) are discarded.
--
-- That is the right shape for reporting and the wrong shape for reproducing a tab. A new
-- spreadsheet that must be 100% identical needs the original rows, so they are captured
-- here ALONGSIDE the mapped tables rather than instead of them. Nothing existing changes.
--
-- Values are a positional jsonb ARRAY, with the header row per tab in sheet_raw_header.
-- Positional rather than keyed by name because the revenue tab ends with a blank column
-- header, and a name-keyed map would silently drop it (and any duplicate).
create table if not exists public.sheet_raw (
  id         bigserial primary key,
  tab        text not null,
  row_index  integer not null,
  values     jsonb not null,
  synced_at  timestamptz not null default now(),
  unique (tab, row_index)
);
create index if not exists sheet_raw_tab_idx on public.sheet_raw(tab, row_index);

create table if not exists public.sheet_raw_header (
  tab       text primary key,
  headers   jsonb not null,
  col_count integer not null,
  synced_at timestamptz not null default now()
);

alter table public.sheet_raw        enable row level security;
alter table public.sheet_raw_header enable row level security;

drop policy if exists sheet_raw_read on public.sheet_raw;
create policy sheet_raw_read on public.sheet_raw for select to authenticated using (true);
drop policy if exists sheet_raw_header_read on public.sheet_raw_header;
create policy sheet_raw_header_read on public.sheet_raw_header for select to authenticated using (true);

-- Written only by the sync function, which runs as service_role.
revoke all on public.sheet_raw, public.sheet_raw_header from anon, public, authenticated;
grant select on public.sheet_raw, public.sheet_raw_header to authenticated;

-- Hourly, offset from the other jobs so the CSV fetches do not stack up.
-- select cron.schedule('sheet-raw-revenue', '41 * * * *',
--   $$select net.http_get(url:='https://<project>.supabase.co/functions/v1/sheet-raw?token=…&tab=revenue')$$);
