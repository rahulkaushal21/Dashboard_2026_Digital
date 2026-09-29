-- Invoices already raised for this month and the months ahead, per unit.
--
-- The forecast's floor. Retainer instalments are raised in advance in the invoice app
-- (Oct–Dec 2026 already carry ~$11.7k/month of LP/Hub), so that much of each future
-- month is known without anybody typing anything. Read-only, our services only, void
-- invoices out. LP/HUB = 'Development - LP/Hub'; every other one of our services = Web.
create or replace function public.invoices_ahead()
returns table (month text, unit text, usd numeric, invoices int)
language sql stable security definer set search_path = public as $$
  select to_char(i.invoice_at, 'YYYY-MM'),
         case when li.service = 'Development - LP/Hub' then 'lp-hub' else 'web' end,
         round(sum(li.amount_usd), 2),
         count(distinct i.invoice_no)::int
  from quote_api_invoices i
  join quote_api_invoice_lines li on li.invoice_no = i.invoice_no
  where quote_api_is_ours(li.service)
    and coalesce(i.status, '') <> 'Void'
    and i.invoice_at >= date_trunc('month', now())
  group by 1, 2
$$;
revoke execute on function public.invoices_ahead() from public, anon;
grant execute on function public.invoices_ahead() to authenticated;
