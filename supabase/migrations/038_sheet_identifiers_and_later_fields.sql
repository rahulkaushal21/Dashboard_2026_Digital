-- 038 — the identifiers PMs type, and the columns somebody fills in afterwards.
--
-- 036 took the Web, Hub & LP tab from 17 filled columns to 30 by asking for what a PM
-- knows at the moment a deal is won. The remaining ten are not unknown, they are simply
-- known LATER: Expert and the hours by whoever delivers the work, the invoice columns by
-- finance. There is no point asking a PM for an invoice number on the day the deal
-- closes, and a required field nobody can answer just teaches people to type anything.
--
-- So these columns are added, left blank at confirmation, and edited from the ledger by
-- the person who does know. Project Id and Quote ID are different: they exist at
-- confirmation, the writer has been deriving them, and the team wants to set them by
-- hand — so those two go in the confirm dialog with the derived value prefilled.

alter table public.opportunities
  -- The sheet's own two identifiers.
  --
  -- NOT quote_key, which stays exactly what it is: this row's internal identity, unique,
  -- and what the Quotes janitors match on. Overloading it with a human-typed value would
  -- let somebody rename a row into collision with another and break the sync. quote_id
  -- is a label; quote_key is the key.
  add column if not exists project_id        text,
  add column if not exists quote_id          text,
  -- Filled in by delivery, after the work is scheduled and done.
  add column if not exists expert            text,
  add column if not exists internal_delivery date,
  add column if not exists internal_hrs      numeric,
  add column if not exists actual_hrs        numeric,
  add column if not exists integration       text,
  -- Filled in by finance.
  add column if not exists outsource_price   numeric,
  add column if not exists invoice_no        text,
  add column if not exists invoice_currency  text,
  add column if not exists invoice_amount    numeric,
  add column if not exists feedback_status   text;

comment on column public.opportunities.quote_id is
  'The human-facing QUT… label from the sheet. Not an identity — see quote_key for that.';
comment on column public.opportunities.project_id is
  'The human-facing PRJ… label from the sheet.';

-- ---------------------------------------------------------------------------
-- Editing a row after the fact
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT a table-level update policy. This function can reach the columns
-- above and NOTHING ELSE — not the value, not the currency, not the owner, not whether
-- the deal is won. A row already booked as revenue should not be silently repriced from
-- a grid on the ledger page, and the safe way to guarantee that is to give the grid a
-- function that cannot express it.
--
-- NULL means "leave alone" for every parameter, so a form that sends three fields cannot
-- blank the other nine. Clearing a value is done with an empty string, which is
-- distinguishable from not-sent.

create or replace function public.update_project_fields(
  p_id bigint,
  p_project_id text default null, p_quote_id text default null,
  p_expert text default null, p_internal_delivery date default null,
  p_internal_hrs numeric default null, p_actual_hrs numeric default null,
  p_integration text default null, p_outsource_price numeric default null,
  p_invoice_no text default null, p_invoice_currency text default null,
  p_invoice_amount numeric default null, p_feedback_status text default null,
  p_delivery_status text default null, p_delivery_date date default null,
  p_start_date date default null
)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  v_row   public.opportunities%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to edit this row.' using errcode = '42501';
  end if;
  select * into v_row from public.opportunities where id = p_id;
  if not found then raise exception 'No such row (#%).', p_id using errcode = 'P0002'; end if;

  -- Same ownership rule as confirming. Delivery detail is still business data, and the
  -- person who owns the deal is the one accountable for what it says.
  if not (public.is_dashboard_admin() or public.directory_owner_match(v_row.pm_owner, v_actor)) then
    raise exception 'This row belongs to another PM. Its owner, or an admin, can edit it.'
      using errcode = '42501';
  end if;

  -- '' clears, NULL leaves alone. nullif(...,'') on a NULL parameter yields NULL, which
  -- coalesce then falls through to the existing value, so both cases fall out of the
  -- same expression.
  update public.opportunities set
    project_id       = case when p_project_id      is null then project_id       else nullif(trim(p_project_id),'')      end,
    quote_id         = case when p_quote_id        is null then quote_id         else nullif(trim(p_quote_id),'')        end,
    expert           = case when p_expert          is null then expert           else nullif(trim(p_expert),'')          end,
    integration      = case when p_integration     is null then integration      else nullif(trim(p_integration),'')     end,
    invoice_no       = case when p_invoice_no      is null then invoice_no       else nullif(trim(p_invoice_no),'')      end,
    invoice_currency = case when p_invoice_currency is null then invoice_currency else nullif(trim(p_invoice_currency),'') end,
    feedback_status  = case when p_feedback_status is null then feedback_status  else nullif(trim(p_feedback_status),'') end,
    delivery_status  = case when p_delivery_status is null then delivery_status  else nullif(trim(p_delivery_status),'') end,
    internal_delivery = coalesce(p_internal_delivery, internal_delivery),
    internal_hrs     = coalesce(p_internal_hrs,   internal_hrs),
    actual_hrs       = coalesce(p_actual_hrs,     actual_hrs),
    outsource_price  = coalesce(p_outsource_price, outsource_price),
    invoice_amount   = coalesce(p_invoice_amount, invoice_amount),
    delivery_date    = coalesce(p_delivery_date,  delivery_date),
    start_date       = coalesce(p_start_date,     start_date)
  where id = p_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'edited', v_actor, jsonb_build_object('from', 'ledger'));

  return p_id;
end $function$;

-- EXECUTE is granted to PUBLIC by default and anon inherits it, so the revoke comes FIRST.
revoke execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date) from public, anon;
grant  execute on function public.update_project_fields(bigint, text, text, text, date, numeric, numeric, text, numeric, text, text, numeric, text, text, date, date) to authenticated;
