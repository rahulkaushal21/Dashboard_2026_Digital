-- Recurring work: dedicated and partial-dedicated retainers that repeat every month.
--
-- WHY THIS IS NOT SMALL: dedicated work is the second-largest line in the business —
-- 236 monthly rows across 22 clients ($1.25M), plus 95 rows across 12 more for partial
-- dedicated ($227K). Many of those clients have billed every month for 18 months
-- straight, several at an identical figure. Asking a PM to retype them is asking for an
-- error.
--
-- DRAFTS LIVE IN THEIR OWN TABLE, NOT IN `opportunities`. This is the important design
-- decision. oppStatus() in the Opportunities page treats any unrecognised status as
-- Open, so 34 generated drafts a month would have been silently added to open pipeline
-- and the forecast across ten pages that read that table. Keeping them separate means a
-- draft cannot touch a single existing number until somebody confirms it, at which point
-- a normal confirmed opportunity is created.
--
-- AND THEY ARE NEVER AUTO-CONFIRMED. One dedicated client in the data billed steadily
-- for nine months and then stopped. Generating confirmed rows would have invented nine
-- months of revenue that never arrived, looking exactly like the real thing. A draft
-- nobody confirms just ages; a confirmed row that should not exist has to be found and
-- unpicked.

create table if not exists public.recurring_deals (
  id               bigserial primary key,
  company_name     text not null,
  monthly_value    numeric,
  currency         text not null default 'USD',
  engagement_model text,
  service_dept     text,
  technology       text,
  geo              text,
  pm_owner         text,
  sales_person     text,
  start_month      date not null,
  -- Set an end month and generation stops on its own, without anybody remembering to.
  end_month        date,
  active           boolean not null default true,
  paused_at        timestamptz,
  pause_reason     text,
  created_by       text,
  created_at       timestamptz not null default now(),
  note             text
);

create table if not exists public.recurring_drafts (
  id             bigserial primary key,
  recurring_id   bigint not null references public.recurring_deals(id) on delete cascade,
  month          date not null,
  amount         numeric,
  state          text not null default 'pending',   -- pending | confirmed | dismissed
  opportunity_id bigint,
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  -- The idempotency guard: generation can run twice, or late, and never doubles a month.
  unique (recurring_id, month)
);
create index if not exists recurring_drafts_state_idx on public.recurring_drafts(state, month desc);

alter table public.recurring_deals  enable row level security;
alter table public.recurring_drafts enable row level security;

drop policy if exists recurring_deals_read on public.recurring_deals;
create policy recurring_deals_read on public.recurring_deals for select to authenticated using (true);
drop policy if exists recurring_deals_write on public.recurring_deals;
create policy recurring_deals_write on public.recurring_deals for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

-- Drafts are machine-written and decided through the RPCs below, so there is no direct
-- write policy at all: the only ways to change one are confirm or dismiss.
drop policy if exists recurring_drafts_read on public.recurring_drafts;
create policy recurring_drafts_read on public.recurring_drafts for select to authenticated using (true);

revoke all on public.recurring_deals, public.recurring_drafts from anon, public;
grant select, insert, update, delete on public.recurring_deals to authenticated;
grant select on public.recurring_drafts to authenticated;
grant usage, select on sequence public.recurring_deals_id_seq to authenticated;

-- Generate this month's drafts, and pause anything that looks finished.
--
-- The auto-pause runs FIRST, so a retainer that has gone quiet does not get one more
-- draft on its way out. Three consecutive months of drafts nobody acted on is the signal
-- that the engagement ended and nobody said so. It pauses rather than deletes: the
-- history stays, and an admin can resume it.
create or replace function public.generate_recurring_drafts(p_month date default date_trunc('month', current_date)::date)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; n integer;
begin
  update public.recurring_deals d
     set active = false, paused_at = now(),
         pause_reason = 'Three months of drafts went unconfirmed - the engagement looks finished.'
   where d.active
     and d.start_month <= (v_month - interval '3 months')
     and not exists (
       select 1 from public.recurring_drafts f
        where f.recurring_id = d.id
          and f.month >= (v_month - interval '3 months')::date
          and f.month < v_month
          and f.state <> 'pending')
     and (select count(*) from public.recurring_drafts f
           where f.recurring_id = d.id
             and f.month >= (v_month - interval '3 months')::date
             and f.month < v_month) >= 3;

  -- The amount carries forward from the last CONFIRMED month, not from the template:
  -- a dedicated resource billing on hours drifts, and last month is a better guess than
  -- whatever was typed when the retainer was set up.
  insert into public.recurring_drafts (recurring_id, month, amount)
  select d.id, v_month,
         coalesce(
           (select f.amount from public.recurring_drafts f
             where f.recurring_id = d.id and f.state = 'confirmed'
             order by f.month desc limit 1),
           d.monthly_value)
    from public.recurring_deals d
   where d.active
     and d.start_month <= v_month
     and (d.end_month is null or d.end_month >= v_month)
  on conflict (recurring_id, month) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- Confirming a draft creates the real opportunity, already complete, and runs it through
-- the same completeness gate as any other confirmation. Ownership is pm_owner, matching
-- 028 - see that migration for why the account-owner branch went.
create or replace function public.confirm_recurring_draft(
  p_draft_id bigint, p_amount numeric default null, p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.jwt_email();
  d public.recurring_deals%rowtype;
  f public.recurring_drafts%rowtype;
  v_amt numeric; v_id bigint; v_missing text[];
begin
  if v_actor is null then raise exception 'Sign in to confirm.' using errcode = '42501'; end if;
  select * into f from public.recurring_drafts where id = p_draft_id;
  if not found then raise exception 'No such draft.' using errcode = 'P0002'; end if;
  if f.state <> 'pending' then raise exception 'That month is already %.', f.state using errcode = '22023'; end if;
  select * into d from public.recurring_deals where id = f.recurring_id;

  if not (public.is_dashboard_admin() or public.directory_owner_match(d.pm_owner, v_actor)) then
    raise exception 'This retainer belongs to another PM. Its owner, or an admin, can confirm it.'
      using errcode = '42501';
  end if;

  v_amt := coalesce(p_amount, f.amount, d.monthly_value);
  if coalesce(v_amt,0) <= 0 then
    raise exception 'Cannot confirm yet - still missing: Value' using errcode = '23502';
  end if;

  insert into public.opportunities (
    quote_key, origin, channel, company_name, source_subject, source_date, first_date,
    est_value, local_value, currency, service_dept, project_type, technology, business_type,
    sales_person, pm_owner, geo, status, won, won_amount, rfq, rfq_status,
    enriched, summary, gist, next_step, created_by, created_at,
    email_won, email_won_by, email_won_at, confirmed_by, confirmed_at
  ) values (
    'rec:' || d.id || ':' || to_char(f.month, 'YYYY-MM'), 'recurring', 'retainer',
    d.company_name,
    d.company_name || ' - ' || coalesce(d.engagement_model,'retainer') || ' ' || to_char(f.month, 'Mon YYYY'),
    f.month, f.month,
    public.to_usd(v_amt, d.currency), v_amt, d.currency,
    d.service_dept, coalesce(d.engagement_model, 'Dedicated'), d.technology, 'Repeat',
    d.sales_person, d.pm_owner, d.geo, 'Won', true, public.to_usd(v_amt, d.currency), false, 'won',
    true,
    left(d.company_name || ' - recurring ' || to_char(f.month, 'Mon YYYY'), 300),
    nullif(trim(coalesce(p_note,'')),''),
    'Recurring engagement - next month generates itself.',
    v_actor, now(), true, v_actor, now(), v_actor, now()
  ) returning id into v_id;

  v_missing := public.opportunity_missing_fields(v_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot confirm yet - still missing: %', array_to_string(v_missing, ', ')
      using errcode = '23502';
  end if;

  update public.recurring_drafts
     set state = 'confirmed', amount = v_amt, opportunity_id = v_id,
         decided_by = v_actor, decided_at = now()
   where id = p_draft_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (v_id, 'confirmed', v_actor,
          jsonb_build_object('from','recurring','recurring_id',d.id,'month',to_char(f.month,'YYYY-MM')));
  return v_id;
end $$;

create or replace function public.dismiss_recurring_draft(p_draft_id bigint, p_reason text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_actor text := public.jwt_email(); d public.recurring_deals%rowtype; f public.recurring_drafts%rowtype;
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into f from public.recurring_drafts where id = p_draft_id;
  if not found or f.state <> 'pending' then return false; end if;
  select * into d from public.recurring_deals where id = f.recurring_id;
  if not (public.is_dashboard_admin() or public.directory_owner_match(d.pm_owner, v_actor)) then
    raise exception 'This retainer belongs to another PM.' using errcode = '42501';
  end if;
  update public.recurring_drafts set state='dismissed', decided_by=v_actor, decided_at=now() where id = p_draft_id;
  return true;
end $$;

-- generate_recurring_drafts is scheduled work, not something a browser should start.
revoke execute on function public.generate_recurring_drafts(date) from public, anon, authenticated;
grant  execute on function public.generate_recurring_drafts(date) to service_role;
revoke execute on function public.confirm_recurring_draft(bigint, numeric, text) from public, anon;
grant  execute on function public.confirm_recurring_draft(bigint, numeric, text) to authenticated, service_role;
revoke execute on function public.dismiss_recurring_draft(bigint, text) from public, anon;
grant  execute on function public.dismiss_recurring_draft(bigint, text) to authenticated, service_role;
