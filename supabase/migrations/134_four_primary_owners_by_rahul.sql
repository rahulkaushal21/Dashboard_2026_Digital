-- 134 — four primary owners, by Rahul
--
-- Rahul, 6 Oct 2026, reading the Delights board with its new PM column:
--   Underdog Digital       Malay Shrivastava   (board said Nitin Mishra — most revenue, but not the owner)
--   Hummingbird Ideas      Gagandeep Singh     (board said Harshal Mehuriya)
--   MyKey Funding (KFP)    Malay Shrivastava   (board said nobody: the signal names the client
--                                              "MyKey Funding (KFP)", the ledger "Key Funding
--                                              Partners", so the key never matched)
--   TiE Silicon Valley     Sankalp Waman Bhoyar (board said Harshal Mehuriya)
--
-- client_owner_overrides is the standing answer for "the primary owner is not the person
-- with the most revenue" — see leavers-need-an-owner-override. web_client_owners and
-- web_client_context put the override first, so Delights, the PM scorecard, "My clients"
-- and Critical Escalations all follow it from the next read.
--
-- The MyKey name is folded onto Key Funding Partners with a merge alias, the same way
-- Ventica went onto Cohort (122), so the email signal lands on the client that owns it.

insert into public.client_owner_overrides (client_key, person, note, set_by, set_at) values
  ('underdogdigital',    'Malay Shrivastava',    'Rahul, 6 Oct 2026 — Malay owns the account; Nitin has the larger revenue share', 'web@uplers.com', now()),
  ('hummingbirdideas',   'Gagandeep Singh',      'Rahul, 6 Oct 2026', 'web@uplers.com', now()),
  ('keyfundingpartners', 'Malay Shrivastava',    'Rahul, 6 Oct 2026 — also known as MyKey Funding (KFP)', 'web@uplers.com', now()),
  ('tiesiliconvalley',   'Sankalp Waman Bhoyar', 'Rahul, 6 Oct 2026', 'web@uplers.com', now())
on conflict (client_key) do update set person = excluded.person, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at;

insert into public.client_aliases (pattern, kind, canonical, note) values
  ('mykey funding (kfp)', 'merge', 'Key Funding Partners', 'the email scan''s name for Key Funding Partners (Revel Stark) — Rahul, 6 Oct 2026'),
  ('mykey funding',       'merge', 'Key Funding Partners', 'same')
on conflict do nothing;

select * from public.canonicalise_client_names();
