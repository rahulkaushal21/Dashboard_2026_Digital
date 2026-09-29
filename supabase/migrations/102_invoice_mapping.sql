-- 102 — Invoice mapping: the month's sheet rows against the invoices raised for them
--
-- The Reconciliation tab asks "which invoices does the sheet not know about". This asks
-- the opposite, the one an AM acts on: of the work booked in the revenue sheet for a
-- month, what has been INVOICED and what is still waiting to be raised? Payment status is
-- deliberately out of scope (Pratik, 29 Sep 2026) — raised is the question.
--
-- One call per month, computed on demand: a month is ~130 sheet rows and the ledger read
-- is ~0.4s, so a materialised copy would only add a staleness problem.
--
-- HOW A SHEET ROW FINDS ITS INVOICE — every key both systems independently record,
-- strongest first (the lesson of migration 100: one identifier is not a reconciliation):
--   1. invoice no   — the sheet's own Invoice No cell names the invoice (or its base,
--                     for an instalment INV…_3). Typed by a person looking at the invoice.
--   2. project id   — the sheet's Project Id = the invoice's. For a RECURRING engagement
--                     (instalment invoices, INV…_N) the invoice must fall within a month of
--                     the booking month, or August's instalment would mark September raised.
--                     A one-off project may be invoiced any time; the closest wins.
--   3. client+value — client name stem and the amount within 2% (min $5), a month either
--                     side. Catches renewals where neither id lines up.
-- Ties go to the closest month, then the closest value.
--
-- VALUE is checked per INVOICE, not per row: one invoice routinely carries several sheet
-- lines (a retainer plus an ad-hoc), so the sheet lines mapped to an invoice are summed
-- and that sum is compared with the invoice's own-service total.
--
-- DEPARTMENT of an invoice comes from its lines' service: 'Development - LP/Hub' is
-- LP/HUB; Development - Web, AI & Automation - WEB and Design - Digital are Web. A sheet row
-- keeps its own Service Department. When the two disagree the row says so in `note` —
-- e.g. an LP job invoiced under Development - Web — but it still counts as raised.
--
-- Void invoices are never a match: a voided invoice raised nothing.

create or replace function public.invoice_mapping(p_month date)
returns table (
  row_type        text,      -- 'sheet' | 'invoice' (invoiced in the month, no sheet row mapped)
  row_key         text,
  company_name    text,
  project_name    text,
  service_dept    text,
  pm_owner        text,
  sales_person    text,
  delivery_status text,
  start_date      date,
  sheet_usd       numeric,
  project_id      text,
  sheet_invoice_no text,
  invoice_no      text,
  invoice_date    date,
  invoice_status  text,
  invoice_client  text,
  invoice_usd     numeric,   -- the invoice's total across OUR services
  invoice_services text,
  group_sheet_usd numeric,   -- all sheet lines this month mapped to the same invoice
  matched_by      text,      -- 'invoice no' | 'project id' | 'client + value'
  state           text,      -- 'Invoiced' | 'Part invoiced' | 'Value differs' | 'To raise' | 'Awaiting info' | 'Not in sheet'
  note            text
)
language sql stable security definer set search_path = public as $$
with p as (select date_trunc('month', p_month)::date as m),
L as materialized (
  select l.row_key, l.company_name, l.project_name, l.service_dept, l.pm_owner, l.sales_person,
         l.delivery_status, l.start_date, coalesce(l.amount_usd, 0) as sheet_usd,
         l.project_id, l.invoice_no as sheet_invoice_no,
         ledger_project_key(l.project_id) as pkey,
         array(select upper(x) from regexp_split_to_table(coalesce(l.invoice_no, ''), '[\s,;/&]+') x
               where x ~* '^INV') as inv_keys,
         client_stem(l.company_name) as cstem
  from web_project_ledger l, p
  where l.booking_month = p.m
    and coalesce(l.delivery_status, '') !~* 'cancel'
),
I as materialized (
  -- Keys worked out ONCE per invoice. Comparing every sheet row with every invoice and
  -- normalising both sides inside the comparison ran 11s — over the 8s API limit.
  select i.invoice_no, i.project_id,
         coalesce(nullif(btrim(i.company_name), ''), i.zoho_company) as client,
         i.status, i.invoice_at::date as d, date_trunc('month', i.invoice_at)::date as im,
         (i.invoice_no ~ '_[0-9]+$') as instalment,
         upper(i.invoice_no) as inv_u,
         upper(regexp_replace(i.invoice_no, '_[0-9]+$', '')) as base_u,
         ledger_project_key(i.project_id) as pkey,
         client_stem(coalesce(nullif(btrim(i.company_name), ''), i.zoho_company)) as cstem,
         sum(li.amount_usd) as usd,
         coalesce(sum(li.amount_usd) filter (where li.service = 'Development - LP/Hub'), 0) as lp_usd,
         string_agg(distinct li.service, ', ' order by li.service) as services
  from quote_api_invoices i
  join quote_api_invoice_lines li on li.invoice_no = i.invoice_no, p
  where quote_api_is_ours(li.service)
    and coalesce(i.status, '') <> 'Void'
    and i.invoice_at >= p.m - interval '12 months'
    and i.invoice_at <  p.m + interval '6 months'
  group by i.invoice_no, i.project_id, i.company_name, i.zoho_company, i.status, i.invoice_at
),
LK as (select L.row_key, k from L, unnest(L.inv_keys) k),
-- Three lookups, each an equality join on a key both sides hold, instead of every pair.
C as (
  select LK.row_key, I.invoice_no, 1 as rnk, I.im, I.usd
  from LK join I on I.inv_u = LK.k
  union all
  -- The sheet names a retainer's BASE number (INV…) and the app bills INV…_1, _2…: only
  -- the instalment within a month of this booking is this month's invoice.
  select LK.row_key, I.invoice_no, 1, I.im, I.usd
  from LK join I on I.base_u = LK.k and I.inv_u <> LK.k
  where abs(I.im - (select m from p)) <= 31
  union all
  select L.row_key, I.invoice_no, 2, I.im, I.usd
  from L join I on I.pkey = L.pkey
  where abs(I.im - (select m from p)) <= 31 or not I.instalment
  union all
  select L.row_key, I.invoice_no, 3, I.im, I.usd
  -- Prefix of the client stem. The app sometimes holds a SHORT name ("2X" for
  -- "2x Marketing"), so a stem under 4 characters matches as a prefix of the sheet's.
  from L join I on left(I.cstem, 4) = left(L.cstem, 4)
                or (length(I.cstem) between 2 and 3 and L.cstem like I.cstem || '%')
  where length(L.cstem) >= 4
    and (I.cstem like left(L.cstem, 5) || '%' or L.cstem like left(I.cstem, 5) || '%')
    and abs(I.usd - L.sheet_usd) <= greatest(5, 0.02 * L.sheet_usd)
    and abs(I.im - (select m from p)) <= 31
),
C2 as (
  select C.row_key, C.invoice_no, C.rnk,
         abs(C.im - (select m from p)) as mdist,
         abs(C.usd - L.sheet_usd) as vdist
  from C join L using (row_key)
),
B0 as materialized (
  select distinct on (row_key) row_key, invoice_no, rnk, mdist, vdist
  from C2
  order by row_key, rnk, mdist, vdist
),
-- A client + value match is a guess, so it may claim an invoice only once, and never one
-- an id already claimed: two $400 lines for one client must not both land on a single
-- $400 invoice and make it look under-billed.
-- A client + value match is a guess, so it is paired ONE TO ONE, and never onto an
-- invoice an id already claimed. Two $400 lines for a client with two $400 invoices get
-- one each — not both landing on the first and one wrongly left "to raise".
B12 as (select row_key, invoice_no, rnk, mdist from B0 where rnk < 3),
C3 as (
  select C2.*, left(L.cstem, 4) || ':' || round(L.sheet_usd)::text as grp
  from C2 join L using (row_key)
  where C2.rnk = 3
    and not exists (select 1 from B12 where B12.row_key = C2.row_key)
    and not exists (select 1 from B12 where B12.invoice_no = C2.invoice_no)
),
A3 as (
  select row_key, invoice_no, rnk, mdist from (
    select *, row_number() over (partition by invoice_no order by row_key) as once
    from (
      select *, dense_rank() over (partition by grp order by row_key) as rr,
                dense_rank() over (partition by grp order by invoice_no) as ri
      from C3
    ) r where rr = ri
  ) t where once = 1
),
B as (select * from B12 union all select * from A3),
G as (select invoice_no, sum(L.sheet_usd) as grp from B join L using (row_key) group by invoice_no)
select
  'sheet', L.row_key, L.company_name, L.project_name, L.service_dept, L.pm_owner, L.sales_person,
  L.delivery_status, L.start_date, L.sheet_usd, L.project_id, L.sheet_invoice_no,
  I.invoice_no, I.d, I.status, I.client, I.usd, I.services, G.grp,
  case B.rnk when 1 then 'invoice no' when 2 then 'project id' when 3 then 'client + value' end,
  case
    when B.row_key is not null and abs(G.grp - I.usd) <= greatest(5, 0.02 * I.usd) then 'Invoiced'
    -- Less invoiced than booked: an advance or a first instalment, more to raise.
    when B.row_key is not null and I.usd < G.grp then 'Part invoiced'
    when B.row_key is not null then 'Value differs'
    when L.delivery_status ~* 'awaiting' then 'Awaiting info'
    else 'To raise'
  end,
  nullif(concat_ws(' · ',
    case when B.row_key is null and L.pkey is null then 'No project ID in the sheet' end,
    case when B.row_key is not null and abs(G.grp - I.usd) > greatest(5, 0.02 * I.usd)
         then 'Invoice $' || round(I.usd)::text || ' vs sheet $' || round(G.grp)::text end,
    case when B.row_key is not null and B.mdist > 31 then 'Invoiced ' || to_char(I.d, 'Mon YYYY') end,
    case when B.row_key is not null and upper(coalesce(L.service_dept, '')) in ('LP', 'HUB', 'LP/HUB') and I.lp_usd = 0
         then 'Invoiced under ' || I.services end,
    case when B.row_key is not null and upper(coalesce(L.service_dept, '')) like 'WEB%' and I.lp_usd > 0 and I.lp_usd >= I.usd
         then 'Invoiced under Development - LP/Hub' end
  ), '')
from L
left join B on B.row_key = L.row_key
left join I on I.invoice_no = B.invoice_no
left join G on G.invoice_no = B.invoice_no

union all

-- Invoices dated in the month that no sheet row of the month maps to. Shown so the two
-- totals at the top can be reconciled line by line, not only as a difference.
select
  'invoice', I.invoice_no, I.client, null,
  case when I.lp_usd >= I.usd / 2 then 'LP/HUB' else 'WEB' end,
  null, null, null, null, null, I.project_id, null,
  I.invoice_no, I.d, I.status, I.client, I.usd, I.services, null, null,
  'Not in sheet', null
from I, p
where I.im = p.m
  and not exists (select 1 from B where B.invoice_no = I.invoice_no);
$$;

revoke execute on function public.invoice_mapping(date) from public, anon;
grant execute on function public.invoice_mapping(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Refresh on demand: pull the invoice app and the revenue sheet NOW rather than at the
-- next hourly run. Runs the SAME commands the cron jobs run (read from cron.job), so the
-- endpoints and their tokens stay in one place, server-side, and never reach a browser.
-- The fetches are asynchronous (pg_net); the page watches sync_runs for both to report
-- back, then calls refresh_invoice_views() so the invoice pages pick the new data up.
create or replace function public.request_invoice_refresh()
returns timestamptz
language plpgsql security definer set search_path = public, cron as $$
declare c text; started timestamptz := now();
begin
  if not (is_registered_pm() or is_dashboard_admin()) then
    raise exception 'Only registered PMs and admins can refresh the invoice data';
  end if;
  for c in select command from cron.job where jobname in ('quote-api-sync', 'sheet-raw-revenue') loop
    execute c;
  end loop;
  return started;
end $$;
revoke execute on function public.request_invoice_refresh() from public, anon;
grant execute on function public.request_invoice_refresh() to authenticated;

create or replace function public.refresh_invoice_views()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_registered_pm() or is_dashboard_admin()) then
    raise exception 'Only registered PMs and admins can refresh the invoice data';
  end if;
  perform refresh_invoice_sources();
end $$;
revoke execute on function public.refresh_invoice_views() from public, anon;
grant execute on function public.refresh_invoice_views() to authenticated;
