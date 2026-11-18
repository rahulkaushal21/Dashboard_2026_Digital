-- The cross-sell list has to find its own candidates
-- ==================================================
--
-- "Keep on updating this in every single refresh" — Rahul, 18 Nov 2026.
--
-- 176 made attribution a hand-written judgement on purpose, and that stays true: a row
-- only enters cross_sells when a person decides a booked line can be traced to a mail a
-- PM sent first. What was missing is the other half — nothing SURFACED the new ones, so
-- the page was a snapshot of one afternoon's reading and would have aged into a lie.
--
-- This is the finder, not the judge. It proposes; cross_sells still decides. The page
-- shows candidates in their own section, outside every total, so a false positive costs
-- a glance rather than a wrong number on a leadership page.
--
-- WHY A MATVIEW. The detection reads 60,000 messages, numbers every thread to find its
-- first message, and matches client domains across three address fields: 18 seconds. That
-- is impossible per page load and unremarkable inside run_refresh_chain, which already
-- holds a 180s budget and an advisory lock. So the chain computes it and the page reads
-- a table.
--
-- WHAT IT LOOKS FOR, and why each test is there:
--   * The thread's FIRST message, from a PM's own address. A reply is a conversation the
--     client started; only the opener is a PM reaching out.
--   * A subject that is not Re:/Fw:/an auto-reply/a calendar invite. Those are the bulk of
--     a PM's sent mail and none of them is a sell.
--   * A subject carrying commercial words — a quote, an audit, a proposal, a plan.
--   * A client who BOOKED something in the 60 days after. Without this it is a list of
--     everything every PM ever suggested.
--   * Not already written down in cross_sells, so confirming a candidate removes it.
--
-- WHAT IT CANNOT DO is the judgement itself: it cannot tell whether the booked line is
-- the work the mail pitched, which is exactly the test 176 exists to apply. In October
-- twelve clients got the security mail, booked nothing against it, and booked $29k of
-- retainers that were already running. Every one of those is a candidate here. That is
-- the intended behaviour — they are a question, not an answer.

create materialized view if not exists public.cross_sell_candidates as
with pm as (
  select name, lower(email) em from public.pm_directory where active
),
booked as (
  -- Every client that has booked recently, with the domain they are mailed at.
  select lower(btrim(l.company_name)) k,
         max(l.company_name) company,
         lower(btrim(split_part(l.contact_email, '@', 2))) dom,
         max(l.service_dept) service_dept,
         min(l.confirmed_at) first_booking,
         max(l.confirmed_at) last_booking,
         sum(l.amount_usd) booked_usd
  from public.web_project_ledger l
  where l.contact_email like '%@%'
    and l.confirmed_at >= now() - interval '150 days'
  group by k, dom
),
first_msg as (
  select thread_id, subject, from_addr, msg_date,
         lower(coalesce(from_addr, '') || ' ' || coalesce(to_addrs, '') || ' ' || coalesce(cc_addrs, '')) parties,
         row_number() over (partition by thread_id order by msg_date, message_id) rn
  from public.email_inbox
  where msg_date >= now() - interval '150 days' and thread_id is not null
),
opener as (
  select f.thread_id, f.subject, f.msg_date, f.parties, p.name pm
  from first_msg f
  join pm p on lower(f.from_addr) like '%' || p.em || '%'
  where f.rn = 1
    and f.subject !~* '^\s*(re|fw|fwd|ooo|automatic reply|out of office|updated invitation)'
    and f.subject ~* '(quote|estimat|proposal|recommend|upgrade|audit|revamp|redesign|additional|retainer|maint|package|bundle|hrs|hours|pricing|phase|next step|optimi|migrat|securit|performance|health check|opportunit)'
    and f.subject !~* '(invitation|accepted|declined|cancel|out of office|read ai|fireflies|fathom|notes from|meeting notes)'
)
select
  o.pm,
  b.company                              as client,
  b.service_dept,
  o.subject                              as mail_subject,
  o.msg_date::date                       as mail_date,
  b.dom                                  as client_domain,
  round(b.booked_usd, 2)                 as client_booked_usd,
  b.last_booking::date                   as last_booking
from opener o
join booked b
  on b.dom <> ''
 and b.dom not in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'mavlers.com', 'uplers.com')
 and o.parties like '%' || b.dom || '%'
 -- Something was booked AFTER the mail, within a window a sale could plausibly close in.
 and b.last_booking >= o.msg_date
 and b.last_booking <= o.msg_date + interval '60 days'
-- Already written down? Then it is not a candidate, it is a record.
where not exists (
  select 1 from public.cross_sells c
   where lower(btrim(c.client)) = lower(btrim(b.company))
     and lower(btrim(c.mail_subject)) = lower(btrim(o.subject))
)
with no data;

comment on materialized view public.cross_sell_candidates is
  'Possible cross-sells the refresh chain found: a PM opened a thread with a commercial subject and that client booked within 60 days. A QUESTION, not a record - nothing here is counted until somebody writes it into cross_sells. See migration 179.';

create unique index if not exists cross_sell_candidates_key
  on public.cross_sell_candidates (pm, client, mail_subject, mail_date);
create index if not exists cross_sell_candidates_date
  on public.cross_sell_candidates (mail_date desc);

-- A new matview in public is served by PostgREST to anon until it is told otherwise, and
-- this one carries client addresses and booked values.
revoke all on public.cross_sell_candidates from anon, public;
grant select on public.cross_sell_candidates to authenticated;

create or replace function public.refresh_cross_sell_candidates()
returns void language plpgsql security definer set search_path = public as $function$
begin
  -- CONCURRENTLY needs the unique index above and lets the page keep reading the old
  -- answer while the new one is built. It cannot populate an empty matview, so the first
  -- run after this migration is the plain form.
  if exists (select 1 from pg_class where oid = 'public.cross_sell_candidates'::regclass and relispopulated) then
    refresh materialized view concurrently public.cross_sell_candidates;
  else
    refresh materialized view public.cross_sell_candidates;
  end if;
end $function$;

revoke all on function public.refresh_cross_sell_candidates() from anon, public;
grant execute on function public.refresh_cross_sell_candidates() to authenticated;
