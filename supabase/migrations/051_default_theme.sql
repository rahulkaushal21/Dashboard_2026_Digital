-- The theme everybody gets before they pick one for themselves. Applied 22 Sep 2026.
--
-- A personal choice lives in that browser's localStorage and always wins. This column is
-- the starting point for a new person, a new laptop, or anybody who has never opened the
-- picker — which is most of the team. Without it, "make this the team default" would mean
-- nothing beyond the one browser the admin clicked it in.
--
-- app_settings is already readable by everyone (select using true) and writable only by
-- admins, which is exactly the shape this needs.
alter table public.app_settings add column if not exists default_theme text;
