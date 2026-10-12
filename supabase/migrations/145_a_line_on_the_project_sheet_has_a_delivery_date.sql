-- A line on the project sheet has a delivery date
-- ===============================================
--
-- Rahul, 12 Oct 2026: "lets make delivery date when moving from opportunity to project
-- sheet as required as this is most important."
--
-- It already was, almost. opportunity_missing_fields listed Delivery date, and both the
-- confirm dialog and confirm_opportunity refused without it. Two holes let lines onto
-- the sheet with the field blank, and the numbers say which:
--
--   dashboard lines booked since July 2026, by engagement model
--     Dedicated           12 lines,  7 with no delivery date   $22,898
--     Partial Dedicated    5 lines,  3 with no delivery date    $6,925
--     everything else     52 lines,  0 with no delivery date
--
-- Every blank is a retainer. Two causes, closed here.
--
--
-- 1. The retainer carve-out
-- -------------------------
-- The check read
--     ('Delivery date', o.delivery_date is null
--                       and lower(btrim(coalesce(o.project_type,''))) not in
--                           ('dedicated', 'partial dedicated', 'ballpark'))
-- on the reasoning that a Dedicated engagement is not delivered on a day. That is true
-- of the ENGAGEMENT and false of the LINE: a line covers one month and that month ends.
--
-- The old spreadsheet settles the argument. All 44 Dedicated and all 19 Partial
-- Dedicated rows in it carry a delivery date. PMs were filling it in for years; the
-- dashboard stopped asking and the field went blank.
--
--
-- 2. The carry-forward never ran the gate
-- ---------------------------------------
-- copy_row_to_month is how a retainer reaches next month, which is the highest-volume
-- route onto the project sheet there is. Its dashboard branch checked the VALUE and
-- nothing else - it never called opportunity_missing_fields, unlike the three other
-- routes (confirm_opportunity, confirm_recurring_draft, duplicate_booking_to_month,
-- duplicate_raw_row_to_month). So a Dedicated line carried forward landed with the date
-- blank even after the carve-out above is gone, because the gate was never consulted.
--
-- Only the delivery date is added here, not the whole gate. Running the full check on
-- this path would refuse carry-forwards for fields the PM cannot answer while moving a
-- retainer, which is a bigger change than the one asked for; the narrow check matches
-- what was actually wrong.
--
-- THE WORDING MATTERS. The revenue sheet reads 'still missing: <fields>' off the
-- refusal, and when the only item is 'Delivery date' it offers a date box under the row
-- instead of sending the PM away. The message here is written to match, so the ten
-- existing retainers above get the inline prompt the first time somebody moves them.
--
-- Nothing is backfilled. The ten lines already booked keep their blank date until
-- somebody sets one - either in the Edit dialog, in place on the revenue sheet, or at
-- the prompt when the line is moved to next month.


-- 1. Delivery date is required on every project type
-- --------------------------------------------------
create or replace function public.opportunity_missing_fields(p_id bigint)
returns text[]
language sql
stable
security definer
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
        -- EVERY project type, retainers included. See the note at the top.
        ('Delivery date',     o.delivery_date is null)
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$function$;


-- 2. The carry-forward asks for it too
-- ------------------------------------
-- Unchanged apart from the one new check; the body is restated in full because
-- create or replace takes the whole function.
create or replace function public.copy_row_to_month(
  p_source text, p_id bigint, p_month date, p_amount numeric default null,
  p_delivery_date date default null, p_internal_delivery date default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  o       public.opportunities%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_amt   numeric;
  v_key   text;
  v_id    bigint;
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  if p_source = 'raw' then
    return public.duplicate_raw_row_to_month(p_id, v_month, p_amount, null, p_delivery_date, p_internal_delivery);
  end if;
  if p_source = 'sheet' then
    return public.duplicate_booking_to_month(p_id, v_month, p_amount, null, p_delivery_date, p_internal_delivery);
  end if;

  select * into o from public.opportunities where id = p_id;
  if not found then raise exception 'No such entry.' using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(o.pm_owner, v_actor)) then
    raise exception 'This client belongs to % - they, or an admin, can copy it.', coalesce(o.pm_owner,'another PM')
      using errcode = '42501';
  end if;

  v_amt := coalesce(p_amount, o.local_value, o.est_value);
  if coalesce(v_amt,0) <= 0 then
    raise exception 'Cannot copy - still missing: Value' using errcode = '23502';
  end if;

  -- A MONTH THAT ENDS HAS A DELIVERY DATE. This path is how a retainer reaches next
  -- month and it checked the value alone, so a Dedicated line carried forward landed on
  -- the project sheet with the date blank - the one field the delivery team works from.
  -- The three other routes onto the sheet all run opportunity_missing_fields and this
  -- one never did. The wording matches theirs so the revenue sheet keeps offering the
  -- date inline rather than sending the PM away.
  if p_delivery_date is null then
    raise exception 'Cannot copy - still missing: Delivery date' using errcode = '23502';
  end if;

  v_key := 'cpy:' || p_id || ':' || to_char(v_month, 'YYYY-MM');
  if exists (select 1 from public.opportunities where quote_key = v_key) then
    raise exception '% is already in %.', coalesce(o.company_name,'That client'), to_char(v_month, 'Mon YYYY')
      using errcode = '23505';
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, local_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, contact_email, status, won, won_amount, rfq, rfq_status,
    enriched, summary, gist, next_step, created_by, created_at,
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at,
    client_name, client_type, service_type, delivery_type, expert, delivery_status,
    delivery_date, internal_delivery
  ) values (
    v_key, 'recurring', 'retainer', o.company_name,
    coalesce(o.source_subject, o.company_name) || ' - ' || to_char(v_month, 'Mon YYYY'),
    v_month, v_month,
    public.to_usd(v_amt, coalesce(o.currency,'USD')), v_amt, coalesce(o.currency,'USD'),
    o.service_dept, coalesce(o.project_type,'Dedicated'), o.technology, 'Repeat',
    o.sales_person, o.pm_owner, o.geo, o.contact_email,
    'Won', true, public.to_usd(v_amt, coalesce(o.currency,'USD')), false, 'won', true,
    left(o.company_name || ' - ' || to_char(v_month, 'Mon YYYY'), 300),
    null, 'Recurring engagement.',
    v_actor, now(), true, v_actor, now(), v_actor, now(),
    o.client_name, o.client_type, o.service_type, o.delivery_type, o.expert,
    'Under Development', p_delivery_date, p_internal_delivery
  ) returning id into v_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','ledger-copy','copied_from',p_id,'month',to_char(v_month,'YYYY-MM')));
  return v_id;
end $function$;
