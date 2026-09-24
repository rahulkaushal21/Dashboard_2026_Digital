-- A PM's business number is the lines with THEIR NAME on them.
--
-- Not the lines belonging to clients they own. Those are two different questions and the
-- dashboard was answering the wrong one: scoped to "my accounts", it filtered revenue by
-- who owns the CLIENT, so an account two people share by service put the whole month on
-- one of them and nothing on the other.
--
-- Checked against the revenue sheet's own Q2 pivot, per person per month, the rule that
-- reproduces it is simply: sum the lines whose PC/SME cell is this person. Every one of
-- the eleven PMs lands within $4 for the quarter, which is the known rounding in the
-- revenue export — it rounds to whole dollars before we ever see it.
--
--     pivot            here
--     Afzal   62,689   62,689     Maitri  43,137   43,139
--     Bonny   59,451   59,448     Malay   46,456   46,456
--     Gagan   74,709   74,705     Nitin   40,214   40,213
--     Gaurav  96,861   96,861     Paryusha 40,679  40,680
--     Madhav  15,963   15,962     Rahul J 25,447   25,447
--     Sankalp 27,118   27,118
--
-- Client ownership is still the right question for escalations, feedback and Client 360:
-- those name only a company, so ownership has to come from somewhere. Money names a person.
--
-- BY START DATE, and Cancelled, On Hold and Awaiting Information do not count. Both come
-- from the same pivot — it reads 'Start Date - Year-Month', and it leaves those three out.

create or replace function public.counts_as_revenue(p_status text)
returns boolean language sql immutable as $$
  -- Awaiting Information is a quote, not money. Cancelled did not happen. On Hold has not
  -- happened yet and may not. $30,354 across 31 lines, none of it after June 2026 — so
  -- this corrects the record without moving the current quarter.
  select coalesce(p_status, '') !~* 'awaiting|on hold|cancel';
$$;

comment on function public.counts_as_revenue(text) is
  'Whether a delivery status counts as booked revenue. Matches the revenue sheet pivot: Awaiting Information, On Hold and Cancelled are excluded.';

create or replace view public.web_pm_business_numbers as
select public.canonical_person(btrim(part))        as pm,
       to_char(l.start_date, 'YYYY-MM')            as month,
       sum(l.amount_usd)                           as usd,
       count(*)                                    as lines
from public.web_project_ledger l,
     lateral unnest(regexp_split_to_array(coalesce(l.pm_owner,''), '\s*(,|/|&|\band\b)\s*')) as t(part)
where coalesce(btrim(part),'') <> ''
  and l.start_date is not null
  and public.counts_as_revenue(l.delivery_status)
group by 1, 2;

comment on view public.web_pm_business_numbers is
  'What each PM booked, per month, on the same basis as the revenue sheet pivot: the lines carrying their name, by Start Date, excluding Awaiting Information, On Hold and Cancelled.';

alter view public.web_pm_business_numbers set (security_invoker = true);
grant select on public.web_pm_business_numbers to anon, authenticated;
