-- 123 — two lines can share an amount
--
-- Telfer Digital, 5 Oct 2026: JCB Terra Website (Sep, $125) refused with "That line is
-- already in Oct 2026" after JCB ingleby (Sep, also $125) had been moved.
--
-- Migration 119 added a second "already in that month" guard for copies made before
-- the row-number key: same agency, same amount, same month. It was meant to catch the
-- SAME line copied twice under an old key; it also catches a DIFFERENT line that
-- happens to cost the same, and Telfer has three JCB maintenance lines at $125.
--
-- The guard now also requires the subject the copy would have been given — the sheet's
-- project name plus the month — so only a true repeat of the same line is refused.
-- The primary guard, on the row-number key, is unchanged.

create or replace function public.duplicate_raw_row_to_month(
  p_raw_id bigint, p_month date, p_amount numeric default null, p_note text default null,
  p_delivery_date date default null, p_internal_delivery date default null)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  b       record;
  v_month date := date_trunc('month', p_month)::date;
  v_amt   numeric;
  v_cur   text;
  v_geo   text;
  v_key   text;
  v_subject text;
  v_id    bigint;
  v_missing text[];
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  select * into b from public.web_sheet_rows where row_index = p_raw_id;
  if not found then raise exception 'No such line in the sheet.' using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(b.pc_sme, v_actor)) then
    raise exception 'This client belongs to % - they, or an admin, can add it.', coalesce(b.pc_sme, 'another PM')
      using errcode = '42501';
  end if;

  v_cur := coalesce(b.currency, 'USD');
  v_amt := coalesce(p_amount, b.confirmed_price, b.usd_value);
  if coalesce(v_amt, 0) <= 0 then
    raise exception 'Cannot add yet - still missing: Value' using errcode = '23502';
  end if;

  v_geo := case
    when b.geo ilike '%us%' or b.geo ilike '%canada%' then 'US'
    when b.geo ilike '%au%' or b.geo ilike '%nz%'     then 'AU'
    when b.geo ilike '%uk%' or b.geo ilike '%eu%'     then 'UK'
    else nullif(btrim(coalesce(b.geo, '')), '') end;

  v_key := 'raw:' || b.row_index || ':' || to_char(v_month, 'YYYY-MM');
  v_subject := coalesce(b.project_name, b.agency) || ' - ' || to_char(v_month, 'Mon YYYY');
  if exists (select 1 from public.opportunities where quote_key = v_key)
     or exists (select 1 from public.opportunities o
                 where o.origin = 'recurring' and o.quote_key like 'raw:%'
                   and lower(btrim(coalesce(o.company_name,''))) = lower(btrim(coalesce(b.agency,'')))
                   and o.local_value = v_amt
                   and lower(btrim(coalesce(o.source_subject,''))) = lower(btrim(v_subject))
                   and date_trunc('month', o.source_date)::date = v_month) then
    raise exception 'That line is already in %.', to_char(v_month, 'Mon YYYY') using errcode = '23505';
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
    v_key, 'recurring', 'retainer', b.agency,
    v_subject,
    v_month, v_month,
    public.to_usd(v_amt, v_cur), v_amt, v_cur,
    b.service_dept, coalesce(b.project_type, 'Dedicated'), b.technology, 'Repeat',
    b.sales_person, b.pc_sme, v_geo, b.client_email,
    'Won', true, public.to_usd(v_amt, v_cur), false, 'won', true,
    left(b.agency || ' - ' || to_char(v_month, 'Mon YYYY'), 300),
    nullif(btrim(coalesce(p_note, '')), ''),
    'Carried forward from the sheet.',
    v_actor, now(), true, v_actor, now(), v_actor, now(),
    b.client_name, b.client_type, b.service_type, b.delivery_type, b.expert,
    'Under Development', p_delivery_date, p_internal_delivery
  ) returning id into v_id;

  perform public.apply_sheet_defaults(v_id);

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot add yet - still missing: %', array_to_string(v_missing, ', ') using errcode = '23502';
  end if;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from', 'sheet-tab', 'row_index', b.row_index, 'month', to_char(v_month, 'YYYY-MM')));

  return v_id;
end $function$;
