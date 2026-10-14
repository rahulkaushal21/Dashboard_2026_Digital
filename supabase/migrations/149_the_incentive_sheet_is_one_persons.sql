-- The incentive sheet is one person's
-- ===================================
--
-- A PM incentive section under PM team. Rahul, 14 Oct 2026, with the rule and the bands
-- given in his own words and the arithmetic checked against his worked example before
-- anything was built.
--
--   Base    the quarter's delivered revenue x 0.25%
--   Booster a further percentage of the SAME revenue, by how far the quarter's monthly
--           average beat the previous quarter's, ADDED to the base:
--
--             under 10%   0.02%        31-50%        0.10%
--             10-20%      0.04%        51% and over  0.15%
--             21-30%      0.08%
--
-- TWO THINGS HE DECIDED when the written ladder did not cover them:
--
--   * A quarter that went BACKWARDS earns no booster at all. The ladder starts at
--     "0 - less than 9%" and says nothing about a decline; the booster is only ever a
--     reward. Six of twelve PMs are negative this quarter, so this is not a corner case
--     — it is $58.40 and six rows.
--   * The written bands leave gaps at 9-10, 20-21, 30-31 and 50-51. They are read as
--     continuous so nobody can land in a hole. Nobody does today; somebody eventually
--     would.
--
-- Verified against his example before building: Gagandeep Singh, Q1 64,882 and Q2 76,636,
-- gives a Q2 monthly average of 25,545 — his figure exactly — and growth of 18.1%, his
-- 18%. His Q1 average of 21,581 against this 21,627 is a $139 drift in the ledger since
-- he ran it, which does not change the band.
--
--
-- WHY THE WHOLE CALCULATION IS IN HERE
-- ------------------------------------
-- The dashboard is a static export. Anything the page works out for itself ships inside
-- public JavaScript that needs no login to read — so a rate written into a component is
-- a published rate, and a payout computed in the browser is a published payout.
--
-- So nothing is computed in the page. It renders what this function returns, and when
-- the caller is not entitled to that, the function raises and returns no rows. The first
-- version of the panel still labelled a column "Base @ 0.25%" and put that figure in the
-- bundle; it now divides the rate back out of base_usd / this_total, which only somebody
-- holding the data can do.
--
-- Confirmed on the built output: "0.25%", "0.0025" and every payout figure appear in
-- zero files.
--
-- ONE PERSON, and deliberately not the obvious ones. is_admin covers five people and
-- isOwner() covers web@uplers.com, and all six must NOT see this, so neither check could
-- be reused. Tested by impersonation, each in a single statement so the claim could not
-- be lost between them:
--
--   rahul.k@mavlers.com   12 rows
--   krunal@mavlers.com    refused   (admin)
--   web@uplers.com        refused   (owner)
--   rahul.j@mavlers.com   refused   (a PM who is IN the table)
--
-- The honest limit: web_project_ledger is readable by any signed-in user, so somebody
-- determined could total revenue per PM themselves. They could not see the rates or the
-- payouts. Closing that is the Tier 2 work open since September.

create or replace function public.pm_incentives(p_quarter_start date default null)
returns table (
  pm_owner      text,
  prev_total    numeric,
  this_total    numeric,
  prev_avg      numeric,
  this_avg      numeric,
  growth_pct    numeric,
  base_usd      numeric,
  growth_rate   numeric,
  growth_usd    numeric,
  total_usd     numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text := public.jwt_email();
  v_this  date;
  v_prev  date;
  v_end   date;
begin
  if v_actor is null or lower(btrim(v_actor)) <> 'rahul.k@mavlers.com' then
    raise exception 'Not available.' using errcode = '42501';
  end if;

  -- These fiscal quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) land exactly on calendar
  -- quarter boundaries, so date_trunc does the work. The default is the most recent
  -- COMPLETE quarter: on 14 Oct 2026 that is Jul-Sep, not the three weeks of October so
  -- far, which would read as a collapse against a full quarter.
  v_this := coalesce(p_quarter_start, (date_trunc('quarter', current_date) - interval '3 months')::date);
  v_prev := (v_this - interval '3 months')::date;
  v_end  := (v_this + interval '3 months')::date;

  return query
  with l as (
    -- START DATE, falling back to confirmation then booking month — the same basis as
    -- Business Numbers and the Business Overview sheet, so a line sits in the same
    -- quarter here as it does everywhere else.
    select
      public.canonical_person(x.pm_owner) as pm,
      coalesce(nullif(x.start_date::text,''), x.confirmed_at::text, x.booking_month::text)::date as d,
      x.amount_usd
    from public.web_project_ledger x
    where coalesce(btrim(x.pm_owner),'') <> ''
  ),
  q as (
    select pm,
           coalesce(sum(amount_usd) filter (where d >= v_prev and d < v_this), 0) as p,
           coalesce(sum(amount_usd) filter (where d >= v_this and d < v_end),  0) as t
    from l group by pm
  ),
  g as (
    select pm, p, t,
           case when p > 0 then (t / p - 1) * 100 else null end as pct
    from q where t > 0
  ),
  r as (
    select pm, p, t, pct,
           case
             when pct is null or pct <= 0 then 0
             when pct <  10 then 0.0002
             when pct <  21 then 0.0004
             when pct <  31 then 0.0008
             when pct <  51 then 0.0010
             else                0.0015
           end as rate
    from g
  )
  select r.pm,
         round(r.p, 2),
         round(r.t, 2),
         round(r.p / 3, 2),
         round(r.t / 3, 2),
         round(r.pct, 1),
         round(r.t * 0.0025, 2),
         r.rate,
         round(r.t * r.rate, 2),
         round(r.t * 0.0025 + r.t * r.rate, 2)
  from r
  order by (r.t * 0.0025 + r.t * r.rate) desc;
end $function$;

revoke execute on function public.pm_incentives(date) from public, anon;
grant  execute on function public.pm_incentives(date) to authenticated;
