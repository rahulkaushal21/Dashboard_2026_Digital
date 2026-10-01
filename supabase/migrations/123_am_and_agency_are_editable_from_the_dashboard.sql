-- 123 — AM and agency are editable on a dashboard line, and the edit STICKS
--
-- Rahul, 2 Oct 2026: "in edit the project, i cant see AM, change agency as some team
-- might make some mistake so PM can edit it and then submit save from the dashboard only
-- so everything should be editable."
--
-- The two fields are easy. The reason this migration is not two lines is that WRITING THEM
-- IS NOT ENOUGH — they get overwritten half an hour later.
--
-- sync_quotes_to_opportunities() runs on cron at :05 and :35 and upserts every Quotes tab
-- row onto opportunities. Its conflict clause says:
--
--     company_name = coalesce(excluded.company_name, o.company_name),
--     sales_person = coalesce(excluded.sales_person, o.sales_person),
--
-- The sheet wins whenever it has a value, and for an agency it always does. 538 of the
-- won opportunities behind the ledger are origin='sheet', so without the rest of this
-- migration a PM would fix an agency name, press Save, see it change, and find it back to
-- the wrong one within thirty minutes with nothing to explain why. A field that silently
-- reverts is worse than a field that is not there, because the second time it happens
-- nobody trusts the rest of the dialog either.
--
-- WHY A TRIGGER AND NOT A CHANGE TO THE CONFLICT CLAUSE
--
-- The obvious fix is to guard those two lines inside sync_quotes_to_opportunities. That
-- means re-declaring a 100-line function whose tail is three janitor DELETEs, to change
-- two lines in its middle — a lot of surface area to retype for a small edit. A trigger
-- also covers writers the conflict clause does not: reconcile_opportunities() enriches
-- sales_person from an email twin, and the owner backfill further down the same sync
-- function fills a blank AM from web_clients and web_revenue. A PM's deliberate edit
-- should outrank all three, not just the one we remembered.

alter table public.opportunities
  add column if not exists manual_fields text[] not null default '{}';

comment on column public.opportunities.manual_fields is
  'Columns a human set by hand from the dashboard, which no sync may overwrite. See migration 123.';

-- The guard. Any UPDATE that is not the editor itself has its hands taken off the columns
-- named in manual_fields.
--
-- The exemption is a session setting rather than a column check, because the editor writes
-- the SAME column the trigger is protecting and cannot be told apart by its values alone.
--
-- set_config(..., true) is transaction-local and read back inside the same statement, which
-- is why it works here. Note this is NOT the case for every GUC: statement_timeout is armed
-- when the top-level statement begins, so SET LOCAL cannot change it from inside a function.
-- That difference cost two dry runs of sync-all to learn; see the sync-all header comment.
create or replace function public.protect_manual_fields()
returns trigger
language plpgsql
as $function$
begin
  if coalesce(current_setting('app.manual_edit', true), '') = '1' then
    return new;   -- the dashboard editor, which is allowed to set these
  end if;
  if 'company_name' = any(coalesce(old.manual_fields, '{}')) then
    new.company_name := old.company_name;
  end if;
  if 'sales_person' = any(coalesce(old.manual_fields, '{}')) then
    new.sales_person := old.sales_person;
  end if;
  -- A sync must not clear the marks either, or the next one would be free to overwrite.
  new.manual_fields := old.manual_fields;
  return new;
end$function$;

revoke execute on function public.protect_manual_fields() from public;

drop trigger if exists trg_protect_manual_fields on public.opportunities;
create trigger trg_protect_manual_fields
  before update on public.opportunities
  for each row execute function public.protect_manual_fields();

-- The editor. Two new parameters, so the old signature has to go first: adding arguments
-- does not replace a function, it OVERLOADS it, and PostgREST cannot then choose between
-- the two and fails the call with "could not choose the best candidate function".
drop function if exists public.update_project_fields(
  bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric,
  text, text, date, date, text, text, text, numeric, text, text, date);

create function public.update_project_fields(
  p_id bigint,
  p_project_id text default null, p_quote_id text default null, p_expert text default null,
  p_internal_delivery date default null, p_internal_hrs numeric default null,
  p_actual_hrs numeric default null, p_integration text default null,
  p_outsource_price numeric default null, p_invoice_no text default null,
  p_invoice_currency text default null, p_invoice_amount numeric default null,
  p_feedback_status text default null, p_delivery_status text default null,
  p_delivery_date date default null, p_start_date date default null,
  p_contractor_name text default null, p_outsource_currency text default null,
  p_project_name text default null, p_local_value numeric default null,
  p_currency text default null, p_pm_owner text default null, p_month date default null,
  -- new in 123
  p_sales_person text default null, p_company_name text default null)
returns bigint
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
  -- Logged like the rest, because an agency rename moves the line to a different client:
  -- its revenue, its health score and its feedback all follow the name. Whoever has to
  -- work out later why a client's numbers moved needs to find this in opportunity_events.
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

  -- What this edit claims from the syncs, from here on. Sending the AM at all counts,
  -- including sending it empty: clearing an AM on purpose has to outlast the backfill in
  -- sync_quotes_to_opportunities that fills a blank one from web_clients and web_revenue.
  if p_sales_person is not null then v_marks := v_marks || 'sales_person'; end if;
  if v_agency is not null          then v_marks := v_marks || 'company_name'; end if;

  perform set_config('app.manual_edit', '1', true);

  update public.opportunities set
    source_subject   = coalesce(nullif(trim(coalesce(p_project_name,'')),''), source_subject),
    pm_owner         = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''), pm_owner),
    -- An AM can be cleared; an agency cannot. A blank agency would detach the line from
    -- its client entirely — no revenue, no health, no feedback — so a blank is read as
    -- "not sent" and leaves the name alone.
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

revoke execute on function public.update_project_fields(
  bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric,
  text, text, date, date, text, text, text, numeric, text, text, date, text, text) from public;
grant execute on function public.update_project_fields(
  bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric,
  text, text, date, date, text, text, text, numeric, text, text, date, text, text)
  to anon, authenticated, service_role;
