-- The chain looks for cross-sells too
--
-- 179 built the finder; this is what makes "every single refresh" true. The candidate
-- scan goes LAST in the chain and inside its own exception block, because it is the only
-- step that is merely useful: the clients, the sentiment and the sheet reconciliation are
-- what the dashboard is for, and a timeout hunting for cross-sells must never cost them.
-- If it fails, the chain reports it in the result and everything else still lands.
--
-- The 18 seconds it takes sit inside the chain's existing 180s ceiling and under the same
-- advisory lock, so two refreshes still cannot interleave.
--
-- The body below is 'the_heartbeat'-era run_refresh_chain unchanged, plus the block
-- marked "Last, and allowed to fail" and the two keys it adds to the result.

create or replace function public.run_refresh_chain()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  t0 timestamptz := clock_timestamp();
  v_synced integer;
  v_reconciled integer;
  v_drift jsonb;
  v_renames jsonb;
  v_clients integer;
  v_at_risk integer;
  v_candidates integer;
  v_candidate_error text := null;
begin
  -- A ceiling, not a licence: see the migration comment above. The role's timeout is what
  -- lets the chain run past 8s; this keeps it from running past three minutes.
  set local statement_timeout = '180s';

  -- One lock for the whole chain. sync-all already refuses to start twice inside a
  -- minute, but cron and a button press can still meet, and two chains interleaving
  -- would have rebuild_clients() deleting rows the other is reading.
  perform pg_advisory_xact_lock(hashtext('refresh_chain'));

  v_synced := public.sync_quotes_to_opportunities();
  v_reconciled := public.reconcile_opportunities();

  select to_jsonb(d) into v_drift from public.reconcile_sheet_drift() d;
  select jsonb_agg(to_jsonb(c)) into v_renames from public.canonicalise_client_names() c;

  -- These two are inseparable. rebuild_clients() deletes every client row and does not set
  -- sentiment, so if only the first runs the board shows zero At Risk clients — a silent
  -- wrong answer. One function body is one transaction, so they cannot come apart.
  perform public.rebuild_clients();
  perform public.compute_client_sentiment();

  select count(*), count(*) filter (where sentiment = 'At Risk')
    into v_clients, v_at_risk from public.clients;

  -- Last, and allowed to fail. See the header.
  begin
    perform public.refresh_cross_sell_candidates();
    select count(*) into v_candidates from public.cross_sell_candidates;
  exception when others then
    v_candidate_error := sqlerrm;
  end;

  return jsonb_build_object(
    'quotes_synced', v_synced,
    'opportunities_reconciled', v_reconciled,
    'sheet_drift', v_drift,
    'client_renames', coalesce(v_renames, '[]'::jsonb),
    'clients', v_clients,
    'at_risk', v_at_risk,
    'sentiment_suspect', (v_clients > 0 and v_at_risk = 0),
    'cross_sell_candidates', v_candidates,
    'cross_sell_error', v_candidate_error,
    'ms', round(extract(epoch from (clock_timestamp() - t0)) * 1000)
  );
end;
$function$;
