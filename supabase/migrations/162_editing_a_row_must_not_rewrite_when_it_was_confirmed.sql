-- Editing a row must not rewrite when it was confirmed.
--
-- The ledger has no booking-month column: the month IS date_trunc('month', confirmed_at).
-- So update_project_fields sets the month by moving confirmed_at to the first of it —
-- and the edit dialog sends p_month on every save, unchanged month included. Any edit
-- to any field therefore threw away the real confirmation date.
--
-- PRJ290926194525 (Precision Creative and Media, $8,188.80): Bonny confirmed it on
-- 30 Oct at 15:13 — opportunity_events records confirmed_on 2026-10-30 — then edited the
-- project type twenty minutes later, and the date became 1 Oct. 76 of 137 confirmations
-- had been overwritten this way, every one of them onto the first of its month.
--
-- Fix: only move confirmed_at when the month is actually CHANGING. Patched by rewriting
-- the two lines in place, on both overloads, rather than restating 20KB of body here.
--
-- The 76 historical dates were restored separately from opportunity_events, which had
-- kept the figure the PM typed. All 76 were same-month, so no revenue moved between
-- months; that one-off repair is not repeated here because a fresh database has no rows
-- to repair.
do $$
declare
  d text;
  nd text;
  n int := 0;
begin
  for d in
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'update_project_fields'
  loop
    nd := replace(d,
      'confirmed_at     = case when p_month is not null and coalesce(origin,'''') <> ''recurring'' then v_month::timestamptz else confirmed_at end',
      'confirmed_at     = case when p_month is not null and coalesce(origin,'''') <> ''recurring'' and v_month is distinct from date_trunc(''month'', confirmed_at)::date then v_month::timestamptz else confirmed_at end');
    nd := replace(nd,
      'email_won_at     = case when p_month is not null and coalesce(origin,'''') <> ''recurring'' then v_month::timestamptz else email_won_at end',
      'email_won_at     = case when p_month is not null and coalesce(origin,'''') <> ''recurring'' and v_month is distinct from date_trunc(''month'', email_won_at)::date then v_month::timestamptz else email_won_at end');
    if nd = d then
      raise exception 'update_project_fields did not contain the expected month lines — not patching blind';
    end if;
    execute nd;
    n := n + 1;
  end loop;
  if n <> 2 then
    raise exception 'expected 2 overloads of update_project_fields, patched %', n;
  end if;
end $$;
