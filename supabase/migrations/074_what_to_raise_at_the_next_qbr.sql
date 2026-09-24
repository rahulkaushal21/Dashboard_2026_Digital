-- The QBR agenda, assembled from what the system already knows.
--
-- The review reads every client thread anyway — for opportunities, feedback, escalations
-- and tone. All of it lands in tables nobody opens between quarters. This points that
-- reading at the one meeting where it is worth the most.
--
-- NOTHING HERE IS INVENTED. Every line is a fact already recorded somewhere else — a
-- revenue movement, an escalation nobody closed, a quote sitting undecided, the client's
-- own words — phrased as the thing to say out loud, with the number in it. If a fact is
-- not in the system the point does not appear; there is no model guessing what a client
-- might care about, because a QBR agenda built on a guess is worse than no agenda.
--
-- The lines are deliberately blunt, and ordered so the first is what you open with: an
-- unclosed action from the last review, then an open escalation, then the money. An
-- agenda that avoids the awkward item is the reason the client raises it instead.
--
-- It does NOT write the QBR. What was agreed on a call lives in the recording, and
-- client_qbr stays typed by whoever ran it. This is the prep, not the minutes.
--
-- Fiscal quarters need no shifting: the year starts 1 April, so Apr-Jun, Jul-Sep,
-- Oct-Dec and Jan-Mar are exactly date_trunc('quarter'). Only the labels differ.
--
-- The cross-sell line reads `technology` (Wordpress, Shopify, Hubspot), NOT
-- `service_name` — that column holds the business unit, so "100% of their spend is
-- WEB-US" is a fact about our org chart and not something to take to a client.

drop view if exists public.web_qbr_brief;
create view public.web_qbr_brief with (security_invoker = true) as
with bounds as (
  select date_trunc('quarter', current_date)::date                              as q_start,
         (date_trunc('quarter', current_date) - interval '3 months')::date      as p_start,
         (date_trunc('quarter', current_date) - interval '1 day')::date         as p_end
),
rev as (
  select lower(btrim(l.company_name)) as client_key,
         sum(l.booking_amount) filter (where l.booking_month >= b.q_start)                                as rev_q,
         sum(l.booking_amount) filter (where l.booking_month >= b.p_start and l.booking_month <= b.p_end) as rev_prev,
         sum(l.booking_amount)                                                                            as rev_life,
         count(*) filter (where l.booking_month >= b.q_start)                                             as jobs_q
    from public.web_revenue_lines l cross join bounds b
   where coalesce(btrim(l.company_name),'') <> ''
   group by 1
),
mix as (
  select client_key, tech, amt,
         row_number() over (partition by client_key order by amt desc) as rn,
         sum(amt) over (partition by client_key)                       as total
    from (
      select lower(btrim(l.company_name)) as client_key,
             coalesce(nullif(btrim(l.technology),''),'unspecified work') as tech,
             sum(l.booking_amount) as amt
        from public.web_revenue_lines l
       group by 1,2
    ) x
),
open_deals as (
  select lower(btrim(o.company_name)) as client_key,
         count(*)                                                          as open_n,
         sum(coalesce(o.est_value,0))                                      as open_usd,
         count(*) filter (where o.est_value is null)                       as open_unpriced,
         max((current_date - coalesce(o.source_date, o.first_date)::date)) as oldest_days
    from public.opportunities o
   where not coalesce(o.won,false) and not coalesce(o.email_won,false)
     and coalesce(o.status,'') !~* 'lost|cancel'
     and o.rolled_into is null
     and coalesce(btrim(o.company_name),'') <> ''
   group by 1
),
esc as (
  select lower(btrim(e.company_name)) as client_key, count(*) as esc_q
    from public.escalations e cross join bounds b
   where coalesce(e.source_date, e.tracking_date)::date >= b.p_start
   group by 1
),
crit as (
  select lower(btrim(c.company_name)) as client_key,
         count(*) filter (where coalesce(c.status,'') !~* 'fixed|resolved|positive') as crit_open,
         min(c.first_flagged_date)::date                                             as crit_since,
         (array_agg(c.escalation_summary order by c.first_flagged_date desc))[1]     as crit_latest
    from public.critical_escalations c
   where not coalesce(c.dismissed,false)
   group by 1
),
praise as (
  select client_key, quote, at from (
    select lower(btrim(f.company_name)) as client_key, f.quote, f.at,
           row_number() over (partition by lower(btrim(f.company_name)) order by f.at desc) rn
      from public.web_real_feedback f cross join bounds b
     where coalesce(btrim(f.quote),'') <> '' and f.at::date >= b.p_start
  ) y where rn = 1
),
tone as (
  select lower(btrim(s.company_name)) as client_key,
         count(*) filter (where s.sentiment ilike 'negative' or s.sentiment ilike 'at risk') as neg_n,
         count(*) filter (where s.sentiment ilike 'positive')                                as pos_n,
         max(s.source_date)::date                                                            as last_touch
    from public.email_signals s cross join bounds b
   where s.source_date::date >= b.p_start
   group by 1
),
lastqbr as (
  select client_key, qbr_date, action_mavlers, action_client from (
    select q.client_key, q.qbr_date, q.action_mavlers, q.action_client,
           row_number() over (partition by q.client_key order by q.qbr_date desc) rn
      from public.client_qbr q
  ) z where rn = 1
),
keys as (
  select client_key from rev
  union select client_key from open_deals
  union select client_key from esc
  union select client_key from crit
  union select client_key from praise
  union select client_key from tone
  union select client_key from lastqbr
)
select
  k.client_key,
  coalesce(round(r.rev_q), 0)::numeric    as revenue_this_quarter,
  coalesce(round(r.rev_prev), 0)::numeric as revenue_last_quarter,
  coalesce(round(r.rev_life), 0)::numeric as revenue_lifetime,
  coalesce(r.jobs_q, 0)                   as jobs_this_quarter,
  coalesce(d.open_n, 0)                   as open_deals,
  coalesce(round(d.open_usd), 0)::numeric as open_value,
  coalesce(d.open_unpriced, 0)            as open_unpriced,
  d.oldest_days                           as oldest_open_days,
  coalesce(e.esc_q, 0)                    as escalations_recent,
  coalesce(c.crit_open, 0)                as escalations_open,
  c.crit_since                            as escalation_since,
  p.quote                                 as best_words,
  p.at::date                              as best_words_at,
  coalesce(t.neg_n, 0)                    as negative_signals,
  coalesce(t.pos_n, 0)                    as positive_signals,
  t.last_touch                            as last_client_contact,
  m.tech                                  as main_technology,
  case when m.total > 0 then round(100.0 * m.amt / m.total) else null end as main_technology_pct,
  q.qbr_date                              as last_qbr,
  (
    select array_agg(txt order by ord)
    from (
      select 0 as ord, 'Last QBR on ' || to_char(q.qbr_date,'DD Mon YYYY') ||
             ' left this open on our side: ' || left(q.action_mavlers, 200) ||
             ' - close it or explain it before anything else.' as txt
       where coalesce(btrim(q.action_mavlers),'') <> ''
      union all
      select 1, 'Open escalation since ' || to_char(c.crit_since,'DD Mon') ||
             ' - lead with it rather than waiting to be asked. Latest: ' || left(coalesce(c.crit_latest,''), 180)
       where coalesce(c.crit_open,0) > 0 and c.crit_since is not null
      union all
      select 2, 'Spend is down ' || round(100.0 * (r.rev_prev - r.rev_q) / nullif(r.rev_prev,0)) ||
             '% on last quarter ($' || to_char(round(r.rev_prev),'FM999,999,999') || ' to $' ||
             to_char(round(r.rev_q),'FM999,999,999') || ') - ask what changed on their side.'
       where coalesce(r.rev_prev,0) > 0 and coalesce(r.rev_q,0) < r.rev_prev * 0.75
      union all
      select 3, 'Spend is up ' || round(100.0 * (r.rev_q - r.rev_prev) / nullif(r.rev_prev,0)) ||
             '% on last quarter - say it out loud and ask what is driving it.'
       where coalesce(r.rev_prev,0) > 0 and coalesce(r.rev_q,0) > r.rev_prev * 1.25
      union all
      select 4, '$' || to_char(round(d.open_usd),'FM999,999,999') || ' still undecided across ' ||
             d.open_n || ' quote' || case when d.open_n = 1 then '' else 's' end ||
             ', oldest ' || d.oldest_days || ' days - ask for a decision in the room.'
       where coalesce(d.open_usd,0) > 0 and coalesce(d.oldest_days,0) >= 21
      union all
      select 5, d.open_unpriced || ' open request' || case when d.open_unpriced = 1 then '' else 's' end ||
             ' with no number on ' || case when d.open_unpriced = 1 then 'it' else 'them' end ||
             ' - either price or drop.'
       where coalesce(d.open_unpriced,0) > 0
      union all
      select 6, 'Worth repeating back to them - feedback logged ' || to_char(p.at,'DD Mon') || ': ' ||
             left(p.quote, 180) || ' Ask for the referral or the case study.'
       where p.quote is not null
      union all
      select 7, 'No contact logged in ' || (current_date - t.last_touch) ||
             ' days - this is a relationship review, not a project one.'
       where t.last_touch is not null and current_date - t.last_touch >= 45
      union all
      select 8, 'Everything they buy is ' || m.tech || ' (' || round(100.0 * m.amt / nullif(m.total,0)) ||
             '% of spend) - nothing else has landed. Take one adjacent service to the meeting.'
       where m.total > 0 and m.amt / nullif(m.total,0) >= 0.8 and coalesce(r.rev_life,0) > 0
      union all
      select 9, t.neg_n || ' negative signals this quarter against ' || t.pos_n ||
             ' positive - the tone is the agenda.'
       where coalesce(t.neg_n,0) >= 2 and coalesce(t.neg_n,0) > coalesce(t.pos_n,0)
      union all
      select 10, 'No QBR has ever been recorded for this client.'
       where q.qbr_date is null and coalesce(r.rev_life,0) >= 5000
    ) pts
  ) as talking_points
from keys k
left join rev        r on r.client_key = k.client_key
left join open_deals d on d.client_key = k.client_key
left join esc        e on e.client_key = k.client_key
left join crit       c on c.client_key = k.client_key
left join praise     p on p.client_key = k.client_key
left join tone       t on t.client_key = k.client_key
left join lastqbr    q on q.client_key = k.client_key
left join mix        m on m.client_key = k.client_key and m.rn = 1;

revoke all on public.web_qbr_brief from public, anon, authenticated;
grant select on public.web_qbr_brief to anon, authenticated;
