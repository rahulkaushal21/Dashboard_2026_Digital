-- The Web lead's three KPIs
--
-- Rahul Kaushal runs Web. His scorecard is not a PM scorecard — no deal carries his name
-- — it is the Web PM team's work read three ways. Defined once here so the page renders
-- an answer rather than recomputing the definitions in TypeScript.
--
-- WEB PM means the nine on pm_directory whose team starts WEB. LP/HUB (Madhav, Nitin,
-- Pratik) are a different business and are excluded everywhere below, including from NBD:
-- a new-business deal that lands on an LP PM is not this team's conversion.
--
-- NBD = an opportunity introduced by one of the three new-business people (Malav Modi,
-- Dhruti Dave, Nevilson Christian), whatever the project type. Booked means won.
--
-- REPEAT = New Development only, from an account manager who is NOT one of those three.
-- Project type, NOT business_type: business_type marks new client vs repeat client and is
-- unfilled on 22% of October. This is the same definition the PM Q2C tab already uses.
--
-- MATCH THE AM ON ALIASES, never the bare name. 16 quotes sit under 'Vikram Sahi',
-- 'Kalgi Shah / Vikram Sahi' and 'kamesh Biniwale' — spellings am_directory does not hold
-- verbatim. Matching on name alone dropped them from Repeat silently.
--
-- THE HEADLINE IS % OF RAISED (won ÷ everything raised), chosen by Rahul on 18 Nov 2026.
-- Of-decided is carried alongside because on a 6-quote quarter one loss moves it 50 points
-- and the two together say more than either alone.

create or replace view public.web_lead_kpis as
with webpm as (select name from public.pm_directory where active and team like 'WEB%'),
nbd(n) as (values ('malav modi'), ('dhruti dave'), ('nevilson christian')),
amname as (
  select distinct lower(btrim(x)) nm
  from public.am_directory a, lateral unnest(array[a.name] || coalesce(a.aliases, '{}')) x
  where a.active
),
q(qkey, qlabel, qfrom, qto) as (
  values
    ('2025Q1','FY25-26 Q1 Apr-Jun 25', date '2025-04-01', date '2025-07-01'),
    ('2025Q2','FY25-26 Q2 Jul-Sep 25', date '2025-07-01', date '2025-10-01'),
    ('2025Q3','FY25-26 Q3 Oct-Dec 25', date '2025-10-01', date '2026-01-01'),
    ('2025Q4','FY25-26 Q4 Jan-Mar 26', date '2026-01-01', date '2026-04-01'),
    ('2026Q1','FY26-27 Q1 Apr-Jun 26', date '2026-04-01', date '2026-07-01'),
    ('2026Q2','FY26-27 Q2 Jul-Sep 26', date '2026-07-01', date '2026-10-01'),
    ('2026Q3','FY26-27 Q3 Oct-Dec 26', date '2026-10-01', date '2027-01-01'),
    ('2026Q4','FY26-27 Q4 Jan-Mar 27', date '2027-01-01', date '2027-04-01')
),
o as (
  select o.*,
    case
      when lower(btrim(o.sales_person)) in (select n from nbd) then 'nbd'
      when lower(btrim(o.sales_person)) in (select nm from amname)
        or lower(btrim(o.sales_person)) like '%vikram%'
        or lower(btrim(o.sales_person)) like '%kalgi%' then 'am'
      else 'unmatched'
    end as who
  from public.opportunities o
  where o.pm_owner in (select name from webpm)
    and o.merged_into is null and o.rolled_into is null
),
won as (select id from public.opportunities where won or email_won),
lost as (
  select id from public.opportunities
   where email_lost or lower(coalesce(status,'')) = 'lost' or lower(coalesce(status,'')) like '%cancel%'
),
deals as (
  select q.qkey, q.qlabel, o.who, o.project_type, o.est_value,
         (o.id in (select id from won)) is_won,
         (o.id in (select id from lost)) is_lost
  from q join o on o.source_date >= q.qfrom and o.source_date < q.qto
),
rev as (
  select q.qkey, round(sum(l.amount_usd), 0) web_usd
  from q join public.web_project_ledger l
    on l.booking_month >= q.qfrom and l.booking_month < q.qto
  where upper(l.service_dept) like 'WEB%' or upper(l.service_dept) like 'AI%'
  group by q.qkey
)
select
  q.qkey, q.qlabel, q.qfrom as quarter_start,
  count(*) filter (where d.who = 'nbd')                        as nbd_quotes,
  count(*) filter (where d.who = 'nbd' and d.is_won)           as nbd_booked,
  count(*) filter (where d.who = 'nbd' and d.is_lost)          as nbd_lost,
  count(*) filter (where d.who = 'nbd' and not d.is_won and not d.is_lost) as nbd_open,
  round(100.0 * count(*) filter (where d.who = 'nbd' and d.is_won)
        / nullif(count(*) filter (where d.who = 'nbd'), 0), 1) as nbd_pct_raised,
  round(100.0 * count(*) filter (where d.who = 'nbd' and d.is_won)
        / nullif(count(*) filter (where d.who = 'nbd' and (d.is_won or d.is_lost)), 0), 1) as nbd_pct_decided,
  round(sum(d.est_value) filter (where d.who = 'nbd'), 0)              as nbd_quoted_usd,
  round(sum(d.est_value) filter (where d.who = 'nbd' and d.is_won), 0) as nbd_booked_usd,
  count(*) filter (where d.who = 'am' and d.project_type ilike '%new%')              as rep_quotes,
  count(*) filter (where d.who = 'am' and d.project_type ilike '%new%' and d.is_won) as rep_won,
  count(*) filter (where d.who = 'am' and d.project_type ilike '%new%' and d.is_lost) as rep_lost,
  count(*) filter (where d.who = 'am' and d.project_type ilike '%new%'
                     and not d.is_won and not d.is_lost)                             as rep_open,
  round(100.0 * count(*) filter (where d.who = 'am' and d.project_type ilike '%new%' and d.is_won)
        / nullif(count(*) filter (where d.who = 'am' and d.project_type ilike '%new%'), 0), 1) as rep_pct_raised,
  round(100.0 * count(*) filter (where d.who = 'am' and d.project_type ilike '%new%' and d.is_won)
        / nullif(count(*) filter (where d.who = 'am' and d.project_type ilike '%new%'
                                    and (d.is_won or d.is_lost)), 0), 1) as rep_pct_decided,
  round(sum(d.est_value) filter (where d.who = 'am' and d.project_type ilike '%new%'), 0) as rep_quoted_usd,
  round(sum(d.est_value) filter (where d.who = 'am' and d.project_type ilike '%new%' and d.is_won), 0) as rep_won_usd,
  -- An AM spelling nothing recognises. Should be zero; if it is not, Repeat is understated.
  count(*) filter (where d.who = 'unmatched' and d.project_type ilike '%new%') as rep_unmatched,
  r.web_usd
from q
left join deals d on d.qkey = q.qkey
left join rev r on r.qkey = q.qkey
group by q.qkey, q.qlabel, q.qfrom, r.web_usd
order by q.qfrom;

comment on view public.web_lead_kpis is
  'The Web lead scorecard, one row per financial quarter: NBD conversion (the three new-business AMs), Repeat conversion (New Development from account managers) and Web revenue for growth. Web PMs only - LP/HUB excluded. See migration 183.';

revoke all on public.web_lead_kpis from anon, public;
grant select on public.web_lead_kpis to authenticated;
