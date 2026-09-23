-- One spelling per person.
--
-- Four account managers were split across two or three spellings, so every per-AM figure
-- silently under-counted them and the AM filter listed the same person twice:
--
--   Kalgi Shah         was also "Kalgi" (1) and "Kalgi shah" (2)
--   Flintoff Mehta     was also "Flintoff" (6)
--   Nevilson Christian was mostly "Nevilson" (7 rows, 1 full)
--   Vikram Sahi        was also "Vikram Shahi" (3)
--
-- AN EXPLICIT MAP, NOT FUZZY MATCHING. Rahul Gupta, Rahul Jain and Rahul Kaushal share a
-- first name and are three different people; so are Kaustubh Agrawal and Kaustubh
-- Kulkarni. Any similarity rule loose enough to merge "Kalgi" into "Kalgi Shah" is loose
-- enough to merge two of those, which would be a far worse bug than the one being fixed.
--
-- WHERE IT IS APPLIED, and why that matters. The variants live in two places with
-- opposite lifetimes:
--
--   * sheet_raw (Kalgi, Flintoff) is REPLACED WHOLESALE on every sync, so an UPDATE there
--     survives about thirty minutes. Normalised in the web_sheet_rows view instead, which
--     is the one place the dashboard reads those rows from — the sheet can keep spelling
--     it however it likes.
--
--   * opportunities (Nevilson, Vikram) is a real table that persists, and the Quotes sync
--     only fills sales_person when it is blank, so a plain UPDATE holds there.
--
-- pc_sme is deliberately NOT normalised. Row edit permissions on Web, Hub & LP hang off
-- it through directory_owner_match, and none of the mapped names are PMs — there is
-- nothing to gain and somebody's edit rights to lose.
--
-- Nevilson merges toward the LONG form even though the short one was commoner (7 against
-- 1): the full name is the correct one, and majority is not the test.
create or replace function public.canonical_person(p text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p, '')))
    when 'kalgi'              then 'Kalgi Shah'
    when 'kalgi shah'         then 'Kalgi Shah'
    when 'flintoff'           then 'Flintoff Mehta'
    when 'nevilson'           then 'Nevilson Christian'
    when 'vikram shahi'       then 'Vikram Sahi'
    else nullif(btrim(coalesce(p, '')), '')
  end;
$$;

comment on function public.canonical_person(text) is
  'One spelling per person. An explicit map, not fuzzy matching: Rahul Gupta, Rahul Jain and Rahul Kaushal are three different people, and so are Kaustubh Agrawal and Kaustubh Kulkarni.';

revoke execute on function public.canonical_person(text) from public;
grant  execute on function public.canonical_person(text) to anon, authenticated;

-- web_sheet_rows is recreated with public.canonical_person(s.sales_person); every other
-- column is unchanged. Pull the current definition with:
--   select pg_get_viewdef('public.web_sheet_rows'::regclass, true);
--
-- And the persistent side, which the sync will not overwrite:
--   update public.opportunities set sales_person = 'Vikram Sahi'       where sales_person = 'Vikram Shahi';   -- 3 rows
--   update public.opportunities set sales_person = 'Nevilson Christian' where btrim(sales_person) = 'Nevilson'; -- 4 rows
--
-- Verified after: Kalgi Shah 332 ledger / 90 deals, Flintoff Mehta 294 / 83,
-- Vikram Sahi 131 / 30, Nevilson Christian 5 deals. No variant left anywhere.
