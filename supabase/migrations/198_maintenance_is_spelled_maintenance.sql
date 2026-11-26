-- 198 — Maintenance is spelled Maintenance
--
-- Pratik, 26 Nov 2026: the Project Type "Maintanance" is misspelled. It came from the old
-- revenue sheet, whose dropdown spelled it that way, and every table that ever copied the
-- sheet carries it: 455 bookings, 409 web_revenue lines, 307 revenue_history lines, 135
-- opportunities, 73 quotes, 11 cross_sells and 2 sheet overrides. The dashboard's own
-- dropdown (lib/deal-fields.ts PROJECT_TYPES) carried it too, so every deal confirmed on the
-- dashboard since October was written with the misspelling.
--
-- No other spelling exists: the external quote API calls this work something else
-- entirely, so nothing resyncs the old word back in. Two things in this database would,
-- though, and both are fixed here:
--   * infer_project_types() — migration 066 — fills a blank project type on an email deal
--     from the words in its subject, and wrote 'Maintanance' when it saw "maintenance".
--   * web_sheet_rows_src, the view over the frozen old-sheet capture (sheet_raw). The raw
--     JSON is left exactly as captured; the view now reads the old spelling as the right one,
--     so the 477 lines from the old sheet show "Maintenance" in the ledger too.
--
-- Migration 112 already treats both spellings as the same for the completeness gate, so no
-- check changes behaviour.

-- 1. The trail first, for the one table people read it on.
insert into public.opportunity_events (opportunity_id, event, actor, detail)
select id, 'edited', 'claude',
       jsonb_build_object('from', 'spelling fix',
                          'changed', jsonb_build_object('project_type',
                                       jsonb_build_object('from', 'Maintanance', 'to', 'Maintenance')))
  from public.opportunities
 where project_type = 'Maintanance';

-- 2. Every table that stores it.
update public.opportunities        set project_type     = 'Maintenance' where project_type     = 'Maintanance';
update public.bookings             set engagement_model = 'Maintenance' where engagement_model = 'Maintanance';
update public.web_revenue          set engagement_model = 'Maintenance' where engagement_model = 'Maintanance';
update public.revenue_history      set engagement_model = 'Maintenance' where engagement_model = 'Maintanance';
update public.quotes               set project_type     = 'Maintenance' where project_type     = 'Maintanance';
update public.cross_sells          set engagement       = 'Maintenance' where engagement       = 'Maintanance';
update public.sheet_row_overrides  set project_type     = 'Maintenance' where project_type     = 'Maintanance';

-- 3. The inference must stop writing the old word.
do $$
declare d text; nd text;
begin
  select pg_get_functiondef('public.infer_project_types()'::regprocedure) into d;
  nd := replace(d, '''Maintanance''', '''Maintenance''');
  if nd = d then
    raise exception 'infer_project_types did not contain the expected literal — not patching blind';
  end if;
  execute nd;
end $$;

-- 4. The old-sheet view reads the old spelling as the right one.
do $$
declare d text; nd text;
begin
  select pg_get_viewdef('public.web_sheet_rows_src'::regclass, true) into d;
  d := regexp_replace(d, ';\s*$', '');
  nd := replace(d,
    'NULLIF(btrim(r."values" ->> c.project_type), ''''::text) AS project_type',
    'CASE WHEN lower(btrim(r."values" ->> c.project_type)) IN (''maintanance'', ''maintainance'', ''maintenence'') THEN ''Maintenance''::text ELSE NULLIF(btrim(r."values" ->> c.project_type), ''''::text) END AS project_type');
  if nd = d then
    raise exception 'web_sheet_rows_src did not contain the expected project_type line — not patching blind';
  end if;
  execute 'create or replace view public.web_sheet_rows_src as ' || nd;
end $$;
