-- The work list: what the system cannot work out for itself.
--
-- Everything derivable IS derived — mail is read, quote values are parsed from the RFQ
-- notifications, intent is scored, client names are canonicalised, deals are matched
-- against revenue. What no amount of automation can produce is a number nobody has
-- written down and a decision nobody has made. Those two things, plus deals somebody
-- started confirming and left half-done, are the whole of this queue.
--
-- ONE ROW PER DEAL, under its most urgent reason. A deal that is both missing a value
-- and awaiting confirmation is one piece of work, not two; listing it twice would make
-- the queue look worse than it is and teach people to skim it. The `order by priority
-- limit 1` in the lateral join is what enforces that.
--
-- The bar for a fourth reason should be high. The review flags on Opportunities once
-- fired on 83% of open deals and buried the handful that mattered — a queue nobody can
-- clear is a queue nobody reads.

-- Whose job is this deal? A web PM is named in pm_owner; NBD is named as the account
-- owner. Falls back in that order, and returns NULL for a deal nobody recognisable owns
-- — which the page surfaces, because an unowned deal is admin-only and otherwise sits
-- in a list nobody feels responsible for.
create or replace function public.opportunity_owner_email(p_pm_owner text, p_sales_person text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.email from public.pm_directory d
      where d.active and d.team = 'web' and public.directory_owner_match(p_pm_owner, d.email) limit 1),
    (select d.email from public.pm_directory d
      where d.active and d.team = 'nbd' and public.directory_owner_match(p_sales_person, d.email) limit 1)
  )
$$;

revoke execute on function public.opportunity_owner_email(text, text) from public, anon;
grant  execute on function public.opportunity_owner_email(text, text) to authenticated, service_role;

-- security_invoker so the view answers with the CALLER's rights rather than the owner's.
-- Three existing views are flagged by the security linter for exactly this; a new one
-- should not add a fourth.
create or replace view public.web_needs_input
with (security_invoker = true) as
with live as (
  select o.*, coalesce(o.source_date, o.first_date) as deal_date
    from public.opportunities o
   where coalesce(o.won,false) = false
     and lower(coalesce(o.status,'')) not like '%lost%'
     and lower(coalesce(o.status,'')) not like '%cancel%'
)
select l.id, l.company_name, l.est_value, l.currency, l.status, l.origin,
       l.pm_owner, l.sales_person, l.deal_date,
       public.opportunity_owner_email(l.pm_owner, l.sales_person) as owner_email,
       greatest(0, (current_date - l.deal_date::date)) as days_waiting,
       r.reason, r.detail, r.priority
  from live l
  join lateral (
    select * from (values
      ('confirm_started',      'Marked won here but never completed - finish the details so it books.', 1,
        (l.email_won is true)),
      ('awaiting_confirmation','The client has committed in writing - confirm it.',                     2,
        exists (select 1 from public.web_quote_intent i where i.id = l.id and i.flag_committed_in_email)),
      ('missing_value',        'No quoted value, so it cannot be forecast, scored or confirmed.',       3,
        (coalesce(l.est_value,0) = 0))
    ) as v(reason, detail, priority, hit)
     where v.hit
     order by v.priority
     limit 1
  ) r on true;

revoke all on public.web_needs_input from anon, public;
grant select on public.web_needs_input to authenticated;
