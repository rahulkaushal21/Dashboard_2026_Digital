-- Removing a line from the ledger. Admins only.
--
-- NOTHING IS DESTROYED. A sheet line still exists in the spreadsheet and a dashboard line
-- is still a won opportunity; this only stops it counting, and restore_ledger_row() puts
-- it back. A hard delete is not available to anyone here: sheet_raw is replaced wholesale
-- on every sync, so a row deleted from it would return within the hour and look like the
-- delete had silently failed.
--
-- ADMINS, NOT THE ROW'S OWNER. A PM may edit the fields on their own line — that is the
-- point of the override table. Taking a line out of the revenue figures is a different
-- kind of act: it changes what the business reports, so it belongs to the small group who
-- answer for that number, and it is enforced in the database rather than by hiding a
-- button.
--
-- THE FINGERPRINT IS THE INTERESTING PART. row_key for a sheet line is 'raw:<row number>'
-- — the spreadsheet's own row, not an id. Insert two rows near the top of the sheet and
-- raw:812 becomes a different project, at which point a stale deletion would be hiding
-- revenue nobody meant to hide, silently. So the deletion records the line it was made
-- against, and when that no longer matches the line reappears. Failing visible is the
-- right way round for something whose only job is to remove money from a total.
create table if not exists public.ledger_deletions (
  row_key     text primary key,
  fingerprint text,
  reason      text,
  deleted_by  text not null,
  deleted_at  timestamptz not null default now()
);

comment on table public.ledger_deletions is
  'Lines hidden from the ledger by an admin. Nothing is destroyed: a sheet line still exists in the spreadsheet and a dashboard line is still a won opportunity. This only stops it counting, and it is reversible by deleting the row here.';

alter table public.ledger_deletions enable row level security;

-- Read is open, because web_project_ledger joins it for everybody. Writes go through the
-- RPCs, which check the caller is an admin. EXECUTE is granted to PUBLIC by default and
-- anon inherits it, so the revoke comes first or the grant is decoration.
grant select on public.ledger_deletions to anon, authenticated;
revoke insert, update, delete on public.ledger_deletions from anon, authenticated;

create or replace function public.delete_ledger_row(p_row_key text, p_fingerprint text default null, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.jwt_email();
begin
  if v_actor is null then raise exception 'not signed in'; end if;
  if not public.is_dashboard_admin() then
    raise exception 'only an admin can remove a line';
  end if;
  if coalesce(btrim(p_row_key), '') = '' then raise exception 'row_key required'; end if;

  insert into public.ledger_deletions (row_key, fingerprint, reason, deleted_by)
  values (p_row_key, nullif(btrim(p_fingerprint), ''), nullif(btrim(p_reason), ''), v_actor)
  on conflict (row_key) do update
    set reason = excluded.reason, deleted_by = excluded.deleted_by, deleted_at = now();
  return true;
end;
$$;

create or replace function public.restore_ledger_row(p_row_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.jwt_email() is null then raise exception 'not signed in'; end if;
  if not public.is_dashboard_admin() then raise exception 'only an admin can restore a line'; end if;
  delete from public.ledger_deletions where row_key = p_row_key;
  return true;
end;
$$;

revoke execute on function public.delete_ledger_row(text, text, text) from public, anon;
revoke execute on function public.restore_ledger_row(text) from public, anon;
grant  execute on function public.delete_ledger_row(text, text, text) to authenticated;
grant  execute on function public.restore_ledger_row(text) to authenticated;

-- web_project_ledger is recreated wrapping its existing UNION in a CTE and excluding
-- anything in ledger_deletions whose fingerprint still matches. Pull the definition with:
--   select pg_get_viewdef('public.web_project_ledger'::regclass, true);
