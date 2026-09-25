-- A business unit filter that runs across the whole dashboard.
--
-- Pratik heads LP/Hub and reads this board for that business; everybody else reads it
-- for Web. Until now the only way to answer "how is LP/Hub doing" was to know which
-- departments count as LP/Hub and filter eight pages by hand.
--
-- WHAT THE DATA ACTUALLY SUPPORTS. Three different situations, and they must not be
-- made to look alike:
--
--   1. web_sheet_rows carries a typed service department on 3,237 of 3,239 lines. Every
--      page built on the revenue sheet filters exactly, and needs nothing from here.
--
--   2. opportunities carries one on 4 of 960. web_opportunity_dept already infers the
--      rest — PM's pod, then that client's booked history, then geo — and reaches 957.
--      That view costs 2.7 SECONDS because it rebuilds the ledger from sheet_raw once
--      per opportunity. Hanging a dashboard-wide filter off it would put that on every
--      page load, which is the same fault that blanked the Project sheet (069) and
--      timed out the QBR brief (084). It is materialised here. Third time.
--
--   3. escalations carries no department at all: `service_type` says 'Managed' on 782
--      of 844 rows, and there is no PM column — `raised_by` is the process person who
--      logged it (Namrata Shah 402, Rachana Pandya 184), none of whom appear in
--      pm_directory, and who each raise across every region. So the PM route does not
--      exist. What does exist: 461 rows have a REGION sitting in the company_name
--      column ('US / Canada', 'ANZ', 'UK'), and 244 more match a booked client. Between
--      them that is 703 of 844.
--
--      The remaining 141 are left NULL on purpose. They show under All and are counted
--      out loud on the page. An escalation nobody can place must not read as an
--      escalation that does not exist — that is how a client's QBR looked empty for a
--      quarter.

-- ── 1. The opportunity department, once an hour instead of once a row ────────────
drop materialized view if exists public.opportunity_dept_mv;
create materialized view public.opportunity_dept_mv as
  select id, service_dept from public.web_opportunity_dept;
create unique index opportunity_dept_mv_key on public.opportunity_dept_mv (id);
grant select on public.opportunity_dept_mv to anon, authenticated;

-- ── 2. Which unit an escalation belongs to ───────────────────────────────────────
-- Client first, because a named client is evidence. The region in company_name is a
-- weaker signal and only says WHICH web pod, so it can never produce LP/HUB — that is
-- correct, not a gap: those rows name no client and no service.
create or replace view public.web_escalation_dept
with (security_invoker = true) as
with ctx as (
  select client_key,
         case when service_dept in ('LP','HUB')   then 'LP/HUB'
              when service_dept like 'WEB-US%'    then 'WEB-US'
              else service_dept end as dept
  from public.web_client_context
  where coalesce(btrim(service_dept),'') <> ''
)
select e.id,
       coalesce(
         c.dept,
         case upper(btrim(coalesce(e.company_name,'')))
           when 'US / CANADA' then 'WEB-US'
           when 'US/CANADA'   then 'WEB-US'
           when 'ANZ'         then 'WEB-AU'
           when 'UK'          then 'WEB-UK'
         end
       ) as service_dept
from public.escalations e
left join ctx c
  on c.client_key = lower(regexp_replace(coalesce(e.company_name,''), '[^a-zA-Z0-9]', '', 'g'));

drop materialized view if exists public.escalation_dept_mv;
create materialized view public.escalation_dept_mv as
  select id, service_dept from public.web_escalation_dept;
create unique index escalation_dept_mv_key on public.escalation_dept_mv (id);
grant select on public.escalation_dept_mv to anon, authenticated;

-- ── 3. Keep them current ─────────────────────────────────────────────────────────
-- :52 past the hour — clear of the sheet sync (:00/:30) and of the QBR sources (:46),
-- so three expensive refreshes are not competing for the same minute.
select cron.unschedule('refresh-unit-sources')
  where exists (select 1 from cron.job where jobname = 'refresh-unit-sources');
select cron.schedule('refresh-unit-sources', '52 * * * *', $$
  refresh materialized view concurrently public.opportunity_dept_mv;
  refresh materialized view concurrently public.escalation_dept_mv;
$$);
