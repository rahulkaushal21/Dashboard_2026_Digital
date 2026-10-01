-- 113 — a Maintenance line needs a delivery date like any other; the move asks for it
--
-- 112 exempted Maintenance from the delivery-date gate so six retainers could move into
-- October. Rahul's call on reviewing it: no. Maintenance should behave like every other
-- project type, and when the date is missing the PM should be asked for it rather than
-- the system deciding it does not matter. The exemption list goes back to 037's three.
--
-- What was actually wrong is that the move-to-month button had no way to supply a date
-- at all. The three copy functions never wrote delivery_date, so any line whose type is
-- not Dedicated/Partial Dedicated/Ballpark was refused every time, with nothing the PM
-- could do about it from the page. Each now takes an optional p_delivery_date, and the
-- page asks for one when the gate names it.
--
-- The signatures change, so the old ones are dropped first: a second overload with a
-- defaulted argument would make every existing call ambiguous.

-- ---------------------------------------------------------------------------
-- 1. The gate, back to 037's list
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
        -- A Dedicated engagement is not delivered on a day. Everything else, Maintenance
        -- included, is: the PM is asked for the date when the line is moved.
        ('Delivery date',     o.delivery_date is null
                              and lower(btrim(coalesce(o.project_type,''))) not in
                                  ('dedicated', 'partial dedicated', 'ballpark'))
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$function$;

revoke execute on function public.opportunity_missing_fields(bigint) from public, anon;
grant  execute on function public.opportunity_missing_fields(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The three copies take a delivery date
-- ---------------------------------------------------------------------------

drop function if exists public.duplicate_booking_to_month(bigint, date, numeric, text);
drop function if exists public.duplicate_raw_row_to_month(bigint, date, numeric, text);
drop function if exists public.copy_row_to_month(text, bigint, date, numeric);

create or replace function public.duplicate_booking_to_month(
  p_booking_id bigint, p_month date, p_amount numeric default null, p_note text default null,
  p_delivery_date date default null)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  b       public.web_revenue%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_amt   numeric;
  v_geo   text;
  v_key   text;
  v_id    bigint;
  v_missing text[];
begin
  if v_actor is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into b from public.web_revenue where id = p_booking_id;
  if not found then raise exception 'No such revenue line.' using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(b.sme, v_actor)) then
    raise exception 'This client belongs to % - they, or an admin, can add it.', coalesce(b.sme,'another PM')
      using errcode = '42501';
  end if;

  v_amt := coalesce(p_amount, b.booking_amount);
  if coalesce(v_amt,0) <= 0 then
    raise exception 'Cannot add yet - still missing: Value' using errcode = '23502';
  end if;

  v_geo := case
    when b.geo ilike '%us%' or b.geo ilike '%canada%'    then 'US'
    when b.geo ilike '%au%' or b.geo ilike '%nz%'        then 'AU'
    when b.geo ilike '%uk%' or b.geo ilike '%eu%'        then 'UK'
    else nullif(trim(coalesce(b.geo,'')),'') end;

  v_key := 'dup:' || p_booking_id || ':' || to_char(v_month, 'YYYY-MM');
  if exists (select 1 from public.opportunities where quote_key = v_key) then
    raise exception 'That line is already in %.', to_char(v_month, 'Mon YYYY') using errcode = '23505';
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, local_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, contact_email, status, won, won_amount, rfq, rfq_status,
    enriched, summary, gist, next_step, created_by, created_at,
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at, delivery_date
  ) values (
    v_key, 'recurring', 'retainer',
    b.company_name,
    b.company_name || ' - ' || coalesce(b.engagement_model, 'recurring') || ' ' || to_char(v_month, 'Mon YYYY'),
    v_month, v_month,
    v_amt, v_amt, 'USD',
    b.service_name, coalesce(b.engagement_model, 'Dedicated'), b.technology, 'Repeat',
    b.sales_person, b.sme, v_geo, b.contact_email,
    'Won', true, v_amt, false, 'won',
    true,
    left(b.company_name || ' - ' || to_char(v_month, 'Mon YYYY') || ' - $' || round(v_amt)::text, 300),
    nullif(trim(coalesce(p_note,'')),''),
    'Copied from the revenue sheet.',
    v_actor, now(), true, v_actor, now(), v_actor, now(), p_delivery_date
  ) returning id into v_id;

  perform public.apply_sheet_defaults(v_id);

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot add yet - still missing: %', array_to_string(v_missing, ', ') using errcode = '23502';
  end if;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','revenue-sheet','booking_id',p_booking_id,'month',to_char(v_month,'YYYY-MM')));

  return v_id;
end $function$;

create or replace function public.duplicate_raw_row_to_month(
  p_raw_id bigint, p_month date, p_amount numeric default null, p_note text default null,
  p_delivery_date date default null)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  b       record;
  v_month date := date_trunc('month', p_month)::date;
  v_amt   numeric;
  v_cur   text;
  v_geo   text;
  v_key   text;
  v_id    bigint;
  v_missing text[];
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  select * into b from public.web_sheet_rows where id = p_raw_id;
  if not found then raise exception 'No such line in the sheet.' using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(b.pc_sme, v_actor)) then
    raise exception 'This client belongs to % - they, or an admin, can add it.', coalesce(b.pc_sme, 'another PM')
      using errcode = '42501';
  end if;

  v_cur := coalesce(b.currency, 'USD');
  v_amt := coalesce(p_amount, b.confirmed_price, b.usd_value);
  if coalesce(v_amt, 0) <= 0 then
    raise exception 'Cannot add yet - still missing: Value' using errcode = '23502';
  end if;

  v_geo := case
    when b.geo ilike '%us%' or b.geo ilike '%canada%' then 'US'
    when b.geo ilike '%au%' or b.geo ilike '%nz%'     then 'AU'
    when b.geo ilike '%uk%' or b.geo ilike '%eu%'     then 'UK'
    else nullif(btrim(coalesce(b.geo, '')), '') end;

  v_key := 'raw:' || p_raw_id || ':' || to_char(v_month, 'YYYY-MM');
  if exists (select 1 from public.opportunities where quote_key = v_key) then
    raise exception 'That line is already in %.', to_char(v_month, 'Mon YYYY') using errcode = '23505';
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, local_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, contact_email, status, won, won_amount, rfq, rfq_status,
    enriched, summary, gist, next_step, created_by, created_at,
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at,
    client_name, client_type, service_type, delivery_type, expert, delivery_status, delivery_date
  ) values (
    v_key, 'recurring', 'retainer', b.agency,
    coalesce(b.project_name, b.agency) || ' - ' || to_char(v_month, 'Mon YYYY'),
    v_month, v_month,
    public.to_usd(v_amt, v_cur), v_amt, v_cur,
    b.service_dept, coalesce(b.project_type, 'Dedicated'), b.technology, 'Repeat',
    b.sales_person, b.pc_sme, v_geo, b.client_email,
    'Won', true, public.to_usd(v_amt, v_cur), false, 'won', true,
    left(b.agency || ' - ' || to_char(v_month, 'Mon YYYY'), 300),
    nullif(btrim(coalesce(p_note, '')), ''),
    'Carried forward from the sheet.',
    v_actor, now(), true, v_actor, now(), v_actor, now(),
    b.client_name, b.client_type, b.service_type, b.delivery_type, b.expert,
    'Under Development', p_delivery_date
  ) returning id into v_id;

  perform public.apply_sheet_defaults(v_id);

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot add yet - still missing: %', array_to_string(v_missing, ', ') using errcode = '23502';
  end if;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from', 'sheet-tab', 'raw_id', p_raw_id, 'month', to_char(v_month, 'YYYY-MM')));

  return v_id;
end $function$;

create or replace function public.copy_row_to_month(
  p_source text, p_id bigint, p_month date, p_amount numeric default null,
  p_delivery_date date default null)
returns bigint
language plpgsql security definer
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
    return public.duplicate_raw_row_to_month(p_id, v_month, p_amount, null, p_delivery_date);
  end if;
  if p_source = 'sheet' then
    return public.duplicate_booking_to_month(p_id, v_month, p_amount, null, p_delivery_date);
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
    client_name, client_type, service_type, delivery_type, expert, delivery_status, delivery_date
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
    'Under Development', p_delivery_date
  ) returning id into v_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','ledger-copy','copied_from',p_id,'month',to_char(v_month,'YYYY-MM')));
  return v_id;
end $function$;

revoke execute on function public.duplicate_booking_to_month(bigint, date, numeric, text, date) from public, anon;
revoke execute on function public.duplicate_raw_row_to_month(bigint, date, numeric, text, date) from public, anon;
revoke execute on function public.copy_row_to_month(text, bigint, date, numeric, date) from public, anon;
grant  execute on function public.duplicate_booking_to_month(bigint, date, numeric, text, date) to authenticated;
grant  execute on function public.duplicate_raw_row_to_month(bigint, date, numeric, text, date) to authenticated;
grant  execute on function public.copy_row_to_month(text, bigint, date, numeric, date) to authenticated;
