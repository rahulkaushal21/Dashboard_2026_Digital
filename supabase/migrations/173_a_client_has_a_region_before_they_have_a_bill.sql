-- Where a client's region comes from when they have not been billed yet.
--
-- Rahul, 16 Nov 2026: "Key Funding Partners is also US". It is — all four of its
-- opportunities say so, and Malay has owned them since Oct 2025. It showed "—" on
-- Delights because every geo lookup on the dashboard starts at web_clients, and
-- web_clients is built FROM web_revenue: no booked line, no row, no region. Key Funding
-- has no revenue line and no Quotes-tab row. It exists only as four deals, a praise
-- email and an approved hand-added testimonial.
--
-- That is the normal shape of a NEW client. They are praised, escalated and quoted
-- before they are ever invoiced, and for that whole window the dashboard does not know
-- what part of the world they are in. Checked across every client on the Delights
-- board today: 34 of them, 33 have a region from web_clients, and the one that does not
-- is this one. Opportunities answer it, and 185 clients gain a region this way.
--
-- So: web_clients first, because a region backed by money is the better answer, then
-- opportunities, taking the region most of their deals agree on.
--
-- Opportunity geo is typed by hand and is not the five-value vocabulary — 465 rows say
-- 'US/Canada' and another 167 say 'US', plus 'AU', 'Australia', 'NZ', 'UK', 'EU',
-- 'UK/Europe' and one 'US (Central Oregon)'. They are folded onto the canonical three
-- here rather than at every call site; 'APAC' and anything unrecognised become 'Others'
-- rather than guessing.
--
-- Keyed on client_key (lowercase alphanumerics), the same key the Clients, Delights and
-- Critical Escalations pages already group on, so 'ZULU 8' and 'Zulu8' are one client.
--
-- The REVOKE below is run separately with execute_sql — apply_migration refuses it —
-- but it belongs here in the record. A new view in public arrives with anon holding
-- INSERT, UPDATE and DELETE from default privileges, and this one did.

create or replace view public.web_client_geo as
with billed as (
  select lower(regexp_replace(company_name, '[^a-zA-Z0-9]', '', 'g')) as client_key,
         geo,
         1 as pri,
         0::bigint as n
  from public.web_clients
  where coalesce(geo, '') <> ''
), deals as (
  select lower(regexp_replace(coalesce(company_name, ''), '[^a-zA-Z0-9]', '', 'g')) as client_key,
         case
           when lower(geo) like 'us%' or lower(geo) like '%canada%' or lower(geo) like '%north america%' then 'US/Canada'
           when lower(geo) like 'uk%' or lower(geo) like 'eu%' or lower(geo) like '%europe%' then 'UK/EU'
           when lower(geo) like 'au%' or lower(geo) like 'nz%' or lower(geo) like '%new zealand%' then 'AU/NZ'
           else 'Others'
         end as geo,
         2 as pri,
         count(*) as n
  from public.opportunities
  where coalesce(geo, '') <> ''
  group by 1, 2
)
select distinct on (t.client_key)
       t.client_key,
       t.geo,
       case when t.pri = 1 then 'revenue' else 'opportunity' end as geo_source
from (select * from billed union all select * from deals) t
where t.client_key <> ''
order by t.client_key, t.pri, t.n desc, t.geo;

grant select on public.web_client_geo to anon, authenticated;
-- Run via execute_sql, not here:
-- revoke insert, update, delete, truncate, references, trigger
--   on public.web_client_geo from anon, authenticated, public;
