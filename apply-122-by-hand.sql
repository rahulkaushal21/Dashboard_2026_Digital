-- RUN STATEMENT 1 ON ITS OWN, THEN 2 AND 3.
-- "drop index concurrently" cannot run inside a transaction block, and the Supabase SQL
-- editor wraps a multi-statement selection in one. Select just the drop, run it, then
-- select the rest.

-- Paste this into the Supabase SQL editor. Two statements the MCP write guard refused.

-- 1) Drop the index that turned out not to help.
drop index concurrently if exists public.idx_email_inbox_extdom;

-- 2) reconcile_opportunities() without step 3. Identical to what is live today except the
--    final `update opportunities o set email_tracked = ...` block is gone; that now lives
--    in public.refresh_email_tracked(), which is already created.
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

-- 3) Only after step 2 succeeds: give the new function its daily slot.
select cron.schedule('refresh-email-tracked', '35 4 * * *',
                     'select public.refresh_email_tracked();');
