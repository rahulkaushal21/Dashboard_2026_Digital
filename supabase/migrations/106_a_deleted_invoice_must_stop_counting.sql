-- 106 — a deleted invoice must stop counting
--
-- Rahul, reconciling September against the app's own export (1 Oct 2026): "there were few
-- deleted invoices ... IsDeleted column True should not be included".
--
-- We had no way to know. GetInvoices carries no IsDeleted field — checked across every
-- September payload, the only related keys are ArchieveDate, VoidDate, RefundStatus and
-- Status, and ArchieveDate is set on nothing. A deleted invoice simply STOPS BEING
-- RETURNED. The sync only ever upserts, so ours stayed in the mirror for good, counted as
-- revenue and listed as a reconciliation gap for a sheet row that will never exist.
--
-- ---------------------------------------------------------------------------
-- WHAT "MISSING FROM THE PULL" DOES AND DOES NOT MEAN
--
-- The obvious test — "in our mirror, not in the latest pull" — is wrong, and expensively
-- so. It flags 522 invoices, $25,194 of September alone. Almost all are alive.
--
-- The reason is that the API's FROMDATE/TODATE filter on CREATION date, not invoice date.
-- Of the invoices DATED in the last 120 days:
--     created inside the window:  2,588 of 2,592 re-returned   (99.8%)
--     created before the window:      1 of   519 re-returned   ( 0.2%)
-- An invoice created in Dec 2025 that bills monthly still produces September invoices, and
-- the rolling window never asks about it again. Its absence says nothing at all.
--
-- So only invoices CREATED inside the window can be judged. On that basis September has
-- exactly one deletion in our services: Hana Lab INV020926192824_2, $1,002, Draft, created
-- 3 Sep, dated 28 Sep, which vanished between the 04:55 and 18:56 runs on 30 Sep. It was
-- sitting in the reconciliation gap.
--
-- This also means deletions of invoices created more than 120 days ago are INVISIBLE to
-- us. The real fix is IsDeleted on GetInvoices; this is the best that can be done without
-- it, and it is inference, not a report.
--
-- ---------------------------------------------------------------------------
-- WHY THE CAP
--
-- A sync that dies halfway looks exactly like a mass deletion, and this would then quietly
-- delete the month. Real deletions come a handful at a time, so anything larger is treated
-- as a broken run, refused, and written to sync_runs as a failure. Un-deleting is
-- automatic and unconditional: an invoice that comes back is not deleted, and a wrong
-- delete hides real money, which is worse than a wrong keep.
-- ---------------------------------------------------------------------------

alter table quote_api_invoices add column if not exists deleted_at timestamptz;
create index if not exists quote_api_invoices_deleted on quote_api_invoices(deleted_at);

comment on column quote_api_invoices.deleted_at is
  'Set when the invoice stopped being returned by GetInvoices while still inside the pull window — i.e. it was deleted in the invoice app. INFERRED, not reported: the invoice payload carries no IsDeleted field. Cleared automatically if the invoice comes back.';

create or replace function public.mark_deleted_invoices(p_window_days int default 120)
returns int
language plpgsql security definer set search_path = public as $$
declare
  run_at   timestamptz;
  in_win   int;
  gone     int;
  cap      int;
begin
  select max(synced_at) into run_at from quote_api_invoices;
  if run_at is null then return 0; end if;

  select count(*) into in_win from quote_api_invoices
   where created_at >= run_at - (p_window_days || ' days')::interval;

  select count(*) into gone from quote_api_invoices
   where created_at >= run_at - (p_window_days || ' days')::interval
     and synced_at  <  run_at - interval '10 minutes'
     and deleted_at is null;

  cap := greatest(25, (in_win * 0.02)::int);
  if gone > cap then
    insert into sync_runs (source, ok, rows_upserted, message)
    values ('mark-deleted-invoices', false, 0,
            gone || ' invoices missing from the last pull, over the cap of ' || cap ||
            ' — treated as a failed sync, nothing marked');
    return -gone;
  end if;

  update quote_api_invoices
     set deleted_at = run_at
   where created_at >= run_at - (p_window_days || ' days')::interval
     and synced_at  <  run_at - interval '10 minutes'
     and deleted_at is null;

  update quote_api_invoices
     set deleted_at = null
   where deleted_at is not null
     and synced_at >= run_at - interval '10 minutes';

  insert into sync_runs (source, ok, rows_upserted, message)
  values ('mark-deleted-invoices', true, gone,
          gone || ' marked deleted of ' || in_win || ' in the creation window');
  return gone;
end $$;
revoke execute on function public.mark_deleted_invoices(int) from public, anon, authenticated;

-- :55 sync → :56 mark → :57 refresh, so the matviews are rebuilt from the marked state.
select cron.schedule('mark-deleted-invoices', '56 * * * *',
  $$select public.mark_deleted_invoices();$$);

-- Every reader of the mirror. Patched in place rather than retyped: these four views are
-- long, and retyping one to add a WHERE is how a clause goes missing.
do $do$
declare d text;
begin
  -- The invoice is the driving row here, so a deleted one must not appear AT ALL. Putting
  -- the test in the LEFT JOIN instead leaves it present with zero lines, which reads as a
  -- $0 invoice rather than no invoice.
  select pg_get_viewdef('web_invoice_scope'::regclass, true) into d;
  if position('  GROUP BY i.invoice_no' in d) = 0 then raise exception 'scope anchor'; end if;
  execute 'create or replace view web_invoice_scope with (security_invoker = true) as '
       || replace(d, '  GROUP BY i.invoice_no', '  WHERE i.deleted_at IS NULL
  GROUP BY i.invoice_no');

  -- A LEFT JOIN: the test goes in the join condition, or every ledger row without an
  -- invoice would be dropped instead of reading 'Not raised'.
  select pg_get_viewdef('web_project_invoice_status'::regclass, true) into d;
  if position('ON i.project_id = ledger_project_key(l.project_id)' in d) = 0 then raise exception 'status anchor'; end if;
  execute 'create or replace view web_project_invoice_status with (security_invoker = true) as '
       || replace(d, 'ON i.project_id = ledger_project_key(l.project_id)',
                     'ON i.project_id = ledger_project_key(l.project_id) AND i.deleted_at IS NULL');

  select pg_get_viewdef('web_deal_lifecycle'::regclass, true) into d;
  if position('ON q_1.quote_no = i.quote_no' in d) = 0 then raise exception 'lifecycle anchor'; end if;
  execute 'create or replace view web_deal_lifecycle with (security_invoker = true) as '
       || replace(d, 'ON q_1.quote_no = i.quote_no', 'ON q_1.quote_no = i.quote_no
          WHERE i.deleted_at IS NULL');

  select pg_get_viewdef('web_invoice_reconciliation'::regclass, true) into d;
  if position('WHERE quote_api_is_ours(l.service)' in d) = 0 then raise exception 'recon anchor'; end if;
  execute 'create or replace view web_invoice_reconciliation with (security_invoker = true) as '
       || replace(d, 'WHERE quote_api_is_ours(l.service)', 'WHERE quote_api_is_ours(l.service) AND i.deleted_at IS NULL');
end $do$;

-- And the Invoice mapping tab's own reader.
do $do$
declare d text; old text;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname='invoice_mapping';
  old := '    and coalesce(i.status, '''') <> ''Void''';
  if position(old in d) = 0 then raise exception 'mapping anchor'; end if;
  execute replace(d, old, old || '
    and i.deleted_at is null');
end $do$;

select public.mark_deleted_invoices();
select refresh_invoice_sources();
