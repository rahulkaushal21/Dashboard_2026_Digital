-- 140 — the database is the only source of a deal
--
-- Rahul, 7 Oct 2026: "Now we don't have the sheet anymore, right?" — "no need to re-read
-- as well, it should be from the database only."
--
-- The old Business Sheet's Quotes tab is frozen (sheet-ingest returns 410 for it since
-- migration 132's commit). The `quotes` table is a snapshot of it, 870 lines, the last
-- dated 30 Sep 2026, and nothing refreshes it. Yet two cron jobs still read that
-- snapshot every half hour:
--
--   job 3  sync_quotes_to_opportunities()  upserts every snapshot line into opportunities,
--          and its ON CONFLICT clause sets est_value, status, won, source_subject from the
--          snapshot UNCONDITIONALLY. Edit the value or status of a sheet-born deal on the
--          dashboard and the next run put the 30-September figure back. The deal was
--          never really the dashboard's to change.
--   job 5  reconcile_sheet_drift()  deletes a sheet-born deal whose key is missing from
--          the snapshot. With the snapshot frozen it can only ever fire on a key the
--          dashboard changed, which is the wrong way round.
--
-- Both stop. Three things they did are worth keeping, and none needs the snapshot:
--   • the owner backfill (a deal with no AM/PC takes the client's usual one, from
--     opportunities, web_clients and web_revenue)   → fill_opportunity_owners()
--   • clearing an email_won/email_lost mark once the deal's own status says the same
--     thing                                          → reconcile_decision_flags()
--   • the currency fill from the RFQ API (migration 139, step 2); step 1 read the
--     snapshot and has done its one-off job, so it goes.
-- All three ride on job 4 with reconcile_opportunities(). The functions themselves are
-- left in place, unscheduled, in case the history is ever wanted.

create or replace function public.fill_opportunity_owners()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with owner_src as (
    select k, mode() within group (order by am) am, mode() within group (order by pc) pc
    from (
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(pm_owner),'') pc
        from opportunities where coalesce(company_name,'')<>''
      union all
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(pc_sme),'') pc
        from web_clients where coalesce(company_name,'')<>''
      union all
      select lower(trim(company_name)) k, nullif(trim(sales_person),'') am, nullif(trim(sme),'') pc
        from web_revenue where coalesce(company_name,'')<>''
    ) z group by k
  )
  update opportunities o set
    sales_person = case when coalesce(o.sales_person,'')='' and os.am is not null then os.am else o.sales_person end,
    pm_owner     = case when coalesce(o.pm_owner,'')=''     and os.pc is not null then os.pc else o.pm_owner end
  from owner_src os
  where os.k = lower(trim(o.company_name))
    and ((coalesce(o.sales_person,'')='' and os.am is not null) or
         (coalesce(o.pm_owner,'')=''     and os.pc is not null));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.reconcile_decision_flags()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n_won integer; n_lost integer;
begin
  update opportunities set
    email_won = false, email_won_reason = null, email_won_at = null, email_won_by = null
  where email_won and (won or lower(coalesce(status,'')) in ('won','confirmed'));
  get diagnostics n_won = row_count;
  update opportunities set
    email_lost = false, email_lost_reason = null, email_lost_at = null, email_lost_by = null
  where email_lost and (lower(coalesce(status,'')) in ('lost','cancelled') or lower(coalesce(status,'')) like 'cancel%');
  get diagnostics n_lost = row_count;
  return n_won + n_lost;
end $$;

create or replace function public.fill_opportunity_currency()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update opportunities o set
    currency = upper(trim(a.currency)),
    local_value = coalesce(o.local_value, nullif(a.amount, 0))
  from quote_api_quotes a
  where a.quote_no = coalesce(nullif(o.quote_id,''), o.quote_key)
    and o.currency is null and nullif(trim(a.currency), '') is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fill_opportunity_owners() from public, anon, authenticated;
revoke all on function public.reconcile_decision_flags() from public, anon, authenticated;
revoke all on function public.fill_opportunity_currency() from public, anon, authenticated;

select cron.unschedule(3);
select cron.unschedule(5);
select cron.alter_job(4, command :=
  'select reconcile_opportunities(); select public.close_email_deals_booked_in_sheet(); '
  'select public.fill_opportunity_owners(); select public.reconcile_decision_flags(); select public.fill_opportunity_currency();');
