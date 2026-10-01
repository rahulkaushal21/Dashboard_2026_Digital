-- 118 — value, owner and month are editable on a dashboard line
--
-- The Edit dialog's footer said "Value, owner and month are set at confirmation and
-- cannot be changed here." Rahul: give the option to edit anything. Nothing comes in
-- from the spreadsheet any more, so the dashboard is where a wrong figure or a wrong
-- month gets put right, and sending somebody back through confirmation to do it was
-- the only reason those three were held back.
--
-- update_project_fields() gains four optional arguments:
--   p_local_value  the figure in the deal's currency; est_value and won_amount are
--                  recomputed in USD from it, so every total moves with it
--   p_currency     changes the currency the figure is in; est_value recomputed
--   p_pm_owner     the PC/SME
--   p_month        the month the line is booked under. A recurring line is filed by
--                  source_date, anything else by confirmed_at (web_project_ledger), so
--                  the matching column is re-dated to the first of the chosen month
--
-- Same rule as before: the row's PM or an admin. A PM who hands a line to a colleague
-- loses the right to edit it afterwards, which is the point. Every change is logged in
-- opportunity_events with the old and new value, because these are the three fields
-- where "who changed this and from what" will be asked.
--
-- Sheet lines are not covered: their value, owner and month are what the old
-- spreadsheet recorded and feed the revenue tables directly; an overlay here would
-- disagree with those. The dialog says so.

drop function if exists public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text);

create or replace function public.update_project_fields(
  p_id bigint, p_project_id text default null, p_quote_id text default null, p_expert text default null,
  p_internal_delivery date default null, p_internal_hrs numeric default null, p_actual_hrs numeric default null,
  p_integration text default null, p_outsource_price numeric default null, p_invoice_no text default null,
  p_invoice_currency text default null, p_invoice_amount numeric default null, p_feedback_status text default null,
  p_delivery_status text default null, p_delivery_date date default null, p_start_date date default null,
  p_contractor_name text default null, p_outsource_currency text default null,
  p_project_name text default null,
  p_local_value numeric default null, p_currency text default null, p_pm_owner text default null, p_month date default null)
returns bigint
language plpgsql security definer
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

  -- What changed among the three guarded fields, for the event log.
  if p_local_value is not null and p_local_value is distinct from v_row.local_value then
    v_changes := v_changes || jsonb_build_object('value', jsonb_build_object('from', v_row.local_value, 'to', p_local_value));
  end if;
  if p_currency is not null and v_cur is distinct from v_row.currency then
    v_changes := v_changes || jsonb_build_object('currency', jsonb_build_object('from', v_row.currency, 'to', v_cur));
  end if;
  if nullif(trim(coalesce(p_pm_owner,'')),'') is not null and trim(p_pm_owner) is distinct from v_row.pm_owner then
    v_changes := v_changes || jsonb_build_object('pm_owner', jsonb_build_object('from', v_row.pm_owner, 'to', trim(p_pm_owner)));
  end if;
  if p_month is not null then
    v_changes := v_changes || jsonb_build_object('month', jsonb_build_object(
      'from', to_char(case when v_row.origin = 'recurring' then coalesce(v_row.source_date, v_row.confirmed_at) else coalesce(v_row.confirmed_at, v_row.source_date) end, 'YYYY-MM'),
      'to', to_char(v_month, 'YYYY-MM')));
  end if;

  update public.opportunities set
    source_subject   = coalesce(nullif(trim(coalesce(p_project_name,'')),''), source_subject),
    pm_owner         = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''), pm_owner),
    -- Value and currency move together: the USD figure every total adds up is
    -- recomputed whenever either changes, so a line cannot be worth one thing in its
    -- own currency and another in dollars.
    local_value      = case when p_local_value is not null or p_currency is not null then v_local else local_value end,
    currency         = case when p_local_value is not null or p_currency is not null then v_cur else currency end,
    est_value        = case when p_local_value is not null or p_currency is not null then public.to_usd(v_local, v_cur) else est_value end,
    won_amount       = case when p_local_value is not null or p_currency is not null then public.to_usd(v_local, v_cur) else won_amount end,
    -- The month a line is booked under. Re-dated to the 1st so it is unambiguous; a
    -- recurring line is filed by source_date, anything else by its confirmation.
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

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'edited', v_actor, jsonb_build_object('from', 'ledger') || case when v_changes = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('changed', v_changes) end);

  return p_id;
end $function$;

revoke execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date) from public, anon;
grant  execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date) to authenticated;
