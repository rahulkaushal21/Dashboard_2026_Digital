-- Cross-sells, named and kept
-- ===========================
--
-- "Check from last 2 months what all business which PMs cross selled or initiated from
-- their email" — Rahul, 18 Nov 2026. Then: put it under the business report.
--
-- WHY A TABLE AND NOT A VIEW. There is no column anywhere that says "a PM sold this".
-- Finding the fifteen rows below took four passes: match threads whose FIRST message came
-- from a PM's own address, drop the replies and the out-of-office noise, then keep only
-- the cases where a BOOKED project line actually names the work the mail pitched. That
-- last step is the whole of it, and it is a judgement a query cannot make. Twelve more
-- clients got the same October security mail and booked nothing against it — they also
-- booked $29k of unrelated retainer work that was already live, and any join on "mailed
-- then booked" would have credited the campaign with all of it. So the attribution is
-- written down once, by a person, with the subject line that earned it, and the page reads
-- what was written rather than re-deriving it and getting a different answer each month.
-- Same reasoning as email_signals and web_client_learnings: the scan is a judgement step.
--
-- STATUS IS ONLY two things. 'closed' is done — the client said yes and the revenue is
-- booked, so it is in web_project_ledger too and the amount here must match it. 'open' is
-- a proposal a PM sent that has not been answered. There is deliberately no 'lost': a
-- cross-sell that died is worth knowing about, but nobody will keep that field honest, and
-- a status people stop updating makes the closed figure a lie. An 'open' row that goes
-- quiet simply stays open and ages in plain sight.
--
-- THE AMOUNT IS USD AND IT IS THE BOOKED FIGURE, not the quote. A cross-sell is worth
-- what came in. Where a mail produced several lines they are one row per line, so the
-- panel's total reconciles against the ledger line by line.

create table if not exists public.cross_sells (
  id             bigserial primary key,
  booking_month  date not null,
  pm             text not null,
  client         text not null,
  service_dept   text,
  project        text not null,
  engagement     text,
  amount_usd     numeric not null default 0 check (amount_usd >= 0),
  confirmed_on   date,
  mail_subject   text not null,
  mail_date      date not null,
  status         text not null default 'closed',
  note           text,
  added_by       text,
  added_at       timestamptz not null default now(),
  constraint cross_sells_month_is_first check (booking_month = date_trunc('month', booking_month)::date),
  constraint cross_sells_status check (status in ('closed', 'open')),
  -- Spelled as the rest of the dashboard spells a department, or the row drops out of the
  -- business-unit switch without saying so. See 'Service dept vocabulary'.
  constraint cross_sells_dept check (service_dept is null or service_dept in
    ('LP', 'HUB', 'WEB-AU', 'WEB-UK', 'WEB-US', 'AI & Automation')),
  -- A closed cross-sell has money and a date on it; an open one has neither yet.
  constraint cross_sells_closed_has_value check (status <> 'closed' or amount_usd > 0)
);

comment on table public.cross_sells is
  'Business a PM opened from their own mailbox: one row per booked line, with the subject that earned it. Hand-attributed — see the migration header for why this is not a view.';

create index if not exists cross_sells_month on public.cross_sells (booking_month desc);

alter table public.cross_sells enable row level security;

drop policy if exists cross_sells_read on public.cross_sells;
create policy cross_sells_read on public.cross_sells
  for select to authenticated using (true);

-- Admin-only write, the same rule as booking_targets. This is a credit line — whose name
-- is against which deal — and it is read on a leadership page, so it is not somewhere a
-- PM adds their own entries.
drop policy if exists cross_sells_admin_write on public.cross_sells;
create policy cross_sells_admin_write on public.cross_sells
  for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

-- A new table in public is served by PostgREST to anon until it is told otherwise.
revoke all on public.cross_sells from anon, public;
revoke all on sequence public.cross_sells_id_seq from anon, public;
grant select, insert, update on public.cross_sells to authenticated;
grant usage, select on sequence public.cross_sells_id_seq to authenticated;

-- October–November 2026, as attributed on 18 Nov 2026.
--
-- Twenty closed rows across fifteen cross-sells, $7,574.79 — one row per booked line, because
-- several of the mails produced more than one. Gagandeep Singh wrote $5,835 of it (13 of the 20 lines), and he
-- is the only PM
-- whose openers are his own rather than the shared security template: the Big Up
-- "additional opportunities" mail, the two Lyons/ESS next-steps mails and the Tullahoma
-- maintenance proposal. The rest came out of one coordinated campaign on 21-23 October,
-- when six PMs each mailed their own accounts about a real WordPress/PHP advisory.
--
-- The two open rows are proposals with no answer yet. Madhav's omadahealth audit mail is
-- NOT here: the $800 was confirmed on the 22nd and the mail went on the 23rd, so the audit
-- followed the sale. Gaurav's Convello mail is open rather than closed for the same
-- reason — it postdates the October bookings on that account.
insert into public.cross_sells
  (booking_month, pm, client, service_dept, project, engagement, amount_usd, confirmed_on, mail_subject, mail_date, status, added_by) values
  ('2026-10-01', 'Gagandeep Singh', 'Big Up Marketing', 'WEB-US', 'Big Up Stores — immediate technical updates and fixes (email notifications, PHP, Debian 12, SSL)', 'New Development', 1920, '2026-10-29', 'Great Connecting – Next Steps & Additional Opportunities', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'ESS Software', 'WEB-US', 'Lyons Wealth — four-page package', 'New Development', 900, '2026-10-15', 'Lyons Wealth & Pintar – Next steps on the sub pages', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'ESS Software', 'WEB-US', 'ESS website Homepage - new design', 'New Development', 550, '2026-10-15', 'Next Steps – Lyons Wealth, ESS & New Opportunities', '2026-10-14', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'ESS Software', 'WEB-US', 'Lyons Core New Page', 'New Development', 225, '2026-10-20', 'Next Steps – Lyons Wealth, ESS & New Opportunities', '2026-10-14', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'Hunter Public Relations, LLC', 'WEB-US', 'Tabasco Social Media Forms - Routine site health check and recommended updates', 'Maintanance', 300, '2026-10-15', 'Tabasco Social Media Forms – Routine site health check and recommended updates', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-11-01', 'Gagandeep Singh', 'Hunter Public Relations, LLC', 'WEB-US', 'Tabasco Social Media Forms - Monthly Maintenance - Nov 2026', 'Maintanance', 300, '2026-11-02', 'Tabasco Social Media Forms – Routine site health check and recommended updates', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'Finch Creative, Inc.', 'WEB-US', 'Tullahoma website — 10-hour Oct', 'Maintanance', 250, '2026-10-27', 'Tullahoma Website – Proposed 10-Hour Monthly Maintenance Plan', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-11-01', 'Gagandeep Singh', 'Finch Creative, Inc.', 'WEB-US', 'Tullahoma website — 10-hour Oct - Nov 2026', 'Maintanance', 250, '2026-11-02', 'Tullahoma Website – Proposed 10-Hour Monthly Maintenance Plan', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'Finch Creative, Inc.', 'WEB-US', 'Finch Creatives Critical PHP vulnerabilities discovered - all sites', 'Maintanance', 300, '2026-10-29', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites- (Tullahome - katherinehoustonart and other wordpress Sites )', '2026-10-21', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'Big Up Marketing', 'WEB-US', 'Bigup Marketing Monthly Maintenance', 'Maintanance', 167, '2026-10-13', 'Great Connecting – Next Steps & Additional Opportunities', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-11-01', 'Gagandeep Singh', 'Big Up Marketing', 'WEB-US', 'Bigup Marketing Monthly Maintenance - Nov 2026', 'Maintanance', 167, '2026-11-02', 'Great Connecting – Next Steps & Additional Opportunities', '2026-10-13', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'Libra', 'WEB-US', 'Libra USA Quartely Maintenance OCT - 26', 'Maintanance', 324, '2026-10-27', 'Libra USA - Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-21', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Gagandeep Singh', 'MGS Marketing', 'WEB-US', 'Critical PHP vulnerabilities discovered', 'Maintanance', 182.48, '2026-10-22', 'OMWA - Updates Completed and Security Patches', '2026-10-26', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Paryusha Jain', 'Telfer Digital', 'WEB-UK', 'PHP Update 6 website', 'Ad-hoc', 450, '2026-10-23', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Maitri Shah', 'responsems', 'WEB-AU', 'Security Solution - 1 page redesign and develop', 'Ad-hoc', 432.62, '2026-10-22', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Malay Srivastava', 'Innovative Capital', 'WEB-US', 'Inncap | PHP Maintainance', 'Maintanance', 250, '2026-10-30', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-21', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Rahul Jain', 'Art One', 'WEB-AU', 'Adbri Security Update + Adbri Security Updates', 'Ad-hoc', 229.78, '2026-10-29', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Rahul Jain', 'Frogonline', 'WEB-AU', 'F&F Core Updates', 'Ad-hoc', 198.58, '2026-10-26', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Rahul Jain', 'Sensen.ai', 'WEB-AU', 'Sensen - PHP Update + Sencare - PHP update', 'Ad-hoc', 114.50, '2026-10-22', 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-11-01', 'Rahul Jain', 'Profile Systems', 'WEB-AU', 'PHP upgrade', 'Ad-hoc', 63.83, null, 'Urgent: Immediate PHP Security Updates Recommended for Your Websites', '2026-10-22', 'closed', 'web@uplers.com'),
  ('2026-10-01', 'Paryusha Jain', 'Telfer Digital', 'WEB-UK', 'Optavo — one-time post-launch SEO scope', null, 0, null, 'Optavo – Proposed One-Time Post-Launch SEO Scope', '2026-10-28', 'open', 'web@uplers.com'),
  ('2026-11-01', 'Gaurav Pardeshi', 'YLP Legal', 'WEB-UK', 'Convello additional tasks', null, 0, null, 'Convello Additional Tasks', '2026-11-17', 'open', 'web@uplers.com')
on conflict do nothing;
