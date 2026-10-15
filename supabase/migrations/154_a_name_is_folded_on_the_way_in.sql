-- A name is folded on the way in
-- ==============================
--
-- "this is Malay Srivastava, why i am seeing 2 names when i fixed this last time" —
-- Rahul, 15 Oct 2026. A fair question, and the answer is that 146 fixed the ROWS and
-- not the WRITER.
--
-- 146 added the spelling to canonical_person(), updated every table once, and wrapped
-- web_sheet_rows in the fold. Its own comment claimed the merge "cannot come undone by
-- a re-sync". It could, because opportunities is a TABLE, not a view: nothing folded a
-- name on the way into it. sync_quotes_to_opportunities() re-imports pc_sme from the
-- Quotes sheet every hour, the sheet still spells it Shrivastava in all 159 of its rows,
-- and 73 of the 74 opportunities that came back carried origin = 'sheet'.
--
-- So the fold now happens at the door, where it holds for every writer there is — the
-- hourly sync, the email scan, add_opportunity(), a PM editing by hand — rather than
-- once, in a migration, for the rows that existed that day.
--
-- IT RUNS LAST, AND THAT IS THE POINT OF THE NAME. Triggers of the same timing fire in
-- alphabetical order, and protect_manual_fields() reverts any field a PM has edited by
-- hand. Named ordinarily, this trigger folded the name and then watched the protection
-- put the old spelling straight back — which is exactly what happened to ten rows of
-- Vikram Shahi / Sahi, hand-edited and therefore protected, left standing after 146's
-- own update appeared to succeed. Sorting after it makes the fold the last word, which
-- is right: changing a SPELLING is not changing the person, so it should outrank both
-- protections rather than be refused by them.
--
-- canonical_people() is canonical_person() for a cell that may hold several people
-- ("Rahul Kaushal, Afzal Multani"). It folds each part and puts the original separators
-- back, so a two-PM cell keeps the shape the sheet gave it.
--
-- PROVEN BY RUNNING THE THING THAT BROKE IT. sync_quotes_to_opportunities(), 865 rows:
--
--   before   Malay Shrivastava 74, Malay Srivastava 16, Vikram Shahi 7+3
--   after    Malay Srivastava 90, Vikram Sahi 44, Kalgi Shah / Vikram Sahi 16
--
-- The sheet itself is untouched. web_sheet_rows_src is the raw import and raw is what it
-- is for; the fold belongs between the sheet and anything that reads it.

create or replace function public.canonical_people(p text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  parts text[]; delims text[]; acc text := ''; i int; d text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  -- The common case: one name in the cell.
  if p !~ '[,/&]' then return public.canonical_person(p); end if;
  parts  := regexp_split_to_array(p, '[,/&]');
  delims := array(select (regexp_matches(p, '([,/&])', 'g'))[1]);
  for i in 1 .. array_length(parts, 1) loop
    acc := acc || coalesce(public.canonical_person(parts[i]), btrim(parts[i]));
    if i <= coalesce(array_length(delims, 1), 0) then
      d := delims[i];
      acc := acc || case when d = ',' then ', ' else ' ' || d || ' ' end;
    end if;
  end loop;
  return nullif(btrim(acc), '');
end $$;

create or replace function public.opportunities_canonical_names()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.pm_owner     := public.canonical_people(new.pm_owner);
  new.sales_person := public.canonical_people(new.sales_person);
  return new;
end $$;

-- zz_ so it sorts after trg_protect_manual_fields. See the note above.
create trigger zz_opportunities_canonical_names
  before insert or update of pm_owner, sales_person on public.opportunities
  for each row execute function public.opportunities_canonical_names();

-- The one-off that follows is only for rows already in the table; everything after this
-- is folded by the trigger.
--   update public.opportunities set pm_owner = pm_owner
--    where pm_owner is distinct from public.canonical_people(pm_owner);
--   update public.opportunities set sales_person = sales_person
--    where sales_person is distinct from public.canonical_people(sales_person);
