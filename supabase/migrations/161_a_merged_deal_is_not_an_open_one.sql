-- A merged deal is not an open one.
--
-- web_open_opportunity_evidence excluded `rolled_into` but never `merged_into`, and
-- opportunity_state() is not told about merges either — so a deal already merged into
-- another kept appearing in the "open deals the invoice app has already closed" banner,
-- with a Clear button under it that would confirm it a second time.
--
-- 30 Oct 2026, all four rows in the banner were this: Milk Digital's $1,501 RFQ is the
-- re-invoice of three Trend Lightning deals already booked under PRJ291026122639_1
-- ($585.11 + $564.54 + $351.06 = $1,500.71); Tabin's $702 is the RFQ mail for a deal
-- Nitin had confirmed that morning; HUNTERhunter's $234 had been merged days earlier and
-- came back anyway. Clearing the banner would have booked $2,203 twice.
--
-- The merge itself was always right — only the view could not see it.
create or replace view web_open_opportunity_evidence as
with open_opps as (
  select o.id, o.company_name, o.est_value, o.first_date::date as opened, o.origin,
         o.quote_key, o.pm_owner, o.sales_person, o.service_dept
    from opportunities o
   where o.rolled_into is null
     and o.merged_into is null
     and opportunity_state(o.won, o.email_won, o.email_lost, o.status, o.manual_state) = 'Open'
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
       end as confidence
  from open_opps op
  left join lateral (
    select a_1.*
      from quote_api_opportunities a_1
     where client_stem(a_1.company_name) = client_stem(op.company_name)
       and op.est_value > 0
       and abs(a_1.amount_usd - op.est_value) <= greatest(25, op.est_value * 0.05)
       and abs(a_1.deal_created_at::date - op.opened) <= 45
     order by abs(a_1.deal_created_at::date - op.opened)
     limit 1) a on true
  left join lateral (
    select round(sum(k.usd_round)) as booked_usd, count(*) as rows
      from ledger_match_keys_mv k
     where client_stem(k.client_key) = client_stem(op.company_name)
       and k.booking_month >= date_trunc('month', op.opened::timestamptz)::date
    having count(*) > 0) b on true;
