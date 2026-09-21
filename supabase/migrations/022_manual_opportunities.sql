-- Creating and confirming a deal from the dashboard.
--
-- Two RPCs, and the rules they enforce are the whole point of the 1 Oct change:
-- from that date the dashboard is where a deal exists, so a deal has to be
-- COMPLETE at the moment it is confirmed. There is no later pass in a sheet
-- where somebody fills the gaps in.
--
-- Both are SECURITY DEFINER and both take their actor from jwt_email() rather
-- than from an argument. The seven RPCs that predate this still trust a p_actor
-- parameter — i.e. the caller declares who they are — which 020 flagged as worth
-- fixing. New code does not repeat it.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
-- All nullable, so nothing existing is disturbed. `origin` gains a third value,
-- 'pm', alongside 'sheet' and 'email'.
--
-- WHY 'pm' IS SAFE AGAINST THE SHEET SYNC: sync_quotes_to_opportunities() ends
-- with three janitor DELETEs that collapse duplicate rows, and every one of them
-- requires origin='sheet' on BOTH sides. A 'pm' row is invisible to them. Its
-- quote_key is 'pm:<uuid>', which cannot collide with the sync's own keys
-- ('QUT…' or 'r:<row>'), so the upsert cannot land on it either.
alter table public.opportunities
  add column if not exists channel      text,          -- referral | linkedin | upsell | event | inbound | other
  add column if not exists currency     text,
  add column if not exists service_dept text,
  add column if not exists project_type text,          -- engagement model: New Development | Ad-hoc | Dedicated | …
  add column if not exists created_by   text,
  add column if not exists created_at   timestamptz,
  add column if not exists confirmed_by text,
  add column if not exists confirmed_at timestamptz;

-- The audit trail. It exists because `status` is overwritten by the sheet sync
-- every 30 minutes, so the row itself cannot tell you who changed what: by the
-- time you look, the evidence has been replaced. Append-only by convention.
create table if not exists public.opportunity_events (
  id             bigserial primary key,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  event          text   not null,          -- created | confirmed | unconfirmed | details_filled
  actor          text,
  at             timestamptz not null default now(),
  detail         jsonb
);
create index if not exists opportunity_events_opp_idx on public.opportunity_events(opportunity_id, at desc);

alter table public.opportunity_events enable row level security;
drop policy if exists opp_events_read on public.opportunity_events;
create policy opp_events_read on public.opportunity_events for select to authenticated using (true);
revoke all on public.opportunity_events from anon, public;
grant select on public.opportunity_events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What "complete" means
-- ---------------------------------------------------------------------------
-- One definition, used by the confirm gate AND by the Needs-input list, so the
-- two can never disagree about whether a deal is ready.
create or replace function public.opportunity_missing_fields(p_id bigint)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f order by f), '{}'::text[]) from (
    select f from public.opportunities o,
      lateral (values
        ('Client',            nullif(trim(coalesce(o.company_name,'')),'') is null),
        ('Value',             coalesce(o.est_value,0) <= 0),
        ('Currency',          nullif(trim(coalesce(o.currency,'')),'') is null),
        ('Quote date',        o.source_date is null),
        ('Service / dept',    nullif(trim(coalesce(o.service_dept,'')),'') is null),
        ('Project type',      nullif(trim(coalesce(o.project_type,'')),'') is null),
        ('Account manager',   nullif(trim(coalesce(o.sales_person,'')),'') is null),
        ('PM owner',          nullif(trim(coalesce(o.pm_owner,'')),'') is null),
        ('Geography',         nullif(trim(coalesce(o.geo,'')),'') is null)
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$$;

-- ---------------------------------------------------------------------------
-- 3. Creating a deal by hand
-- ---------------------------------------------------------------------------
-- Returns the new id. Raises rather than returning null on refusal, so a caller
-- cannot mistake "you may not" for "nothing matched".
create or replace function public.add_opportunity(
  p_company       text,
  p_channel       text    default null,
  p_est_value     numeric default null,
  p_currency      text    default 'USD',
  p_quote_date    date    default null,
  p_service_dept  text    default null,
  p_project_type  text    default null,
  p_technology    text    default null,
  p_business_type text    default null,
  p_sales_person  text    default null,
  p_pm_owner      text    default null,
  p_geo           text    default null,
  p_subject       text    default null,
  p_note          text    default null,
  p_force         boolean default false
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.jwt_email();
  v_id    bigint;
  v_dupe  bigint;
  v_company text := nullif(trim(coalesce(p_company,'')),'');
begin
  if v_actor is null then
    raise exception 'Sign in to add an opportunity.' using errcode = '42501';
  end if;
  if not (public.is_dashboard_admin() or public.is_registered_pm()) then
    raise exception 'Only a registered PM or an admin can add an opportunity.' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'A client name is required.' using errcode = '22023';
  end if;

  -- Duplicate guard: SAME CLIENT AND SAME VALUE, which is an actual re-entry of
  -- the same deal rather than a coincidence of price.
  --
  -- Value alone is too broad to BLOCK on. Tested against live data, $7,777.77
  -- already collides with an unrelated deal, and in a business that quotes in
  -- round numbers a blanket value match would refuse most legitimate entries.
  -- The agency-vs-end-client duplicate that value matching is meant to catch is a
  -- reconciliation problem across two feeds, not something the person filling in
  -- this form can settle — so it is surfaced as a WARNING by
  -- find_possible_duplicates() below and left to a human.
  if not p_force and coalesce(p_est_value,0) > 0 then
    select o.id into v_dupe from public.opportunities o
     where coalesce(o.won,false) = false
       and lower(coalesce(o.status,'')) not like '%lost%'
       and o.est_value is not null
       and public.pm_norm(o.company_name) = public.pm_norm(v_company)
       and abs(o.est_value - p_est_value) <= greatest(p_est_value * 0.05, 1)
     order by o.id desc limit 1;
    if v_dupe is not null then
      raise exception 'This client already has a live deal at about this value (#%). Add it again with force to keep both.', v_dupe
        using errcode = '23505';
    end if;
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, status, won, rfq, rfq_status,
    -- enriched=true keeps the sheet sync's generated blurbs off a row a human
    -- wrote. The sync only overwrites summary/gist/next_step where it is false.
    enriched, summary, gist, next_step, created_by, created_at
  ) values (
    'pm:' || gen_random_uuid(), 'pm', nullif(trim(coalesce(p_channel,'')),''),
    v_company, nullif(trim(coalesce(p_subject,'')),''),
    coalesce(p_quote_date::timestamptz, now()), coalesce(p_quote_date::timestamptz, now()),
    p_est_value, coalesce(nullif(trim(coalesce(p_currency,'')),''), 'USD'),
    nullif(trim(coalesce(p_service_dept,'')),''), nullif(trim(coalesce(p_project_type,'')),''),
    nullif(trim(coalesce(p_technology,'')),''), nullif(trim(coalesce(p_business_type,'')),''),
    nullif(trim(coalesce(p_sales_person,'')),''), nullif(trim(coalesce(p_pm_owner,'')),''),
    nullif(trim(coalesce(p_geo,'')),''), 'Open', false, false, 'quoted',
    true,
    left('Added by hand · ' || v_company || coalesce(' · $' || round(p_est_value)::text, ''), 300),
    nullif(trim(coalesce(p_note,'')),''),
    'Complete the details, then confirm when the client commits.',
    v_actor, now()
  ) returning id into v_id;

  -- NOTE: win_probability is deliberately left NULL. A percentage against a deal
  -- nobody has judged is a made-up number that reads like a real one, and it
  -- propagates into the forecast. The existing hard rule is the same.

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'created', v_actor,
          jsonb_build_object('channel', p_channel, 'est_value', p_est_value, 'forced', p_force));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Confirming, with the completeness gate
-- ---------------------------------------------------------------------------
-- Fill-and-confirm in ONE call, so a deal can never be left half-completed by a
-- form that failed between two round trips. Every p_* is optional and is applied
-- only when non-null; the completeness check runs on the result.
create or replace function public.confirm_opportunity(
  p_id            bigint,
  p_est_value     numeric default null,
  p_currency      text    default null,
  p_quote_date    date    default null,
  p_service_dept  text    default null,
  p_project_type  text    default null,
  p_sales_person  text    default null,
  p_pm_owner      text    default null,
  p_geo           text    default null,
  p_confirmed_on  date    default null,
  p_note          text    default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_actor   text := public.jwt_email();
  v_missing text[];
begin
  if v_actor is null then
    raise exception 'Sign in to confirm a deal.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.opportunities where id = p_id) then
    raise exception 'No such deal (#%).', p_id using errcode = 'P0002';
  end if;

  -- Ownership. An UNOWNED deal returns false here for every PM, so it stays
  -- admin-only rather than becoming confirmable by any PM who happens to look.
  if not public.can_confirm_opportunity(p_id) then
    raise exception 'This deal belongs to another PM. Its owner, or an admin, can confirm it.'
      using errcode = '42501';
  end if;

  -- Apply whatever the form supplied. pm_owner is applied BEFORE the ownership
  -- check has any further effect, but the check above already passed, so a PM
  -- cannot use this to hand themselves a deal they could not confirm.
  update public.opportunities set
    est_value    = coalesce(p_est_value,    est_value),
    currency     = coalesce(nullif(trim(coalesce(p_currency,'')),''),     currency),
    source_date  = coalesce(p_quote_date::timestamptz, source_date),
    service_dept = coalesce(nullif(trim(coalesce(p_service_dept,'')),''), service_dept),
    project_type = coalesce(nullif(trim(coalesce(p_project_type,'')),''), project_type),
    sales_person = coalesce(nullif(trim(coalesce(p_sales_person,'')),''), sales_person),
    pm_owner     = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''),     pm_owner),
    geo          = coalesce(nullif(trim(coalesce(p_geo,'')),''),          geo)
  where id = p_id;

  -- The gate. Enforced HERE and not only in the form, so the rule holds by any
  -- route into the database. This is the one thing keeping the revenue dump
  -- trustworthy once the sheet stops being the record.
  v_missing := public.opportunity_missing_fields(p_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot confirm yet — still missing: %', array_to_string(v_missing, ', ')
      using errcode = '23502';
  end if;

  update public.opportunities set
    won            = true,
    status         = 'Won',
    won_amount     = est_value,
    rfq_status     = 'won',
    email_won      = true,
    email_won_by   = v_actor,
    email_won_at   = coalesce(p_confirmed_on::timestamptz, now()),
    email_won_reason = nullif(trim(coalesce(p_note,'')),''),
    confirmed_by   = v_actor,
    confirmed_at   = coalesce(p_confirmed_on::timestamptz, now()),
    -- Confirming supersedes both "lost" and "might not come".
    unlikely = false, unlikely_reason = null, unlikely_at = null, unlikely_by = null,
    email_lost = false, email_lost_reason = null, email_lost_at = null, email_lost_by = null
  where id = p_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'confirmed', v_actor,
          jsonb_build_object('confirmed_on', coalesce(p_confirmed_on, current_date), 'note', p_note));

  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4b. Possible duplicates, advisory
-- ---------------------------------------------------------------------------
-- What the form SHOWS before submitting: anything live at a similar value or
-- under the same client. It returns candidates and refuses nothing — the broad
-- value match is useful as a prompt to a human and useless as a rule.
create or replace function public.find_possible_duplicates(p_company text, p_est_value numeric default null)
returns table(id bigint, company_name text, est_value numeric, status text, origin text, source_date timestamptz, why text)
language sql stable security definer set search_path = public as $$
  select o.id, o.company_name, o.est_value, o.status, o.origin, o.source_date,
         case
           when public.pm_norm(o.company_name) = public.pm_norm(p_company)
            and p_est_value is not null and o.est_value is not null
            and abs(o.est_value - p_est_value) <= greatest(p_est_value * 0.05, 1) then 'same client and value'
           when public.pm_norm(o.company_name) = public.pm_norm(p_company) then 'same client'
           else 'similar value'
         end
    from public.opportunities o
   where coalesce(o.won,false) = false
     and lower(coalesce(o.status,'')) not like '%lost%'
     and (
       public.pm_norm(o.company_name) = public.pm_norm(p_company)
       or (p_est_value is not null and o.est_value is not null
           and abs(o.est_value - p_est_value) <= greatest(p_est_value * 0.05, 1))
     )
   order by o.source_date desc nulls last
   limit 10
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default and anon inherits it, so each one
-- is revoked from PUBLIC first — revoking from anon alone leaves it callable.
do $$
declare f text;
begin
  foreach f in array array[
    'public.add_opportunity(text, text, numeric, text, date, text, text, text, text, text, text, text, text, text, boolean)',
    'public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text)',
    'public.opportunity_missing_fields(bigint)',
    'public.find_possible_duplicates(text, numeric)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant  execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
