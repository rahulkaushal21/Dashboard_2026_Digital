-- 117 — a sheet line can be renamed too
--
-- 116 made the project name editable on a dashboard line and left a sheet line's name
-- read-only, on the grounds that the spreadsheet's cell was the source of truth. Rahul:
-- nothing comes in from the spreadsheet any more - everything starts in the dashboard,
-- and every edit made here has to reach the project sheet.
--
-- So the name joins the overlay. sheet_row_overrides gains project_name, web_sheet_rows
-- lays it over the source cell exactly as it does the other fourteen fields, and
-- update_sheet_row_fields() takes p_project_name. The ledger reads project_name off
-- web_sheet_rows, so it shows the new name; the sheet-writer reads the same view and
-- writes it into the Project Name column of the output sheet.
--
-- The override's fingerprint still uses the SOURCE name (s.project_name), so renaming a
-- line does not unhook its own override.
--
-- The view is replaced with one column's expression changed and nothing else, so the
-- views built on it (web_project_ledger, web_client_360) are untouched.

alter table public.sheet_row_overrides add column if not exists project_name text;

create or replace view public.web_sheet_rows as
 SELECT s.id,
    s.row_index,
    COALESCE(o.project_id, s.project_id) AS project_id,
    COALESCE(o.quote_id, s.quote_id) AS quote_id,
    s.service_dept,
    COALESCE(o.project_name, s.project_name) AS project_name,
    s.project_type,
    s.technology,
    s.confirmation_date,
    COALESCE(o.start_date, s.start_date) AS start_date,
    COALESCE(o.delivery_date, s.delivery_date) AS delivery_date,
    COALESCE(o.internal_delivery, s.internal_delivery) AS internal_delivery,
    COALESCE(o.internal_hrs, s.internal_hrs) AS internal_hrs,
    COALESCE(o.actual_hrs, s.actual_hrs) AS actual_hrs,
    COALESCE(o.project_status, s.project_status) AS project_status,
    s.service_type,
    s.delivery_type,
    s.pc_sme,
    COALESCE(o.expert, s.expert) AS expert,
    COALESCE(o.integration, s.integration) AS integration,
    client_canonical_name(s.agency) AS agency,
    s.client_name,
    s.client_email,
    s.client_type,
    s.geo,
    s.currency,
    s.quote_price,
    s.confirmed_price,
    s.usd_value,
    s.business_type,
    canonical_person(s.sales_person) AS sales_person,
    COALESCE(o.outsource_price, s.outsource_price) AS outsource_price,
    COALESCE(o.invoice_no, s.invoice_no) AS invoice_no,
    COALESCE(o.invoice_currency, s.invoice_currency) AS invoice_currency,
    COALESCE(o.invoice_amount, s.invoice_amount) AS invoice_amount,
    s.booking_month,
    o.contractor_name,
    o.outsource_currency,
    o.row_index IS NOT NULL AS has_override,
    o.updated_by AS override_by,
    o.updated_at AS override_at
   FROM web_sheet_rows_src s
     LEFT JOIN sheet_row_overrides o ON o.row_index = s.row_index AND o.fingerprint = ((((lower(COALESCE(s.agency, ''::text)) || '|'::text) || lower(COALESCE(s.project_name, ''::text))) || '|'::text) || COALESCE(s.booking_month::text, ''::text));

drop function if exists public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric);

create or replace function public.update_sheet_row_fields(
  p_row_index integer, p_project_id text default null, p_quote_id text default null, p_expert text default null,
  p_contractor_name text default null, p_outsource_currency text default null, p_outsource_price numeric default null,
  p_project_status text default null, p_start_date date default null, p_delivery_date date default null,
  p_internal_delivery date default null, p_internal_hrs numeric default null, p_actual_hrs numeric default null,
  p_integration text default null, p_invoice_no text default null, p_invoice_currency text default null,
  p_invoice_amount numeric default null, p_project_name text default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor  text := public.jwt_email();
  v_src    public.web_sheet_rows_src%rowtype;
  v_fp     text;
  v_expert text;
begin
  if v_actor is null then
    raise exception 'Sign in to edit this row.' using errcode = '42501';
  end if;

  select * into v_src from public.web_sheet_rows_src where row_index = p_row_index;
  if not found then
    raise exception 'No such sheet row (row %).', p_row_index using errcode = 'P0002';
  end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(v_src.pc_sme, v_actor)) then
    raise exception 'This row belongs to % — its PC/SME, or an admin, can edit it.',
      coalesce(v_src.pc_sme, 'another PM') using errcode = '42501';
  end if;

  v_fp := lower(coalesce(v_src.agency,'')) || '|' || lower(coalesce(v_src.project_name,'')) || '|' || coalesce(v_src.booking_month::text,'');

  v_expert := case when p_expert is null
                   then coalesce((select expert from public.sheet_row_overrides where row_index = p_row_index), v_src.expert)
                   else nullif(btrim(p_expert), '') end;

  insert into public.sheet_row_overrides as x (
    row_index, fingerprint, project_name, project_id, quote_id, expert, contractor_name,
    outsource_currency, outsource_price, project_status, start_date, delivery_date,
    internal_delivery, internal_hrs, actual_hrs, integration, invoice_no,
    invoice_currency, invoice_amount, updated_by, updated_at)
  values (
    p_row_index, v_fp, nullif(btrim(p_project_name),''), nullif(btrim(p_project_id),''), nullif(btrim(p_quote_id),''), v_expert,
    case when v_expert = 'Contractor' then nullif(btrim(p_contractor_name),'') end,
    case when v_expert = 'Contractor' then coalesce(nullif(btrim(p_outsource_currency),''), 'USD') end,
    case when v_expert = 'Contractor' then p_outsource_price end,
    nullif(btrim(p_project_status),''), p_start_date, p_delivery_date, p_internal_delivery,
    p_internal_hrs, p_actual_hrs, nullif(btrim(p_integration),''), nullif(btrim(p_invoice_no),''),
    nullif(btrim(p_invoice_currency),''), p_invoice_amount, v_actor, now())
  on conflict (row_index) do update set
    fingerprint        = excluded.fingerprint,
    -- A name cannot be blanked: an empty one leaves the current name standing, since a
    -- line with no name is worse than one with the old name.
    project_name       = coalesce(excluded.project_name, x.project_name),
    project_id         = case when p_project_id        is null then x.project_id        else excluded.project_id end,
    quote_id           = case when p_quote_id          is null then x.quote_id          else excluded.quote_id end,
    expert             = v_expert,
    contractor_name    = case when v_expert = 'Contractor'
                              then case when p_contractor_name is null then x.contractor_name else excluded.contractor_name end
                              else null end,
    outsource_currency = case when v_expert = 'Contractor'
                              then coalesce(excluded.outsource_currency, x.outsource_currency, 'USD')
                              else null end,
    outsource_price    = case when v_expert = 'Contractor' then coalesce(p_outsource_price, x.outsource_price) else null end,
    project_status     = case when p_project_status    is null then x.project_status    else excluded.project_status end,
    integration        = case when p_integration       is null then x.integration       else excluded.integration end,
    invoice_no         = case when p_invoice_no        is null then x.invoice_no        else excluded.invoice_no end,
    invoice_currency   = case when p_invoice_currency  is null then x.invoice_currency  else excluded.invoice_currency end,
    start_date         = coalesce(p_start_date,        x.start_date),
    delivery_date      = coalesce(p_delivery_date,     x.delivery_date),
    internal_delivery  = coalesce(p_internal_delivery, x.internal_delivery),
    internal_hrs       = coalesce(p_internal_hrs,      x.internal_hrs),
    actual_hrs         = coalesce(p_actual_hrs,        x.actual_hrs),
    invoice_amount     = coalesce(p_invoice_amount,    x.invoice_amount),
    updated_by = v_actor, updated_at = now();

  return p_row_index;
end $function$;

revoke execute on function public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text) from public, anon;
grant  execute on function public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text) to authenticated;
