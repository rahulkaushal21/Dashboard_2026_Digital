-- 116 — the project name is editable on a dashboard line
--
-- A line moved into October is named by the copy: "Mannkind Corp Sep- 26 - Oct 2026",
-- the old name with the new month on the end. Rahul: the team needs to be able to edit
-- the project name, so every column is theirs to fix.
--
-- On a dashboard line the ledger's Project Name IS opportunities.source_subject
-- (web_project_ledger), so update_project_fields() gains p_project_name and writes it
-- there. Same rules as the rest of the function: the row's PM or an admin, null means
-- "not sent", and the name cannot be blanked - an empty string leaves it alone, because
-- a line with no name is worse than one with the old name.
--
-- A sheet line's name is the spreadsheet's own cell and comes in on every sync, so it is
-- not overlaid here; it is changed in the sheet. The page says so.
--
-- The signature changes, so the old one is dropped first.

drop function if exists public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text);

create or replace function public.update_project_fields(
  p_id bigint, p_project_id text default null, p_quote_id text default null, p_expert text default null,
  p_internal_delivery date default null, p_internal_hrs numeric default null, p_actual_hrs numeric default null,
  p_integration text default null, p_outsource_price numeric default null, p_invoice_no text default null,
  p_invoice_currency text default null, p_invoice_amount numeric default null, p_feedback_status text default null,
  p_delivery_status text default null, p_delivery_date date default null, p_start_date date default null,
  p_contractor_name text default null, p_outsource_currency text default null,
  p_project_name text default null)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor  text := public.jwt_email();
  v_row    public.opportunities%rowtype;
  v_expert text;
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

  v_expert := case when p_expert is null then v_row.expert else nullif(trim(p_expert),'') end;

  update public.opportunities set
    source_subject   = coalesce(nullif(trim(coalesce(p_project_name,'')),''), source_subject),
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
  values (p_id, 'edited', v_actor, jsonb_build_object('from', 'ledger'));

  return p_id;
end $function$;

revoke execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text) from public, anon;
grant  execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text) to authenticated;
