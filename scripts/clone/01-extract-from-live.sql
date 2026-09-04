-- ---------------------------------------------------------------------------
-- Clone step 1 — run this in the SQL editor of the EXISTING project
-- (hsmuxmvhgteexanssigc) and copy the single text result.
--
-- WHY THIS EXISTS: four of the functions the dashboard depends on were applied
-- straight to the live database and never landed in supabase/migrations —
-- sync_quotes_to_opportunities, canonicalise_client_names, reconcile_sheet_drift
-- and reconcile_opportunities. A new project built from the repo alone comes up
-- missing them, and the failure is quiet: the quotes sync simply never runs and
-- Opportunities stays empty.
--
-- The output is ready-to-run DDL. Paste it into the NEW project's SQL editor
-- AFTER the tables exist (functions reference them).
-- ---------------------------------------------------------------------------
select string_agg(pg_get_functiondef(p.oid), E';\n\n' order by p.proname) || ';' as ddl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rebuild_clients',              -- rebuilds `clients`; call compute_client_sentiment after
    'compute_client_sentiment',     -- rebuild_clients does NOT set sentiment
    'sync_quotes_to_opportunities', -- Quotes tab -> opportunities, incl. janitors
    'canonicalise_client_names',    -- applies client_aliases kind='merge' everywhere
    'reconcile_opportunities',      -- cross-source value backfill, merges email twins
    'reconcile_sheet_drift',        -- clears orphans + spent manual flags
    'set_opportunity_lost',         -- the three human-decision writers, all
    'set_opportunity_confirmed',    -- SECURITY DEFINER and mutually exclusive
    'set_opportunity_unlikely'
  );
