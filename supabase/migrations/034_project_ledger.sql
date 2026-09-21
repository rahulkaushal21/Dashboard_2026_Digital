-- One ledger: the Web, Hub & LP tab, plus everything PMs have confirmed here.
--
-- Two sources, one shape. `web_revenue` is what the spreadsheet holds today; confirmed
-- opportunities are what the dashboard has booked and the sheet does not know about yet.
-- Showing them apart was the mistake — reconciling a month means reading ONE list with a
-- column saying where each line came from, not cross-referencing two pages. `in_sheet`
-- is the only distinction that matters, and it is what a handover to the spreadsheet is
-- driven from.
--
-- BOOKING MONTH IS NOT THE SAME FIELD ON BOTH SIDES. A sheet line carries its own
-- booking_month. A confirmed deal carries confirmed_at — EXCEPT a recurring entry, which
-- is added in one month FOR another, and whose source_date holds the month it belongs to.
-- Using confirmed_at for those would file October's retainers under September.
--
-- Only deals with confirmed_by set are included: that means confirmed HERE by a person,
-- not merely arriving won through the sheet feed, which would double-count every line.
create or replace view public.web_project_ledger
with (security_invoker = true) as
select
  'rev:' || r.id as row_key, 'sheet' as source, r.id as source_id,
  r.company_name, null::text as project_name, r.contact_email,
  r.service_name as service_dept, r.engagement_model, r.technology, r.geo,
  r.sme as pm_owner, r.sales_person, r.booking_month,
  r.booking_amount as amount_usd, r.booking_amount as local_value, 'USD' as currency,
  true as in_sheet, null::timestamptz as confirmed_at, null::text as confirmed_by
from public.web_revenue r
union all
select
  'opp:' || o.id, 'dashboard', o.id,
  o.company_name, o.source_subject, o.contact_email,
  o.service_dept, o.project_type, o.technology, o.geo,
  o.pm_owner, o.sales_person,
  date_trunc('month',
    case when o.origin = 'recurring' then coalesce(o.source_date, o.confirmed_at)
         else coalesce(o.confirmed_at, o.source_date) end)::date,
  o.est_value, coalesce(o.local_value, o.est_value), coalesce(o.currency, 'USD'),
  false, o.confirmed_at, o.confirmed_by
from public.opportunities o
where o.won = true and o.confirmed_by is not null;

revoke all on public.web_project_ledger from anon, public;
grant select on public.web_project_ledger to authenticated;

-- Copy any ledger row into a month, whichever side it came from.
--
-- One entry point so the page has one action instead of branching on source. Both paths
-- end in a confirmed opportunity keyed to the month, so copying the same line twice is
-- refused rather than quietly producing two bookings — which matters most for the bulk
-- move, where re-running a batch is the obvious thing to do after a partial failure.
create or replace function public.copy_row_to_month(
  p_source text, p_id bigint, p_month date, p_amount numeric default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.jwt_email();
  o public.opportunities%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_amt numeric; v_key text; v_id bigint;
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  if p_source = 'sheet' then
    return public.duplicate_booking_to_month(p_id, v_month, p_amount);
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
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at
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
    v_actor, now(), true, v_actor, now(), v_actor, now()
  ) returning id into v_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','ledger-copy','copied_from',p_id,'month',to_char(v_month,'YYYY-MM')));
  return v_id;
end $$;

revoke execute on function public.copy_row_to_month(text, bigint, date, numeric) from public, anon;
grant  execute on function public.copy_row_to_month(text, bigint, date, numeric) to authenticated, service_role;
