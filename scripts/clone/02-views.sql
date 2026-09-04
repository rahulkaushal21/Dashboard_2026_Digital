-- ---------------------------------------------------------------------------
-- Clone step 2 — the two VIEWS the Clients page reads.
--
-- getClients() reads `web_clients` and getClientDirectory() reads
-- `web_client_directory` — NOT the `clients` / `client_directory` base tables.
-- Miss these and the Clients page renders empty with no error.
--
-- Run this in the EXISTING project to get their definitions, then replay in the new one.
-- ---------------------------------------------------------------------------
select string_agg(
         format('create or replace view public.%I as %s', c.relname, pg_get_viewdef(c.oid, true)),
         E'\n\n' order by c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in ('web_clients', 'web_client_directory');
