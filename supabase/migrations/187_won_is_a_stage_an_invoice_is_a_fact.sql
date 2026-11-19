-- An opportunity marked Won is not an invoice
--
-- The banner said "the invoice app has already closed" these deals and then showed an
-- OPP number. OPP021126192709 is an OPPORTUNITY. Won is a stage someone sets on it, and
-- a stage is a plan: of 1,768 opportunities the app marked Won this financial year, 60
-- have no live invoice behind them. Asking a PM to close a live deal on the strength of
-- another person's dropdown is the same mistake as migration 186, one table along.
--
-- SO 'app won' NOW REQUIRES AN INVOICE. quote_api_invoices, joined on deal_key, not
-- deleted. The INV number, its total, its date and its status ride on the view so the
-- banner can show what it is actually claiming instead of a number that looks like proof.
-- All four rows in today's banner do have one - this is a gate for the sixty that do not.
--
-- 'app lost' IS UNCHANGED AND NEEDS NO INVOICE. Lost and Deleted are the app saying the
-- deal is not happening; there is nothing to invoice and the claim is "stop counting this
-- as pipeline", not "this was billed". 111 Lost records this year have no invoice, as
-- they should.
--
-- A RETAINER HAS MANY INVOICES - 12, 24, 26 against one deal_key - so the columns
-- aggregate: the earliest invoice is the one shown, with the count and the total beside
-- it. Half a retainer billed is still evidence the deal is not open.
--
-- Columns are appended, because CREATE OR REPLACE VIEW cannot insert one in the middle.
--
-- The service guard from migration 186 stays: the app record must be Development - Web,
-- Development - LP/Hub or AI & Automation. Merge exclusions are 161, the soft
-- 'client booked' tier is 102 and still does not reach the banner.
create or replace view public.web_open_opportunity_evidence as
with open_opps as (
  select o.id, o.company_name, o.est_value, o.first_date::date as opened, o.origin,
         o.quote_key, o.pm_owner, o.sales_person, o.service_dept
    from public.opportunities o
   where o.rolled_into is null
     and o.merged_into is null
     and public.opportunity_state(o.won, o.email_won, o.email_lost, o.status, o.manual_state) = 'Open'
)
select op.id, op.company_name, op.est_value, op.opened, op.origin, op.quote_key,
       op.pm_owner, op.sales_person, op.service_dept,
       a.opportunity_no as app_opportunity_no,
       a.final_stage    as app_final_stage,
       a.stage          as app_stage,
       a.amount_usd     as app_usd,
       a.deal_created_at::date as app_created,
       b.booked_usd as client_booked_since,
       b.rows       as client_booked_rows,
       case
         -- Won needs the invoice. Without one it is a stage, not a closed deal.
         when a.final_stage = 'Won' and inv.invoice_no is not null then 'app won'
         when a.final_stage = any (array['Lost','Deleted']) then 'app lost'
         when b.booked_usd is not null then 'client booked'
       end as evidence,
       case
         when a.final_stage = 'Won' and inv.invoice_no is not null then 1
         when a.final_stage = any (array['Lost','Deleted']) then 2
         when b.booked_usd is not null then 3
       end as confidence,
       a.service      as app_service,
       a.project_name as app_project,
       inv.invoice_no  as app_invoice_no,
       inv.total_usd   as app_invoice_usd,
       inv.invoice_at  as app_invoice_at,
       inv.status      as app_invoice_status,
       inv.n           as app_invoice_count
  from open_opps op
  left join lateral (
    select a_1.*
      from public.quote_api_opportunities a_1
     where public.client_stem(a_1.company_name) = public.client_stem(op.company_name)
       and op.est_value > 0
       and abs(a_1.amount_usd - op.est_value) <= greatest(25, op.est_value * 0.05)
       and abs(a_1.deal_created_at::date - op.opened) <= 45
       -- Our work only. An SEO or campaign invoice cannot close a Web or LP deal (186).
       and a_1.service ~* '(Development - Web|Development - LP/Hub|AI & Automation)'
     order by abs(a_1.deal_created_at::date - op.opened)
     limit 1) a on true
  -- The invoices behind that opportunity. Earliest one named, all of them counted.
  left join lateral (
    select (array_agg(i.invoice_no order by i.invoice_at, i.invoice_no))[1] as invoice_no,
           (array_agg(i.status     order by i.invoice_at, i.invoice_no))[1] as status,
           min(i.invoice_at)::date as invoice_at,
           round(sum(i.total_usd), 2) as total_usd,
           count(*) as n
      from public.quote_api_invoices i
     where i.deal_key = a.deal_key
       and not coalesce(i.is_deleted, false)
    having count(*) > 0) inv on true
  left join lateral (
    select round(sum(k.usd_round)) as booked_usd, count(*) as rows
      from public.ledger_match_keys_mv k
     where public.client_stem(k.client_key) = public.client_stem(op.company_name)
       and k.booking_month >= date_trunc('month', op.opened::timestamptz)::date
    having count(*) > 0) b on true;

comment on view public.web_open_opportunity_evidence is
  'Open opportunities the invoice app or the ledger says are already closed. ''app won'' requires a live INVOICE on the deal, not just a Won stage (migration 187), and the app record must be our work - Development - Web, Development - LP/Hub or AI & Automation (186). ''app lost'' needs no invoice: Lost and Deleted mean the deal is not happening. Merged and rolled deals excluded (161).';
