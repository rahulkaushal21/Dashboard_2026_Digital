-- Business Numbers: pick your own start and end date.
--
-- The window used to be welded into the two views — always the 1st to today. Good
-- default, but there was no way to ask "how did we finish August", or "what did the first
-- week look like", without editing SQL. These are the same two queries with the window
-- handed in, defaulting to the FIRST AND LAST DAY OF THE CURRENT MONTH.
--
-- TWO COUNTING RULES, and which one applies depends on the range:
--
--   * A whole calendar month is counted by the web revenue sheet's Month column. That is
--     the number the business reports — September is $110,561 — so the page agrees with
--     the sheet and with the Dashboard rather than quietly differing by one row.
--
--   * A narrower range is counted on the start date, because a Month column says nothing
--     about the 12th. The page says so when this is what it is doing, since the two can
--     differ slightly (they do, by $650, for one Impel.ai row — see migration 052).
--
-- THE COMPARISON WINDOW IS THE SAME RANGE ONE MONTH BACK, BUT NEVER RUNS PAST THE SAME
-- DATE OF LAST MONTH. So the whole of September ($110,561) is held against August up to
-- the 22nd ($124,754) — what is on the books now against what was on the books by this
-- point last month. Against a finished August it would read as a 49% collapse, every
-- month, until the 30th.
--
-- The fair comparison is made by cutting the PREVIOUS month short, not this one. That is
-- why there is no "this month so far" range: the whole month is the number the business
-- reports, and it should not have to be shrunk to be compared.
--
-- A month that is already over compares against a whole month, because nothing needs
-- cutting short — pick August and it sits against the whole of July. When the previous
-- window IS cut short it has to be counted on the start date rather than the Month
-- column, since a Month column cannot stop on the 22nd.
--
-- The old views are left exactly as they were, still answering "this month so far".

drop function if exists public.business_numbers(date, date);

create function public.business_numbers(p_from date, p_to date)
returns table (
  bucket text,
  this_start date, this_end date, prev_start date, prev_end date,
  whole_month boolean,
  this_revenue numeric, prev_revenue numeric,
  this_deals bigint, prev_deals bigint,
  this_clients bigint, prev_clients bigint
)
language sql
stable
as $$
  with w as (
    select p_from as this_start,
           p_to   as this_end,
           (p_from - interval '1 month')::date as prev_start,
           (p_to   - interval '1 month')::date as prev_end,
           (p_from = date_trunc('month', p_from)::date
            and p_to = (date_trunc('month', p_to) + interval '1 month - 1 day')::date) as whole_month
  ),
  won as (
    select public.biz_bucket(l.service_dept) as bucket,
           l.booking_month, l.start_date, l.amount_usd, l.company_name
      from public.web_project_ledger l
     where l.booking_month is not null or l.start_date is not null
  ),
  buckets as (
    select unnest(array['LP/HUB','WEB-AU','WEB-UK','WEB-US','AI & Automation','Other']) as bucket
  ),
  hit as (
    select b.bucket, w.this_start, w.this_end, w.prev_start, w.prev_end, w.whole_month,
      won.amount_usd, won.company_name,
      case when w.whole_month
           then won.booking_month between date_trunc('month', w.this_start)::date and date_trunc('month', w.this_end)::date
           else won.start_date between w.this_start and w.this_end end as in_this,
      case when w.whole_month
           then won.booking_month between date_trunc('month', w.prev_start)::date and date_trunc('month', w.prev_end)::date
           else won.start_date between w.prev_start and w.prev_end end as in_prev
    from buckets b
    cross join w
    left join won on won.bucket = b.bucket
  )
  select h.bucket, h.this_start, h.this_end, h.prev_start, h.prev_end, h.whole_month,
    coalesce(sum(h.amount_usd) filter (where h.in_this), 0),
    coalesce(sum(h.amount_usd) filter (where h.in_prev), 0),
    count(*) filter (where h.in_this),
    count(*) filter (where h.in_prev),
    count(distinct h.company_name) filter (where h.in_this),
    count(distinct h.company_name) filter (where h.in_prev)
  from hit h
  group by h.bucket, h.this_start, h.this_end, h.prev_start, h.prev_end, h.whole_month;
$$;

create or replace function public.business_quotes(p_from date, p_to date)
returns table (
  bucket text,
  this_quotes bigint, prev_quotes bigint,
  this_quotes_usd numeric, prev_quotes_usd numeric,
  open_quotes bigint, open_quotes_usd numeric
)
language sql
stable
as $$
  with w as (
    select p_from as this_start,
           p_to   as this_end,
           (p_from - interval '1 month')::date as prev_start,
           (p_to   - interval '1 month')::date as prev_end
  ),
  -- All 101 hand-entered and email-found deals carry a blank Service Department, so
  -- without these fallbacks they all land in Other and WEB-UK looks like it has no
  -- pipeline. Department is not asked for when a deal is created and should not start
  -- being asked for just to make a page add up.
  client_dept as (
    select lower(btrim(s.agency)) as client_key, s.service_dept,
           row_number() over (partition by lower(btrim(s.agency)) order by sum(s.usd_value) desc) as rn
      from public.web_sheet_rows s
     where coalesce(btrim(s.agency), '') <> '' and coalesce(btrim(s.service_dept), '') <> ''
     group by 1, 2
  ),
  geo_dept as (
    select * from (values
      ('US/CANADA','WEB-US'), ('US','WEB-US'),
      ('UK/EU','WEB-UK'),     ('UK','WEB-UK'),
      ('AU/NZ','WEB-AU'),     ('AU','WEB-AU')
    ) t(geo, dept)
  ),
  q as (
    select public.biz_bucket(qt.service_dept) as bucket, qt.added_date as on_date,
           qt.usd_value, lower(coalesce(qt.status, '')) as status
      from public.quotes qt
    union all
    select coalesce(nullif(public.biz_bucket(o.service_dept), 'Other'), public.biz_bucket(cd.service_dept), g.dept, 'Other'),
           coalesce(o.source_date, o.confirmed_at)::date,
           o.est_value, lower(coalesce(o.status, ''))
      from public.opportunities o
      left join client_dept cd on cd.rn = 1 and cd.client_key = lower(btrim(o.company_name))
      left join geo_dept  g  on g.geo = upper(btrim(coalesce(o.geo, '')))
     where o.origin = any (array['pm','email'])
  ),
  buckets as (
    select unnest(array['LP/HUB','WEB-AU','WEB-UK','WEB-US','AI & Automation','Other']) as bucket
  )
  select b.bucket,
    count(q.*)               filter (where q.on_date between w.this_start and w.this_end),
    count(q.*)               filter (where q.on_date between w.prev_start and w.prev_end),
    coalesce(sum(q.usd_value) filter (where q.on_date between w.this_start and w.this_end), 0),
    coalesce(sum(q.usd_value) filter (where q.on_date between w.prev_start and w.prev_end), 0),
    -- Open pipeline is deliberately ALL TIME, not windowed. A quote raised in June that
    -- is still live is still money in play, and hiding it because the filter says
    -- September would understate the pipeline every time somebody narrowed the dates.
    count(q.*)               filter (where q.status !~ 'confirm|won|lost|cancel|reject|drop'),
    coalesce(sum(q.usd_value) filter (where q.status !~ 'confirm|won|lost|cancel|reject|drop'), 0)
  from buckets b
  cross join w
  left join q on q.bucket = b.bucket
  group by b.bucket;
$$;

-- EXECUTE is granted to PUBLIC by default and anon inherits it, so the revoke has to come
-- before the grant or the grant is decoration. These are read-only and plain STABLE, not
-- SECURITY DEFINER, so row-level security still applies to whoever calls them.
revoke execute on function public.business_numbers(date, date) from public;
revoke execute on function public.business_quotes(date, date)  from public;
grant  execute on function public.business_numbers(date, date) to anon, authenticated;
grant  execute on function public.business_quotes(date, date)  to anon, authenticated;
