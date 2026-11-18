-- A candidate is judged once, not on every refresh
--
-- "AI should have this information, system should be smart that it can find out whether
-- its cross selled or not, i dont want to see any data" — Rahul, 18 Nov 2026.
--
-- 179 surfaced candidates on the page and asked a person to decide. Wrong shape: the
-- judgement belongs BEFORE the page, and what gets shown should already be an answer.
-- Every candidate now resolves to one of three things and the page only ever shows the
-- first two:
--
--   closed    — pitched and bought. A cross-sell, counted.
--   open      — pitched and NOT bought. Still a cross-sell effort, worth chasing, worth
--               crediting as activity; just no money against it yet.
--   dismissed — not a pitch at all. A monthly maintenance report, a delivery note, an
--               access request, minutes of a meeting. The finder cannot tell these from a
--               sell by their subject line, so they land here once and never again.
--
-- WITHOUT THIS TABLE the dismissals had nowhere to live, so every refresh would re-offer
-- the same nine non-pitches forever, and the only way to make them stop would be to
-- weaken the finder until it missed real ones too. A dismissal is a RECORD of a decision,
-- with the reason on it — the same shape as deal_signal_dismissals.

create table if not exists public.cross_sell_dismissals (
  id            bigserial primary key,
  pm            text not null,
  client        text not null,
  mail_subject  text not null,
  mail_date     date not null,
  reason        text not null,
  dismissed_by  text,
  dismissed_at  timestamptz not null default now(),
  unique (pm, client, mail_subject, mail_date)
);

comment on table public.cross_sell_dismissals is
  'Candidates judged NOT to be a cross-sell, with why. Keeps the finder from re-offering the same non-pitch every refresh. See migration 181.';

alter table public.cross_sell_dismissals enable row level security;

create policy cross_sell_dismissals_read on public.cross_sell_dismissals
  for select to authenticated using (true);
create policy cross_sell_dismissals_admin_write on public.cross_sell_dismissals
  for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

revoke all on public.cross_sell_dismissals from anon, public;
revoke all on sequence public.cross_sell_dismissals_id_seq from anon, public;
grant select, insert, update on public.cross_sell_dismissals to authenticated;
grant usage, select on sequence public.cross_sell_dismissals_id_seq to authenticated;
