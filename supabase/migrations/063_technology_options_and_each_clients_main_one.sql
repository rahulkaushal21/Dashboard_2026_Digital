-- Technology stops being a free-text box.
--
-- It was typed by hand on every deal, which is how one stack ends up spelled 'Wordpress',
-- 'WordPress + WooCommerce' and 'WP+ React+HTML' and no report can group them. These two
-- views give the form a list to pick from and a sensible default, both derived from what
-- has actually been booked rather than from a list somebody has to maintain.

create or replace view public.web_technology_options as
select btrim(technology) as technology, count(*) as lines
from public.web_project_ledger
where coalesce(btrim(technology),'') <> ''
group by 1
having count(*) >= 2   -- a one-off spelling is noise in a picker, and still typeable
order by count(*) desc;

comment on view public.web_technology_options is
  'Technologies worth offering in a picker, commonest first, from the ledger itself.';

alter view public.web_technology_options set (security_invoker = true);
grant select on public.web_technology_options to anon, authenticated;

-- What a client is mostly built on. By REVENUE, not by the most recent line: one small
-- ad-hoc job on a different stack should not redefine an account that has been WordPress
-- for three years, which is what defaulting to the latest booking did.
create or replace view public.web_client_top_technology as
select distinct on (client_key) client_key, technology, usd
from (
  select lower(regexp_replace(coalesce(company_name,''),'[^a-zA-Z0-9]','','g')) as client_key,
         btrim(technology) as technology,
         sum(amount_usd)   as usd
  from public.web_project_ledger
  where coalesce(btrim(technology),'') <> ''
    and coalesce(company_name,'') <> ''
  group by 1, 2
) t
order by client_key, usd desc nulls last, technology;

comment on view public.web_client_top_technology is
  'The technology each client has the most revenue under — the default to offer on a new deal for them.';

alter view public.web_client_top_technology set (security_invoker = true);
grant select on public.web_client_top_technology to anon, authenticated;
