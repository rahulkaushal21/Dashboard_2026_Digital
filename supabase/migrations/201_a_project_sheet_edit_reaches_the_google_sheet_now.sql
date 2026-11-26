-- 201 — a project-sheet edit reaches the Google Sheet now
--
-- Pratik, 26 Nov 2026: a change made on the Project Sheet module should be in the Google Sheet
-- right away, not at the next :17 or :47.
--
-- The dashboard asks for a push after a project-sheet save. It cannot call the writer itself:
-- the writer's address carries a secret, and this site is a static page anyone can read. So the
-- page calls request_sheet_push(), a signed-in-only function, and the database fires the same
-- command the schedule runs, read from cron.job. The secret is never copied or sent out.
--
-- THE GATE MATTERS. sheet-writer decides which rows to add by comparing lengths and positions,
-- so two runs at the same moment could each append the same new line. A push is therefore sent
-- only when no run is in flight:
--   * idle                       -> sent at once;
--   * a run still going          -> marked pending, sent by the one-minute flush as soon as
--                                   that run has written its sync_runs row (3 min at worst);
--   * minute 16-18 or 46-48      -> marked pending; the scheduled run owns that window.
-- Several quick edits therefore become one follow-up run, which carries all of them, because
-- the writer reads the database as it is when it runs.

create table if not exists public.sheet_push_state (
  id           boolean primary key default true check (id),
  fired_at     timestamptz,
  pending      boolean not null default false,
  requested_by text,
  requested_at timestamptz
);
insert into public.sheet_push_state (id) values (true) on conflict (id) do nothing;
alter table public.sheet_push_state enable row level security;
revoke all on public.sheet_push_state from anon, authenticated, public;

-- Whether it is safe to start a run now.
create or replace function public.sheet_push_is_busy()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select extract(minute from now())::int in (16, 17, 18, 46, 47, 48)
      or exists (
           select 1 from public.sheet_push_state s
            where s.fired_at is not null
              and s.fired_at > now() - interval '3 minutes'
              and not exists (select 1 from public.sync_runs r
                               where r.source = 'sheet-writer' and r.ran_at > s.fired_at))
$$;

-- Runs exactly what the schedule runs. The command is read from cron.job rather than written
-- here, so the secret in it lives in one place. net.http_get is sent after this transaction
-- commits, so the writer always sees the edit that asked for it.
create or replace function public.fire_sheet_writer()
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare c text;
begin
  select command into c from cron.job where jobname = 'sheet-writer' and active;
  if c is null then
    raise exception 'The sheet-writer job is missing or switched off.';
  end if;
  execute c;
  update public.sheet_push_state set fired_at = now(), pending = false where id;
end $function$;

-- Called by the dashboard after a project-sheet change. Returns 'sent' or 'queued'.
create or replace function public.request_sheet_push()
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare v_actor text := public.jwt_email();
begin
  if v_actor is null then
    raise exception 'Sign in to send changes to the sheet.' using errcode = '42501';
  end if;
  -- One request at a time, so two people saving together cannot both start a run.
  perform 1 from public.sheet_push_state where id for update;
  update public.sheet_push_state set requested_by = v_actor, requested_at = now() where id;
  if public.sheet_push_is_busy() then
    update public.sheet_push_state set pending = true where id;
    return 'queued';
  end if;
  perform public.fire_sheet_writer();
  return 'sent';
end $function$;

-- Sends a queued push once the way is clear.
create or replace function public.flush_sheet_push()
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform 1 from public.sheet_push_state where id and pending for update;
  if found and not public.sheet_push_is_busy() then
    perform public.fire_sheet_writer();
  end if;
end $function$;

revoke execute on function public.sheet_push_is_busy() from public, anon, authenticated;
revoke execute on function public.fire_sheet_writer() from public, anon, authenticated;
revoke execute on function public.flush_sheet_push() from public, anon, authenticated;
revoke execute on function public.request_sheet_push() from public, anon;
grant  execute on function public.request_sheet_push() to authenticated;

select cron.schedule('sheet-push-flush', '* * * * *', 'select public.flush_sheet_push()');
