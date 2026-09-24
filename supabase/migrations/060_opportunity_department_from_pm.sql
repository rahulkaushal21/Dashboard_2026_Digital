-- Which department a deal belongs to, answered from the PM.
--
-- The service_dept column on an opportunity is blank on all 951 of them — nobody is asked
-- for it when a deal is created and nobody should be. PMs ARE assigned to departments, so
-- the PM is the answer; everything after it is a fallback for the handful of rows that
-- have no PM.
--
--   1. The PM directory's team — the authoritative answer. 11 PMs, 4 teams.  847 deals.
--   2. The PM's own delivery history, for people no longer in the directory. A former
--      PM's deals still belong to the department they delivered in. Picks up Harshal
--      Mehuriya (WEB-US), Harshvardhan Sharma (LP/HUB) and Rahul Kaushal (WEB-AU).
--   3. The client's dominant department, for a deal with no PM at all.
--   4. Geo, matched LOOSELY. "US (Central Oregon)" is a real value in this data and an
--      exact match against 'US' would miss it.
--
-- NO 'OTHER' BUCKET, deliberately. It was 104 deals of "we did not look hard enough",
-- which is not a department and should not be offered as a filter. What still cannot be
-- placed returns null and is simply not matched by a department filter.
--
-- After this: WEB-US 343, WEB-UK 207, WEB-AU 200, LP/HUB 198, unresolved 3. The three are
-- Spark SEM (PM Sonu Devda, who has no directory entry and no delivered lines), AVASO
-- Technology (no PM, no geo, no history) and one completely empty row.
create or replace view public.web_pm_department
with (security_invoker = true) as
with led as (
  select lower(btrim(l.pm_owner)) as pm,
         case when l.service_dept in ('LP','HUB') then 'LP/HUB'
              when l.service_dept like 'WEB-US%' then 'WEB-US'
              else l.service_dept end as dept,
         sum(l.amount_usd) as amt
    from public.web_project_ledger l
   where coalesce(btrim(l.pm_owner), '') <> '' and coalesce(btrim(l.service_dept), '') <> ''
   group by 1, 2
), ranked as (
  select pm, dept, row_number() over (partition by pm order by amt desc nulls last, dept) rn from led
)
select lower(btrim(d.name)) as pm, d.team as dept, 'directory' as via
  from public.pm_directory d where d.active and coalesce(btrim(d.team), '') <> ''
union
select r.pm, r.dept, 'history'
  from ranked r
 where r.rn = 1
   and not exists (select 1 from public.pm_directory d
                    where d.active and lower(btrim(d.name)) = r.pm and coalesce(btrim(d.team), '') <> '');

comment on view public.web_pm_department is
  'One department per PM: their directory team, or the department most of their delivered revenue sits in when they are not in the directory.';

grant select on public.web_pm_department to anon, authenticated;

create or replace view public.web_opportunity_dept
with (security_invoker = true) as
select
  o.id,
  coalesce(
    -- A cell can name two people ("Krunal, Rahul Kaushal"); the first one we recognise wins.
    (select p.dept from public.web_pm_department p
      where p.pm = any (select lower(btrim(x)) from regexp_split_to_table(coalesce(o.pm_owner, ''), '[,/&]|\s+and\s+') x)
      limit 1),
    (select case when c.service_dept in ('LP','HUB') then 'LP/HUB'
                 when c.service_dept like 'WEB-US%' then 'WEB-US'
                 else c.service_dept end
       from public.web_client_context c
      where c.client_key = lower(regexp_replace(coalesce(o.company_name, ''), '[^a-zA-Z0-9]', '', 'g'))
        and coalesce(btrim(c.service_dept), '') <> ''
      limit 1),
    case
      when upper(coalesce(o.geo, '')) like '%US%' or upper(coalesce(o.geo, '')) like '%CANADA%' then 'WEB-US'
      when upper(coalesce(o.geo, '')) like '%UK%' or upper(coalesce(o.geo, '')) like '%EU%'     then 'WEB-UK'
      when upper(coalesce(o.geo, '')) like '%AU%' or upper(coalesce(o.geo, '')) like '%NZ%'     then 'WEB-AU'
    end
  ) as service_dept
from public.opportunities o;

comment on view public.web_opportunity_dept is
  'Department per deal: PM team, then the PM''s delivery history, then the client''s department, then geo. Null where none of those answer — there is no Other bucket.';

grant select on public.web_opportunity_dept to anon, authenticated;
