-- What we already know about a client, so nobody retypes it.
--
-- The add form fills six fields from three characters, and none of it is guessed: it is
-- read back from that client's OWN history — their most recent deal and their most
-- recent revenue row. Opportunity values win over revenue values where both exist,
-- because a deal is more recent and more specific than a booking line.
--
-- Checked against live rows: HexaGroup returns WEB-US / Wordpress / Malay Shrivastava /
-- Ad-hoc across 66 booked months, Klick returns LP / Dedicated / Harshvardhan Sharma.
-- The service_dept values that come back (WEB-US, LP, HUB, WEB-AU, WEB-UK,
-- AI & Automation) are exactly the department list, so history and the dropdown agree.

alter table public.opportunities add column if not exists contact_email text;

create or replace view public.web_client_defaults
with (security_invoker = true) as
with rev as (
  select lower(trim(company_name)) k, company_name, geo, sme, sales_person, technology,
         engagement_model, contact_email, service_name, booking_month, booking_amount,
         row_number() over (partition by lower(trim(company_name)) order by booking_month desc nulls last) rn
    from public.web_revenue where coalesce(company_name,'') <> ''
), rev1 as (select * from rev where rn = 1),
revagg as (
  select k, sum(booking_amount) lifetime_usd, count(*) booking_months, max(booking_month) last_booking
    from rev group by k
), opp as (
  select lower(trim(company_name)) k, company_name, geo, pm_owner, sales_person, technology,
         project_type, currency, service_dept, contact_email,
         coalesce(source_date, first_date) d,
         row_number() over (partition by lower(trim(company_name)) order by coalesce(source_date, first_date) desc nulls last) rn
    from public.opportunities where coalesce(company_name,'') <> ''
), opp1 as (select * from opp where rn = 1),
oppagg as (select k, count(*) deals, max(d) last_deal from opp group by k)
select
  coalesce(o.k, r.k) as client_key,
  coalesce(o.company_name, r.company_name) as company_name,
  coalesce(nullif(trim(o.currency),''), 'USD') as currency,
  coalesce(nullif(trim(o.geo),''), nullif(trim(r.geo),'')) as geo,
  coalesce(nullif(trim(o.sales_person),''), nullif(trim(r.sales_person),'')) as sales_person,
  coalesce(nullif(trim(o.pm_owner),''), nullif(trim(r.sme),'')) as pm_owner,
  coalesce(nullif(trim(o.technology),''), nullif(trim(r.technology),'')) as technology,
  coalesce(nullif(trim(o.service_dept),''), nullif(trim(r.service_name),'')) as service_dept,
  coalesce(nullif(trim(o.project_type),''), nullif(trim(r.engagement_model),'')) as project_type,
  coalesce(nullif(trim(o.contact_email),''), nullif(trim(r.contact_email),'')) as contact_email,
  coalesce(oa.deals, 0) as deals,
  coalesce(ra.booking_months, 0) as booking_months,
  ra.lifetime_usd,
  greatest(coalesce(oa.last_deal::date, date '1900-01-01'), coalesce(ra.last_booking, date '1900-01-01')) as last_seen,
  (ra.k is not null) as is_existing_client
from opp1 o
full outer join rev1 r on r.k = o.k
left join oppagg oa on oa.k = coalesce(o.k, r.k)
left join revagg ra on ra.k = coalesce(o.k, r.k)
where coalesce(o.k, r.k) is not null;

revoke all on public.web_client_defaults from anon, public;
grant select on public.web_client_defaults to authenticated;
