-- The one thing that could overstate revenue from 1 October, and a guard against it.
--
-- Until now every booked line came from one place: the revenue sheet. From 1 October a
-- line can also be born here, when a PM confirms a deal. The ledger unions the two, and
-- NOTHING in that union checks whether the same job exists on both sides. If someone
-- confirms a deal here and also types it into the old sheet — which is exactly what
-- people will do for the first few weeks, out of habit — it books twice, and the month
-- is overstated by a real amount with nothing saying so.
--
-- This finds them. Same client, same money to within a dollar, same month, one from each
-- side. It does NOT hide anything: a false positive here is two genuinely similar jobs in
-- one month for one client, which happens, so the decision stays with a person. Hiding
-- one automatically would be the same mistake in the other direction.

create or replace view public.web_possible_double_count as
select d.row_key      as dashboard_row,
       s.row_key      as sheet_row,
       d.company_name,
       d.project_name as dashboard_project,
       s.project_name as sheet_project,
       d.amount_usd   as dashboard_usd,
       s.amount_usd   as sheet_usd,
       coalesce(d.start_date, d.booking_month) as dashboard_month,
       coalesce(s.start_date, s.booking_month) as sheet_month,
       d.confirmed_by,
       d.confirmed_at
from public.web_project_ledger d
join public.web_project_ledger s
  on s.source = 'raw'
 and d.source <> 'raw'
 and lower(regexp_replace(coalesce(s.company_name,''),'[^a-zA-Z0-9]','','g'))
   = lower(regexp_replace(coalesce(d.company_name,''),'[^a-zA-Z0-9]','','g'))
 and abs(coalesce(s.amount_usd,0) - coalesce(d.amount_usd,0)) <= 1
 and to_char(coalesce(s.start_date, s.booking_month),'YYYY-MM')
   = to_char(coalesce(d.start_date, d.booking_month),'YYYY-MM');

comment on view public.web_possible_double_count is
  'Jobs that appear to have been booked twice — once confirmed in the dashboard and once typed into the revenue sheet. Same client, same amount, same month. Empty is the expected state.';

alter view public.web_possible_double_count set (security_invoker = true);
grant select on public.web_possible_double_count to anon, authenticated;
