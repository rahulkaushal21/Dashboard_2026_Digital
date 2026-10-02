-- On Hold, Cancelled and Not an opportunity, called from the dashboard.
--
-- Same reasoning as email_won / email_lost: the 30-minute sheet sync rewrites `status`
-- and `won`, so a decision made on the dashboard has to live in a column the sync never
-- touches. One column, one verdict at a time:
--   on_hold   — the client paused it; it is still a deal, just not moving
--   cancelled — the client called it off (lands in the Lost tab, labelled Cancelled)
--   not_opp   — it was never a deal: internal handoff, support ask, another team's scope
--
-- All the manual calls are mutually exclusive. Setting a state clears Confirmed and
-- Lost; confirming or losing a deal clears the state. "Might not come" can sit on top of
-- On Hold (a paused deal can also be doubtful) but not on Cancelled / Not an opportunity.

alter table public.opportunities
  add column if not exists manual_state        text,
  add column if not exists manual_state_reason text,
  add column if not exists manual_state_at     timestamptz,
  add column if not exists manual_state_by     text;

do $$ begin
  alter table public.opportunities add constraint opportunities_manual_state_chk
    check (manual_state is null or manual_state in ('on_hold', 'cancelled', 'not_opp'));
exception when duplicate_object then null; end $$;

create or replace function public.set_opportunity_state(p_id bigint, p_state text, p_actor text default null, p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer; s text := nullif(btrim(coalesce(p_state, '')), '');
begin
  if s is not null and s not in ('on_hold', 'cancelled', 'not_opp') then
    raise exception 'unknown state %', s;
  end if;
  update public.opportunities o set
    manual_state        = s,
    manual_state_reason = case when s is not null then nullif(btrim(coalesce(p_reason,'')),'') else null end,
    manual_state_at     = case when s is not null then now() else null end,
    manual_state_by     = case when s is not null then nullif(btrim(coalesce(p_actor,'')),'') else null end,
    email_won         = case when s is not null then false else o.email_won end,
    email_won_reason  = case when s is not null then null  else o.email_won_reason end,
    email_won_at      = case when s is not null then null  else o.email_won_at end,
    email_won_by      = case when s is not null then null  else o.email_won_by end,
    email_lost        = case when s is not null then false else o.email_lost end,
    email_lost_reason = case when s is not null then null  else o.email_lost_reason end,
    email_lost_at     = case when s is not null then null  else o.email_lost_at end,
    email_lost_by     = case when s is not null then null  else o.email_lost_by end,
    unlikely          = case when s in ('cancelled', 'not_opp') then false else o.unlikely end,
    unlikely_reason   = case when s in ('cancelled', 'not_opp') then null  else o.unlikely_reason end,
    unlikely_at       = case when s in ('cancelled', 'not_opp') then null  else o.unlikely_at end,
    unlikely_by       = case when s in ('cancelled', 'not_opp') then null  else o.unlikely_by end
  where o.id = p_id;
  get diagnostics n = row_count;
  return n;
end; $function$;

revoke execute on function public.set_opportunity_state(bigint, text, text, text) from public, anon;
grant  execute on function public.set_opportunity_state(bigint, text, text, text) to authenticated, service_role;

-- Confirm and Lost now also clear a manual state, so a deal never sits in two verdicts.
create or replace function public.set_opportunity_confirmed(p_id bigint, p_confirmed boolean, p_actor text default null, p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  update public.opportunities o set
    email_won        = coalesce(p_confirmed, false),
    email_won_reason = case when p_confirmed then nullif(btrim(coalesce(p_reason,'')),'') else null end,
    email_won_at     = case when p_confirmed then now() else null end,
    email_won_by     = case when p_confirmed then nullif(btrim(coalesce(p_actor,'')),'') else null end,
    email_lost        = case when p_confirmed then false else o.email_lost end,
    email_lost_reason = case when p_confirmed then null  else o.email_lost_reason end,
    email_lost_at     = case when p_confirmed then null  else o.email_lost_at end,
    email_lost_by     = case when p_confirmed then null  else o.email_lost_by end,
    unlikely          = case when p_confirmed then false else o.unlikely end,
    unlikely_reason   = case when p_confirmed then null  else o.unlikely_reason end,
    unlikely_at       = case when p_confirmed then null  else o.unlikely_at end,
    unlikely_by       = case when p_confirmed then null  else o.unlikely_by end,
    manual_state        = case when p_confirmed then null else o.manual_state end,
    manual_state_reason = case when p_confirmed then null else o.manual_state_reason end,
    manual_state_at     = case when p_confirmed then null else o.manual_state_at end,
    manual_state_by     = case when p_confirmed then null else o.manual_state_by end
  where o.id = p_id;
  get diagnostics n = row_count;
  return n;
end; $function$;

create or replace function public.set_opportunity_lost(p_id bigint, p_lost boolean, p_actor text default null, p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  update public.opportunities o set
    email_lost        = coalesce(p_lost, false),
    email_lost_reason = case when p_lost then nullif(btrim(coalesce(p_reason,'')),'') else null end,
    email_lost_at     = case when p_lost then now() else null end,
    email_lost_by     = case when p_lost then nullif(btrim(coalesce(p_actor,'')),'') else null end,
    email_won         = case when p_lost then false else o.email_won end,
    email_won_reason  = case when p_lost then null  else o.email_won_reason end,
    email_won_at      = case when p_lost then null  else o.email_won_at end,
    email_won_by      = case when p_lost then null  else o.email_won_by end,
    unlikely          = case when p_lost then false else o.unlikely end,
    unlikely_reason   = case when p_lost then null  else o.unlikely_reason end,
    unlikely_at       = case when p_lost then null  else o.unlikely_at end,
    unlikely_by       = case when p_lost then null  else o.unlikely_by end,
    manual_state        = case when p_lost then null else o.manual_state end,
    manual_state_reason = case when p_lost then null else o.manual_state_reason end,
    manual_state_at     = case when p_lost then null else o.manual_state_at end,
    manual_state_by     = case when p_lost then null else o.manual_state_by end
  where o.id = p_id;
  get diagnostics n = row_count;
  return n;
end; $function$;

-- "Might not come" can't be raised on a deal that is cancelled or not a deal at all.
create or replace function public.set_opportunity_unlikely(p_id bigint, p_unlikely boolean, p_actor text default null, p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  update public.opportunities o set
    unlikely        = coalesce(p_unlikely, false),
    unlikely_reason = case when p_unlikely then nullif(btrim(coalesce(p_reason,'')),'') else null end,
    unlikely_at     = case when p_unlikely then now() else null end,
    unlikely_by     = case when p_unlikely then nullif(btrim(coalesce(p_actor,'')),'') else null end,
    manual_state        = case when p_unlikely and o.manual_state in ('cancelled', 'not_opp') then null else o.manual_state end,
    manual_state_reason = case when p_unlikely and o.manual_state in ('cancelled', 'not_opp') then null else o.manual_state_reason end,
    manual_state_at     = case when p_unlikely and o.manual_state in ('cancelled', 'not_opp') then null else o.manual_state_at end,
    manual_state_by     = case when p_unlikely and o.manual_state in ('cancelled', 'not_opp') then null else o.manual_state_by end
  where o.id = p_id;
  get diagnostics n = row_count;
  return n;
end; $function$;

-- The SQL mirror of the page's oppStatus(). A five-argument version that knows the
-- manual state; the four-argument one stays for anything not yet moved across.
create or replace function public.opportunity_state(p_won boolean, p_email_won boolean, p_email_lost boolean, p_status text, p_manual_state text)
returns text language sql immutable as $function$
  select case
    when coalesce(p_won, false)       then 'Won'
    when coalesce(p_email_won, false) then 'Won'
    when p_manual_state = 'not_opp'   then 'Not an opportunity'
    when p_manual_state = 'cancelled' then 'Lost'
    when lower(coalesce(p_status,'')) like '%cancel%' then 'Lost'
    when lower(coalesce(p_status,'')) = 'lost'        then 'Lost'
    when coalesce(p_email_lost, false) then 'Lost'
    when p_manual_state = 'on_hold'   then 'On Hold'
    when lower(coalesce(p_status,'')) like '%hold%'   then 'On Hold'
    else 'Open'
  end
$function$;

-- Move the two callers onto the five-argument version, so the duplicate check in the
-- Add dialog and the open-deal evidence view stop treating a dismissed deal as live.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.find_possible_duplicates'::regproc);
  if position('o.status, o.manual_state)' in d) = 0 then
    execute replace(d, 'opportunity_state(o.won, o.email_won, o.email_lost, o.status)',
                       'opportunity_state(o.won, o.email_won, o.email_lost, o.status, o.manual_state)');
  end if;
  d := pg_get_viewdef('public.web_open_opportunity_evidence'::regclass);
  if position('o.status, o.manual_state)' in d) = 0 then
    execute 'create or replace view public.web_open_opportunity_evidence as ' ||
      replace(d, 'opportunity_state(o.won, o.email_won, o.email_lost, o.status)',
                 'opportunity_state(o.won, o.email_won, o.email_lost, o.status, o.manual_state)');
  end if;
end $$;
