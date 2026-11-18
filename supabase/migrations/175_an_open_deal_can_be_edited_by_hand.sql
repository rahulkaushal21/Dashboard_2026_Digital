-- 175 — an open deal can be edited by hand
--
-- Pratik, 18 Nov 2026: the email scan cannot read everything. Costing, project type,
-- business type, technology, geography and the rest arrive blank or wrong on an email
-- deal, and the only way to fix them was to CONFIRM the deal first (confirm_opportunity)
-- or wait until it was Won and use the ledger editor (update_project_fields).
--
-- This is the edit for a deal that is still live. It reaches the fields a person knows
-- and the scan does not, and nothing else: not the status, not whether it is won, not
-- who confirmed it. A deal that is already Won is refused and pointed at the revenue
-- sheet's editor, because repricing booked revenue is a different act with its own trail.
--
-- Same contract as the other editors: NULL leaves a field alone, an empty string clears
-- a text field. Every field changed is written to opportunity_events, and named in
-- manual_fields so the scan routine knows a person set it and does not write over it.
--
-- Who may: exactly who may confirm it (can_confirm_opportunity) — an active PM on the
-- directory, or an admin. The browser copy of that rule only decides whether to show
-- the button; this is the one that counts.

create or replace function public.update_opportunity_fields(
  p_id bigint,
  p_subject text default null,
  p_local_value numeric default null,
  p_currency text default null,
  p_win_probability integer default null,
  p_service_dept text default null,
  p_project_type text default null,
  p_technology text default null,
  p_business_type text default null,
  p_geo text default null,
  p_sales_person text default null,
  p_pm_owner text default null,
  p_contact_email text default null,
  p_service_type text default null,
  p_delivery_type text default null,
  p_client_type text default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor   text := public.jwt_email();
  v_row     public.opportunities%rowtype;
  v_cur     text;
  v_local   numeric;
  v_usd     numeric;
  v_changes jsonb := '{}'::jsonb;
  v_marks   text[] := '{}';
  v_pm      text := nullif(trim(coalesce(p_pm_owner,'')),'');
begin
  if v_actor is null then
    raise exception 'Sign in to edit this deal.' using errcode = '42501';
  end if;
  select * into v_row from public.opportunities where id = p_id;
  if not found then raise exception 'No such deal (#%).', p_id using errcode = 'P0002'; end if;

  if not public.can_confirm_opportunity(p_id) then
    raise exception 'Only a registered PM or an admin can edit a deal.' using errcode = '42501';
  end if;
  if coalesce(v_row.won, false) then
    raise exception 'This deal is already Won. Edit it from the revenue sheet instead.' using errcode = '22023';
  end if;

  if p_local_value is not null and p_local_value <= 0 then
    raise exception 'The value has to be more than zero.' using errcode = '22023';
  end if;
  if p_win_probability is not null and (p_win_probability < 0 or p_win_probability > 100) then
    raise exception 'Win probability is between 0 and 100.' using errcode = '22023';
  end if;
  -- An owner has to be someone the directory knows: the owner decides who can confirm.
  if v_pm is not null and not exists (
       select 1 from public.pm_directory d
        where lower(d.name) = lower(v_pm) or lower(v_pm) = any (select lower(a) from unnest(coalesce(d.aliases,'{}')) a)) then
    raise exception '% is not on the PM directory.', v_pm using errcode = '22023';
  end if;

  v_cur   := coalesce(nullif(trim(coalesce(p_currency,'')),''), v_row.currency, 'USD');
  v_local := coalesce(p_local_value, v_row.local_value, v_row.est_value);
  v_usd   := public.to_usd(v_local, v_cur);

  -- A percentage only exists where there is a quoted value (standing rule).
  if p_win_probability is not null and p_win_probability > 0
     and coalesce(case when p_local_value is not null or p_currency is not null then v_usd else v_row.est_value end, 0) <= 0 then
    raise exception 'Add a value before setting a win probability.' using errcode = '22023';
  end if;

  if p_local_value is not null or p_currency is not null then
    if v_local is distinct from v_row.local_value or v_cur is distinct from v_row.currency then
      v_changes := v_changes || jsonb_build_object('value', jsonb_build_object(
        'from', v_row.local_value, 'to', v_local, 'currency_from', v_row.currency, 'currency_to', v_cur));
      v_marks := array_append(v_marks, 'value');
    end if;
  end if;
  if p_win_probability is not null and p_win_probability is distinct from v_row.win_probability then
    v_changes := v_changes || jsonb_build_object('win_probability', jsonb_build_object('from', v_row.win_probability, 'to', p_win_probability));
    v_marks := array_append(v_marks, 'win_probability');
  end if;
  if v_pm is not null and v_pm is distinct from v_row.pm_owner then
    v_changes := v_changes || jsonb_build_object('pm_owner', jsonb_build_object('from', v_row.pm_owner, 'to', v_pm));
    v_marks := array_append(v_marks, 'pm_owner');
  end if;
  if p_subject is not null and nullif(trim(p_subject),'') is not null and trim(p_subject) is distinct from v_row.source_subject then
    v_changes := v_changes || jsonb_build_object('subject', jsonb_build_object('from', v_row.source_subject, 'to', trim(p_subject)));
    v_marks := array_append(v_marks, 'source_subject');
  end if;
  if p_service_dept is not null and nullif(trim(p_service_dept),'') is distinct from v_row.service_dept then
    v_changes := v_changes || jsonb_build_object('service_dept', jsonb_build_object('from', v_row.service_dept, 'to', nullif(trim(p_service_dept),'')));
    v_marks := array_append(v_marks, 'service_dept');
  end if;
  if p_project_type is not null and nullif(trim(p_project_type),'') is distinct from v_row.project_type then
    v_changes := v_changes || jsonb_build_object('project_type', jsonb_build_object('from', v_row.project_type, 'to', nullif(trim(p_project_type),'')));
    v_marks := array_append(v_marks, 'project_type');
  end if;
  if p_technology is not null and nullif(trim(p_technology),'') is distinct from v_row.technology then
    v_changes := v_changes || jsonb_build_object('technology', jsonb_build_object('from', v_row.technology, 'to', nullif(trim(p_technology),'')));
    v_marks := array_append(v_marks, 'technology');
  end if;
  if p_business_type is not null and nullif(trim(p_business_type),'') is distinct from v_row.business_type then
    v_changes := v_changes || jsonb_build_object('business_type', jsonb_build_object('from', v_row.business_type, 'to', nullif(trim(p_business_type),'')));
    v_marks := array_append(v_marks, 'business_type');
  end if;
  if p_geo is not null and nullif(trim(p_geo),'') is distinct from v_row.geo then
    v_changes := v_changes || jsonb_build_object('geo', jsonb_build_object('from', v_row.geo, 'to', nullif(trim(p_geo),'')));
    v_marks := array_append(v_marks, 'geo');
  end if;
  if p_sales_person is not null and nullif(trim(p_sales_person),'') is distinct from v_row.sales_person then
    v_changes := v_changes || jsonb_build_object('sales_person', jsonb_build_object('from', v_row.sales_person, 'to', nullif(trim(p_sales_person),'')));
    v_marks := array_append(v_marks, 'sales_person');
  end if;
  if p_contact_email is not null and nullif(trim(p_contact_email),'') is distinct from v_row.contact_email then
    v_changes := v_changes || jsonb_build_object('contact_email', jsonb_build_object('from', v_row.contact_email, 'to', nullif(trim(p_contact_email),'')));
    v_marks := array_append(v_marks, 'contact_email');
  end if;
  if p_service_type is not null and nullif(trim(p_service_type),'') is distinct from v_row.service_type then
    v_changes := v_changes || jsonb_build_object('service_type', jsonb_build_object('from', v_row.service_type, 'to', nullif(trim(p_service_type),'')));
    v_marks := array_append(v_marks, 'service_type');
  end if;
  if p_delivery_type is not null and nullif(trim(p_delivery_type),'') is distinct from v_row.delivery_type then
    v_changes := v_changes || jsonb_build_object('delivery_type', jsonb_build_object('from', v_row.delivery_type, 'to', nullif(trim(p_delivery_type),'')));
    v_marks := array_append(v_marks, 'delivery_type');
  end if;
  if p_client_type is not null and nullif(trim(p_client_type),'') is distinct from v_row.client_type then
    v_changes := v_changes || jsonb_build_object('client_type', jsonb_build_object('from', v_row.client_type, 'to', nullif(trim(p_client_type),'')));
    v_marks := array_append(v_marks, 'client_type');
  end if;

  -- Nothing actually changed: no write, no event, no noise in the trail.
  if v_changes = '{}'::jsonb then return p_id; end if;

  perform set_config('app.manual_edit', '1', true);

  update public.opportunities set
    source_subject  = case when p_subject is null or nullif(trim(p_subject),'') is null then source_subject else trim(p_subject) end,
    local_value     = case when p_local_value is not null or p_currency is not null then v_local else local_value end,
    currency        = case when p_local_value is not null or p_currency is not null then v_cur   else currency end,
    est_value       = case when p_local_value is not null or p_currency is not null then v_usd   else est_value end,
    win_probability = coalesce(p_win_probability, win_probability),
    pm_owner        = coalesce(v_pm, pm_owner),
    service_dept    = case when p_service_dept  is null then service_dept  else nullif(trim(p_service_dept),'')  end,
    project_type    = case when p_project_type  is null then project_type  else nullif(trim(p_project_type),'')  end,
    technology      = case when p_technology    is null then technology    else nullif(trim(p_technology),'')    end,
    business_type   = case when p_business_type is null then business_type else nullif(trim(p_business_type),'') end,
    geo             = case when p_geo           is null then geo           else nullif(trim(p_geo),'')           end,
    sales_person    = case when p_sales_person  is null then sales_person  else nullif(trim(p_sales_person),'')  end,
    contact_email   = case when p_contact_email is null then contact_email else nullif(trim(p_contact_email),'') end,
    service_type    = case when p_service_type  is null then service_type  else nullif(trim(p_service_type),'')  end,
    delivery_type   = case when p_delivery_type is null then delivery_type else nullif(trim(p_delivery_type),'') end,
    client_type     = case when p_client_type   is null then client_type   else nullif(trim(p_client_type),'')   end,
    manual_fields   = array(select distinct unnest(coalesce(manual_fields, '{}') || v_marks))
  where id = p_id;

  perform set_config('app.manual_edit', '0', true);

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'edited', v_actor, jsonb_build_object('from', 'opportunities', 'changed', v_changes));

  return p_id;
end $function$;

revoke execute on function public.update_opportunity_fields(bigint, text, numeric, text, integer, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.update_opportunity_fields(bigint, text, numeric, text, integer, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
