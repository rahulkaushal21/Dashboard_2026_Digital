-- Paste this into the Supabase SQL editor in one go.
--
-- Why it is not in a migration run from here: the MCP connection declines any statement
-- containing DELETE, and this function carries three janitor deletes in its body, so
-- `create or replace` on it is refused. See 147 for the full story.
--
-- It is SAFE TO RUN LATE. The trigger from 147 already stops the damage this prevents;
-- this replaces the net with a proper floor, and additionally stops the janitors from
-- deleting a confirmed deal.
--
-- Changed from the live version, and nothing else:
--   * on conflict — source_subject, est_value, won_amount, won, status and rfq_status
--     are left alone when o.confirmed_by is not null; win_probability, next_step,
--     summary and gist gain the same guard alongside the existing `enriched` one.
--   * each of the three janitor deletes gains `and a.confirmed_by is null`.
--
-- Verify afterwards with:
--   select count(*) from public.opportunities
--    where confirmed_by is not null and rolled_into is null
--      and (coalesce(won,false) = false or lower(coalesce(status,'')) <> 'won');
--   -- expect 0, now and after any "Sync now"

create or replace function public.sync_quotes_to_opportunities()
returns integer
language plpgsql
as $function$
declare n integer;
begin
  with q as (
    select distinct on (qkey) qkey, quote_id, added_date, agency, subject_project, usd_value, status, geo,
      sales_person, pc_sme, technology, project_type, notes, business_type
    from (
      select
        coalesce(
          nullif(quote_id,''),
          case when src_row_hash ~ '^Q:[^:]*:[0-9]+$' then 'r:'||split_part(src_row_hash,':',3)
               else nullif(src_row_hash,'') end,
          md5(coalesce(agency,'')||coalesce(subject_project,'')||coalesce(added_date::text,'')||id::text)
        ) as qkey,
        quote_id, added_date, agency, subject_project, usd_value, status, geo,
        sales_person, pc_sme, technology, project_type, notes, business_type, id
      from quotes
    ) z
    order by qkey, added_date desc nulls last, id desc
  ),
  mapped as (
    select qkey, quote_id, added_date, agency, subject_project, usd_value, geo,
      sales_person, pc_sme, technology, notes,
      nullif(nullif(trim(business_type),''),'Business Type') as business_type,
      coalesce(
        nullif(trim(agency),''),
        nullif(trim(regexp_replace(
          case
            when position('<>' in coalesce(subject_project,'')) > 0 then split_part(subject_project,'<>',1)
            when position('|'  in coalesce(subject_project,'')) > 0 then split_part(subject_project,'|',1)
            when position(' - ' in coalesce(subject_project,'')) > 0 then split_part(subject_project,' - ',1)
            else coalesce(subject_project,'')
          end,
          '^(re|fwd|fw)\s*:\s*', '', 'i')), '')
      ) as comp,
      coalesce(status,'') as status,
      -- HARD RULE: no quoted value -> no win% (a pre-quote/value-less line has no probability).
      case
        when lower(coalesce(status,''))='confirmed' then 100
        when lower(coalesce(status,'')) like 'cancel%' then 0
        when usd_value is null or usd_value = 0 then null
        else case lower(coalesce(status,''))
          when 'waiting for final approval' then 80 when 'quote shared' then 45
          when 'waiting for details' then 30 when 'on hold' then 25 else 40 end
      end as pct,
      case
        when lower(coalesce(status,''))='confirmed' then 'Won'
        when lower(coalesce(status,'')) like 'cancel%' then 'Lost'
        when lower(coalesce(status,''))='on hold' then 'On Hold' else 'Open' end as st_bucket,
      case lower(coalesce(status,''))
        when 'confirmed' then 'Won — confirm kickoff/delivery is scheduled and booked to revenue.'
        when 'cancelled' then 'Lost — capture the reason and nurture the agency for future work.'
        when 'waiting for final approval' then 'Push for final sign-off — deal is one approval from closing.'
        when 'quote shared' then 'Follow up with the AM/client for a decision on the shared quote.'
        when 'waiting for details' then 'Chase the client for the missing details needed to finalise scope/price.'
        when 'on hold' then 'Re-engage the client to revive this on-hold opportunity.'
        else 'Clarify status with the AM and define the next action.' end as nstep
    from q
  )
  insert into opportunities as o
    (quote_key, origin, company_name, source_subject, source_date, first_date,
     est_value, won_amount, won, status, rfq, rfq_status, win_probability, geo,
     sales_person, pm_owner, technology, business_type, next_step, summary, gist)
  select
    qkey, 'sheet',
    coalesce((select ca.canonical from client_aliases ca where ca.kind='name' and lower(ca.pattern)=lower(comp) limit 1), comp),
    subject_project, added_date, added_date,
    usd_value,
    case when lower(status)='confirmed' then usd_value else null end,
    lower(status)='confirmed', st_bucket, true,
    case when lower(status)='confirmed' then 'won' when lower(status) like 'cancel%' then 'lost' else 'quoted' end,
    pct, geo, sales_person, pc_sme, technology, business_type, nstep,
    left(coalesce(status,'Open')||' · '||coalesce(comp,'—')||
      case when usd_value is not null then ' · $'||round(usd_value)::text else '' end, 300),
    trim(both e'\n' from
      coalesce(status,'Open')||case when usd_value is not null then ' — quote $'||round(usd_value)::text else '' end||
      case when pct is not null and pct not in (0,100) then ' (~'||pct||'% to confirm)' else '' end||e'\n'||
      'Client: '||coalesce(comp,'unknown')||'. '||
      coalesce(technology,'')||case when subject_project is not null then ' · Subject: "'||subject_project||'"' else '' end||e'\n'||
      'AM: '||coalesce(sales_person,'—')||' · PC: '||coalesce(pc_sme,'—')||
      case when geo is not null then ' · GEO: '||geo else '' end||
      case when notes is not null and notes<>'' then e'\nNotes: '||notes else '' end||e'\n'||
      'Next: '||nstep)
  from mapped
  on conflict (quote_key) do update set
    company_name = coalesce(excluded.company_name, o.company_name),
    -- A CONFIRMATION MADE IN THE DASHBOARD OUTRANKS THE QUOTES SNAPSHOT.
    -- These six were written unconditionally, which reset a deal a PM had confirmed
    -- back to whatever the Quotes tab still said — "Quote Shared" for any quote nobody
    -- updated there. confirmed_by/confirmed_at were never written, so the row ended up
    -- half-confirmed: on the Opportunities board AND out of web_project_ledger.
    source_subject  = case when o.confirmed_by is not null then o.source_subject  else excluded.source_subject end,
    est_value       = case when o.confirmed_by is not null then o.est_value       else excluded.est_value end,
    won_amount      = case when o.confirmed_by is not null then o.won_amount      else excluded.won_amount end,
    won             = case when o.confirmed_by is not null then o.won             else excluded.won end,
    status          = case when o.confirmed_by is not null then o.status          else excluded.status end,
    rfq_status      = case when o.confirmed_by is not null then o.rfq_status      else excluded.rfq_status end,
    source_date = coalesce(o.source_date, excluded.source_date),
    first_date  = coalesce(o.first_date,  excluded.first_date),
    geo = coalesce(excluded.geo, o.geo),
    sales_person = coalesce(excluded.sales_person, o.sales_person),
    pm_owner = coalesce(excluded.pm_owner, o.pm_owner),
    technology = coalesce(excluded.technology, o.technology),
    business_type = coalesce(excluded.business_type, o.business_type),
    win_probability = case when o.confirmed_by is not null or o.enriched then o.win_probability else excluded.win_probability end,
    next_step       = case when o.confirmed_by is not null or o.enriched then o.next_step       else excluded.next_step end,
    summary         = case when o.confirmed_by is not null or o.enriched then o.summary         else excluded.summary end,
    gist            = case when o.confirmed_by is not null or o.enriched then o.gist            else excluded.gist end;
  get diagnostics n = row_count;

  with owner_src as (
    select k, mode() within group (order by am) am, mode() within group (order by pc) pc
    from (
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(pm_owner),'') pc
        from opportunities where coalesce(company_name,'')<>''
      union all
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(pc_sme),'') pc
        from web_clients where coalesce(company_name,'')<>''
      union all
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(sme),'') pc
        from web_revenue where coalesce(company_name,'')<>''
    ) z group by k
  )
  update opportunities o set
    sales_person = case when coalesce(o.sales_person,'')='' and os.am is not null then os.am else o.sales_person end,
    pm_owner     = case when coalesce(o.pm_owner,'')=''     and os.pc is not null then os.pc else o.pm_owner end
  from owner_src os
  where os.k = lower(trim(o.company_name))
    and ((coalesce(o.sales_person,'')='' and os.am is not null) or
         (coalesce(o.pm_owner,'')=''     and os.pc is not null));

  -- JANITOR 1: r: quote line superseded by a QUT twin (value equal OR QUT won).
  -- `a.confirmed_by is null` added: a tidy-up must not delete a confirmed deal, which
  -- would take its revenue with it and leave nothing behind to explain the gap.
  delete from opportunities a using opportunities b
  where a.origin='sheet' and b.origin='sheet' and a.id <> b.id
    and a.quote_key ~ '^r:' and b.quote_key ~ '^QUT'
    and lower(trim(coalesce(a.company_name,''))) = lower(trim(coalesce(b.company_name,'')))
    and coalesce(a.source_subject,'') = coalesce(b.source_subject,'')
    and (coalesce(a.est_value,-1) = coalesce(b.est_value,-1) or b.won = true)
    and coalesce(a.enriched,false) = false
    and a.confirmed_by is null;

  -- JANITOR 2: open line superseded by a Won line (same client+subject+value).
  delete from opportunities a using opportunities b
  where a.origin='sheet' and b.origin='sheet' and a.id <> b.id
    and coalesce(a.won,false) = false and coalesce(a.enriched,false) = false
    and b.won = true
    and lower(trim(coalesce(a.company_name,''))) = lower(trim(coalesce(b.company_name,'')))
    and coalesce(a.source_subject,'') = coalesce(b.source_subject,'')
    and coalesce(a.est_value,-1) = coalesce(b.est_value,-1)
    and a.confirmed_by is null;

  -- JANITOR 3: collapse IDENTICAL sheet twins.
  delete from opportunities a using opportunities b
  where a.origin='sheet' and b.origin='sheet' and a.id <> b.id
    and a.quote_key ~ '^r:[0-9]+$' and b.quote_key ~ '^r:[0-9]+$'
    and lower(trim(coalesce(a.company_name,''))) = lower(trim(coalesce(b.company_name,'')))
    and coalesce(a.source_subject,'') = coalesce(b.source_subject,'') and a.source_subject is not null
    and coalesce(a.est_value,-1) = coalesce(b.est_value,-1)
    and coalesce(a.won,false) = false and coalesce(b.won,false) = false
    and a.confirmed_by is null
    and (
      (coalesce(a.enriched,false) = false and coalesce(b.enriched,false) = true)
      or (coalesce(a.enriched,false) = coalesce(b.enriched,false)
          and split_part(a.quote_key,':',2)::int > split_part(b.quote_key,':',2)::int)
    );

  return n;
end;
$function$;
