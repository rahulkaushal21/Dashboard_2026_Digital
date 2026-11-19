-- The invoice app match ignored what the deal was FOR
--
-- Q2Technologies sat in the "open deals the invoice app has already closed" banner
-- against OPP291026061844, Won, $400 - and that record is "west texas", service
-- 'Search - SEO'. Q2Technologies buys $400 of SEO every single month: OPP270426125906,
-- OPP060526054524, OPP260626055426, OPP140726062207, OPP270826063439, OPP300926070254,
-- OPP291026061844. Their Web work in the same window is $250, $480, $650 and $2,200.
--
-- The lateral join matched on client stem, amount within 5% and date within 45 days, and
-- never asked what the record was for, so a monthly SEO retainer that happens to equal a
-- Web quote closed it. Clicking Clear would have marked a live Web deal Won on the
-- strength of another department's invoice.
--
-- SO THE APP RECORD MUST BE OUR WORK: its service list has to name Development - Web,
-- Development - LP/Hub or AI & Automation. service is a comma-joined list, so a combined
-- 'Development - Web,Search - SEO' record still matches - it is partly ours. Everything
-- else - SEO, SEM, SFMC, campaigns, email, standalone design - belongs to another
-- business unit and cannot close a deal on this dashboard.
--
-- A NEARER WRONG RECORD NO LONGER HIDES THE RIGHT ONE: the filter sits inside the lateral
-- join, so "nearest by date" now picks the nearest record that is ours.
--
-- IMPACT TODAY: one row leaves the banner, the Q2Technologies one. The other three
-- (Reward Gateway, YLP Legal, Precision Creative) are 'Development - Web' and
-- 'Development - LP/Hub' and are unaffected. Across every open opportunity, this was the
-- only cross-department match.
--
-- app_service and app_project are added at the end of the column list - CREATE OR REPLACE
-- VIEW cannot insert a column in the middle - so the banner can show what it matched on
-- instead of asking anyone to take the opportunity number on faith.
--
-- The soft 'client booked' tier is untouched and still does not reach the banner; see
-- migration 102. The merge exclusions are migration 161.
create or replace view public.web_open_opportunity_evidence as
with open_opps as (
  select o.id, o.company_name, o.est_value, o.first_date::date as opened, o.origin,
         o.quote_key, o.pm_owner, o.sales_person, o.service_dept
    from public.opportunities o
   where o.rolled_into is null
     and o.merged_into is null
     and public.opportunity_state(o.won, o.email_won, o.email_lost, o.status, o.manual_state) = 'Open'
)
select op.id, op.company_name, op.est_value, op.opened, op.origin, op.quote_key,
       op.pm_owner, op.sales_person, op.service_dept,
       a.opportunity_no as app_opportunity_no,
       a.final_stage    as app_final_stage,
       a.stage          as app_stage,
       a.amount_usd     as app_usd,
       a.deal_created_at::date as app_created,
       b.booked_usd as client_booked_since,
       b.rows       as client_booked_rows,
       case
         when a.final_stage = 'Won' then 'app won'
         when a.final_stage = any (array['Lost','Deleted']) then 'app lost'
         when b.booked_usd is not null then 'client booked'
       end as evidence,
       case
         when a.final_stage = 'Won' then 1
         when a.final_stage = any (array['Lost','Deleted']) then 2
         when b.booked_usd is not null then 3
       end as confidence,
       a.service      as app_service,
       a.project_name as app_project
  from open_opps op
  left join lateral (
    select a_1.*
      from public.quote_api_opportunities a_1
     where public.client_stem(a_1.company_name) = public.client_stem(op.company_name)
       and op.est_value > 0
       and abs(a_1.amount_usd - op.est_value) <= greatest(25, op.est_value * 0.05)
       and abs(a_1.deal_created_at::date - op.opened) <= 45
       -- Our work only. An SEO or campaign invoice cannot close a Web or LP deal.
       and a_1.service ~* '(Development - Web|Development - LP/Hub|AI & Automation)'
     order by abs(a_1.deal_created_at::date - op.opened)
     limit 1) a on true
  left join lateral (
    select round(sum(k.usd_round)) as booked_usd, count(*) as rows
      from public.ledger_match_keys_mv k
     where public.client_stem(k.client_key) = public.client_stem(op.company_name)
       and k.booking_month >= date_trunc('month', op.opened::timestamptz)::date
    having count(*) > 0) b on true;

comment on view public.web_open_opportunity_evidence is
  'Open opportunities the invoice app or the ledger says are already closed. The app match requires the record to be OUR work - Development - Web, Development - LP/Hub or AI & Automation - because Q2Technologies'' monthly $400 SEO retainer was closing a $400 Web deal (migration 186). Merged and rolled deals excluded (161).';
