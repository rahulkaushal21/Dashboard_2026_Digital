-- Who owns this client, what service they sit under, what it is built in.
--
-- Critical Escalations, Delights and Major Process Gap show a client name, a status and a
-- geo, and nothing else. Deciding whether a row is yours — or who to hand it to — meant
-- leaving the page for Client 360 and coming back. One small lookup, keyed the way the
-- rest of the app keys clients (lowercased, punctuation stripped), so a name written
-- three ways still lands on one row.
--
-- The callers match on a PREFIX as well as exactly, because the escalation says "Layer 8
-- Training" where the ledger says "Layer 8 Training, Inc." — 18 of the 20 clients with
-- open escalations resolve. The two that do not have no revenue history at all, so there
-- is nothing to resolve them from and the chips simply do not render.
--
-- DOMINANT BY REVENUE, not by project count: a client with nine small WordPress jobs and
-- one large Shopify build is a WordPress client, and counting projects would say the
-- opposite.
create or replace view public.web_client_context
with (security_invoker = true) as
with ranked as (
  select
    lower(regexp_replace(coalesce(l.company_name, ''), '[^a-zA-Z0-9]', '', 'g')) as client_key,
    l.pm_owner, l.service_dept, l.technology, l.amount_usd
  from public.web_project_ledger l
  where coalesce(btrim(l.company_name), '') <> ''
),
top_of as (
  select client_key, 'pm' as facet, pm_owner as value, sum(amount_usd) as amt
    from ranked where coalesce(btrim(pm_owner), '') <> '' group by 1, 3
  union all
  select client_key, 'dept', service_dept, sum(amount_usd)
    from ranked where coalesce(btrim(service_dept), '') <> '' group by 1, 3
  union all
  select client_key, 'tech', technology, sum(amount_usd)
    from ranked where coalesce(btrim(technology), '') <> '' group by 1, 3
),
picked as (
  select client_key, facet, value,
         row_number() over (partition by client_key, facet order by amt desc nulls last, value) as rn
  from top_of
)
select
  c.client_key,
  max(c.company_name) as company_name,
  max(p.value) filter (where p.facet = 'pm')   as pm_owner,
  max(p.value) filter (where p.facet = 'dept') as service_dept,
  max(p.value) filter (where p.facet = 'tech') as technology
from (
  select distinct lower(regexp_replace(coalesce(company_name, ''), '[^a-zA-Z0-9]', '', 'g')) as client_key,
         company_name
  from public.web_project_ledger
  where coalesce(btrim(company_name), '') <> ''
) c
left join picked p on p.client_key = c.client_key and p.rn = 1
group by c.client_key;

comment on view public.web_client_context is
  'Per client: the PM, service department and technology that most of their revenue sits under. For pages that show a client name and need the context without a second lookup.';

grant select on public.web_client_context to anon, authenticated;
