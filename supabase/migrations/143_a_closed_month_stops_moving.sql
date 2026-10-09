-- A closed month stops moving, and corrections go forward
-- =======================================================
--
-- Two changes. The first makes the booking figure match the invoice app's own export
-- exactly. The second stops it drifting afterwards.
--
--
-- PART ONE — how an invoice books
-- -------------------------------
-- web_invoice_bookings counted an invoice once, in full, in the month of its booking
-- date. The app does not. Against Rahul's October export of $69,879.39 we were $642.26
-- out, and it was three rules, not a filter:
--
--  1. A MULTI-MONTH LINE SPREADS. `frequency` says over how long — Yearly 12 months,
--     Half yearly 6, Quarterly 3, Monthly and blank 1. Vericast's $8,568 maintenance
--     line is Yearly, 08 Mar 2026 to 07 Mar 2027, and the app books $660.42 into each of
--     those twelve months. We booked the whole $8,568 into March and nothing after.
--     Layer 8 Training is $700 Quarterly across Aug-Oct 2026, $233.33 a month. Only 9
--     lines in the table are not Monthly or blank, so the rule is narrow — but it is the
--     one that silently lost the later months of every annual retainer.
--
--  2. A DISCOUNT IS SHARED EQUALLY ACROSS THE SERVICE LINES, not pro rata by value.
--     Searchmarketingpros carries Web $4,200, SEM $3,885, SEO $3,875 and -$239.20.
--     Pro rata would put $83.99 on the web line; the app puts $239.20/3 = $79.73, giving
--     $4,120.27. Tax, fees, wallet and reimbursement lines are not service lines and are
--     excluded from both the discount and the divisor.
--
--  3. AN INVOICE BOOKS WHEN IT IS RAISED. `invoice_at <= now()`, not a status test.
--     Status was giving the wrong answer anyway (migration 142: seven October invoices
--     read Draft only because the sync had not re-fetched them since September), and the
--     $40,367 of future-dated October invoices are scheduled, not booked.
--
--
-- PART TWO — why it would drift again
-- -----------------------------------
-- The last $171.77 was Brandtech INV020926161935, which the export carries as a negative
-- correction dated 6 October. Our mirror holds only an invoice's CURRENT amount, so when
-- an invoice belonging to a closed month is revised, our September total quietly changes
-- and October never hears about it. The app does the opposite: September stays as it was
-- reported and the difference is booked forward.
--
-- So a month is now SNAPSHOTTED when it closes, the view serves the snapshot for any
-- closed month, and reconcile_booking_months() posts the difference between the snapshot
-- and the live figure as an adjustment in the current month. invoice_booking_adjustments
-- already existed for this and had never been used.
--
-- Rahul, 9 Oct 2026, on the remaining $642: "i need 100% correct".


-- ---------------------------------------------------------------------------
-- What each invoice booked in a month, frozen at the moment the month closed.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_booking_snapshots (
  booking_month date   not null,
  invoice_no    text   not null,
  services      text,
  amount        numeric not null,
  snapshot_at   timestamptz not null default now(),
  primary key (booking_month, invoice_no)
);

comment on table public.invoice_booking_snapshots is
  'One row per invoice per closed booking month, frozen when the month closed. A closed month is reported from here, never from the live invoice mirror, so a later revision cannot restate it.';

alter table public.invoice_booking_snapshots enable row level security;
-- Same posture as the rest of the booking tables: readable, never written from a browser.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='invoice_booking_snapshots' and policyname='invoice_booking_snapshots_read') then
    create policy invoice_booking_snapshots_read on public.invoice_booking_snapshots for select using (true);
  end if;
end $$;

-- The table inherited the schema's blanket grants, which hand anon INSERT, UPDATE,
-- DELETE and TRUNCATE. RLS covers the first three and silently does NOT cover TRUNCATE,
-- so a browser key could have emptied every frozen month.
revoke insert, update, delete, truncate on public.invoice_booking_snapshots from anon;
revoke insert, update, delete, truncate on public.invoice_booking_snapshots from authenticated;


-- ---------------------------------------------------------------------------
-- Every invoice line that is ours, with its discount share already taken off
-- and the number of months it covers. Both the bookings and the reversals read
-- from here, so a discounted or spread invoice cannot reverse at a different
-- figure from the one it booked at.
-- ---------------------------------------------------------------------------
create or replace view public.web_invoice_net_lines as
with disc as (
  select invoice_no,
         sum(amount_usd) filter (where service in ('Discount','Partial-Refund')) as disc_usd,
         count(*) filter (where service not in
           ('Discount','Partial-Refund','IGST','GST','Paypal Fee','Wallet','Reimbursement',
            'Reimbursement for MacBook','Reimbursement for MacBook Display','Gift Card')) as svc_lines
  from public.quote_api_invoice_lines
  group by invoice_no
)
select i.invoice_no, i.project_id, i.status, i.invoice_at, i.booking_at, i.void_at,
       coalesce(nullif(btrim(i.company_name),''), i.zoho_company) as client,
       i.geo, i.sales_person, i.pc, l.service, l.start_at,
       case lower(coalesce(l.frequency,''))
         when 'yearly' then 12 when 'half yearly' then 6 when 'quarterly' then 3 else 1 end as months,
       l.amount_usd + coalesce(d.disc_usd,0) / nullif(d.svc_lines,0) as net_usd
  from public.quote_api_invoices i
  join public.quote_api_invoice_lines l on l.invoice_no = i.invoice_no
  left join disc d on d.invoice_no = i.invoice_no
 where i.deleted_at is null and public.quote_api_is_ours(l.service);


-- ---------------------------------------------------------------------------
-- The live derivation. One row per invoice per month it books into.
-- ---------------------------------------------------------------------------
create or replace view public.web_invoice_bookings_live as
select n.invoice_no, n.project_id, n.client, n.geo, n.sales_person, n.pc, n.status,
       string_agg(distinct n.service, ', ' order by n.service) as services,
       max(n.invoice_at)::date as invoice_date,
       (date_trunc('month', case when n.months > 1 and n.start_at is not null then n.start_at else n.booking_at end)
          + (gs || ' month')::interval)::date as booking_month,
       round(sum(n.net_usd / n.months)::numeric, 2) as amount
  from public.web_invoice_net_lines n, generate_series(0, n.months - 1) gs
 where n.invoice_at <= now() and n.booking_at is not null
 group by n.invoice_no, n.project_id, n.client, n.geo, n.sales_person, n.pc, n.status,
          (date_trunc('month', case when n.months > 1 and n.start_at is not null then n.start_at else n.booking_at end)
             + (gs || ' month')::interval)::date;


-- ---------------------------------------------------------------------------
-- Close a month: freeze what it booked. Idempotent — a month closes once, and
-- re-running leaves the frozen figures alone.
-- ---------------------------------------------------------------------------
create or replace function public.close_booking_month(p_month date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_month date := date_trunc('month', p_month)::date; v_n integer;
begin
  if v_month >= date_trunc('month', current_date)::date then
    raise exception 'Month % is not over yet.', to_char(v_month,'Mon YYYY') using errcode = '22023';
  end if;
  insert into public.invoice_booking_snapshots (booking_month, invoice_no, services, amount)
  select booking_month, invoice_no, services, amount
    from public.web_invoice_bookings_live
   where booking_month = v_month
  on conflict (booking_month, invoice_no) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;


-- ---------------------------------------------------------------------------
-- Compare every closed month against the live mirror and book the difference
-- forward, into the month that is currently open.
--
-- Idempotent by construction: it looks at what has ALREADY been adjusted for
-- that invoice and closed month, and posts only the remainder. Running it twice
-- in a day changes nothing the second time.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_booking_months()
returns table(out_invoice_no text, out_closed_month date, out_drift numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_open date := date_trunc('month', current_date)::date;
begin
  create temporary table _drift on commit drop as
  with closed as (
    select s.booking_month, s.invoice_no, s.services, s.amount as was,
           coalesce(l.amount, 0) as now_is
      from public.invoice_booking_snapshots s
      left join public.web_invoice_bookings_live l
        on l.invoice_no = s.invoice_no and l.booking_month = s.booking_month
  ),
  -- Anything the live mirror now books into a closed month that was not frozen then.
  appeared as (
    select l.booking_month, l.invoice_no, l.services, 0::numeric as was, l.amount as now_is
      from public.web_invoice_bookings_live l
     where l.booking_month < v_open
       and exists (select 1 from public.invoice_booking_snapshots s2 where s2.booking_month = l.booking_month)
       and not exists (select 1 from public.invoice_booking_snapshots s3
                        where s3.booking_month = l.booking_month and s3.invoice_no = l.invoice_no)
  ),
  all_rows as (select * from closed union all select * from appeared)
  select a.booking_month, a.invoice_no, a.services, a.was, a.now_is,
         round(a.now_is - a.was, 2) as target,
         -- What has already been booked forward for this invoice and closed month, so a
         -- second run in the same day posts nothing.
         coalesce((select sum(x.amount) from public.invoice_booking_adjustments x
                    where x.invoice_no = a.invoice_no
                      and x.adjustment_key like a.invoice_no || ':' || to_char(a.booking_month,'YYYY-MM') || ':drift:%'), 0) as already
    from all_rows a;

  insert into public.invoice_booking_adjustments
    (adjustment_key, invoice_no, booking_month, amount, service, reason, source, recorded_by, recorded_at)
  select d.invoice_no || ':' || to_char(d.booking_month,'YYYY-MM') || ':drift:' || to_char(v_open,'YYYY-MM'),
         d.invoice_no, v_open, round(d.target - d.already, 2),
         coalesce(d.services, 'Development - Web'),
         to_char(d.booking_month,'Mon YYYY') || ' was reported at ' || to_char(d.was,'FM999999990.00')
           || ' and the invoice now stands at ' || to_char(d.now_is,'FM999999990.00')
           || '. The closed month keeps what it reported and the difference books here.',
         'drift', 'reconcile_booking_months', now()
    from _drift d
   where round(d.target - d.already, 2) <> 0
  on conflict (adjustment_key) do update
    set amount = public.invoice_booking_adjustments.amount + excluded.amount,
        reason = excluded.reason, recorded_at = now();

  return query select d.invoice_no, d.booking_month, round(d.target - d.already, 2)
                 from _drift d where round(d.target - d.already, 2) <> 0;
end $function$;


-- ---------------------------------------------------------------------------
-- What the dashboard reads. A closed month comes from its snapshot; the open
-- month and anything ahead of it come from the live mirror.
-- ---------------------------------------------------------------------------
create or replace view public.web_invoice_bookings as
with snap as (
  select s.booking_month, s.invoice_no, s.services, s.amount,
         l.project_id, l.client, l.geo, l.sales_person, l.pc, l.status, l.invoice_date
    from public.invoice_booking_snapshots s
    left join public.web_invoice_bookings_live l
      on l.invoice_no = s.invoice_no and l.booking_month = s.booking_month
),
closed_months as (select distinct booking_month from public.invoice_booking_snapshots)
select invoice_no, project_id, client, geo, sales_person, pc, status, services,
       invoice_date, booking_month as booking_date, booking_month,
       amount, 'booking'::text as kind, null::text as reason
  from snap

union all

select l.invoice_no, l.project_id, l.client, l.geo, l.sales_person, l.pc, l.status, l.services,
       l.invoice_date, l.booking_month, l.booking_month,
       l.amount, 'booking'::text, null::text
  from public.web_invoice_bookings_live l
 where not exists (select 1 from closed_months c where c.booking_month = l.booking_month)

union all

-- A voided invoice reverses in full, in the month it was voided rather than the
-- month it booked, at the same discount-adjusted figure it booked at.
select n.invoice_no, n.project_id, n.client, n.geo, n.sales_person, n.pc, n.status,
       string_agg(distinct n.service, ', ' order by n.service),
       max(n.invoice_at)::date, date_trunc('month', n.void_at)::date, date_trunc('month', n.void_at)::date,
       -round(sum(n.net_usd)::numeric, 2), 'reversal'::text, 'Voided'::text
  from public.web_invoice_net_lines n
 where n.void_at is not null
 group by n.invoice_no, n.project_id, n.client, n.geo, n.sales_person, n.pc, n.status,
          date_trunc('month', n.void_at)::date

union all

select a.invoice_no, null::text, null::text, null::text, null::text, null::text, null::text,
       a.service, null::date, a.booking_month, a.booking_month,
       a.amount, 'adjustment'::text, a.reason
  from public.invoice_booking_adjustments a;


-- ---------------------------------------------------------------------------
-- Close every month that is already over, so today's figures become the agreed
-- baseline, then reconcile (which finds nothing on a fresh close).
-- ---------------------------------------------------------------------------
do $$
declare m date;
begin
  for m in
    select distinct booking_month from public.web_invoice_bookings_live
     where booking_month < date_trunc('month', current_date)::date
     order by 1
  loop
    perform public.close_booking_month(m);
  end loop;
end $$;

-- Nightly, after the wide invoice pull at 02:40 has refreshed the mirror.
select cron.schedule('reconcile-booking-months', '10 3 * * *',
  $$ select public.reconcile_booking_months(); $$);

-- On the 1st, close the month that just ended.
select cron.schedule('close-booking-month', '30 3 1 * *',
  $$ select public.close_booking_month((date_trunc('month', current_date) - interval '1 month')::date); $$);
