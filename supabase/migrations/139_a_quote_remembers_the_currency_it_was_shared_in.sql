-- 139 — a quote remembers the currency it was shared in
--
-- Rahul, 7 Oct 2026: "in opportunities please add currency as well in which currency we
-- shared the quote, add it in a column, and add 1 more column of USD conversion."
--
-- The page can show it, but 418 of the 430 open deals had no currency on the row at all.
-- The Quotes tab records one (Currency Type, with the quoted figure beside it in
-- Estimated Cost), and sync_quotes_to_opportunities() reads that table every 30 minutes —
-- it just never carried those two columns across. The RFQ API (quote_api_quotes) knows the
-- currency and amount of every quote with a QUT number too. So the quoted figure existed
-- for 857 sheet deals and 237 API-matched ones, and the dashboard showed every one of them
-- as a bare dollar figure.
--
-- This fills currency + local_value from those two sources, and keeps filling: the cron
-- job that runs the Quotes sync now runs this straight after. Only a null currency is
-- filled — a currency set from the dashboard (edit dialog, confirm, fx) is never
-- overwritten, and nothing here touches est_value, which stays the USD figure every
-- total adds up. The Quotes tab writes "EURO" for euros; it is stored as EUR so it meets
-- the fx_rates row of that name.

create or replace function public.fill_opportunity_currency()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n1 integer; n2 integer;
begin
  -- 1. The Quotes tab: same key the sync uses, so the row it filled is the row this reads.
  with q as (
    select distinct on (qkey) qkey, currency_type, estimated_cost from (
      select coalesce(nullif(quote_id,''),
        case when src_row_hash ~ '^Q:[^:]*:[0-9]+$' then 'r:'||split_part(src_row_hash,':',3) else nullif(src_row_hash,'') end,
        md5(coalesce(agency,'')||coalesce(subject_project,'')||coalesce(added_date::text,'')||id::text)) as qkey,
        currency_type, estimated_cost, added_date, id
      from quotes) z
    order by qkey, added_date desc nulls last, id desc
  )
  update opportunities o set
    currency = case upper(trim(q.currency_type)) when 'EURO' then 'EUR' else upper(trim(q.currency_type)) end,
    local_value = coalesce(o.local_value, nullif(q.estimated_cost, 0))
  from q
  where q.qkey = o.quote_key and o.origin = 'sheet'
    and o.currency is null and nullif(trim(q.currency_type), '') is not null;
  get diagnostics n1 = row_count;

  -- 2. The RFQ API, by quote number, for anything the sheet did not cover (email deals
  --    whose QUT number the scan picked up).
  update opportunities o set
    currency = upper(trim(a.currency)),
    local_value = coalesce(o.local_value, nullif(a.amount, 0))
  from quote_api_quotes a
  where a.quote_no = coalesce(nullif(o.quote_id,''), o.quote_key)
    and o.currency is null and nullif(trim(a.currency), '') is not null;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;

revoke all on function public.fill_opportunity_currency() from public, anon, authenticated;

-- Run with the Quotes sync, every time it runs.
select cron.alter_job(3, command := 'select sync_quotes_to_opportunities(); select fill_opportunity_currency();');

-- And once now.
select public.fill_opportunity_currency();
