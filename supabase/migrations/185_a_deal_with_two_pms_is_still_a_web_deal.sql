-- Who counts as a Web PM on an opportunity
--
-- eMetabolic's two quotes were nowhere on the lead scorecard. They sit under
-- pm_owner 'Rahul Kaushal', and migration 183 scoped the view with
-- `pm_owner in (select name from pm_directory where team like 'WEB%')` - an exact match
-- on the full directory name. Three different things fell through that test:
--
--   1. THE LEAD HIMSELF. Rahul Kaushal runs Web and is not on pm_directory as a PM, so
--      every deal he carries personally vanished from his own scorecard. Seven rows.
--   2. ALIASES. The directory already holds them - 'paryusha' for Paryusha Jain - and the
--      exact-name test ignored every one. Telfer Digital's two quotes, booked to
--      'Paryusha', were dropped.
--   3. TWO NAMES IN ONE FIELD. 'Rahul Kaushal, Krunal', 'Krunal, Rahul Kaushal',
--      'Rahul Kaushal, Afzal Multani'. A deal shared with someone outside the team is
--      still a Web deal; matching the whole string against one name found none of them.
--
-- SO THE FIELD IS SPLIT ON COMMAS AND SLASHES AND EACH PART MATCHED WHOLE against the
-- Web PMs' names and aliases, plus the lead's own name. Whole parts, never substrings:
-- 'Rahul Kaushal' must never match Rahul Jain or Rahul Kumar, who are different people
-- with different numbers. Three Kaustubhs and two Rahuls is why.
--
-- WHAT IT RECOVERS, FY26-27: ten opportunities. NBD Q1 9 clients -> 10 (Jaze Systems,
-- Malav, still open), Q2 13 -> 14 (eMetabolic, two quotes, one client, still open).
-- Repeat does not move: none of the ten is New Development from an account manager.
-- Rates: Q1 33.3% -> 30.0%, Q2 23.1% -> 21.4%, Q3 16.7% unchanged.
--
-- THE LEAD IS IN THE SCOPE, NOT IN THE DIRECTORY. Adding him to pm_directory would put
-- him in the PM roster, the per-PM pages and every PM aggregate as a tenth Web PM. He is
-- the lead, not a tenth PM, so his name is named here and only here.
--
-- Everything else is migrations 183 and 184: NBD = the three new-business people counted
-- once per client, Repeat = New Development from an account manager, LP/HUB excluded.

create or replace view public.web_lead_kpis as
with webpm as (
  -- Every spelling that means a Web PM, plus the lead. Lowercased and trimmed.
  select distinct lower(btrim(x)) nm
  from public.pm_directory d, lateral unnest(array[d.name] || coalesce(d.aliases, '{}')) x
  where d.active and d.team like 'WEB%'
  union
  select 'rahul kaushal'
),
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
  where exists (
          select 1 from regexp_split_to_table(coalesce(o.pm_owner, ''), '\s*[,/&]+\s*') part
           where lower(btrim(part)) in (select nm from webpm))
    and o.merged_into is null and o.rolled_into is null
),
won as (select id from public.opportunities where won or email_won),
lost as (
  select id from public.opportunities
   where email_lost or lower(coalesce(status,'')) = 'lost' or lower(coalesce(status,'')) like '%cancel%'
),
deals as (
  select q.qkey, q.qlabel, o.who, o.project_type, o.est_value,
         lower(btrim(coalesce(nullif(btrim(o.company_name), ''), 'id:' || o.id))) as client_key,
         (o.id in (select id from won)) is_won,
         (o.id in (select id from lost)) is_lost
  from q join o on o.source_date >= q.qfrom and o.source_date < q.qto
),
-- One row per NBD prospect per quarter. Won beats lost beats open. See migration 184.
nbd_clients as (
  select qkey, client_key,
         bool_or(is_won) is_won,
         bool_or(is_lost) and not bool_or(is_won) as is_lost
  from deals where who = 'nbd'
  group by qkey, client_key
),
nbd_agg as (
  select qkey,
    count(*)                                                  as nbd_quotes,
    count(*) filter (where is_won)                            as nbd_booked,
    count(*) filter (where is_lost)                           as nbd_lost,
    count(*) filter (where not is_won and not is_lost)        as nbd_open,
    round(100.0 * count(*) filter (where is_won)
          / nullif(count(*), 0), 1)                           as nbd_pct_raised,
    round(100.0 * count(*) filter (where is_won)
          / nullif(count(*) filter (where is_won or is_lost), 0), 1) as nbd_pct_decided
  from nbd_clients group by qkey
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
  coalesce(n.nbd_quotes, 0)  as nbd_quotes,
  coalesce(n.nbd_booked, 0)  as nbd_booked,
  coalesce(n.nbd_lost, 0)    as nbd_lost,
  coalesce(n.nbd_open, 0)    as nbd_open,
  n.nbd_pct_raised,
  n.nbd_pct_decided,
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
  r.web_usd,
  -- The quote count behind the client count, so the page can say when they differ.
  -- Last in the list because CREATE OR REPLACE VIEW cannot insert a column in the middle.
  count(*) filter (where d.who = 'nbd') as nbd_raw_quotes
from q
left join deals d on d.qkey = q.qkey
left join nbd_agg n on n.qkey = q.qkey
left join rev r on r.qkey = q.qkey
group by q.qkey, q.qlabel, q.qfrom, r.web_usd,
         n.nbd_quotes, n.nbd_booked, n.nbd_lost, n.nbd_open, n.nbd_pct_raised, n.nbd_pct_decided
order by q.qfrom;

comment on view public.web_lead_kpis is
  'The Web lead scorecard, one row per financial quarter. Scope is any opportunity whose pm_owner names a Web PM - by name or directory alias, split on commas so a shared deal counts - or names the lead himself (migration 185). NBD counts CLIENTS, not quotes (184). Repeat is New Development from account managers. LP/HUB excluded.';

revoke all on public.web_lead_kpis from anon, public;
grant select on public.web_lead_kpis to authenticated;
