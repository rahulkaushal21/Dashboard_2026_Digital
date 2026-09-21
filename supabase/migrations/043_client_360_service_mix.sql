-- Client 360: everything a client has bought, not just the one thing they mostly buy.
--
-- 042 answered "mostly built in" with a single winner. That is the right headline and the
-- wrong whole answer: a client on Wordpress who also had two Shopify builds reads as a
-- pure Wordpress account, and the person about to pitch them never learns otherwise.
--
-- Three mixes, each the full list by revenue:
--   tech_split    — the technology column (Wordpress, Shopify, HubSpot, …)
--   service_split — Service Type (Development Only, Design + Development, …)
--   dept_split    — Service Dept (WEB-UK, HUB-US, LP-AU …), which is where the work sat
--
-- By revenue, not by count, for the same reason "mostly built in" is: ten small ad-hoc
-- jobs and one large build should not read as an ad-hoc account. `pct` is of the client's
-- lifetime value, so each list sums to 100 and the numbers agree with the tiles above.
--
-- Rows with a blank value are kept as 'Unspecified' rather than dropped: dropping them
-- would make the percentages add to less than the money we actually billed.

drop view if exists public.web_client_360;

create view public.web_client_360 with (security_invoker = true) as
with rows_ as (
  select lower(btrim(agency)) as client_key, *
  from public.web_sheet_rows
  where coalesce(btrim(agency), '') <> '' and coalesce(usd_value, 0) <> 0
), base as (
  select client_key,
         max(agency) as company_name,
         count(*) as projects,
         sum(usd_value) as lifetime_usd,
         avg(usd_value) as avg_value,
         min(booking_month) as first_month,
         max(booking_month) as last_month,
         count(distinct booking_month) as months_active,
         max(delivery_date) as last_delivered,
         (array_agg(usd_value    order by booking_month desc nulls last, id desc))[1] as last_amount,
         (array_agg(project_name order by booking_month desc nulls last, id desc))[1] as last_project
  from rows_ group by client_key
), months as (
  select client_key, booking_month, sum(usd_value) as amount,
         row_number() over (partition by client_key order by sum(usd_value) desc, booking_month desc) as rn
  from rows_ where booking_month is not null group by client_key, booking_month
), handler as (
  select client_key, pc_sme as name, sum(usd_value) as amount,
         row_number() over (partition by client_key order by sum(usd_value) desc) as rn
  from rows_ where coalesce(btrim(pc_sme), '') <> '' group by client_key, pc_sme
), tech as (
  select client_key, technology as name, sum(usd_value) as amount,
         row_number() over (partition by client_key order by sum(usd_value) desc) as rn
  from rows_ where coalesce(btrim(technology), '') <> '' group by client_key, technology
), split as (
  select client_key, jsonb_agg(jsonb_build_object('name', name, 'amount', round(amount), 'pct', pct) order by amount desc) as revenue_split
  from (
    select client_key, coalesce(nullif(btrim(project_type), ''), 'Unspecified') as name,
           sum(usd_value) as amount,
           round(100.0 * sum(usd_value) / nullif(sum(sum(usd_value)) over (partition by client_key), 0), 1) as pct
    from rows_ group by client_key, coalesce(nullif(btrim(project_type), ''), 'Unspecified')
  ) z group by client_key
), tech_mix as (
  select client_key, jsonb_agg(jsonb_build_object('name', name, 'amount', round(amount), 'projects', n, 'pct', pct) order by amount desc) as tech_split
  from (
    select client_key, coalesce(nullif(btrim(technology), ''), 'Unspecified') as name,
           sum(usd_value) as amount, count(*) as n,
           round(100.0 * sum(usd_value) / nullif(sum(sum(usd_value)) over (partition by client_key), 0), 1) as pct
    from rows_ group by client_key, coalesce(nullif(btrim(technology), ''), 'Unspecified')
  ) z group by client_key
), service_mix as (
  select client_key, jsonb_agg(jsonb_build_object('name', name, 'amount', round(amount), 'projects', n, 'pct', pct) order by amount desc) as service_split
  from (
    select client_key, coalesce(nullif(btrim(service_type), ''), 'Unspecified') as name,
           sum(usd_value) as amount, count(*) as n,
           round(100.0 * sum(usd_value) / nullif(sum(sum(usd_value)) over (partition by client_key), 0), 1) as pct
    from rows_ group by client_key, coalesce(nullif(btrim(service_type), ''), 'Unspecified')
  ) z group by client_key
), dept_mix as (
  select client_key, jsonb_agg(jsonb_build_object('name', name, 'amount', round(amount), 'projects', n, 'pct', pct) order by amount desc) as dept_split
  from (
    select client_key, coalesce(nullif(btrim(service_dept), ''), 'Unspecified') as name,
           sum(usd_value) as amount, count(*) as n,
           round(100.0 * sum(usd_value) / nullif(sum(sum(usd_value)) over (partition by client_key), 0), 1) as pct
    from rows_ group by client_key, coalesce(nullif(btrim(service_dept), ''), 'Unspecified')
  ) z group by client_key
), cycle as (
  -- Only quotes somebody confirmed. An open quote has no cycle yet, and counting it as
  -- zero would flatter every client with a live pipeline.
  select lower(btrim(agency)) as client_key,
         round(avg(confirmed_in_days), 1) as sales_cycle_days,
         count(*) as sales_cycle_n
  from public.quotes
  where confirmed_in_days is not null and coalesce(btrim(agency), '') <> ''
    and (lower(coalesce(status, '')) like '%confirm%' or lower(coalesce(status, '')) = 'won')
  group by lower(btrim(agency))
)
select b.client_key, b.company_name, b.projects,
       round(b.lifetime_usd) as lifetime_usd,
       round(b.avg_value) as avg_value,
       b.first_month, b.last_month, b.months_active,
       case when b.first_month is not null and b.last_month is not null
            then (extract(year from age(b.last_month, b.first_month)) * 12
                + extract(month from age(b.last_month, b.first_month)))::int + 1 end as tenure_months,
       b.last_delivered, round(b.last_amount) as last_amount, b.last_project,
       m.booking_month as strongest_month, round(m.amount) as strongest_amount,
       h.name as handled_by, round(100.0 * h.amount / nullif(b.lifetime_usd, 0), 0) as handled_by_pct,
       t.name as built_in,   round(100.0 * t.amount / nullif(b.lifetime_usd, 0), 0) as built_in_pct,
       s.revenue_split, tm.tech_split, sm.service_split, dm.dept_split,
       c.sales_cycle_days, c.sales_cycle_n
from base b
left join months      m  on m.client_key  = b.client_key and m.rn = 1
left join handler     h  on h.client_key  = b.client_key and h.rn = 1
left join tech        t  on t.client_key  = b.client_key and t.rn = 1
left join split       s  on s.client_key  = b.client_key
left join tech_mix    tm on tm.client_key = b.client_key
left join service_mix sm on sm.client_key = b.client_key
left join dept_mix    dm on dm.client_key = b.client_key
left join cycle       c  on c.client_key  = b.client_key;

grant select on public.web_client_360 to anon, authenticated;
