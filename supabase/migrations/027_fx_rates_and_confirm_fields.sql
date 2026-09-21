-- Currency conversion, an editable project title, and the fixed field lists.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS: est_value is USD everywhere in this dashboard.
-- Every total, forecast, month card and PM scorecard adds it up without ever asking what
-- currency the quote was raised in. So a GBP quote stored raw in est_value does not look
-- wrong anywhere — it just silently overstates the pipeline by a third.
--
-- From here the figure as QUOTED lives in local_value with its own currency, and
-- est_value holds the conversion. Rates are a table rather than a constant because they
-- move, and a rate nobody can change without a deploy is a rate that goes stale quietly.
-- Rates from the revenue sheet's own conversion formula.

create table if not exists public.fx_rates (
  currency    text primary key,
  rate_to_usd numeric not null check (rate_to_usd > 0),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.fx_rates enable row level security;
drop policy if exists fx_read on public.fx_rates;
create policy fx_read on public.fx_rates for select to authenticated using (true);
drop policy if exists fx_admin_write on public.fx_rates;
create policy fx_admin_write on public.fx_rates for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());
revoke all on public.fx_rates from anon, public;
grant select, insert, update, delete on public.fx_rates to authenticated;

insert into public.fx_rates (currency, rate_to_usd, updated_by) values
  ('USD', 1,          'web@uplers.com'),
  ('AUD', 0.70922,    'web@uplers.com'),
  ('NZD', 0.588235,   'web@uplers.com'),
  ('GBP', 1.333333,   'web@uplers.com'),
  ('EUR', 1.162791,   'web@uplers.com'),
  ('CAD', 0.729927,   'web@uplers.com'),
  ('SGD', 0.78125,    'web@uplers.com'),
  ('INR', 0.0104167,  'web@uplers.com'),
  ('AED', 0.27248,    'web@uplers.com')
on conflict (currency) do nothing;

alter table public.opportunities add column if not exists local_value numeric;

-- Unknown currency falls back to 1:1 rather than raising. A deal that books at the wrong
-- figure is recoverable; a confirm button that throws in front of a PM at the moment they
-- are trying to close something is not. 'EURO' is accepted as EUR because older sheet
-- rows spell it that way, matching the revenue sheet's own formula.
create or replace function public.to_usd(p_amount numeric, p_currency text)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when p_amount is null then null
    else round(p_amount * coalesce(
      (select r.rate_to_usd from public.fx_rates r
        where upper(trim(r.currency)) = upper(trim(coalesce(nullif(p_currency,''), 'USD')))),
      case when upper(trim(coalesce(p_currency,'USD'))) = 'EURO'
           then (select rate_to_usd from public.fx_rates where currency = 'EUR') end,
      1), 2)
  end
$$;

grant execute on function public.to_usd(numeric, text) to authenticated, service_role;

-- confirm_opportunity gains p_subject (the project title — an email-sourced deal inherits
-- the mail's subject line, which is rarely what the project should be called) and now
-- converts the quoted figure to USD before the completeness gate runs.
--
-- See 022 for the rest of the reasoning; only the signature and the currency handling
-- change here. The 11-argument version is dropped so no caller can reach the old one.
create or replace function public.confirm_opportunity(
  p_id bigint, p_est_value numeric default null, p_currency text default null,
  p_quote_date date default null, p_service_dept text default null,
  p_project_type text default null, p_sales_person text default null,
  p_pm_owner text default null, p_geo text default null,
  p_confirmed_on date default null, p_note text default null, p_subject text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_actor text := public.jwt_email(); v_missing text[]; v_cur text; v_local numeric;
begin
  if v_actor is null then raise exception 'Sign in to confirm a deal.' using errcode = '42501'; end if;
  if not exists (select 1 from public.opportunities where id = p_id) then
    raise exception 'No such deal (#%).', p_id using errcode = 'P0002'; end if;
  if not public.can_confirm_opportunity(p_id) then
    raise exception 'This deal belongs to another PM. Its owner, or an admin, can confirm it.' using errcode = '42501'; end if;

  update public.opportunities set
    currency       = coalesce(nullif(trim(coalesce(p_currency,'')),''),     currency, 'USD'),
    source_subject = coalesce(nullif(trim(coalesce(p_subject,'')),''),      source_subject),
    source_date    = coalesce(p_quote_date::timestamptz, source_date),
    service_dept   = coalesce(nullif(trim(coalesce(p_service_dept,'')),''), service_dept),
    project_type   = coalesce(nullif(trim(coalesce(p_project_type,'')),''), project_type),
    sales_person   = coalesce(nullif(trim(coalesce(p_sales_person,'')),''), sales_person),
    pm_owner       = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''),     pm_owner),
    geo            = coalesce(nullif(trim(coalesce(p_geo,'')),''),          geo)
  where id = p_id;

  select coalesce(p_est_value, local_value, est_value), currency into v_local, v_cur
    from public.opportunities where id = p_id;
  update public.opportunities
     set local_value = v_local, est_value = public.to_usd(v_local, v_cur)
   where id = p_id;

  v_missing := public.opportunity_missing_fields(p_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot confirm yet - still missing: %', array_to_string(v_missing, ', ') using errcode = '23502'; end if;

  update public.opportunities set
    won = true, status = 'Won', won_amount = est_value, rfq_status = 'won',
    email_won = true, email_won_by = v_actor,
    email_won_at = coalesce(p_confirmed_on::timestamptz, now()),
    email_won_reason = nullif(trim(coalesce(p_note,'')),''),
    confirmed_by = v_actor, confirmed_at = coalesce(p_confirmed_on::timestamptz, now()),
    unlikely = false, unlikely_reason = null, unlikely_at = null, unlikely_by = null,
    email_lost = false, email_lost_reason = null, email_lost_at = null, email_lost_by = null
  where id = p_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'confirmed', v_actor,
          jsonb_build_object('confirmed_on', coalesce(p_confirmed_on, current_date),
                             'local_value', v_local, 'currency', v_cur, 'note', p_note));
  return p_id;
end $$;

drop function if exists public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text);

revoke execute on function public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text, text) from public, anon;
grant  execute on function public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text, text) to authenticated, service_role;
