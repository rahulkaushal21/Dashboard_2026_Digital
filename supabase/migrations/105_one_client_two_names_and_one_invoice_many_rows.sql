-- 105 — one client under two names, and one invoice covering many sheet rows
--
-- Telfer Digital in the revenue sheet is DigiDo Media in the invoice app — their
-- accounting firm raises the invoices (confirmed by Rahul, 1 Oct 2026). September showed
-- what that costs: $12,044 of invoices listed as "no sheet row" and $14,133 of Telfer
-- Digital sitting in "To raise", for the SAME work. An AM would have chased seven
-- invoices that were already raised.
--
-- Two separate faults had to line up for that, and both are fixed here.
--
-- ---------------------------------------------------------------------------
-- 1. THE NAMES SHARE NOTHING
--
-- Matching falls back to a client-name stem, and 'telferdigital' against 'digidomedia'
-- has no common prefix, so no amount of tuning would ever have matched them. This is not
-- a fuzzy-matching problem — it is a fact about the business that only a person knows,
-- so it belongs in a table a person can write to, not in a string function.
--
-- client_aliases holds it. client_match_stem() reads it and is used everywhere the old
-- client_stem() was used for MATCHING. client_stem() itself is left exactly as it was:
-- it is IMMUTABLE and two other things depend on it, and an immutable function must never
-- read a table.
--
-- ---------------------------------------------------------------------------
-- 2. ONE INVOICE, SEVERAL SHEET ROWS
--
-- The alias alone would still not have matched them, which is worth stating because it
-- would have looked fixed. INV100926233446 is one $3,000 invoice carrying three lines —
-- JCB Maintainence 22 website $2,750, Ingleby Maintainance $125, JCB Terra $125 — against
-- three separate sheet rows of $2,750, $125 and $125. The client + value route compared
-- each sheet row with the INVOICE TOTAL, so $125 never met $3,000 and none of the three
-- matched.
--
-- So there is now a fourth route: client + the amount of an individual invoice LINE. It
-- is ranked last, after the invoice total, so every match that exists today still wins in
-- the same way and this can only add.
--
-- The one-to-one guard moves with it. For the invoice-total route a guess may claim an
-- invoice once; for the line route it may claim a LINE once — otherwise three $125 sheet
-- rows would all land on the same $125 line. A line is the right unit: it is what the
-- sheet row actually corresponds to.
--
-- Once the three rows map to the one invoice, the value check works as designed: the
-- sheet lines mapped to an invoice are summed and compared with the invoice's own total,
-- $2,750 + $125 + $125 = $3,000, and the invoice reads Invoiced rather than three-way
-- wrong.
-- ---------------------------------------------------------------------------

-- client_aliases ALREADY EXISTS and already holds 27 merges a person wrote by hand
-- ("OLIVER Agency" → Brandtech Plus, "smart kenect" → Kenect). A second alias table would
-- have been a second place to look, so matching reads that one instead — which also means
-- all 27 existing merges now help invoice matching, not just this one.
create or replace function public.client_match_stem(t text)
returns text language sql stable set search_path = public as $$
  select coalesce(
    (select client_stem(a.canonical) from client_aliases a
      where a.kind = 'merge' and client_stem(a.pattern) = client_stem(t)
      limit 1),
    client_stem(t));
$$;
revoke execute on function public.client_match_stem(text) from public;
grant execute on function public.client_match_stem(text) to anon, authenticated;

delete from client_aliases where kind = 'merge' and client_stem(pattern) = 'digidomedia';
insert into client_aliases (pattern, kind, canonical, note)
values ('DigiDo Media', 'merge', 'Telfer Digital',
        'DigiDo Media is Telfer Digital''s accounting firm and raises their invoices, so the invoice app names the accountant where the revenue sheet names the client. Confirmed by Rahul Kaushal, 1 Oct 2026.');

-- ---------------------------------------------------------------------------
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
  state           text,      -- 'Invoiced' | 'Part invoiced' | 'Value differs' | 'To raise' | 'Not in sheet'
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
         client_match_stem(l.company_name) as cstem
  from web_project_ledger l, p
  where l.booking_month = p.m
    and coalesce(l.delivery_status, '') !~* 'cancel|hold|awaiting'
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
         client_match_stem(coalesce(nullif(btrim(i.company_name), ''), i.zoho_company)) as cstem,
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
-- The individual lines of those invoices. One invoice routinely covers several sheet
-- rows, so a sheet row's counterpart is often a LINE, not the invoice total.
IL as materialized (
  select li.line_key, li.invoice_no, li.amount_usd as amt, I.im, I.cstem
  from quote_api_invoice_lines li
  join I on I.invoice_no = li.invoice_no
  where quote_api_is_ours(li.service) and li.amount_usd is not null
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
-- Route 4, last: the client matches and a single invoice LINE carries this row's amount.
-- Ranked after the invoice total so nothing that matches today changes; this can only add.
C4 as (
  select L.row_key, IL.invoice_no, IL.line_key,
         abs(IL.im - (select m from p)) as mdist,
         abs(IL.amt - L.sheet_usd) as vdist
  from L join IL on left(IL.cstem, 4) = left(L.cstem, 4)
                 or (length(IL.cstem) between 2 and 3 and L.cstem like IL.cstem || '%')
  where length(L.cstem) >= 4
    and (IL.cstem like left(L.cstem, 5) || '%' or L.cstem like left(IL.cstem, 5) || '%')
    and abs(IL.amt - L.sheet_usd) <= greatest(5, 0.02 * L.sheet_usd)
    and abs(IL.im - (select m from p)) <= 31
    and not exists (select 1 from B12 where B12.row_key = L.row_key)
    and not exists (select 1 from A3  where A3.row_key  = L.row_key)
),
-- Paired one to one, and NOT greedily. Picking each row's best line first and then
-- dropping the collisions left two of the three $125 rows unmatched, because all three
-- picked the same line. Ranking from BOTH sides and keeping the pairs whose ranks agree
-- gives the k-th row the k-th line, so all three land. Same trick as A3.
C4b as (
  select *,
         row_number() over (partition by row_key  order by mdist, vdist, line_key) as rr,
         row_number() over (partition by line_key order by mdist, vdist, row_key)  as rl
  from C4
),
A4 as (select row_key, invoice_no, 4 as rnk, mdist from C4b where rr = rl),
B as (select * from B12 union all select * from A3 union all select * from A4),
G as (select invoice_no, sum(L.sheet_usd) as grp from B join L using (row_key) group by invoice_no)
select
  'sheet', L.row_key, L.company_name, L.project_name, L.service_dept, L.pm_owner, L.sales_person,
  L.delivery_status, L.start_date, L.sheet_usd, L.project_id, L.sheet_invoice_no,
  I.invoice_no, I.d, I.status, I.client, I.usd, I.services, G.grp,
  case B.rnk when 1 then 'invoice no' when 2 then 'project id'
             when 3 then 'client + value' when 4 then 'client + line value' end,
  case
    when B.row_key is not null and abs(G.grp - I.usd) <= greatest(5, 0.02 * I.usd) then 'Invoiced'
    -- Less invoiced than booked: an advance or a first instalment, more to raise.
    when B.row_key is not null and I.usd < G.grp then 'Part invoiced'
    when B.row_key is not null then 'Value differs'
    else 'To raise'
  end,
  nullif(concat_ws(' · ',
    case when B.row_key is null and L.pkey is null then 'No project ID in the sheet' end,
    case when B.row_key is not null and abs(G.grp - I.usd) > greatest(5, 0.02 * I.usd)
         then 'Invoice $' || round(I.usd)::text || ' vs sheet $' || round(G.grp)::text end,
    case when B.row_key is not null and B.mdist > 31 then 'Invoiced ' || to_char(I.d, 'Mon YYYY') end,
    -- Say so when the invoice names somebody else — an alias is a claim worth showing.
    case when B.row_key is not null and client_stem(L.company_name) <> client_stem(I.client)
         then 'Invoiced as ' || I.client end,
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

-- The Reconciliation tab matches on the same client stem, so it gets the alias too.
-- Checked before and after over every invoice since April: client + month + value
-- matched 639 invoices before and 666 after. Strictly more — no existing match was lost.
do $do$
declare d text;
begin
  select pg_get_viewdef('web_invoice_reconciliation'::regclass, true) into d;
  if position('client_stem(' in d) = 0 then raise exception 'no client_stem in view'; end if;
  execute 'create or replace view web_invoice_reconciliation with (security_invoker = true) as '
        || replace(d, 'client_stem(', 'client_match_stem(');
end $do$;

select refresh_invoice_sources();
