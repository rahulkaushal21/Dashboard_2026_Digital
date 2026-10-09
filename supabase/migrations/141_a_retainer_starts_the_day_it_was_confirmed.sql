-- A retainer starts the day it was confirmed, not the 1st
-- =======================================================
--
-- Every retainer carried into a month landed with Start Date = the 1st of that month,
-- whatever day the PM actually confirmed it. 19 rows across 5 PMs in the first week of
-- October alone: Telfer confirmed on the 5th, Brandtech's five L'Oreal lines on the 6th,
-- Seven Living and Office Complete on the 6th, all reading 2026-10-01.
--
-- Cause: apply_sheet_defaults() ended with
--     start_date = coalesce(o.start_date, o.source_date::date)
-- and all three carry-forward paths (confirm_recurring_draft, duplicate_raw_row_to_month,
-- duplicate_booking_to_month) set source_date to the FIRST of the booking month as a
-- month marker rather than as a real date. So start_date inherited the marker.
--
-- The 1st is also wrong in principle: not every retainer runs calendar months. Some run
-- the 15th to the 14th. Rahul's call (9 Oct 2026): default it to the day it was
-- confirmed, and let the PM change it — Start Date is already editable in place on the
-- revenue sheet and in the Edit dialog.
--
-- ONE GUARD. Start Date is what the revenue sheet pages on and what Business Numbers
-- reports, so a start date outside the booking month moves money between months. Three
-- of those 19 rows were confirmed OUTSIDE the month they were booked into:
--   HexaGroup and Xzito  — confirmed 30 Sep, booked into October
--   Vested (CMIC)        — confirmed  1 Oct, booked into November
-- Taking the confirmation date there would drag $7,601 into the wrong month. So the
-- confirmation date is used only when it falls inside the booking month; otherwise the
-- month's 1st stands. By construction this can never move a line between months — it
-- only sharpens the day within the month the line already sits in.
--
-- Existing rows are NOT rewritten here. The 19 are going to the PMs to check first.

create or replace function public.apply_sheet_defaults(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d record;
begin
  select * into d from public.web_sheet_client_defaults
   where client_key = (select lower(btrim(company_name)) from public.opportunities where id = p_id);

  update public.opportunities o set
    client_name   = coalesce(nullif(trim(coalesce(o.client_name,'')),''),   d.client_name),
    client_type   = coalesce(nullif(trim(coalesce(o.client_type,'')),''),   d.client_type),
    service_type  = coalesce(nullif(trim(coalesce(o.service_type,'')),''),  d.service_type,  'Development Only'),
    delivery_type = coalesce(nullif(trim(coalesce(o.delivery_type,'')),''), d.delivery_type, 'Effort based'),
    technology    = coalesce(nullif(trim(coalesce(o.technology,'')),''),    d.technology),
    contact_email = coalesce(nullif(trim(coalesce(o.contact_email,'')),''), d.client_email),
    delivery_status = coalesce(nullif(trim(coalesce(o.delivery_status,'')),''), 'Under Development'),
    -- The day it was confirmed, unless that day falls outside the booking month, in
    -- which case the month's own marker stands and the line stays where it belongs.
    start_date    = coalesce(
                      o.start_date,
                      case
                        when o.confirmed_at is not null
                         and date_trunc('month', o.confirmed_at) = date_trunc('month', o.source_date)
                        then o.confirmed_at::date
                        else o.source_date::date
                      end)
  where o.id = p_id;
end $function$;


-- The edit trail records dates too
-- --------------------------------
-- update_project_fields logged a change to value, currency, PM, AM, agency and month,
-- and nothing else. So when Fishing World's start date moved from 1 Oct to 9 Oct this
-- morning, the event for that save recorded only `month: 2026-10 -> 2026-10` and there
-- was no way to tell from the trail who had moved the date or when. Dates are the field
-- people are correcting right now, which makes them exactly the field worth logging.

create or replace function public.update_project_fields(
  p_id bigint,
  p_project_id text default null,
  p_quote_id text default null,
  p_expert text default null,
  p_internal_delivery date default null,
  p_internal_hrs numeric default null,
  p_actual_hrs numeric default null,
  p_integration text default null,
  p_outsource_price numeric default null,
  p_invoice_no text default null,
  p_invoice_currency text default null,
  p_invoice_amount numeric default null,
  p_feedback_status text default null,
  p_delivery_status text default null,
  p_delivery_date date default null,
  p_start_date date default null,
  p_contractor_name text default null,
  p_outsource_currency text default null,
  p_project_name text default null,
  p_local_value numeric default null,
  p_currency text default null,
  p_pm_owner text default null,
  p_month date default null,
  p_sales_person text default null,
  p_company_name text default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor  text := public.jwt_email();
  v_row    public.opportunities%rowtype;
  v_expert text;
  v_cur    text;
  v_local  numeric;
  v_month  date := date_trunc('month', p_month)::date;
  v_changes jsonb := '{}'::jsonb;
  v_am     text := nullif(trim(coalesce(p_sales_person,'')),'');
  v_agency text := nullif(trim(coalesce(p_company_name,'')),'');
  v_marks  text[] := '{}';
begin
  if v_actor is null then
    raise exception 'Sign in to edit this row.' using errcode = '42501';
  end if;
  select * into v_row from public.opportunities where id = p_id;
  if not found then raise exception 'No such row (#%).', p_id using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(v_row.pm_owner, v_actor)) then
    raise exception 'This row belongs to another PM. Its owner, or an admin, can edit it.'
      using errcode = '42501';
  end if;

  if p_local_value is not null and p_local_value <= 0 then
    raise exception 'The value has to be more than zero.' using errcode = '22023';
  end if;

  v_expert := case when p_expert is null then v_row.expert else nullif(trim(p_expert),'') end;
  v_cur    := coalesce(nullif(trim(coalesce(p_currency,'')),''), v_row.currency, 'USD');
  v_local  := coalesce(p_local_value, v_row.local_value, v_row.est_value);

  if p_local_value is not null and p_local_value is distinct from v_row.local_value then
    v_changes := v_changes || jsonb_build_object('value', jsonb_build_object('from', v_row.local_value, 'to', p_local_value));
  end if;
  if p_currency is not null and v_cur is distinct from v_row.currency then
    v_changes := v_changes || jsonb_build_object('currency', jsonb_build_object('from', v_row.currency, 'to', v_cur));
  end if;
  if nullif(trim(coalesce(p_pm_owner,'')),'') is not null and trim(p_pm_owner) is distinct from v_row.pm_owner then
    v_changes := v_changes || jsonb_build_object('pm_owner', jsonb_build_object('from', v_row.pm_owner, 'to', trim(p_pm_owner)));
  end if;
  if p_sales_person is not null and v_am is distinct from v_row.sales_person then
    v_changes := v_changes || jsonb_build_object('sales_person', jsonb_build_object('from', v_row.sales_person, 'to', v_am));
  end if;
  if v_agency is not null and v_agency is distinct from v_row.company_name then
    v_changes := v_changes || jsonb_build_object('company_name', jsonb_build_object('from', v_row.company_name, 'to', v_agency));
  end if;
  if p_month is not null then
    v_changes := v_changes || jsonb_build_object('month', jsonb_build_object(
      'from', to_char(case when v_row.origin = 'recurring' then coalesce(v_row.source_date, v_row.confirmed_at) else coalesce(v_row.confirmed_at, v_row.source_date) end, 'YYYY-MM'),
      'to', to_char(v_month, 'YYYY-MM')));
  end if;
  -- The three dates. Logged only when the save actually moves one, so a dialog that
  -- sends back the date it was opened with does not fill the trail with no-ops.
  if p_start_date is not null and p_start_date is distinct from v_row.start_date then
    v_changes := v_changes || jsonb_build_object('start_date', jsonb_build_object('from', v_row.start_date, 'to', p_start_date));
  end if;
  if p_delivery_date is not null and p_delivery_date is distinct from v_row.delivery_date then
    v_changes := v_changes || jsonb_build_object('delivery_date', jsonb_build_object('from', v_row.delivery_date, 'to', p_delivery_date));
  end if;
  if p_internal_delivery is not null and p_internal_delivery is distinct from v_row.internal_delivery then
    v_changes := v_changes || jsonb_build_object('internal_delivery', jsonb_build_object('from', v_row.internal_delivery, 'to', p_internal_delivery));
  end if;

  if p_sales_person is not null then v_marks := array_append(v_marks, 'sales_person'); end if;
  if v_agency is not null          then v_marks := array_append(v_marks, 'company_name'); end if;

  perform set_config('app.manual_edit', '1', true);

  update public.opportunities set
    source_subject   = coalesce(nullif(trim(coalesce(p_project_name,'')),''), source_subject),
    pm_owner         = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''), pm_owner),
    sales_person     = case when p_sales_person is null then sales_person else v_am end,
    company_name     = coalesce(v_agency, company_name),
    manual_fields    = array(select distinct unnest(coalesce(manual_fields, '{}') || v_marks)),
    local_value      = case when p_local_value is not null or p_currency is not null then v_local else local_value end,
    currency         = case when p_local_value is not null or p_currency is not null then v_cur else currency end,
    est_value        = case when p_local_value is not null or p_currency is not null then public.to_usd(v_local, v_cur) else est_value end,
    won_amount       = case when p_local_value is not null or p_currency is not null then public.to_usd(v_local, v_cur) else won_amount end,
    source_date      = case when p_month is not null and origin = 'recurring' then v_month::timestamptz else source_date end,
    first_date       = case when p_month is not null and origin = 'recurring' then v_month::timestamptz else first_date end,
    confirmed_at     = case when p_month is not null and coalesce(origin,'') <> 'recurring' then v_month::timestamptz else confirmed_at end,
    email_won_at     = case when p_month is not null and coalesce(origin,'') <> 'recurring' then v_month::timestamptz else email_won_at end,
    project_id       = case when p_project_id      is null then project_id       else nullif(trim(p_project_id),'')      end,
    quote_id         = case when p_quote_id        is null then quote_id         else nullif(trim(p_quote_id),'')        end,
    expert           = v_expert,
    integration      = case when p_integration     is null then integration      else nullif(trim(p_integration),'')     end,
    invoice_no       = case when p_invoice_no      is null then invoice_no       else nullif(trim(p_invoice_no),'')      end,
    invoice_currency = case when p_invoice_currency is null then invoice_currency else nullif(trim(p_invoice_currency),'') end,
    feedback_status  = case when p_feedback_status is null then feedback_status  else nullif(trim(p_feedback_status),'') end,
    delivery_status  = case when p_delivery_status is null then delivery_status  else nullif(trim(p_delivery_status),'') end,
    contractor_name  = case when v_expert = 'Contractor'
                            then case when p_contractor_name is null then contractor_name else nullif(trim(p_contractor_name),'') end
                            else null end,
    outsource_price  = case when v_expert = 'Contractor' then coalesce(p_outsource_price, outsource_price) else null end,
    outsource_currency = case when v_expert = 'Contractor'
                              then coalesce(nullif(trim(coalesce(p_outsource_currency,'')),''), outsource_currency, 'USD')
                              else null end,
    internal_delivery = coalesce(p_internal_delivery, internal_delivery),
    internal_hrs     = coalesce(p_internal_hrs,   internal_hrs),
    actual_hrs       = coalesce(p_actual_hrs,     actual_hrs),
    invoice_amount   = coalesce(p_invoice_amount, invoice_amount),
    delivery_date    = coalesce(p_delivery_date,  delivery_date),
    start_date       = coalesce(p_start_date,     start_date)
  where id = p_id;

  perform set_config('app.manual_edit', '0', true);

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'edited', v_actor, jsonb_build_object('from', 'ledger') || case when v_changes = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('changed', v_changes) end);

  return p_id;
end $function$;
