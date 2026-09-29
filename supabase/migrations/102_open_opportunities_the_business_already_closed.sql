-- 102 — open opportunities the rest of the business has already closed
--
-- The pipeline only means something if what is on it is still open. Terrace Boating was
-- confirmed and still sat in Opportunities (Rahul, 29 Sep 2026), and it was not alone.
--
-- EVIDENCE IS TIERED AND THE TIER IS RECORDED, because clearing a live deal is a worse
-- error than leaving a dead one on the list:
--
--   'app won' / 'app lost'   the invoice app's own FinalStage, for an opportunity of the
--                            same client, within 5% on value AND within 45 days.
--
--        ALL THREE CONDITIONS ARE LOAD-BEARING. On client + value alone the match paired
--        Innovative Capital's September deal with a July 2025 record, Market Veep's with
--        December 2025 and Biotronik's with February 2025 — $250, $400 and $80 are common
--        round numbers and they collide across years. Four of fourteen "wins" were that,
--        and they would have cleared live deals.
--
--   'client booked'          the client has revenue booked in the sheet in or after the
--                            opportunity's month. This is the only thing that catches
--                            Terrace Boating, whose app record still reads 'Pending' while
--                            three rows worth $6,439 sit in the September ledger. It is
--                            SOFT — 90 of 196 open opportunities trip it, because an
--                            agency with one live deal usually has other work running.
--                            NEVER auto-clear on this alone.
--
-- The view writes nothing. It ranks and evidences; a person decides.
--
-- Applied on 29 Sep 2026 from this evidence, all reversible and all carrying their reason:
--   12 confirmed Won (app FinalStage = Won)
--    2 marked Lost — NoLie Communications $8,820 (exact value, one day apart, Lost since
--      13 July and the largest single distortion in the pipeline) and Libra $240 (Deleted)
--    1 Terrace Boating, confirmed by Rahul directly
create or replace view web_open_opportunity_evidence
with (security_invoker = true) as
with open_opps as (
  select o.id, o.company_name, o.est_value, o.first_date::date as opened,
         o.origin, o.quote_key, o.pm_owner, o.sales_person, o.service_dept
  from opportunities o
  where o.rolled_into is null
    and opportunity_state(o.won, o.email_won, o.email_lost, o.status) = 'Open'
)
select
  op.*,
  a.opportunity_no as app_opportunity_no, a.final_stage as app_final_stage,
  a.stage as app_stage, a.amount_usd as app_usd, a.deal_created_at::date as app_created,
  b.booked_usd as client_booked_since, b.rows as client_booked_rows,
  case
    when a.final_stage = 'Won' then 'app won'
    when a.final_stage in ('Lost','Deleted') then 'app lost'
    when b.booked_usd is not null then 'client booked'
  end as evidence,
  -- 1 act on it, 3 look at it.
  case
    when a.final_stage = 'Won' then 1
    when a.final_stage in ('Lost','Deleted') then 2
    when b.booked_usd is not null then 3
  end as confidence
from open_opps op
left join lateral (
  select * from quote_api_opportunities a
  where client_stem(a.company_name) = client_stem(op.company_name)
    and op.est_value > 0
    and abs(a.amount_usd - op.est_value) <= greatest(25, op.est_value * 0.05)
    and abs(a.deal_created_at::date - op.opened) <= 45
  order by abs(a.deal_created_at::date - op.opened)
  limit 1) a on true
left join lateral (
  select round(sum(k.usd_round)) as booked_usd, count(*) as rows
  from ledger_match_keys_mv k
  where client_stem(k.client_key) = client_stem(op.company_name)
    and k.booking_month >= date_trunc('month', op.opened)::date
  having count(*) > 0) b on true;
