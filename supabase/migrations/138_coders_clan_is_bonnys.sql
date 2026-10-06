-- 138 — Coders Clan is Bonny's
--
-- Rahul, 6 Oct 2026: "Codersclan is under Bonny not under paryusha." The client's owner
-- was read off the ledger lines, which carry Paryusha Jain, and the one open deal (the
-- QA Sep'26 email) was filed under her by the scan. The override puts Bonny Chhatbar
-- first everywhere the owner is read, and the open deal moves to her so it shows under
-- her filter on Opportunities and counts on her scorecard.

insert into public.client_owner_overrides (client_key, person, note, set_by, set_at) values
  ('codersclan', 'Bonny Chhatbar', 'Rahul, 6 Oct 2026', 'web@uplers.com', now())
on conflict (client_key) do update set person = excluded.person, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at;

update public.opportunities set pm_owner = 'Bonny Chhatbar'
where lower(btrim(company_name)) = 'coders clan' and pm_owner = 'Paryusha Jain' and not won;

insert into public.opportunity_events (opportunity_id, event, actor, detail)
select id, 'edited', 'web@uplers.com', jsonb_build_object('from', 'migration-138', 'changed', jsonb_build_object('pm_owner', jsonb_build_object('from', 'Paryusha Jain', 'to', 'Bonny Chhatbar')))
from public.opportunities where lower(btrim(company_name)) = 'coders clan' and pm_owner = 'Bonny Chhatbar' and not won;
