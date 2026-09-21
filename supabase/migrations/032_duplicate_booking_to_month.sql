-- Copy a line from the revenue sheet into a chosen month.
--
-- IT DOES NOT WRITE TO web_revenue, and cannot. That table is FULL REPLACE on every
-- sync, so a row inserted there is gone within thirty minutes and the person who added
-- it would have no idea why. The duplicate becomes a confirmed opportunity in our own
-- record instead, which is what the Project sheet reads.
--
-- Idempotent on quote_key: 'dup:<booking id>:<YYYY-MM>'. Copying the same line into the
-- same month twice is refused rather than quietly producing two bookings.
create or replace function public.duplicate_booking_to_month(
  p_booking_id bigint, p_month date, p_amount numeric default null, p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.jwt_email();
  b public.web_revenue%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_amt numeric; v_geo text; v_key text; v_id bigint; v_missing text[];
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  select * into b from public.web_revenue where id = p_booking_id;
  if not found then raise exception 'No such revenue line.' using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(b.sme, v_actor)) then
    raise exception 'This client belongs to % - they, or an admin, can add it.', coalesce(b.sme,'another PM')
      using errcode = '42501';
  end if;

  v_amt := coalesce(p_amount, b.booking_amount);
  if coalesce(v_amt,0) <= 0 then
    raise exception 'Cannot add yet - still missing: Value' using errcode = '23502';
  end if;

  -- The revenue sheet writes GEO as US/Canada, AU/NZ, UK/EU; the dashboard groups deals
  -- as US, UK, AU. Translate on the way in so the copy sits in the same bucket as every
  -- other deal rather than forming a fourth one nothing else matches.
  v_geo := case
    when b.geo ilike '%us%' or b.geo ilike '%canada%' then 'US'
    when b.geo ilike '%au%' or b.geo ilike '%nz%'     then 'AU'
    when b.geo ilike '%uk%' or b.geo ilike '%eu%'     then 'UK'
    else nullif(trim(coalesce(b.geo,'')),'') end;

  v_key := 'dup:' || p_booking_id || ':' || to_char(v_month, 'YYYY-MM');
  if exists (select 1 from public.opportunities where quote_key = v_key) then
    raise exception 'That line is already in %.', to_char(v_month, 'Mon YYYY') using errcode = '23505';
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, local_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, contact_email, status, won, won_amount, rfq, rfq_status,
    enriched, summary, gist, next_step, created_by, created_at,
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at
  ) values (
    v_key, 'recurring', 'retainer', b.company_name,
    b.company_name || ' - ' || coalesce(b.engagement_model, 'recurring') || ' ' || to_char(v_month, 'Mon YYYY'),
    v_month, v_month, v_amt, v_amt, 'USD',
    b.service_name, coalesce(b.engagement_model, 'Dedicated'), b.technology, 'Repeat',
    b.sales_person, b.sme, v_geo, b.contact_email, 'Won', true, v_amt, false, 'won', true,
    left(b.company_name || ' - ' || to_char(v_month, 'Mon YYYY') || ' - $' || round(v_amt)::text, 300),
    nullif(trim(coalesce(p_note,'')),''), 'Copied from the revenue sheet.',
    v_actor, now(), true, v_actor, now(), v_actor, now()
  ) returning id into v_id;

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot add yet - still missing: %', array_to_string(v_missing, ', ') using errcode = '23502';
  end if;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','revenue-sheet','booking_id',p_booking_id,'month',to_char(v_month,'YYYY-MM')));
  return v_id;
end $$;

revoke execute on function public.duplicate_booking_to_month(bigint, date, numeric, text) from public, anon;
grant  execute on function public.duplicate_booking_to_month(bigint, date, numeric, text) to authenticated, service_role;
