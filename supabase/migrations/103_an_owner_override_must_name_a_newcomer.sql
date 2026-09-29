-- 103 — an owner override must be able to name someone who has never billed the client
--
-- 091 gave client_owner_overrides the job of saying who owns a client NOW, but it only
-- ever REORDERED candidates drawn from web_project_ledger. It could not INTRODUCE one.
--
-- That held until somebody left. Pritpal Singh's 19 clients were reassigned to Rahul Jain
-- on 29 Sep 2026; 12 took effect and 7 did not — and the 7 were exactly those where Rahul
-- had never billed the client. With no ledger row to promote, the override had nothing to
-- reorder and Pritpal, the only name in the ledger, kept winning. The dashboard went on
-- naming a departed employee as the current owner of Digital Ninjas, Endeavoram,
-- Noproblem, Noble Five, mobile roof racks nz, satisfinefoods and thejames.agency.
--
-- web_client_owners already had this right: there the override is a UNION branch, so Rahul
-- came back is_primary for all seven. Only web_client_context was reordering rather than
-- introducing, which is why the two views disagreed.
--
-- The fix is one union branch: the override person becomes a pm candidate in their own
-- right, with amt = null so the existing ordering (override first, then revenue) decides.
--
-- The reassignment was deliberately made at CLIENT level and not pushed onto the 16
-- historical opportunity rows that still name Pritpal. Those are accurate history — he
-- did run those deals — and the sync would overwrite them within 30 minutes anyway, since
-- sync_quotes_to_opportunities does pm_owner = coalesce(excluded.pm_owner, o.pm_owner)
-- straight from the Quotes tab. Who ran a deal and who owns the client now are different
-- questions, which is the distinction 091 existed to draw.
create or replace view web_client_context
with (security_invoker = true) as
with ranked as (
  select lower(regexp_replace(coalesce(l.company_name,''), '[^a-zA-Z0-9]', '', 'g')) as client_key,
         l.pm_owner, l.service_dept, l.technology, l.amount_usd
  from web_project_ledger l
  where coalesce(btrim(l.company_name),'') <> ''
), top_of as (
  select client_key, 'pm' as facet, pm_owner as value, sum(amount_usd) as amt
  from ranked where coalesce(btrim(pm_owner),'') <> '' group by client_key, pm_owner
  union all
  -- The override as a CANDIDATE, not merely as a tie-break. A person reassigned a client
  -- they have not yet billed is the whole point of the table.
  select ov.client_key, 'pm', btrim(ov.person), null::numeric
  from client_owner_overrides ov
  where coalesce(btrim(ov.person),'') <> ''
  union all
  select client_key, 'dept', service_dept, sum(amount_usd)
  from ranked where coalesce(btrim(service_dept),'') <> '' group by client_key, service_dept
  union all
  select client_key, 'tech', technology, sum(amount_usd)
  from ranked where coalesce(btrim(technology),'') <> '' group by client_key, technology
), picked as (
  select t.client_key, t.facet, t.value,
    row_number() over (partition by t.client_key, t.facet order by
      case when t.facet = 'pm' and ov.person is not null
            and canonical_person(ov.person) = canonical_person(t.value) then 0 else 1 end,
      t.amt desc nulls last, t.value) as rn
  from top_of t
  left join client_owner_overrides ov on ov.client_key = t.client_key
)
select c.client_key,
  max(c.company_name) as company_name,
  max(p.value) filter (where p.facet = 'pm')   as pm_owner,
  max(p.value) filter (where p.facet = 'dept') as service_dept,
  max(p.value) filter (where p.facet = 'tech') as technology
from (
  select distinct lower(regexp_replace(coalesce(company_name,''), '[^a-zA-Z0-9]', '', 'g')) as client_key,
         company_name
  from web_project_ledger where coalesce(btrim(company_name),'') <> ''
) c
left join picked p on p.client_key = c.client_key and p.rn = 1
group by c.client_key;
