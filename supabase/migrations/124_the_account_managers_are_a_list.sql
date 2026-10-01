-- 124 — the account managers are a list, not a text box
--
-- Rahul, 2 Oct 2026: "in adding new opportunity, AM name should be in dropdown, why
-- people need to add it manually same goes for PM."
--
-- The PM half needed no migration — pm_directory already existed and the field was just
-- the wrong control. There was no equivalent for AMs, and the cost of that is measurable:
-- forty distinct spellings across opportunities, web_revenue and web_clients for about
-- twenty-five people.
--
--   Kaustubh Agrawal (31) / Kaustubh Kulkarni (1) / Kaustub (1)   three Kaustubhs, two real
--   Vikram Shahi / Vikram Sahi (32)                               one is a typo, confirmed 2 Oct
--   Nevilson Christian (6) / Nevilson (3)
--   Kalgi Shah (74) / Kalgi shah (1) / Kalgi (1)
--   Flintoff Mehta (90) / Flintoff (6)
--   kamesh Biniwale                                               lower-case k
--
-- Every one of those splits a person's deals in two in any report grouped by AM.
--
-- No email column, unlike pm_directory. A PM's row is matched against the signed-in user
-- by directory_owner_match to decide who may confirm and edit; an AM does not sign in and
-- owns no permission, so there is nothing to match on and an email would be a column
-- nobody fills. That is also why this is a SEPARATE table rather than a role flag on
-- pm_directory: putting AMs there would put twenty-five names inside the check that grants
-- edit rights over a row.

create table if not exists public.am_directory (
  name     text primary key,
  slug     text not null unique,
  -- The spellings already in the data. canonicalAm() in lib/supabase.ts resolves a stored
  -- value through these so an old row shows the right person already selected instead of
  -- falling through to "not in list" and looking like somebody else.
  aliases  text[] not null default '{}',
  active   boolean not null default true,
  team     text,
  note     text,
  added_by text,
  added_at timestamptz not null default now()
);

comment on table public.am_directory is
  'The account managers an AM field is PICKED from. Shaped like pm_directory but with no email: an AM does not sign in, so there is nothing to match them on. aliases holds the spellings already in the data so a historical name still resolves to one person. See migration 124.';

alter table public.am_directory enable row level security;
create policy am_directory_read on public.am_directory for select to authenticated using (true);
create policy am_directory_admin_write on public.am_directory for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

-- Seeded from what was actually in use, so nobody's name disappears from the dropdown the
-- day it ships. Checked afterwards: zero spellings across all three tables fail to resolve.
--
-- NOTHING IS REWRITTEN. opportunities.sales_person still says what it said. The dropdown
-- stops new variants; it does not repair old ones, and repairing them is not a one-line
-- update — the Quotes tab still holds "Vikram Sahi" and sync_quotes_to_opportunities would
-- put it back inside the half hour. That is a decision about the source sheet, not this table.
insert into public.am_directory (name, slug, aliases, active, note, added_by) values
  ('Dhaval Damania','dhaval-damania','{}',true,null,'seed:124'),
  ('Prachi Porwal','prachi-porwal','{}',true,null,'seed:124'),
  ('Flintoff Mehta','flintoff-mehta','{"Flintoff"}',true,null,'seed:124'),
  ('Hammad Riyaz Bhaldar','hammad-riyaz-bhaldar','{}',true,null,'seed:124'),
  ('Saquib Khan','saquib-khan','{}',true,null,'seed:124'),
  ('Kalgi Shah','kalgi-shah','{"Kalgi","Kalgi shah"}',true,'On maternity leave; handover to Vikram Shahi','seed:124'),
  ('Sourya Ghosh','sourya-ghosh','{}',true,null,'seed:124'),
  ('Baspin Thomas','baspin-thomas','{}',true,null,'seed:124'),
  ('Malav Modi','malav-modi','{}',true,null,'seed:124'),
  ('Vikram Shahi','vikram-shahi','{"Vikram Sahi"}',true,'Confirmed spelling 2 Oct 2026; "Vikram Sahi" was 32 deals of typo','seed:124'),
  ('Kaustubh Agrawal','kaustubh-agrawal','{"Kaustub"}',true,'Distinct from Kaustubh Kulkarni','seed:124'),
  ('Kaustubh Kulkarni','kaustubh-kulkarni','{}',true,'Distinct from Kaustubh Agrawal','seed:124'),
  ('Manvi Choumal','manvi-choumal','{"Manvi"}',true,'Confirmed full name 2 Oct 2026','seed:124'),
  ('Nevilson Christian','nevilson-christian','{"Nevilson"}',true,null,'seed:124'),
  ('Kamesh Biniwale','kamesh-biniwale','{"kamesh Biniwale"}',true,null,'seed:124'),
  ('Devanshu Kumar','devanshu-kumar','{}',true,null,'seed:124'),
  ('Ayush Rathi','ayush-rathi','{}',true,null,'seed:124'),
  ('Kunal Gohil','kunal-gohil','{}',true,null,'seed:124'),
  ('Karan Doshi','karan-doshi','{}',true,null,'seed:124'),
  ('Preeti Thapliyal','preeti-thapliyal','{}',true,null,'seed:124'),
  ('Sudarshan Damani','sudarshan-damani','{}',true,null,'seed:124'),
  ('Jebin Joy','jebin-joy','{}',true,null,'seed:124'),
  ('Aman Acharya','aman-acharya','{}',true,null,'seed:124'),
  ('Divya S','divya-s','{}',true,'Full name not confirmed','seed:124'),
  ('Rahul Kaushal','rahul-kaushal','{}',true,null,'seed:124'),
  ('Rahul Gupta','rahul-gupta','{}',true,null,'seed:124'),
  ('Rahul Jain','rahul-jain','{}',true,null,'seed:124'),
  ('Mukund Basita','mukund-basita','{}',true,null,'seed:124'),
  ('Sakshi Bissa','sakshi-bissa','{}',true,null,'seed:124'),
  ('Rupali Sindhu','rupali-sindhu','{}',true,null,'seed:124'),
  ('Meera Shingala','meera-shingala','{}',true,null,'seed:124'),
  ('Ashish Kurian','ashish-kurian','{}',true,null,'seed:124'),
  ('Sheldon Fernandes','sheldon-fernandes','{}',true,null,'seed:124'),
  ('Pandian Mudaliar','pandian-mudaliar','{}',true,null,'seed:124'),
  ('Dhruti Dave','dhruti-dave','{}',true,null,'seed:124'),
  ('Vinita Raidu','vinita-raidu','{}',true,null,'seed:124'),
  ('Prativa Dubey','prativa-dubey','{}',true,null,'seed:124'),
  -- Not a person. Rahul asked for both names on Kalgi's deals while she is on maternity
  -- leave, so the joint label is deliberate and has to stay selectable.
  ('Kalgi Shah / Vikram Shahi','kalgi-shah-vikram-shahi','{}',true,'Deliberate joint entry for the maternity handover, not a person','seed:124'),
  -- These six are in web_revenue and web_clients but on no opportunity: older accounts,
  -- probably leavers. Seeded active so nothing vanishes; mark inactive once confirmed.
  ('Dimple Acharya','dimple-acharya','{}',true,'Only in web_revenue/web_clients, not on any opportunity','seed:124'),
  ('Chris Wilden Karkada','chris-wilden-karkada','{}',true,'Only in web_revenue/web_clients','seed:124'),
  ('Tanuj Gupta','tanuj-gupta','{}',true,'Only in web_revenue','seed:124'),
  ('Hiren Purohit','hiren-purohit','{}',true,'Only in web_revenue','seed:124'),
  ('Richa Kohli Pawar','richa-kohli-pawar','{}',true,'Only in web_revenue/web_clients','seed:124'),
  ('Ankit Pandya','ankit-pandya','{}',true,'Only in web_revenue','seed:124')
on conflict (name) do nothing;
