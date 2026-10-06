-- 136 — the forecast reads the pipeline
--
-- Rahul, 6 Oct 2026: "opportunities/pipeline should be part of the forecast but it
-- shouldn't be like that you just add the total value into forecast, we have models
-- set, based on probability A and B … think practically … what opportunities we close,
-- what's the fix business we have as retainer."
--
-- Two numbers per unit, both read by the forecast (lib/forecast.ts, ForecastInputs.pipeline):
--
--   pipeline_weighted  Open deals raised in the last 120 days, each at its own win
--                      probability (the Opportunities page's A/B/C scoring; the size-band
--                      rate where a deal has none). 120 days because the A tier is full
--                      of deals that were never closed off — 28 of them averaging 305
--                      days old on 6 Oct — and a deal that old is not pipeline.
--   quoted_won_avg     What the unit typically wins from quotes in a month: the won
--                      value of quotes by the month they were raised, averaged over the
--                      six complete months ending two months ago (the latest month's
--                      quotes are mostly still open). Quotes tab until Sep 2026, then
--                      the dashboard's own confirmations.
--
-- The forecast already contains the typical month's quote wins inside its ad-hoc level,
-- so the pipeline is NOT added. The DIFFERENCE between the two — more visible than usual,
-- or less — is applied to the next two months (half, then a quarter) and a quarter of it
-- to the month in progress. Nothing counted twice, and a thin pipeline pulls the number
-- down as surely as a fat one lifts it.

create or replace view public.web_forecast_inputs as
with dept_unit as (
  select d.id, case when upper(coalesce(d.service_dept,'')) in ('LP','HUB','LP/HUB') then 'lp-hub'
                    when upper(coalesce(d.service_dept,'')) like 'WEB%' or upper(coalesce(d.service_dept,'')) like 'AI%' then 'web' end unit
  from opportunity_dept_mv d
), open_deals as (
  select u.unit, o.est_value,
         coalesce(o.win_probability, case when o.est_value >= 10000 then 4.3 when o.est_value >= 3000 then 35.5 when o.est_value >= 1000 then 45.5 else 75 end) pct
  from opportunities o join dept_unit u on u.id = o.id
  where not o.won and coalesce(o.email_won,false) = false and coalesce(o.email_lost,false) = false
    and o.manual_state is null and o.rolled_into is null and coalesce(o.unlikely,false) = false
    and lower(coalesce(o.status,'')) not in ('won','lost','cancelled','on hold')
    and o.est_value > 0 and o.source_date >= current_date - 120 and u.unit is not null
), won_by_month as (
  select case when upper(coalesce(q.service_dept,'')) in ('LP','HUB','LP/HUB') then 'lp-hub'
              when upper(coalesce(q.service_dept,'')) like 'WEB%' or upper(coalesce(q.service_dept,'')) like 'AI%' then 'web' end unit,
         date_trunc('month', q.added_date)::date m, q.usd_value usd
  from quotes q where lower(coalesce(q.status,'')) ~ 'won|confirm' and q.added_date < date '2026-10-01'
  union all
  select u.unit, date_trunc('month', o.confirmed_at)::date, coalesce(o.won_amount, o.est_value)
  from opportunities o join dept_unit u on u.id = o.id
  where o.won and o.origin in ('pm','email') and o.confirmed_at >= date '2026-10-01'
), window_months as (
  select (date_trunc('month', current_date) - (n || ' months')::interval)::date m from generate_series(2, 7) n
), won_avg as (
  select w.unit, sum(w.usd) / 6.0 quoted_won_avg, count(*) won_deals
  from won_by_month w join window_months wm on wm.m = w.m
  where w.unit is not null group by w.unit
), pipe as (
  select unit, count(*) pipeline_deals, sum(est_value) pipeline_usd, sum(est_value * pct / 100.0) pipeline_weighted
  from open_deals group by unit
)
select u.unit,
       coalesce(p.pipeline_deals, 0) pipeline_deals,
       round(coalesce(p.pipeline_usd, 0)) pipeline_usd,
       round(coalesce(p.pipeline_weighted, 0)) pipeline_weighted,
       round(coalesce(w.quoted_won_avg, 0)) quoted_won_avg,
       coalesce(w.won_deals, 0) won_deals_in_window
from (values ('lp-hub'), ('web')) u(unit)
left join pipe p on p.unit = u.unit
left join won_avg w on w.unit = u.unit;

grant select on public.web_forecast_inputs to anon, authenticated;
