-- Quarterly business reviews, written down.
--
-- Every other block on Client 360 is DERIVED — revenue, quotes, delivery, escalations all
-- come from a sheet or a mailbox that is already synced. A QBR is not: it happens in a
-- call, and what was agreed in that call exists only in a recording or somebody's minutes.
-- Nothing in this dashboard can reach either, so this is the one Client 360 block that has
-- to be typed. Whoever ran the call pastes what was agreed; it is stored per client and
-- per date so the next QBR opens with the last one's action items in front of it.
--
-- Deliberately four free-text fields rather than a task tracker. Action items out of a QBR
-- are sentences ("they will send the brand assets by the 14th"), not tickets, and a
-- structured tracker nobody fills in is worse than a paragraph everybody does.

create table if not exists public.client_qbr (
  id bigserial primary key,
  -- lower(trim(company)) — the same key Client 360 joins everything else on, so a QBR
  -- filed under "BPL Marketing " still lands on the same client card.
  client_key text not null,
  company_name text not null,
  qbr_date date not null,
  summary text,
  action_mavlers text,
  action_client text,
  opportunities text,
  next_roadmap text,
  -- Where this came from: a recording, written minutes, or somebody's notes. Recorded
  -- because "we agreed X" carries different weight depending on the answer.
  source text,
  added_by text not null,
  added_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz,
  unique (client_key, qbr_date)
);

create index if not exists client_qbr_client_idx on public.client_qbr (client_key, qbr_date desc);

alter table public.client_qbr enable row level security;

drop policy if exists client_qbr_read on public.client_qbr;
create policy client_qbr_read on public.client_qbr for select using (true);

-- Same rule as contractors: the PM who ran the call is the one who can write it up.
-- Making them raise a request first is how a QBR log goes empty.
drop policy if exists client_qbr_write on public.client_qbr;
create policy client_qbr_write on public.client_qbr for all
  using (public.is_registered_pm() or public.is_dashboard_admin())
  with check (public.is_registered_pm() or public.is_dashboard_admin());

grant select on public.client_qbr to anon, authenticated;
grant insert, update, delete on public.client_qbr to authenticated;
grant usage, select on sequence public.client_qbr_id_seq to authenticated;

-- The actor is taken from the JWT, never from a parameter: a caller cannot file a QBR
-- under somebody else's name.
create or replace function public.save_client_qbr(
  p_company text, p_qbr_date date,
  p_summary text default null, p_action_mavlers text default null,
  p_action_client text default null, p_opportunities text default null,
  p_next_roadmap text default null, p_source text default null
) returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint; v_who text := public.jwt_email(); v_key text := lower(btrim(p_company));
begin
  if v_who is null or not (public.is_registered_pm() or public.is_dashboard_admin()) then
    raise exception 'Only a registered PM or an admin can record a QBR';
  end if;
  if coalesce(v_key, '') = '' then raise exception 'A client is needed'; end if;
  if p_qbr_date is null then raise exception 'A QBR date is needed'; end if;

  insert into public.client_qbr (client_key, company_name, qbr_date, summary, action_mavlers,
                                 action_client, opportunities, next_roadmap, source, added_by)
  values (v_key, btrim(p_company), p_qbr_date, p_summary, p_action_mavlers,
          p_action_client, p_opportunities, p_next_roadmap, p_source, v_who)
  on conflict (client_key, qbr_date) do update
    set summary = excluded.summary, action_mavlers = excluded.action_mavlers,
        action_client = excluded.action_client, opportunities = excluded.opportunities,
        next_roadmap = excluded.next_roadmap, source = excluded.source,
        company_name = excluded.company_name,
        updated_by = v_who, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- EXECUTE is granted to PUBLIC by default and anon inherits it, so the revoke has to come
-- BEFORE the grant or the gate above is the only thing standing between anon and a write.
revoke all on function public.save_client_qbr(text, date, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_client_qbr(text, date, text, text, text, text, text, text) to authenticated;

-- anon picks up insert/update/delete from the schema's default privileges. RLS already
-- refuses it (anon has no jwt email, so is_registered_pm() is false), but a grant that
-- only RLS stands behind is one policy edit away from being a hole.
revoke insert, update, delete on public.client_qbr from anon;
revoke all on sequence public.client_qbr_id_seq from anon;
