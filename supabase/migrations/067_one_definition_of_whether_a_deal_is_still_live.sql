-- The Add dialog and the Opportunities page disagreed about which deals are still live.
--
-- Point B showed "4 live deals look similar" while the page showed something else, and the
-- $5,200 one is the reason: it was CONFIRMED on the dashboard (email_won) and the Quotes
-- sheet has not caught up, so `status` still reads 'Open'. The page knows that and shows
-- it as Won. The duplicate check looked only at `won` and at the word in `status`, so it
-- offered an already-won deal as a live duplicate — the one situation the warning exists
-- to prevent, working backwards.
--
-- The rule now lives in one place. opportunity_state() mirrors the page's own derivation:
-- a booking wins, then a decision made here, then the sheet's word. The page keeps one
-- extra case SQL cannot see — a deal already invoiced in the revenue sheet — because that
-- is matched client-side against the booking rows; everything else is identical.
--
-- The two lists will still not be identical, and should not be: the page opens on your own
-- deals within a date range, while this deliberately ignores every filter. What it stops
-- doing is calling a decided deal live.

create or replace function public.opportunity_state(
  p_won boolean, p_email_won boolean, p_email_lost boolean, p_status text
) returns text
language sql immutable as $$
  select case
    when coalesce(p_won, false)       then 'Won'      -- a booking always wins
    when coalesce(p_email_won, false) then 'Won'      -- confirmed here; the sheet may not know yet
    when lower(coalesce(p_status,'')) like '%cancel%' then 'Lost'
    when lower(coalesce(p_status,'')) = 'lost'        then 'Lost'
    when coalesce(p_email_lost, false) then 'Lost'    -- marked Lost here, likewise ahead of the sheet
    when lower(coalesce(p_status,'')) like '%hold%'   then 'On Hold'
    else 'Open'
  end
$$;

comment on function public.opportunity_state(boolean, boolean, boolean, text) is
  'Whether a deal is Won, Lost, On Hold or Open — the same derivation the Opportunities page uses, so the dashboard cannot show one answer in a list and another in a dialog.';

create or replace function public.find_possible_duplicates(p_company text, p_est_value numeric default null)
returns table (id bigint, company_name text, est_value numeric, status text, origin text,
               source_date timestamptz, why text)
language sql stable security definer set search_path to 'public' as $$
  select o.id, o.company_name, o.est_value,
         -- The state, not the sheet's stale word, so the dialog says what the page says.
         public.opportunity_state(o.won, o.email_won, o.email_lost, o.status) as status,
         o.origin, o.source_date,
         case
           when public.pm_norm(o.company_name) = public.pm_norm(p_company)
            and p_est_value is not null and o.est_value is not null
            and abs(o.est_value - p_est_value) <= greatest(p_est_value * 0.05, 1) then 'same client and value'
           when public.pm_norm(o.company_name) = public.pm_norm(p_company) then 'same client'
           else 'similar value'
         end
    from public.opportunities o
   -- Still live means not decided. A deal won here but still reading Open in the sheet is
   -- decided, and offering it as a duplicate to check is the warning working backwards.
   where public.opportunity_state(o.won, o.email_won, o.email_lost, o.status) in ('Open', 'On Hold')
     and (
       public.pm_norm(o.company_name) = public.pm_norm(p_company)
       or (p_est_value is not null and o.est_value is not null
           and abs(o.est_value - p_est_value) <= greatest(p_est_value * 0.05, 1))
     )
   order by o.source_date desc nulls last
   limit 10
$$;

revoke execute on function public.find_possible_duplicates(text, numeric) from public, anon;
grant  execute on function public.find_possible_duplicates(text, numeric) to authenticated;
