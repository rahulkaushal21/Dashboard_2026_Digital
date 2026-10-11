-- The classification of a line is editable
-- ========================================
--
-- Service Department, Project Type, Service Type, Delivery Type, Technology, Client
-- Type, Geo and Business Type were read-only everywhere once a deal was confirmed. The
-- confirm dialog asks for all eight, and after that nobody could change one — not in the
-- Edit dialog, not by double-clicking the cell. Rahul, 11 Oct 2026: "there is no option
-- to edit the service either in opportunity nor in project sheet while adding or doing
-- edit. we should give all options to edit or change, it can prefilled however PM can
-- change anything from the list of dropdowns."
--
-- Why it matters beyond tidiness: service_dept is what the Business Unit switch splits
-- on and what every per-department total counts, and geo is what the revenue sheet's
-- pods are. A line typed into the wrong department was wrong on six pages with no way to
-- put it right. The data shows exactly that — a sheet row with geo 'Agency', another
-- with client_type set to somebody's email address, twelve rows under 'WEB-US (KS)'.
--
-- THESE MOVE MONEY BETWEEN VIEWS, NOT BETWEEN MONTHS. Changing a department moves a
-- line's value from one business unit's total to another's; it cannot change the total
-- itself, the month, or whether the deal is won. That is the same bargain 118 struck for
-- value, owner and month, and the same two gates apply: the row's own PC/SME or an
-- admin, enforced in both RPCs, and every change written to the edit trail.
--
-- Both sides of the ledger. A dashboard line updates the opportunity; a sheet line
-- writes into sheet_row_overrides beside the spreadsheet, because web_sheet_rows_src is
-- re-synced and anything written into it would vanish at the next sync without an error.
--
-- APPLIED ON THE LIVE DATABASE WITHOUT THE TWO DROPS. Both RPCs gain parameters, which
-- in Postgres makes a new function rather than replacing the old one, so the old
-- signatures have to go or PostgREST has two candidates to choose between. The MCP
-- connection declines DROP, so on 11 Oct 2026 the new bodies went up with
-- `create or replace` and the narrow originals are still there — update_project_fields
-- with 25 arguments, update_sheet_row_fields with 18. That is SAFE ONLY BECAUSE both
-- callers in lib/supabase.ts send every parameter by name on every save: a call naming
-- all 33 (or all 26) can only match the wide one. Send fewer and PostgREST refuses with
-- "could not choose the best candidate function". The two drops are parked for pasting
-- by hand, and this file keeps them so a replay on a fresh database is clean.
--
--   drop function public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text);
--   drop function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date, text, text);

-- 1. The overlay learns the eight fields
-- --------------------------------------
alter table public.sheet_row_overrides add column if not exists service_dept text;
alter table public.sheet_row_overrides add column if not exists project_type text;
alter table public.sheet_row_overrides add column if not exists technology text;
alter table public.sheet_row_overrides add column if not exists service_type text;
alter table public.sheet_row_overrides add column if not exists delivery_type text;
alter table public.sheet_row_overrides add column if not exists client_type text;
alter table public.sheet_row_overrides add column if not exists geo text;
alter table public.sheet_row_overrides add column if not exists business_type text;


-- 2. The view lays them over the source cells
-- -------------------------------------------
-- Eight expressions changed from s.x to coalesce(o.x, s.x) and nothing else, so the
-- views built on this one (web_project_ledger, web_client_360) are untouched and the
-- sheet-writer, which reads this view, carries the corrected values into the sheet.

create or replace view public.web_sheet_rows as
 SELECT s.id,
    s.row_index,
    COALESCE(o.project_id, s.project_id) AS project_id,
    COALESCE(o.quote_id, s.quote_id) AS quote_id,
    COALESCE(o.service_dept, s.service_dept) AS service_dept,
    COALESCE(o.project_name, s.project_name) AS project_name,
    COALESCE(o.project_type, s.project_type) AS project_type,
    COALESCE(o.technology, s.technology) AS technology,
    s.confirmation_date,
    COALESCE(o.start_date, s.start_date) AS start_date,
    COALESCE(o.delivery_date, s.delivery_date) AS delivery_date,
    COALESCE(o.internal_delivery, s.internal_delivery) AS internal_delivery,
    COALESCE(o.internal_hrs, s.internal_hrs) AS internal_hrs,
    COALESCE(o.actual_hrs, s.actual_hrs) AS actual_hrs,
    COALESCE(o.project_status, s.project_status) AS project_status,
    COALESCE(o.service_type, s.service_type) AS service_type,
    COALESCE(o.delivery_type, s.delivery_type) AS delivery_type,
    s.pc_sme,
    COALESCE(o.expert, s.expert) AS expert,
    COALESCE(o.integration, s.integration) AS integration,
    client_canonical_name(s.agency) AS agency,
    s.client_name,
    s.client_email,
    COALESCE(o.client_type, s.client_type) AS client_type,
    COALESCE(o.geo, s.geo) AS geo,
    s.currency,
    s.quote_price,
    s.confirmed_price,
    s.usd_value,
    COALESCE(o.business_type, s.business_type) AS business_type,
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


-- 3. A sheet line's classification can be set
-- -------------------------------------------
-- Same contract as every other field here: null means "not sent", so one cell at a time
-- can fill a blank or change a value and never clear one.

drop function if exists public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text);

create function public.update_sheet_row_fields(
  p_row_index integer, p_project_id text default null, p_quote_id text default null, p_expert text default null,
  p_contractor_name text default null, p_outsource_currency text default null, p_outsource_price numeric default null,
  p_project_status text default null, p_start_date date default null, p_delivery_date date default null,
  p_internal_delivery date default null, p_internal_hrs numeric default null, p_actual_hrs numeric default null,
  p_integration text default null, p_invoice_no text default null, p_invoice_currency text default null,
  p_invoice_amount numeric default null, p_project_name text default null,
  p_service_dept text default null, p_project_type text default null, p_technology text default null,
  p_service_type text default null, p_delivery_type text default null, p_client_type text default null,
  p_geo text default null, p_business_type text default null)
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
    invoice_currency, invoice_amount,
    service_dept, project_type, technology, service_type, delivery_type, client_type,
    geo, business_type,
    updated_by, updated_at)
  values (
    p_row_index, v_fp, nullif(btrim(p_project_name),''), nullif(btrim(p_project_id),''), nullif(btrim(p_quote_id),''), v_expert,
    case when v_expert = 'Contractor' then nullif(btrim(p_contractor_name),'') end,
    case when v_expert = 'Contractor' then coalesce(nullif(btrim(p_outsource_currency),''), 'USD') end,
    case when v_expert = 'Contractor' then p_outsource_price end,
    nullif(btrim(p_project_status),''), p_start_date, p_delivery_date, p_internal_delivery,
    p_internal_hrs, p_actual_hrs, nullif(btrim(p_integration),''), nullif(btrim(p_invoice_no),''),
    nullif(btrim(p_invoice_currency),''), p_invoice_amount,
    nullif(btrim(p_service_dept),''), nullif(btrim(p_project_type),''), nullif(btrim(p_technology),''),
    nullif(btrim(p_service_type),''), nullif(btrim(p_delivery_type),''), nullif(btrim(p_client_type),''),
    nullif(btrim(p_geo),''), nullif(btrim(p_business_type),''),
    v_actor, now())
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
    -- The eight. Left alone when not sent; a blank sent on purpose drops the override
    -- and the sheet's own cell shows through again, which is the nearest thing to undo.
    service_dept       = case when p_service_dept      is null then x.service_dept      else excluded.service_dept end,
    project_type       = case when p_project_type      is null then x.project_type      else excluded.project_type end,
    technology         = case when p_technology        is null then x.technology        else excluded.technology end,
    service_type       = case when p_service_type      is null then x.service_type      else excluded.service_type end,
    delivery_type      = case when p_delivery_type     is null then x.delivery_type     else excluded.delivery_type end,
    client_type        = case when p_client_type       is null then x.client_type       else excluded.client_type end,
    geo                = case when p_geo               is null then x.geo               else excluded.geo end,
    business_type      = case when p_business_type     is null then x.business_type     else excluded.business_type end,
    start_date         = coalesce(p_start_date,        x.start_date),
    delivery_date      = coalesce(p_delivery_date,     x.delivery_date),
    internal_delivery  = coalesce(p_internal_delivery, x.internal_delivery),
    internal_hrs       = coalesce(p_internal_hrs,      x.internal_hrs),
    actual_hrs         = coalesce(p_actual_hrs,        x.actual_hrs),
    invoice_amount     = coalesce(p_invoice_amount,    x.invoice_amount),
    updated_by = v_actor, updated_at = now();

  return p_row_index;
end $function$;

revoke execute on function public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.update_sheet_row_fields(integer, text, text, text, text, text, numeric, text, date, date, date, numeric, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text, text) to authenticated;


-- 4. A dashboard line's classification can be set
-- -----------------------------------------------
-- Same eight, straight onto the opportunity, and every one of them logged. Department
-- and geography in particular decide which totals a line lands in, so "who moved this
-- line out of WEB-UK" has to be answerable from the trail.

drop function if exists public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date, text, text);

create function public.update_project_fields(
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
  p_company_name text default null,
  p_service_dept text default null,
  p_project_type text default null,
  p_technology text default null,
  p_service_type text default null,
  p_delivery_type text default null,
  p_client_type text default null,
  p_geo text default null,
  p_business_type text default null
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
  -- The eight classification fields (144).
  if p_service_dept is not null and nullif(trim(p_service_dept),'') is distinct from v_row.service_dept then
    v_changes := v_changes || jsonb_build_object('service_dept', jsonb_build_object('from', v_row.service_dept, 'to', nullif(trim(p_service_dept),'')));
  end if;
  if p_project_type is not null and nullif(trim(p_project_type),'') is distinct from v_row.project_type then
    v_changes := v_changes || jsonb_build_object('project_type', jsonb_build_object('from', v_row.project_type, 'to', nullif(trim(p_project_type),'')));
  end if;
  if p_technology is not null and nullif(trim(p_technology),'') is distinct from v_row.technology then
    v_changes := v_changes || jsonb_build_object('technology', jsonb_build_object('from', v_row.technology, 'to', nullif(trim(p_technology),'')));
  end if;
  if p_service_type is not null and nullif(trim(p_service_type),'') is distinct from v_row.service_type then
    v_changes := v_changes || jsonb_build_object('service_type', jsonb_build_object('from', v_row.service_type, 'to', nullif(trim(p_service_type),'')));
  end if;
  if p_delivery_type is not null and nullif(trim(p_delivery_type),'') is distinct from v_row.delivery_type then
    v_changes := v_changes || jsonb_build_object('delivery_type', jsonb_build_object('from', v_row.delivery_type, 'to', nullif(trim(p_delivery_type),'')));
  end if;
  if p_client_type is not null and nullif(trim(p_client_type),'') is distinct from v_row.client_type then
    v_changes := v_changes || jsonb_build_object('client_type', jsonb_build_object('from', v_row.client_type, 'to', nullif(trim(p_client_type),'')));
  end if;
  if p_geo is not null and nullif(trim(p_geo),'') is distinct from v_row.geo then
    v_changes := v_changes || jsonb_build_object('geo', jsonb_build_object('from', v_row.geo, 'to', nullif(trim(p_geo),'')));
  end if;
  if p_business_type is not null and nullif(trim(p_business_type),'') is distinct from v_row.business_type then
    v_changes := v_changes || jsonb_build_object('business_type', jsonb_build_object('from', v_row.business_type, 'to', nullif(trim(p_business_type),'')));
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
    -- The eight. Not sent leaves the column alone; sent blank clears it, same contract
    -- as every text field above.
    service_dept     = case when p_service_dept   is null then service_dept   else nullif(trim(p_service_dept),'')   end,
    project_type     = case when p_project_type   is null then project_type   else nullif(trim(p_project_type),'')   end,
    technology       = case when p_technology     is null then technology     else nullif(trim(p_technology),'')     end,
    service_type     = case when p_service_type   is null then service_type   else nullif(trim(p_service_type),'')   end,
    delivery_type    = case when p_delivery_type  is null then delivery_type  else nullif(trim(p_delivery_type),'')  end,
    client_type      = case when p_client_type    is null then client_type    else nullif(trim(p_client_type),'')    end,
    geo              = case when p_geo            is null then geo            else nullif(trim(p_geo),'')            end,
    business_type    = case when p_business_type  is null then business_type  else nullif(trim(p_business_type),'')  end,
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

-- Recreating the function drops its grants, so they are restated. anon is deliberately
-- NOT given it back: it carried an anon EXECUTE from before the Tier 1 close, and the
-- first thing the body does is refuse a caller with no signed-in email, so no anon call
-- has ever succeeded. One of the six parked revokes, taken here because the function is
-- being replaced anyway.
revoke execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date, text, text, text, numeric, text, text, date, text, text, text, text, text, text, text, text, text, text) to authenticated;
