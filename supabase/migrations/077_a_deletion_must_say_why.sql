-- Removing a line from the revenue figures now requires a reason.
--
-- It was optional. The prompt actually read "(optional, but it is the only record)",
-- which is a sentence arguing with itself — and on 25 Sep 2026 exactly what it invites
-- happened: a Tanium September Dedicated line was removed with the reason left blank.
--
-- Why it matters more here than on a normal delete: nothing is destroyed. The row goes on
-- existing in the spreadsheet, marked Deleted, carrying the name of whoever removed it and
-- their reason. That sentence is the ONLY thing that will ever explain why the money
-- stopped counting, to whoever reads that row months later. Leaving it blank produces a
-- Deleted line nobody can account for, which is worse than no deletion at all.
--
-- Ten characters is not a quality bar. It refuses an empty box and a stray keypress, and
-- nothing else — a gate people can't pass gets worked around, and the way around this one
-- would be to leave a wrong line in the figures.
create or replace function public.delete_ledger_row(p_row_key text, p_fingerprint text default null::text, p_reason text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor  text := public.jwt_email();
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  if v_actor is null then raise exception 'not signed in'; end if;
  -- Admins only. A PM may edit the fields on their own row; removing a line from the
  -- revenue figures is a different kind of act and belongs to one small group.
  if not public.is_dashboard_admin() then
    raise exception 'only an admin can remove a line';
  end if;
  if coalesce(btrim(p_row_key), '') = '' then raise exception 'row_key required'; end if;

  if v_reason is null then
    raise exception 'A reason is required - it is the only record of why this line stopped counting.'
      using errcode = '22023';
  end if;
  if length(v_reason) < 10 then
    raise exception 'Say a little more about why - that sentence is all anybody will have later.'
      using errcode = '22023';
  end if;

  insert into public.ledger_deletions (row_key, fingerprint, reason, deleted_by)
  values (p_row_key, nullif(btrim(p_fingerprint), ''), v_reason, v_actor)
  on conflict (row_key) do update
    set reason = excluded.reason, deleted_by = excluded.deleted_by, deleted_at = now();
  return true;
end;
$function$;

-- NOT backfilled. The one existing reason-less deletion (raw:3169, Tanium) is a real
-- decision somebody made; inventing a reason for it would be worse than the blank.
