-- A copied month starts on a day
-- ==============================
--
-- Sixteen of November's 33 lines reached the month with Start Date blank. All sixteen
-- came the same way: "copy to month" on the revenue sheet, which runs copy_row_to_month.
--
-- That is the fourth carry-forward path, and the only one that calls neither
-- apply_sheet_defaults() nor opportunity_missing_fields(). confirm_recurring_draft,
-- duplicate_raw_row_to_month and duplicate_booking_to_month all call both; this one
-- inserts and returns. So a retainer carried forward from the ledger has never had a
-- start date, and nothing refused it.
--
-- 141 had already made every path default the date (the day it was confirmed, or the
-- month's 1st when the confirmation falls outside the month) and 'Start date' has been
-- in opportunity_missing_fields all along. Both were simply never reached from here.
--
-- The function's own comment records the same hole being patched once before: a blank
-- Delivery date was fixed by hand-coding one check rather than calling the gate, so the
-- next field through fell straight back out. This calls the gate.
--
-- The early delivery-date check stays. It fires before the insert, which is what lets
-- the revenue sheet offer the date inline instead of sending the PM to a dialog.
--
-- The sixteen existing rows were set to 2026-11-01 by hand (Rahul, 3 Nov 2026). No money
-- moved: web_revenue_lines.booking_date is COALESCE(start_date, booking_month), and the
-- fallback was already the 1st.

create or replace function public.copy_row_to_month(
  p_source text,
  p_id bigint,
  p_month date,
  p_amount numeric default null,
  p_delivery_date date default null,
  p_internal_delivery date default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  o       public.opportunities%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_amt   numeric;
  v_key   text;
  v_id    bigint;
  v_missing text[];
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  if p_source = 'raw' then
    return public.duplicate_raw_row_to_month(p_id, v_month, p_amount, null, p_delivery_date, p_internal_delivery);
  end if;
  if p_source = 'sheet' then
    return public.duplicate_booking_to_month(p_id, v_month, p_amount, null, p_delivery_date, p_internal_delivery);
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

  -- A MONTH THAT ENDS HAS A DELIVERY DATE. Checked here, before the insert, so the
  -- revenue sheet can offer the date inline rather than sending the PM away.
  if p_delivery_date is null then
    raise exception 'Cannot copy - still missing: Delivery date' using errcode = '23502';
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
    client_name, client_type, service_type, delivery_type, expert, delivery_status,
    delivery_date, internal_delivery
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
    'Under Development', p_delivery_date, p_internal_delivery
  ) returning id into v_id;

  -- The two calls this path never made. The first fills the sheet's columns from the
  -- client's own history - the start date among them - and the second refuses the copy
  -- if anything the project sheet needs is still blank. NOT the parent's start date:
  -- that one is in the month being copied FROM.
  perform public.apply_sheet_defaults(v_id);

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot copy - still missing: %', array_to_string(v_missing, ', ')
      using errcode = '23502';
  end if;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','ledger-copy','copied_from',p_id,'month',to_char(v_month,'YYYY-MM')));
  return v_id;
end $function$;
