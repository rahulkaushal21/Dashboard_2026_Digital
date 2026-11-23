-- 194 — the confirmation date is editable on the project sheet
--
-- Pratik, 23 Nov 2026: the Edit dialog on a project-sheet line showed Start date and Delivery
-- date and not the Confirmation date, although the sheet has a Confirmation Date column and
-- the booking month is derived from it. The only way to correct it was the Month field,
-- which moves confirmed_at to the FIRST of a month and cannot say which day.
--
-- This is a separate setter rather than another parameter on update_project_fields: that
-- function already exists in two overloads and PostgREST refuses to choose between
-- candidates (migrations 144 and 162), so widening it a third time is how a save breaks.
--
-- Rules, all the same as the editor next to it:
--   * only the row's own PM, a PM who matches it by alias, or an admin (directory_owner_match);
--   * only a deal that is actually confirmed: it moves a date, it does not confirm anything;
--   * the date is stored at noon so no time zone can push it into the neighbouring month;
--   * when the date changes MONTH, the booking month moves with it (it is derived from
--     confirmed_at), so every total follows. A recurring line's month is its own source_date
--     and is not touched; only the date shown is;
--   * a change is written to opportunity_events with from and to, and nothing is written
--     when the date did not move.
--
-- A line from the old sheet is not covered: its confirmation date is the sheet's own cell
-- and the overlay has no column for it. The dialog shows it read-only.

create or replace function public.set_confirmation_date(p_id bigint, p_date date)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  v_row   public.opportunities%rowtype;
  v_new   timestamptz;
begin
  if v_actor is null then
    raise exception 'Sign in to edit this row.' using errcode = '42501';
  end if;
  select * into v_row from public.opportunities where id = p_id;
  if not found then raise exception 'No such row (#%).', p_id using errcode = 'P0002'; end if;

  if not (public.is_dashboard_admin() or public.directory_owner_match(v_row.pm_owner, v_actor)) then
    raise exception 'This row belongs to another PM. Its owner, or an admin, can edit it.'
      using errcode = '42501';
  end if;
  if not coalesce(v_row.won, false) then
    raise exception 'This deal is not confirmed yet. Confirm it first; the date is set then.'
      using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'A confirmation date is required.' using errcode = '22023';
  end if;
  if p_date < date '2020-01-01' or p_date > (current_date + 31) then
    raise exception 'That confirmation date looks wrong (%).', p_date using errcode = '22023';
  end if;

  v_new := (p_date + time '12:00')::timestamp at time zone 'UTC';

  -- Nothing to do when the day is already that day.
  if v_row.confirmed_at is not null and (v_row.confirmed_at at time zone 'UTC')::date = p_date then
    return p_id;
  end if;

  perform set_config('app.manual_edit', '1', true);

  update public.opportunities set
    confirmed_at = v_new,
    email_won_at = case when coalesce(origin, '') <> 'recurring' and email_won_at is not null
                        then v_new else email_won_at end
  where id = p_id;

  perform set_config('app.manual_edit', '0', true);

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'edited', v_actor, jsonb_build_object(
    'from', 'ledger',
    'changed', jsonb_build_object('confirmation_date', jsonb_build_object(
      'from', to_char(v_row.confirmed_at at time zone 'UTC', 'YYYY-MM-DD'),
      'to',   to_char(p_date, 'YYYY-MM-DD')))));

  return p_id;
end $function$;

revoke execute on function public.set_confirmation_date(bigint, date) from public, anon;
grant  execute on function public.set_confirmation_date(bigint, date) to authenticated;
