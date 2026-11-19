-- 185 — a deal labelled LP or HUB is in LP/HUB, whoever the PM is
--
-- Pratik, 19 Nov 2026: choosing LP/HUB in the business-unit switch did not show the LP/HUB
-- team's new deals, although All did.
--
-- Two causes. (1) web_opportunity_dept never read the row's OWN service_dept: it ranked the
-- PM's team first, so Andersondd (labelled LP, PM Gagandeep Singh of WEB-US) sat in WEB-US.
-- (2) the page reads opportunity_dept_mv, refreshed once an hour at :52, so a deal created
-- by a refresh was not in it at all and matched no unit until the next :52. (2) is handled
-- by the routine refreshing the view after it writes; this migration fixes (1).
--
-- A label LP or HUB written on a deal that is not yet Won now wins. Won rows are left on the
-- old order on purpose: their department decides which bucket booked revenue lands in, and
-- that should not move because of a view change. One Won row is labelled LP and sits in
-- WEB-AU; it stays there.
--
-- Everything else in the view is migration 060's, unchanged.

create or replace view public.web_opportunity_dept as
select o.id,
  coalesce(
    (case when not coalesce(o.won, false) and o.service_dept in ('LP', 'HUB') then 'LP/HUB' end),
    (select p.dept
       from public.web_pm_department p
      where p.pm in (select lower(btrim(x.x))
                       from regexp_split_to_table(coalesce(o.pm_owner, ''), '[,/&]|\s+and\s+') x(x))
      limit 1),
    (select case
              when c.service_dept = any (array['LP', 'HUB']) then 'LP/HUB'
              when c.service_dept like 'WEB-US%' then 'WEB-US'
              else c.service_dept
            end
       from public.web_client_context c
      where c.client_key = lower(regexp_replace(coalesce(o.company_name, ''), '[^a-zA-Z0-9]', '', 'g'))
        and coalesce(btrim(c.service_dept), '') <> ''
      limit 1),
    case
      when upper(coalesce(o.geo, '')) like '%US%' or upper(coalesce(o.geo, '')) like '%CANADA%' then 'WEB-US'
      when upper(coalesce(o.geo, '')) like '%UK%' or upper(coalesce(o.geo, '')) like '%EU%' then 'WEB-UK'
      when upper(coalesce(o.geo, '')) like '%AU%' or upper(coalesce(o.geo, '')) like '%NZ%' then 'WEB-AU'
      else null
    end
  ) as service_dept
from public.opportunities o;
