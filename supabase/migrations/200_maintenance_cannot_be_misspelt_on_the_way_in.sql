-- 200 — Maintenance cannot be misspelt on the way in
--
-- Pratik, 26 Nov 2026: "what is the permanent fix, so if we re-run, the change remains".
--
-- Migrations 198 and 199 corrected every stored value, but a correction of stored data is
-- only as lasting as the next write. The old spelling can arrive again from:
--   * a re-run of the sheet capture (sheet-raw / sheet-ingest) reading an old copy of the sheet;
--   * a restored dump, an import, or an old script;
--   * the email scan or a PM RPC passing a project type through unchecked.
--
-- So the guard sits in the database, on the way in, rather than in each writer. Whatever
-- writes the row, a project type that is a known misspelling of Maintenance is stored as
-- Maintenance. Only the misspellings are touched: every other value passes through exactly
-- as sent, so this cannot rewrite a legitimate project type.
--
-- Known misspellings: maintanance (the old sheet's), maintainance, maintenence, maintanence,
-- maintainence. Matched ignoring case and surrounding spaces.

create or replace function public.is_maintenance_misspelling(v text)
returns boolean
language sql immutable
as $$
  select lower(btrim(coalesce(v, ''))) in
         ('maintanance', 'maintainance', 'maintenence', 'maintanence', 'maintainence')
$$;

-- One trigger function for every table that has a project-type column. The column name is
-- passed as the trigger argument, so there is one rule to read and one place to change.
create or replace function public.fix_maintenance_spelling()
returns trigger
language plpgsql
as $$
declare col text := tg_argv[0];
begin
  if public.is_maintenance_misspelling(to_jsonb(new) ->> col) then
    new := jsonb_populate_record(new, jsonb_build_object(col, 'Maintenance'));
  end if;
  return new;
end $$;

drop trigger if exists zz_fix_maintenance_spelling on public.opportunities;
create trigger zz_fix_maintenance_spelling before insert or update on public.opportunities
  for each row execute function public.fix_maintenance_spelling('project_type');

drop trigger if exists zz_fix_maintenance_spelling on public.quotes;
create trigger zz_fix_maintenance_spelling before insert or update on public.quotes
  for each row execute function public.fix_maintenance_spelling('project_type');

drop trigger if exists zz_fix_maintenance_spelling on public.sheet_row_overrides;
create trigger zz_fix_maintenance_spelling before insert or update on public.sheet_row_overrides
  for each row execute function public.fix_maintenance_spelling('project_type');

drop trigger if exists zz_fix_maintenance_spelling on public.bookings;
create trigger zz_fix_maintenance_spelling before insert or update on public.bookings
  for each row execute function public.fix_maintenance_spelling('engagement_model');

drop trigger if exists zz_fix_maintenance_spelling on public.web_revenue;
create trigger zz_fix_maintenance_spelling before insert or update on public.web_revenue
  for each row execute function public.fix_maintenance_spelling('engagement_model');

drop trigger if exists zz_fix_maintenance_spelling on public.revenue_history;
create trigger zz_fix_maintenance_spelling before insert or update on public.revenue_history
  for each row execute function public.fix_maintenance_spelling('engagement_model');

drop trigger if exists zz_fix_maintenance_spelling on public.recurring_deals;
create trigger zz_fix_maintenance_spelling before insert or update on public.recurring_deals
  for each row execute function public.fix_maintenance_spelling('engagement_model');

drop trigger if exists zz_fix_maintenance_spelling on public.cross_sells;
create trigger zz_fix_maintenance_spelling before insert or update on public.cross_sells
  for each row execute function public.fix_maintenance_spelling('engagement');

-- The old-sheet capture is different: a captured row is a JSON ARRAY and the project type is
-- one element of it. Which element is read from the captured header every time, not assumed,
-- so a column inserted into the old sheet cannot make this rewrite the wrong cell.
create or replace function public.fix_maintenance_spelling_in_capture()
returns trigger
language plpgsql
as $$
declare idx int;
begin
  if new.tab = 'revenue' and jsonb_typeof(new."values") = 'array' then
    select (e.ord - 1)::int into idx
      from public.sheet_raw_header h,
           lateral jsonb_array_elements_text(h.headers) with ordinality e(val, ord)
     where h.tab = 'revenue' and lower(btrim(e.val)) = 'project type'
     limit 1;
    if idx is not null and public.is_maintenance_misspelling(new."values" ->> idx) then
      new."values" := jsonb_set(new."values", array[idx::text], '"Maintenance"'::jsonb);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists zz_fix_maintenance_spelling on public.sheet_raw;
create trigger zz_fix_maintenance_spelling before insert or update on public.sheet_raw
  for each row execute function public.fix_maintenance_spelling_in_capture();
