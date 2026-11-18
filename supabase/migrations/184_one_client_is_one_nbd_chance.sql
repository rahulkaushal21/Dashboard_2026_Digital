-- NBD counts clients, not quotes
--
-- BOLT Marketing was raised four times in Q2, eMetabolic twice, ALTUS twice. Four quotes
-- to one prospect is one chance to win that prospect, not four; counting the quotes
-- makes the denominator a measure of how much re-quoting happened and pushes the rate
-- down every time a scope is revised. Q2 FY26-27 was 3 of 16 = 18.8%; read per client it
-- is 3 of 13 = 23.1%. Q1 and Q3 do not move - no prospect was quoted twice in either.
--
-- A CLIENT IS BOOKED IF ANY OF ITS QUOTES WON. Lost only when every quote is lost and
-- none won; anything else is still open. BOLT is one booked client, not one win and
-- three strays.
--
-- GROUPED ON company_name, lowercased and trimmed. A row with no company name stands
-- alone on its id rather than collapsing every blank into one.
--
-- MONEY IS NOT DEDUPLICATED. nbd_quoted_usd still sums every quote raised - that is the
-- value that went out of the door, and picking one quote per client to keep would be an
-- arbitrary choice about which revision counts.
--
-- REPEAT IS UNCHANGED, and so are the PM scorecards. This is the Web lead's NBD measure
-- only, asked for on 18 Nov 2026.
--
-- Everything else is migration 183: Web PMs only, NBD = the three new-business people,
-- Repeat = New Development from an account manager, headline is % of raised.

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
         lower(btrim(coalesce(nullif(btrim(o.company_name), ''), 'id:' || o.id))) as client_key,
         (o.id in (select id from won)) is_won,
         (o.id in (select id from lost)) is_lost
  from q join o on o.source_date >= q.qfrom and o.source_date < q.qto
),
-- One row per NBD prospect per quarter. Won beats lost beats open.
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
  'The Web lead scorecard, one row per financial quarter. NBD counts CLIENTS, not quotes - four quotes to BOLT is one chance (migration 184); nbd_raw_quotes carries the quote count. Repeat conversion is New Development from account managers, unchanged. Web PMs only - LP/HUB excluded. See migrations 183 and 184.';

revoke all on public.web_lead_kpis from anon, public;
grant select on public.web_lead_kpis to authenticated;
