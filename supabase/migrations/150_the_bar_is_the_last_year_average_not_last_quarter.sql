-- The bar is the last-year average, not last quarter
-- ==================================================
--
-- 149 measured growth as this quarter against the PREVIOUS quarter. Wrong. Rahul sent
-- the Q1 sheet he had built by hand and the structure gave it away: a "Base Data" column
-- per PM, and growth computed as the quarter's monthly average against THAT, not against
-- the quarter before.
--
-- Those Base Data figures are lastYearAvg in lib/pm-team.ts, to the rupee — Afzal 23,081,
-- Bonny 22,962, Gagandeep 21,416, and so on for all eleven. It is the same bar the KPI
-- scorecard already measures growth on, and it RATCHETS: beat it in a quarter and that
-- quarter's average becomes the bar from then on; miss it and the old bar stands.
--
-- HOW THE CORRECTION WAS PROVEN. Rahul named the five PMs who are positive this quarter
-- — Gagandeep Singh, Gaurav Pardeshi, Madhav Maheshwari, Maitri Shah, Rahul Jain — and
-- said Malay is negative. That is a twelve-way check with one right answer, and only one
-- model passes it:
--
--                          149 (vs last qtr)      150 (vs ratcheted bar)
--   Malay Srivastava       +0.5%  positive  X     -22.9%  negative  OK
--   Maitri Shah            +34.8% positive  OK    +11.5%  positive  OK
--   Gagandeep Singh        +18.1%                 +18.1%            (Rahul's own 18%)
--
-- and the five positives under 150 are exactly Rahul's five. 149 got six.
--
-- IT ALSO SETTLED WHICH SOURCE. The PM scorecard computes growth from the `bookings`
-- feed; this uses web_project_ledger on start date. They disagree, and the disagreement
-- is decisive: bookings puts Maitri at -3.0% for this quarter, the ledger at +11.5%, and
-- Rahul says she grew. So the ledger it is — which also matches the sheet's own note,
-- "This data will be derived from Project sheet".
--
-- WORTH KNOWING: that means the incentive's growth figure and the KPI scorecard's growth
-- figure, on sibling pages, are computed from different sources and will not always
-- agree. Not fixed here; flagged.
--
-- Harshvardhan Sharma delivers revenue but is not on the PM roster, so he has no bar.
-- He earns base only, and the page says "no bar" rather than showing a growth of zero.
--
-- 149's pm_incentives() is superseded. It is gated to the same single address so it is
-- harmless, but it should go:
--   drop function public.pm_incentives(date);

-- 1. The bar, as data rather than as a constant in the bundle
-- -----------------------------------------------------------
-- Mirrors lastYearAvg in lib/pm-team.ts. Seeded under the CURRENT spelling of each name
-- (Malay Srivastava, not Shrivastava — see 146), and matched through canonical_person()
-- so a future rename cannot silently drop somebody's bar and hand them base only.
--
-- No grants at all: only pm_incentive_sheet(), which is security definer, reads it.
create table if not exists public.pm_incentive_baselines (
  pm_name        text primary key,
  last_year_avg  numeric not null,
  note           text,
  updated_at     timestamptz not null default now()
);

alter table public.pm_incentive_baselines enable row level security;
revoke all on public.pm_incentive_baselines from public, anon, authenticated;

insert into public.pm_incentive_baselines (pm_name, last_year_avg) values
  ('Afzal Multani', 23081), ('Bonny Chhatbar', 22962), ('Gagandeep Singh', 21416),
  ('Gaurav Pardeshi', 12201), ('Madhav Maheshwari', 10000), ('Maitri Shah', 15638),
  ('Malay Srivastava', 20464), ('Nitin Mishra', 23333), ('Paryusha Jain', 16251),
  ('Rahul Jain', 5738), ('Sankalp Waman Bhoyar', 16224)
on conflict (pm_name) do update
  set last_year_avg = excluded.last_year_avg, updated_at = now();


-- 2. The sheet itself
-- -------------------
-- Still one person's: not the five dashboard admins, not web@uplers.com, not the PMs it
-- is about. And still computed entirely in here, because the dashboard is a static
-- export — anything the page worked out would ship in public JavaScript that needs no
-- login to read. Verified on the built output: the rates, the payouts and every total
-- appear in zero files.
--
-- The function body is applied live; see the repository for its text.


-- 3. Reached by its own menu entry
-- ---------------------------------
-- /pm-team/incentive, hidden from the rail AND refused by the route guard for everybody
-- else. Both read canSee() in lib/access, which is the point: a page merely missing from
-- the sidebar is still reachable by typing its address.
