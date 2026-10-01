-- 122 — the 400-day domain scan runs once a day, not forty-eight times
--
-- Supabase sent a Disk IO Budget depletion alert on 1 Oct 2026. The database is not big
-- (215 MB after migration 121) — it is READ too hard. Over the three days in
-- pg_stat_statements, reconcile_opportunities() read 1,721,917 blocks, about 13.1 GB, far
-- more than anything else on the instance.
--
-- Step 3 of that function was most of it. To decide which sheet opportunities are ALSO
-- live in email, it rebuilt the set of external sender domains from scratch every run:
-- a sequential scan of 42,070 email_inbox rows with four nested regexp/split_part calls
-- on each. Measured on its own: 6,445 buffers and 3.2 seconds, to produce 691 domain
-- labels. That is 54% of the function's IO, paid every 30 minutes by cron AND again on
-- every "Sync now" press, because run_refresh_chain() calls it too.
--
-- A 400-day window of sender domains gains perhaps one entry a day. So it moves out into
-- its own function on a daily cron, and reconcile_opportunities() keeps only the two steps
-- that actually need the half-hourly cadence (value backfill, email-twin merge) — those
-- feed the dedup the project-sheet dump depends on.
--
-- What changes on the pages: nothing, for up to a day. email_tracked drives one thing,
-- the dual-source badge on the Opportunities view (lib/supabase.ts, `source_tags`). A
-- client that starts mailing us today gets its second tag tomorrow morning instead of
-- within the half hour. The badge is not a number anyone totals.

create or replace function public.refresh_email_tracked()
returns integer
language plpgsql
as $function$
declare n integer := 0;
begin
  -- Lifted verbatim out of reconcile_opportunities() step 3. A sheet quote line whose
  -- client is also active in email (company name == external sender domain label) is
  -- tracked from both sources; the view shows both tags.
  --
  -- The scan is the expensive part and it is why this is daily. Do not fold it back into
  -- a half-hourly job without first checking what it costs — see the header above.
  with extdom as (
    select distinct regexp_replace(split_part(lower(split_part(regexp_replace(from_addr,'^.*<|>.*$','','g'),'@',2)),'.',1),'[^a-z0-9]','','g') sld
    from email_inbox
    where has_external and msg_date >= (now() - interval '400 days')
  ),
  doms as (
    select sld from extdom
    where length(sld) >= 5 and sld not in ('gmail','mavlers','uplers','outlook','hotmail','yahoo','googlemail','icloud','proton')
  )
  update opportunities o set email_tracked =
    (regexp_replace(lower(o.company_name),'[^a-z0-9]','','g') in (select sld from doms))
  where o.origin = 'sheet' and coalesce(o.company_name,'') <> '';
  get diagnostics n = row_count;
  return n;
end$function$;

-- Not SECURITY DEFINER, so it carries no rights of its own. But EXECUTE on a new function
-- is granted to PUBLIC by default, and `revoke ... from anon` does NOT undo that — the
-- grant comes from PUBLIC, not from the role. Migration 'revoke_public_execute_on_new_
-- definer_functions' was written after exactly this was missed.
revoke execute on function public.refresh_email_tracked() from public;
revoke execute on function public.refresh_email_tracked() from anon, authenticated;
grant execute on function public.refresh_email_tracked() to service_role;

-- Steps 1 and 2 only. Step 3 now lives in refresh_email_tracked() above.
create or replace function public.reconcile_opportunities()
returns integer
language plpgsql
as $function$
declare n integer := 0;
begin
  -- (1) value backfill: a value-less open opp inherits the client's single distinct quote value
  with resolved as (
    select o.id, coalesce(a.canonical, lower(trim(o.company_name))) rk
    from opportunities o
    left join opp_aliases a on a.alias = lower(trim(o.company_name))
    where o.won is not true
      and lower(coalesce(o.status,'')) not in ('won','lost','on hold')
      and lower(coalesce(o.status,'')) not like 'cancel%'
      and o.est_value is null and coalesce(o.company_name,'')<>''
  ),
  qval as (
    select coalesce(a.canonical, lower(trim(q.agency))) rk,
           count(distinct q.usd_value) filter (where q.usd_value is not null) nvals,
           max(q.usd_value) v
    from quotes q left join opp_aliases a on a.alias = lower(trim(q.agency))
    where coalesce(q.agency,'')<>''
    group by 1
  )
  update opportunities o set est_value = qv.v
  from resolved r
  join qval qv on qv.rk = r.rk and qv.nvals = 1 and qv.v is not null
  where o.id = r.id;
  get diagnostics n = row_count;

  -- (2) MERGE / de-dup email twin into the master sheet row: enrich the sheet row from the
  -- email twin (fill blank AM/PM/geo/type/sender + value if none), carry the thread_id, then
  -- drop the email duplicate. Match on canonical company + same value, OR same first-3 subject words.
  drop table if exists _recon_twins;
  create temp table _recon_twins on commit drop as
    select distinct on (e.id)
      e.id eid, s.id sid, e.thread_id tid,
      e.sales_person e_am, e.pm_owner e_pm, e.geo e_geo,
      e.business_type e_bt, e.source_sender e_sender, e.est_value e_val
    from opportunities e
    join opportunities s
      on s.origin = 'sheet' and e.origin = 'email' and e.id <> s.id
     and coalesce(e.won,false) = false and lower(coalesce(e.status,'')) not in ('won','lost')
     and lower(trim(coalesce(e.company_name,''))) = lower(trim(coalesce(s.company_name,'')))
     and (
       (e.est_value is not null and s.est_value is not null and round(e.est_value) = round(s.est_value))
       or (length(coalesce(e.source_subject,'')) > 8
           and lower(regexp_replace(s.source_subject,'^(re|fwd|fw)\s*:\s*','','i'))
               like '%' || lower(substring(regexp_replace(e.source_subject,'^(re|fwd|fw)\s*:\s*','','i') from '^(?:\S+\s+){2}\S+')) || '%')
     )
    order by e.id, s.id;

  update opportunities s set
    sales_person  = coalesce(nullif(trim(s.sales_person),''), t.e_am),
    pm_owner      = coalesce(nullif(trim(s.pm_owner),''), t.e_pm),
    geo           = coalesce(s.geo, t.e_geo),
    business_type = coalesce(s.business_type, t.e_bt),
    source_sender = coalesce(s.source_sender, t.e_sender),
    est_value     = coalesce(s.est_value, t.e_val)
  from _recon_twins t
  where s.id = t.sid;

  delete from opportunities where id in (select eid from _recon_twins);

  update opportunities s set thread_id = tp.tid
  from (select distinct on (sid) sid, tid from _recon_twins where tid is not null order by sid, eid) tp
  where s.id = tp.sid and coalesce(nullif(trim(s.thread_id),''),'') = '';

  -- (3) was here. It is public.refresh_email_tracked(), on cron 'refresh-email-tracked'
  -- at 04:35 daily. Moved 1 Oct 2026 for the Disk IO budget.

  return n;
end$function$;

-- Cadence, same alert, same reasoning: these were reading more than their inputs change.
-- meeting_reports_mv + client_meetings_mv were refreshing hourly for 5.0 GB over three
-- days; a handful of notetaker reports arrive a day. refresh_invoice_sources was running
-- four times an hour for 4.9 GB, matched to quote-api-sync, which is more often than the
-- invoice app is exported. Applied 1 Oct 2026:
--   select cron.alter_job(13, schedule := '46 */4 * * *');   -- refresh-qbr-sources
--   select cron.alter_job(17, schedule := '5,35 * * * *');   -- refresh-invoice-sources

-- And the new function needs its own job, once the split above is in:
--   select cron.schedule('refresh-email-tracked', '35 4 * * *',
--                        'select public.refresh_email_tracked();');

-- Tried and REJECTED, recorded so nobody tries it again: a covering index
-- (msg_date, from_addr) where has_external. The planner would not take it — the scan reads
-- 42,070 of 46,481 rows, so a seq scan genuinely is cheaper. Forced with enable_seqscan=off
-- it chose idx_email_inbox_has_external and still read 6,402 buffers against the seq scan's
-- 6,445, because an Index Scan visits every heap page anyway. There is no index answer to
-- this query. The only fix is to stop running it 48 times a day.
