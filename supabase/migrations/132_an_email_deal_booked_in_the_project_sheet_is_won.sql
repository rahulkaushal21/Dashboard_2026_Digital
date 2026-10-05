-- 132 — an email deal booked in the project sheet is Won
--
-- Rahul, 5 Oct 2026: "New Project / TVFH / John Kerr" (view from here, 11 Sep) still Open
-- on Opportunities, while the project sheet has "TVFH - John Kerr" confirmed 30 Sep.
--
-- The line was typed straight into the project sheet, so it never passed through the
-- dashboard's Confirm, and nothing closed the email deal. reconcile_opportunities() does
-- pair email deals with the QUOTES tab (same client + same value, or same first words),
-- but never with project-sheet lines — and this deal carried no value to match on.
--
-- The rule here pairs an open email deal with a project-sheet line of the same client,
-- confirmed on or after the deal's date (a week's grace for a line dated before the
-- mail was read), whose NAME is in the deal's subject: either every distinctive word of
-- the line's project name (the generic ones — website, update, monthly, month names —
-- do not count, and two are needed), or the whole project name run together.
--   "TVFH - John Kerr"             in "New Project / TVFH / John Kerr"      tvfh, john, kerr
--   "SBRI Tours page"              in "Sbri Sports Tours — three homepage…" sbri, tours
--   "GERF Website Updates - September" in "GERF Website Updates / September" whole name
-- Dry-run on 5 Oct: six deals, every pair checked by hand, two of them to the dollar.
--
-- WHAT IT SETS. email_won, with the line named in the reason — the same verdict a person
-- gives from the page, shown as Won and undoable there. NOT won/confirmed_by: that would
-- make the deal a ledger line of its own beside the sheet line that already carries
-- the money. One deal is closed once; the reason says which line it was matched to.

create or replace function public.close_email_deals_booked_in_sheet()
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare n integer := 0;
begin
  with open_email as (
    select o.id, o.source_date::date sd,
           lower(regexp_replace(coalesce(o.company_name,''), '[^a-zA-Z0-9]', '', 'g')) ck,
           lower(regexp_replace(coalesce(o.source_subject,''), '^((re|fw|fwd)\s*:\s*)+', '', 'i')) subj,
           lower(regexp_replace(coalesce(o.source_subject,''), '[^a-zA-Z0-9]', '', 'g')) subj_key
    from public.opportunities o
    where o.origin = 'email' and coalesce(o.won,false) = false and coalesce(o.email_won,false) = false
      and coalesce(o.email_lost,false) = false and o.manual_state is null and o.rolled_into is null
      and lower(coalesce(o.status,'')) not in ('won','lost','cancelled')
      and o.source_date is not null
  ), lines as (
    select r.row_index, r.project_name, coalesce(r.confirmation_date, r.booking_month) confirmed_on,
           lower(regexp_replace(coalesce(r.agency,''), '[^a-zA-Z0-9]', '', 'g')) ck,
           lower(regexp_replace(coalesce(r.project_name,''), '[^a-zA-Z0-9]', '', 'g')) name_key,
           array(select t from regexp_split_to_table(lower(coalesce(r.project_name,'')), '[^a-z0-9]+') t
                 where length(t) >= 3 and t not in (
                   'the','and','for','with','website','web','site','page','pages','update','updates',
                   'project','new','monthly','maintenance','maintanance','support','work','task','tasks',
                   'dev','development','design','landing','additional','month','phase',
                   'january','february','march','april','may','june','july','august','september','october','november','december',
                   'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec','2025','2026','2027')) toks
    from public.web_sheet_rows r
    where coalesce(btrim(r.project_name),'') <> '' and coalesce(r.confirmation_date, r.booking_month) is not null
  ), matched as (
    select distinct on (e.id) e.id, l.row_index, l.project_name, l.confirmed_on
    from open_email e
    join lines l on l.ck = e.ck and l.confirmed_on >= e.sd - 7
    where (array_length(l.toks,1) >= 2
           and not exists (select 1 from unnest(l.toks) t where position(t in e.subj) = 0))
       or (length(l.name_key) >= 8 and position(l.name_key in e.subj_key) > 0)
    order by e.id, l.confirmed_on desc, l.row_index desc
  ), done as (
    update public.opportunities o set
      email_won        = true,
      email_won_at     = m.confirmed_on::timestamptz,
      email_won_by     = 'sheet-match',
      email_won_reason = 'Booked in the project sheet: ' || m.project_name || ' (row ' || m.row_index || ', confirmed ' || to_char(m.confirmed_on, 'DD Mon YYYY') || ')'
    from matched m where o.id = m.id
    returning o.id, m.row_index
  )
  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  select id, 'won', 'sheet-match', jsonb_build_object('from', 'project-sheet', 'row_index', row_index) from done;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke execute on function public.close_email_deals_booked_in_sheet() from public, anon, authenticated;

-- Runs with the reconcile, every half hour.
select cron.alter_job(4, command := 'select reconcile_opportunities(); select public.close_email_deals_booked_in_sheet();');
