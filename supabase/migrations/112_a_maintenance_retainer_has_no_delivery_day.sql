-- 112 — a maintenance retainer has no delivery day either
--
-- The team moved September's recurring lines into October and six of them refused:
--
--   Innovative Capital, Russound, Sprung, Sunrise Technologies,
--   Finch Creative, Vici Trading Solutions
--     → "Cannot add yet - still missing: Delivery date"
--
-- All six carry Project Type = "Maintanance" in the revenue sheet (the sheet's spelling).
-- sync-web-revenue maps that column straight onto web_revenue.engagement_model, and
-- duplicate_booking_to_month() copies it onto the new opportunity's project_type. The
-- completeness gate in 037 then demands a Delivery date, because its exemption list is
-- only ('Dedicated', 'Partial Dedicated', 'Ballpark').
--
-- 037's own reason for that exemption was "A Dedicated engagement is not delivered on a
-- day. Demanding a delivery date would make the monthly retainer impossible to complete
-- honestly." That reasoning covers Maintenance exactly: 477 rows of it in the sheet, all
-- monthly billing against work that is ongoing rather than handed over on a date. The
-- list was simply short.
--
-- Nothing else is relaxed. Ad-hoc, New Development, Additional Pages and Change Request
-- are all delivered on a day, and still have to say which.
--
-- ---------------------------------------------------------------------------
-- WHY NOT JUST FILL THE DATE IN
--
-- The obvious alternative was to have the copy stamp the last day of the target month,
-- since that is what the sheet usually holds. It only usually holds it: of the 474 dated
-- Maintenance rows, 286 are the last day of the month, 148 are some other day in it, and
-- 40 are in a different month entirely. Writing a date on the other 40% would be putting
-- a number nobody chose into a column somebody reads.
--
-- BOTH SPELLINGS. The sheet says "Maintanance" throughout; anyone correcting it to
-- "Maintenance" would silently re-break this. Matching is case-insensitive on both.
-- ---------------------------------------------------------------------------

create or replace function public.opportunity_missing_fields(p_id bigint)
returns text[]
language sql stable security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(f order by f), '{}'::text[]) from (
    select f from public.opportunities o,
      lateral (values
        ('Client',            nullif(trim(coalesce(o.company_name,'')),'') is null),
        ('Value',             coalesce(o.est_value,0) <= 0),
        ('Currency',          nullif(trim(coalesce(o.currency,'')),'') is null),
        ('Quote date',        o.source_date is null),
        ('Service / dept',    nullif(trim(coalesce(o.service_dept,'')),'') is null),
        ('Project type',      nullif(trim(coalesce(o.project_type,'')),'') is null),
        ('Account manager',   nullif(trim(coalesce(o.sales_person,'')),'') is null),
        ('PM owner',          nullif(trim(coalesce(o.pm_owner,'')),'') is null),
        ('Geography',         nullif(trim(coalesce(o.geo,'')),'') is null),
        ('Client name',       nullif(trim(coalesce(o.client_name,'')),'') is null
                              and coalesce(o.origin,'') <> 'recurring'),
        ('Client type',       nullif(trim(coalesce(o.client_type,'')),'') is null
                              and coalesce(o.origin,'') <> 'recurring'),
        ('Service type',      nullif(trim(coalesce(o.service_type,'')),'') is null),
        ('Delivery type',     nullif(trim(coalesce(o.delivery_type,'')),'') is null),
        ('Technology',        nullif(trim(coalesce(o.technology,'')),'') is null),
        ('Start date',        o.start_date is null),
        -- An engagement billed by the month is not delivered on a day. Dedicated,
        -- Partial Dedicated and Maintenance are all of that kind; everything else is
        -- handed over on a date and still has to name it.
        ('Delivery date',     o.delivery_date is null
                              and lower(btrim(coalesce(o.project_type,''))) not in
                                  ('dedicated', 'partial dedicated', 'ballpark',
                                   'maintanance', 'maintenance'))
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$function$;

revoke execute on function public.opportunity_missing_fields(bigint) from public, anon;
grant  execute on function public.opportunity_missing_fields(bigint) to authenticated;
