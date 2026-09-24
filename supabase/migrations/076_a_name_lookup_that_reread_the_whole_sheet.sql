-- The Project sheet page went blank. This is why, and it was my doing.
--
-- 069 gave every contact their own name back: contact_display_name(email, name) picks a
-- manual fix first, then the commonest spelling of the same letters for that address.
-- It reads web_contact_name_forms, which is built from web_sheet_rows, which is built
-- from sheet_raw.
--
-- web_project_ledger calls that function ONCE PER ROW. So rendering the ledger re-derived
-- the whole 3,239-row sheet 3,239 times. The view went from milliseconds to 36 SECONDS,
-- which is past PostgREST's statement timeout, so the request errored, read() returned
-- null, and the page showed "0 lines - 0 clients - $0" with no error anywhere. A silent
-- blank, which is the worst way for this to fail: it looks like there is no data rather
-- than like something is broken.
--
-- It degraded rather than broke on the day 069 shipped, which is why nobody caught it in
-- the same session.
--
-- THE FIX: materialise the 818-row lookup and point the function at that. Measured
-- 36,268ms -> 504ms on the same query. The manual-fix table is still read LIVE, so
-- correcting somebody's name still applies the moment it is saved; only the "commonest
-- spelling" evidence is hourly, and a spelling that has been wrong for months can wait
-- an hour.
--
-- THE LESSON, worth more than the fix: a function that queries a view must never be
-- called from inside a view over the same base table. It is invisible in the SQL - the
-- call site looks like a scalar - and it costs O(n^2). 069 already hit the other face of
-- this when web_contact_name_forms read the ledger and hung on apply; this is the same
-- mistake from the opposite direction.
create materialized view if not exists public.contact_name_forms_mv as
select email, letters, best_form from public.web_contact_name_forms;

create unique index if not exists contact_name_forms_mv_key
  on public.contact_name_forms_mv (email, letters);

grant select on public.contact_name_forms_mv to anon, authenticated;

create or replace function public.contact_display_name(p_email text, p_name text)
 returns text
 language sql
 stable
as $function$
  select coalesce(
    -- Someone has said what this person is called. That wins outright, and it is read
    -- live so a correction applies the moment it is made.
    (select f.name from public.contact_name_fixes f
      where f.email = lower(btrim(coalesce(p_email,'')))),
    -- Otherwise the commonest spelling of the same letters for the same contact, from
    -- the materialised copy. NOT from web_contact_name_forms - see the note above.
    (select v.best_form from public.contact_name_forms_mv v
      where v.email = lower(btrim(coalesce(p_email,'')))
        and v.letters = lower(regexp_replace(coalesce(p_name,''), '[^a-zA-Z]', '', 'g'))),
    nullif(btrim(coalesce(p_name,'')), '')
  )
$function$;

-- Rebuilt hourly at :44, three minutes after sheet-raw-revenue pulls the sheet at :41.
-- 44ms to rebuild, so a plain refresh rather than CONCURRENTLY: pg_cron runs each job in
-- a transaction and CONCURRENTLY cannot run inside one.
select cron.schedule('refresh-contact-name-forms', '44 * * * *',
  $$refresh materialized view public.contact_name_forms_mv$$);
