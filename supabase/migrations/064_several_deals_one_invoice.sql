-- Several ad-hoc jobs, one revenue entry.
--
-- On an ad-hoc account the month is a dozen small jobs and ONE invoice. Confirming them
-- one at a time produced a dozen revenue lines for an invoice that does not exist a dozen
-- times, so the sheet and the invoice stopped agreeing and somebody reconciled it by hand.
--
-- So a deal can now be ROLLED INTO another. The primary carries the whole amount and is
-- the line that books; the rest are confirmed — they are won, they happened, they keep
-- their own history and their own PM — but they do not book again. rolled_into is the
-- only thing that decides it, in one place, so nothing can count them twice.
--
-- AD-HOC ONLY, and one client at a time. A retainer is billed on its own terms and a
-- dedicated month is already one line; rolling those up would hide the shape of the
-- work rather than match the invoice. Enforced here, not just in the form.

alter table public.opportunities
  add column if not exists rolled_into bigint references public.opportunities(id) on delete set null;

comment on column public.opportunities.rolled_into is
  'This deal is billed as part of another deal. It is won, but it books no revenue of its own — the deal it points at carries the combined amount.';

create index if not exists opportunities_rolled_into_idx on public.opportunities (rolled_into) where rolled_into is not null;

-- Rolling up is a STEP, not a rival confirmation.
--
-- The first cut had this function confirm the primary itself, which meant a group could
-- only be billed when that deal already had all six required fields — and the dry run
-- showed what that looks like: "still missing: Client name, Client type, Delivery date,
-- Delivery type, Service / dept, Service type, Start date". The form that collects
-- exactly those already exists, so the deal carrying the invoice is confirmed through the
-- ordinary dialog and the others are attached afterwards. Nothing about what makes a deal
-- bookable is described in two places.
--
-- AD-HOC, but blank counts. project_type is empty on all 951 opportunities — the Quotes
-- sheet does not carry it and only the confirm dialog ever sets it — so refusing anything
-- not already marked "Ad-hoc" would refuse everything. An explicit Dedicated or Retainer
-- is a refusal; unclassified is accepted and marked Ad-hoc, which is simply what several
-- small jobs on one invoice are.
create or replace function public.roll_up_opportunities(p_ids bigint[], p_primary bigint)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.jwt_email();
  v_n     int;
  v_id    bigint;
  v_bad   text;
  v_cur   text;
begin
  if v_actor is null then
    raise exception 'Sign in to confirm a deal.' using errcode = '42501';
  end if;

  select count(*) into v_n from public.opportunities where id = any (p_ids);
  if v_n <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'One of those deals no longer exists — reload and try again.' using errcode = 'P0002';
  end if;
  if v_n < 2 then
    raise exception 'Pick at least two deals to bill together.' using errcode = '22023';
  end if;
  if not (p_primary = any (p_ids)) then
    raise exception 'The deal carrying the invoice must be one of the deals being billed.' using errcode = '22023';
  end if;

  -- The primary must already be confirmed. This runs immediately after that happens, so
  -- if it has not, something went wrong upstream and attaching deals to an unbooked line
  -- would hide them from the figures entirely.
  if not exists (select 1 from public.opportunities
                  where id = p_primary and won = true and confirmed_by is not null) then
    raise exception 'Confirm the deal carrying the invoice first.' using errcode = '22023';
  end if;

  select string_agg(distinct btrim(project_type), ', ') into v_bad
  from public.opportunities
  where id = any (p_ids)
    and coalesce(btrim(project_type),'') <> ''
    and btrim(project_type) !~* 'ad[ -]?hoc';
  if v_bad is not null then
    raise exception 'Only ad-hoc jobs can be billed together — these are marked %.', v_bad
      using errcode = '22023';
  end if;

  -- One client. Keyed the way the rest of the dashboard keys a client name, so "ZULU 8"
  -- and "Zulu8" are one account and two genuinely different clients are not.
  if (select count(distinct lower(regexp_replace(coalesce(company_name,''),'[^a-zA-Z0-9]','','g')))
        from public.opportunities where id = any (p_ids)) > 1 then
    raise exception 'Those deals are for different clients — one invoice covers one client.' using errcode = '22023';
  end if;

  -- One currency, because the combined figure is a sum. Mixed currencies would need a
  -- conversion the person never asked for and could not see.
  select string_agg(distinct coalesce(nullif(btrim(currency),''), 'USD'), ', ') into v_cur
    from public.opportunities where id = any (p_ids);
  if v_cur like '%,%' then
    raise exception 'Those deals are in different currencies (%) — bill them separately.', v_cur
      using errcode = '22023';
  end if;

  if exists (select 1 from public.opportunities
              where id = any (p_ids) and rolled_into is not null and rolled_into <> p_primary) then
    raise exception 'One of those deals is already billed as part of another invoice.' using errcode = '22023';
  end if;

  -- Permission, per deal, exactly as a single confirmation asks it.
  foreach v_id in array p_ids loop
    if not public.can_confirm_opportunity(v_id) then
      raise exception 'Deal #% belongs to another PM. Its owner, or an admin, can confirm it.', v_id
        using errcode = '42501';
    end if;
  end loop;

  update public.opportunities set project_type = 'Ad-hoc'
   where id = any (p_ids) and coalesce(btrim(project_type),'') = '';

  update public.opportunities set
    rolled_into  = p_primary,
    won          = true,
    status       = 'Won',
    rfq_status   = 'won',
    email_won    = true,
    email_won_by = v_actor,
    email_won_at = now(),
    email_won_reason = 'Billed together with deal #' || p_primary,
    confirmed_by = v_actor,
    confirmed_at = now(),
    unlikely = false, unlikely_reason = null, unlikely_at = null, unlikely_by = null,
    email_lost = false, email_lost_reason = null, email_lost_at = null, email_lost_by = null
  where id = any (p_ids) and id <> p_primary;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  select id, 'rolled_up', v_actor, jsonb_build_object('into', p_primary)
  from public.opportunities where id = any (p_ids) and id <> p_primary;

  return coalesce(array_length(p_ids, 1), 0) - 1;
end $$;

revoke execute on function public.roll_up_opportunities(bigint[], bigint) from public, anon;
grant  execute on function public.roll_up_opportunities(bigint[], bigint) to authenticated;

-- Undo. A group billed together and then split again is an ordinary correction, not a
-- reason to go into the database — and without this the only way back would be to delete
-- the ledger line, which is a different and more destructive thing.
create or replace function public.unroll_opportunity(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_actor text := public.jwt_email();
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.can_confirm_opportunity(p_id) then
    raise exception 'That deal belongs to another PM.' using errcode = '42501';
  end if;
  update public.opportunities set rolled_into = null where id = p_id;
  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'unrolled', v_actor, '{}'::jsonb);
  return true;
end $$;

revoke execute on function public.unroll_opportunity(bigint) from public, anon;
grant  execute on function public.unroll_opportunity(bigint) to authenticated;

-- And the ledger has to ignore them, or the money counts twice: once on each rolled-up
-- deal and again on the line carrying the invoice. Edited in place rather than retyped,
-- because the view is a hundred columns and a hand copy is a hundred chances to drift.
do $$
declare v_def text;
begin
  select pg_get_viewdef('public.web_project_ledger'::regclass, true) into v_def;
  if position('rolled_into' in v_def) > 0 then
    return;                      -- already carries the filter
  end if;
  if position('WHERE o.won = true AND o.confirmed_by IS NOT NULL' in v_def) = 0 then
    raise exception 'web_project_ledger no longer has the predicate this migration edits — recreate it by hand';
  end if;
  v_def := replace(v_def,
    'WHERE o.won = true AND o.confirmed_by IS NOT NULL',
    'WHERE o.won = true AND o.confirmed_by IS NOT NULL AND o.rolled_into IS NULL');
  execute 'create or replace view public.web_project_ledger as ' || v_def;
end $$;

comment on view public.web_project_ledger is
  'Every booked line: the revenue sheet, plus deals confirmed in the dashboard. A deal rolled into another books nothing of its own — the deal carrying the invoice books the lot. Lines an admin has removed are excluded (see ledger_deletions).';
