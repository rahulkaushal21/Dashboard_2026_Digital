-- 095 — the sheet's project id is not always an id
--
-- Joining the ledger to the invoice API on project_id verbatim reported 195 projects
-- worth $301,905 as never invoiced. Most of them had been invoiced all along. The live
-- ledger contains:
--
--   PRJ100725033937_3            an instalment counter the sheet appends
--   PRJ091025124116   PRJ0910…   two ids typed into one cell
--   PRJ                          a placeholder with no id at all
--
-- Extracting the first well-formed PRJ id recovers 114 of those rows, $197,801. The
-- remaining 69 carry no id at all, and a report saying "no project id" is a truer
-- statement than one saying "never invoiced" — so they get their own status rather than
-- being counted as unbilled work.
--
-- Normalised in the VIEW only. The sheet is never rewritten, same rule as
-- client_name_fixes.
create or replace function ledger_project_key(raw text) returns text
language sql immutable as $$
  select (regexp_match(upper(btrim(coalesce(raw,''))), '(PRJ[0-9]{12})'))[1];
$$;

drop view if exists web_project_invoice_status;

create view web_project_invoice_status
with (security_invoker = true) as
select
  l.project_id,
  ledger_project_key(l.project_id) as project_key,
  l.row_key, l.company_name, l.project_name,
  l.booking_month, l.amount_usd as ledger_usd,
  count(i.invoice_no) as invoice_count,
  coalesce(sum(i.total_usd), 0) as invoiced_usd,
  coalesce(sum(i.total_usd) filter (where i.status = 'Paid'), 0) as paid_usd,
  array_agg(i.status order by case i.status
      when 'Overdue' then 1 when 'Draft' then 2 when 'Partially Paid' then 3
      when 'Sent' then 4 when 'Paid' then 5 when 'Void' then 6 else 7 end)
    filter (where i.invoice_no is not null) as statuses,
  min(i.due_at) as earliest_due_at,
  max(i.paid_at) as last_paid_at,
  -- 'No project id' and 'Not raised' are different facts and must not be merged: one is
  -- a gap in the sheet, the other is money nobody has asked for.
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
group by l.project_id, l.row_key, l.company_name, l.project_name, l.booking_month, l.amount_usd;
