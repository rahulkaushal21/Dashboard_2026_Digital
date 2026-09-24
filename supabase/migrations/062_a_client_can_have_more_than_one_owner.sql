-- A client can have more than one owner, and the data has always said so.
--
-- Ownership was recorded as ONE name in clients.pc_sme, and everything that asks "is this
-- mine" asked that column. But the work is split by service: ZULU 8's record says Nitin
-- Mishra while $16,194 of its last two quarters were delivered by Maitri Shah. So Maitri
-- signs in, the dashboard filters to "my accounts", and her own revenue is missing —
-- reported as "$9,072 in the revenue sheet, not in her dashboard". The same single name
-- sent ZULU 8's client feedback to Nitin's scorecard instead of hers.
--
-- It is not one odd client. Across this financial year 40 clients have revenue under more
-- than one person (Klick under three, Vested under four), and on 11 the record's owner is
-- not even the person who delivered most of the money.
--
-- So ownership stops being a name and becomes a set, derived from what people actually
-- did rather than from a column somebody has to remember to update:
--
--   * anyone with revenue lines against the client       (by dollars, which is the truth)
--   * anyone named on one of its opportunities           (current work, before it books)
--   * whoever the client record names                    (still an owner, never the only one)
--
-- A cell naming two people ("Malav Modi / Kalgi Shah") is split, so the sheet's own way of
-- recording shared work is read rather than dropped. is_primary marks the one to show when
-- there is only room for one: most revenue wins, and the record's owner breaks a tie.
--
-- NOTHING IS REASSIGNED. Nitin keeps ZULU 8 and Maitri gains it. Taking it off him would
-- be a second wrong guess, and both of them work on it.

create or replace view public.web_client_owners as
with keyed as (
  -- Revenue lines. Dollars, not row counts: one $40k booking is a stronger claim on a
  -- client than twelve $200 ad-hoc jobs.
  select lower(regexp_replace(coalesce(r.company_name,''),'[^a-zA-Z0-9]','','g')) as client_key,
         btrim(part)      as person,
         r.booking_amount as usd,
         'line'           as src
  from public.web_revenue_lines r,
       lateral unnest(regexp_split_to_array(coalesce(r.sme,''), '\s*(,|/|&|\band\b)\s*')) as t(part)
  where coalesce(btrim(part),'') <> ''

  union all

  -- Open and won deals, so somebody who has just picked up a client is an owner before
  -- the first line books rather than a month later.
  select lower(regexp_replace(coalesce(o.company_name,''),'[^a-zA-Z0-9]','','g')),
         btrim(part), 0, 'opp'
  from public.opportunities o,
       lateral unnest(regexp_split_to_array(coalesce(o.pm_owner,''), '\s*(,|/|&|\band\b)\s*')) as t(part)
  where coalesce(btrim(part),'') <> ''

  union all

  -- The client record. Still an owner even with no lines of their own — it is how a PM
  -- who has just been handed an account is known before they have done anything.
  select lower(regexp_replace(coalesce(c.company_name,''),'[^a-zA-Z0-9]','','g')),
         btrim(part), 0, 'record'
  from public.clients c,
       lateral unnest(regexp_split_to_array(coalesce(c.pc_sme,''), '\s*(,|/|&|\band\b)\s*')) as t(part)
  where coalesce(btrim(part),'') <> ''
),
rolled as (
  select client_key,
         public.canonical_person(person) as person,
         sum(usd)                                as usd,
         count(*) filter (where src = 'line')    as lines,
         bool_or(src = 'record')                 as on_record,
         bool_or(src = 'opp')                    as on_deal
  from keyed
  where client_key <> ''
  group by 1, 2
)
select client_key,
       person,
       usd,
       lines,
       on_record,
       on_deal,
       -- One owner has to be nameable when there is only room for one — a table cell, a
       -- chart label. Most money wins; the record's owner breaks a tie, because with no
       -- revenue either way that column is the only evidence there is.
       row_number() over (partition by client_key order by usd desc, on_record desc, person) = 1 as is_primary
from rolled;

comment on view public.web_client_owners is
  'Everyone who owns a client: anyone with revenue lines against them, anyone named on their deals, and whoever the client record names. One row per client per person. is_primary is the one to show where only one name fits.';

alter view public.web_client_owners set (security_invoker = true);
grant select on public.web_client_owners to anon, authenticated;

-- The same answer as one row per client, for the pages that want a name to print rather
-- than a set to test against. Primary first, then by revenue.
create or replace view public.web_client_owner_names as
select client_key,
       string_agg(person, ', ' order by is_primary desc, usd desc, person) as owners,
       count(*)                                                            as owner_count,
       max(person) filter (where is_primary)                               as primary_owner
from public.web_client_owners
group by client_key;

comment on view public.web_client_owner_names is
  'web_client_owners flattened to one row per client: every owner in one string, primary first.';

alter view public.web_client_owner_names set (security_invoker = true);
grant select on public.web_client_owner_names to anon, authenticated;

-- Anyone who owns the client can confirm its deals.
--
-- Until now only the person NAMED ON THE DEAL could, which on a shared client meant the
-- work sat waiting for whichever of the two happened to be in the cell — and on an
-- unowned deal, waiting for an admin. Co-ownership is the whole point of the view above;
-- if the dashboard shows a client as Maitri's and Nitin's, both must be able to act on it.
--
-- The team rule from 023 is kept exactly: a web person is matched against pm_owner, an
-- NBD person against sales_person, and someone on neither team still confirms nothing.
-- The new branch only widens the web side, because web_client_owners is built from the
-- delivery columns and says nothing about who sells.
create or replace function public.can_confirm_opportunity(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.jwt_email() is null then false
    when public.is_dashboard_admin() then true
    else exists (
      select 1
        from public.opportunities o
        join public.pm_directory d
          on d.active and d.email = public.jwt_email()
       where o.id = p_id
         and case d.team
               when 'web' then public.directory_owner_match(o.pm_owner, d.email)
                              or exists (
                                   select 1 from public.web_client_owners w
                                    where w.client_key = lower(regexp_replace(coalesce(o.company_name,''),'[^a-zA-Z0-9]','','g'))
                                      and public.pm_norm(w.person) = any (d.aliases)
                                 )
               when 'nbd' then public.directory_owner_match(o.sales_person, d.email)
               else false
             end)
  end
$$;

revoke execute on function public.can_confirm_opportunity(bigint) from public, anon;
grant  execute on function public.can_confirm_opportunity(bigint) to authenticated, service_role;
