-- 122 — Ventica is Cohort, and DW Commercial Cleaning is dwservices
--
-- Critical Escalations showed Ventica and DW Commercial Cleaning with no GEO and no PM,
-- and their names opened Client 360 on nothing. Both are the same fault: the loader
-- (getCriticalEscalations) finds GEO and PM by matching the escalation's company name
-- to a client record, and the client records carry other names.
--
--   Ventica is a product of Cohort, the agency. Cohort has the bookings (AU/NZ, Rahul
--   Jain since Jun 2026); Ventica has none, so there was no record to match. Rahul's
--   call, 5 Oct 2026: one client, Cohort, under Rahul Jain.
--
--   DW Commercial Cleaning is the trading name in the client's own emails; the sheet
--   and the bookings say dwservices (dwservices.com.au). The owner override for
--   dwservices (Rahul Jain, 29 Sep) never reached the escalation because the keys
--   differ ('dwcommercialcleaning' vs 'dwservices'). Folded onto dwservices, the name
--   every other table already uses, so nothing else has to move.
--
-- client_aliases kind='merge' is what canonicalise_client_names() applies to
-- web_revenue, bookings, email_signals, escalations, critical_escalations, feedback,
-- email-origin opportunities, client_directory and sql_leads. It runs after every
-- sheet and revenue sync and inside rebuild_clients(). Run once here so the change
-- shows now, not at the next hour.

insert into public.client_aliases (pattern, kind, canonical, note) values
  ('ventica',                 'merge', 'Cohort',     'Ventica is a Cohort product (Jon Phillips, ventica.com.au); one client under Rahul Jain — Rahul, 5 Oct 2026'),
  ('ventica (vocal minority)', 'merge', 'Cohort',    'same; thevocalminority.com.au is the Ventica site'),
  ('dw commercial cleaning',  'merge', 'dwservices', 'trading name in David Lange''s emails; bookings and sheet say dwservices — Rahul, 5 Oct 2026'),
  ('dw services',            'merge', 'dwservices', 'spelling the email scan used; same client'),
  ('dwservices.com.au',       'domain', 'dwservices', 'David Lange; DW Commercial Cleaning')
on conflict do nothing;

update public.client_aliases set canonical = 'Cohort',
  note = coalesce(note, '') || ' — folded into Cohort 5 Oct 2026'
where pattern = 'ventica.com.au' and kind = 'domain' and canonical <> 'Cohort';

insert into public.client_owner_overrides (client_key, person, note, set_by, set_at) values
  ('cohort', 'Rahul Jain', 'Cohort incl. Ventica — Rahul, 5 Oct 2026', 'web@uplers.com', now())
on conflict (client_key) do update set person = excluded.person, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at;

select * from public.canonicalise_client_names();
