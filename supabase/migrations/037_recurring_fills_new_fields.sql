-- 037 — keep the two dialog-less paths working under 036's stricter gate.
--
-- 036 made Client Name, Client Type, Service Type, Delivery Type, Technology and Start
-- Date required, on the reasoning that the confirm dialog prefills all of them. That
-- reasoning does not reach confirm_recurring_draft() or duplicate_booking_to_month():
-- both insert an opportunity and then run the same gate, and NEITHER HAS A DIALOG. The
-- monthly retainer and the move-to-next-month button are one click each, by design.
--
-- Left alone, 036 would have failed every one of them with "still missing: Client name,
-- Client type, Delivery type, Service type, Start date" — breaking the highest-volume
-- confirmation in the system on the day it went live.
--
-- Two changes, so the click keeps working without the gate being weakened for anybody
-- typing a deal in by hand:
--   1. A helper that fills the blanks from the client's own sheet history.
--   2. Client Name and Client Type are not required on a recurring line, which is a
--      billing entry against an existing engagement rather than a new conversation.

-- ---------------------------------------------------------------------------
-- 1. Fill what the sheet already knows
-- ---------------------------------------------------------------------------
--
-- Only ever fills a BLANK. A value already on the row was decided for this deal; the
-- sheet only knows what was true of the last one.

create or replace function public.apply_sheet_defaults(p_id bigint)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare d record;
begin
  select * into d from public.web_sheet_client_defaults
   where client_key = (select lower(btrim(company_name)) from public.opportunities where id = p_id);

  update public.opportunities o set
    client_name   = coalesce(nullif(trim(coalesce(o.client_name,'')),''),   d.client_name),
    client_type   = coalesce(nullif(trim(coalesce(o.client_type,'')),''),   d.client_type),
    -- Service and delivery type fall back to the answer on ~97% of the sheet's rows.
    -- A retainer is Development Only on an Effort based schedule unless somebody has
    -- said otherwise, and the alternative is refusing a one-click action.
    service_type  = coalesce(nullif(trim(coalesce(o.service_type,'')),''),  d.service_type,  'Development Only'),
    delivery_type = coalesce(nullif(trim(coalesce(o.delivery_type,'')),''), d.delivery_type, 'Effort based'),
    technology    = coalesce(nullif(trim(coalesce(o.technology,'')),''),    d.technology),
    contact_email = coalesce(nullif(trim(coalesce(o.contact_email,'')),''), d.client_email),
    delivery_status = coalesce(nullif(trim(coalesce(o.delivery_status,'')),''), 'Under Development'),
    -- A recurring line runs for the month it is filed under, so its own source_date is
    -- the start date. Using now() would date October's retainer to whenever it was
    -- clicked, which for a late entry is the wrong month entirely.
    start_date    = coalesce(o.start_date, o.source_date::date)
  where o.id = p_id;
end $function$;

revoke execute on function public.apply_sheet_defaults(bigint) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. The gate, with the two exemptions
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
        -- A recurring line is this month's billing against an engagement that already
        -- exists. There is no new person to name, and requiring one would only produce
        -- a field somebody types the company into twelve times a year.
        ('Client name',       nullif(trim(coalesce(o.client_name,'')),'') is null
                              and coalesce(o.origin,'') <> 'recurring'),
        ('Client type',       nullif(trim(coalesce(o.client_type,'')),'') is null
                              and coalesce(o.origin,'') <> 'recurring'),
        ('Service type',      nullif(trim(coalesce(o.service_type,'')),'') is null),
        ('Delivery type',     nullif(trim(coalesce(o.delivery_type,'')),'') is null),
        ('Technology',        nullif(trim(coalesce(o.technology,'')),'') is null),
        ('Start date',        o.start_date is null),
        -- A Dedicated engagement is not delivered on a day. Demanding a delivery date
        -- would make the monthly retainer impossible to complete honestly.
        ('Delivery date',     o.delivery_date is null
                              and coalesce(o.project_type,'') not in
                                  ('Dedicated','Partial Dedicated','Ballpark'))
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$function$;

revoke execute on function public.opportunity_missing_fields(bigint) from public, anon;
grant  execute on function public.opportunity_missing_fields(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Call it from the two dialog-less paths
-- ---------------------------------------------------------------------------
--
-- The bodies of confirm_recurring_draft() and duplicate_booking_to_month() are otherwise
-- unchanged from 026 and 032; the single added line in each is
--
--     perform public.apply_sheet_defaults(v_id);
--
-- placed immediately before the completeness check, so the gate sees a row the sheet has
-- already finished. Applied to the live project as migration 037b; the full bodies are
-- in that migration rather than repeated here.
