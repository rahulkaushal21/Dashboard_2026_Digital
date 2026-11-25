-- An LP person is not a Web department
--
-- Rahul found project-sheet rows where Nitin Mishra or Madhav Maheshwari were the PC/SME
-- or the expert while Service Department read WEB-AU, WEB-UK or WEB-US, and corrected
-- them by hand on 25 Nov 2026. Neither of them takes Web work.
--
-- Not cosmetic. service_dept is what the Business Unit switch splits on and what every
-- per-team total groups by, so an LP delivery filed as WEB-US moves money out of LP's
-- numbers into Web's — and nothing on screen looks wrong, because the row is complete.
-- Only somebody who knows who works where can see it.
--
-- TWO fixes, because there are two different failures here.
--
-- 1. pm_directory.team. web_pm_department (060) answers "which team is this PM on" from
--    the directory FIRST and from their delivery history only as a fallback. For these
--    two the history is the wrong teacher — Nitin Mishra is PC/SME on 78 WEB-US sheet
--    rows and expert on 79, which are the rows being corrected — so the directory has to
--    say it outright or the fallback keeps filing them under Web.
--
-- 2. A refusal at the point of writing. The dialogs already block it (deptPersonConflict
--    in lib/deal-fields.ts), but the dialogs are not the only way a row is written: the
--    email scan inserts opportunities directly and never opens one.
--
-- An explicit LIST, not a rule derived from web_pm_department, which would refuse any
-- PM whose history disagrees with the row — Gagandeep Singh picking up one WEB-UK job is
-- normal and must not be blocked. This list is for people who never take Web work at all.
-- Add to it only on that basis.
--
-- It REFUSES rather than corrects. Which of the two fields is wrong, the department or
-- the person, is not something a trigger can know, and quietly rewriting either would
-- replace a visible error with an invisible one.

create table if not exists public.dept_person_rules (
  person     text primary key,
  aliases    text[] not null default '{}',
  allowed    text[] not null,
  note       text,
  set_by     text,
  set_at     timestamptz not null default now()
);

-- Aliases are lower-case and matched exactly. A BARE FIRST NAME is listed only where one
-- person in the book carries it: there is one Nitin and one Madhav today, unlike the
-- three Kaustubhs and two Rahuls that the NBD list warns about. Check before adding one.
insert into public.dept_person_rules (person, aliases, allowed, note, set_by) values
  ('Nitin Mishra',      array['nitin mishra','nitin'],       array['LP','HUB'],
   'Found on WEB-AU/UK/US rows and corrected by hand, 25 Nov 2026.', 'rahul.k@mavlers.com'),
  ('Madhav Maheshwari', array['madhav maheshwari','madhav'], array['LP','HUB'],
   'Found on WEB-AU/UK/US rows and corrected by hand, 25 Nov 2026.', 'rahul.k@mavlers.com')
on conflict (person) do nothing;

revoke all on public.dept_person_rules from anon, authenticated;
grant select on public.dept_person_rules to anon, authenticated;

-- Say it in the directory too, so every page that asks web_pm_department gets LP/HUB
-- instead of the majority of their mis-filed history. Only where the person is already
-- in the directory: adding somebody to pm_directory has other consequences.
update public.pm_directory
   set team = 'LP/HUB'
 where lower(btrim(name)) in ('nitin mishra', 'madhav maheshwari')
   and coalesce(btrim(team), '') <> 'LP/HUB';

create or replace function public.check_dept_person()
returns trigger language plpgsql as $$
declare bad record;
begin
  if coalesce(btrim(new.service_dept), '') = '' then return new; end if;
  select r.person, r.allowed into bad
    from public.dept_person_rules r
   where (lower(btrim(coalesce(new.pm_owner, ''))) = any (r.aliases)
       or lower(btrim(coalesce(new.expert,   ''))) = any (r.aliases))
     and not (btrim(new.service_dept) = any (r.allowed))
   limit 1;
  if found then
    raise exception '% works % — % is wrong for this row. Set the department, or put the right person on it.',
      bad.person, array_to_string(bad.allowed, '/'), btrim(new.service_dept)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger check_dept_person
  before insert or update on public.opportunities
  for each row execute function public.check_dept_person();
