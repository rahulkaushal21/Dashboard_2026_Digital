-- 099 — contractor work on the invoice report
--
-- The sheet marks outsourced work in an odd place, and the obvious column is the wrong one:
--
--   contractor_name   filled on ONE row of 1,047 since April
--   expert            filled on 1,046 — it is the assigned delivery owner, NOT a flag,
--                     but its VALUE is the literal string 'Contractor' on 123 rows
--                     worth $207,771
--   outsource_price   non-zero on 97 rows, 91 of which are those 'Contractor' rows;
--                     the other 6 carry a named internal expert and still cost us money
--
-- So contractor work is expert = 'Contractor' OR a non-zero outsource_price. Neither test
-- alone catches it, and contractor_name catches almost nothing.
--
-- CURRENCY: confirmed with the business that these are INR. Converted as INR regardless of
-- what outsource_currency says, because it says nothing on 95 of the 97 priced rows and
-- the single row labelled 'USD' holds 90,000 — which as dollars would be 43% of all
-- contractor revenue since April on one project, and as rupees is $937. The stated
-- currency is less trustworthy than the instruction. 5,478,342 INR converts to ~$55,870
-- against $196,929 billed: about 28% cost, which is the sanity check that says so.
--
-- Both are kept: outsource_local with its currency for reconciling against the sheet,
-- outsource_usd for anything that sums.
--
-- Worth recording what the split then showed: of 115 contractor projects since April,
-- NONE are 'Not raised'. Outsourced work is always invoiced. The exposure on it is 6
-- Overdue ($10,600) and 3 Draft ($7,640), not missing invoices.
drop view if exists web_project_invoice_status cascade;

create view web_project_invoice_status
with (security_invoker = true) as
select
  l.project_id,
  ledger_project_key(l.project_id) as project_key,
  l.row_key, l.company_name, l.project_name,
  l.booking_month, l.amount_usd as ledger_usd,
  l.pm_owner, l.expert, l.contractor_name,
  l.outsource_price                     as outsource_local,
  coalesce(l.outsource_currency, 'INR') as outsource_currency,
  to_usd(l.outsource_price, 'INR')      as outsource_usd,
  (coalesce(btrim(l.expert),'') = 'Contractor'
     or coalesce(l.outsource_price,0) <> 0) as is_contractor,
  count(i.invoice_no) as invoice_count,
  coalesce(sum(i.total_usd), 0) as invoiced_usd,
  coalesce(sum(i.total_usd) filter (where i.status = 'Paid'), 0) as paid_usd,
  array_agg(i.status order by case i.status
      when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
      when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end)
    filter (where i.invoice_no is not null) as statuses,
  array_agg(i.invoice_no order by i.invoice_at)
    filter (where i.invoice_no is not null) as invoice_nos,
  min(i.due_at) as earliest_due_at,
  max(i.paid_at) as last_paid_at,
  case
    when ledger_project_key(l.project_id) is null then 'No project id'
    when count(i.invoice_no) = 0 then 'Not raised'
    else (array_agg(i.status order by case i.status
            when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
            when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end))[1]
  end as status
from web_project_ledger l
left join quote_api_invoices i on i.project_id = ledger_project_key(l.project_id)
where coalesce(btrim(l.project_id), '') <> ''
group by l.project_id, l.row_key, l.company_name, l.project_name, l.booking_month,
         l.amount_usd, l.pm_owner, l.expert, l.contractor_name, l.outsource_price,
         l.outsource_currency;

create materialized view project_invoice_status_mv as
  select * from web_project_invoice_status;
create unique index project_invoice_status_mv_key on project_invoice_status_mv(row_key);
create index project_invoice_status_mv_status on project_invoice_status_mv(status);
create index project_invoice_status_mv_month on project_invoice_status_mv(booking_month);
create index project_invoice_status_mv_contractor on project_invoice_status_mv(is_contractor);

create or replace function refresh_invoice_sources() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently project_invoice_status_mv;
  refresh materialized view concurrently deal_lifecycle_mv;
  refresh materialized view concurrently invoice_reconciliation_mv;
end $$;
revoke execute on function refresh_invoice_sources() from public, anon, authenticated;
