-- A department has an owner
--
-- Expert is now a required field on the confirm dialog, along with Account manager and
-- Business type. A required field needs a sensible default or it becomes a field people
-- type anything into, and it needs to hold for rows that never pass through the form at
-- all — the email scan writes opportunities directly.
--
-- So the map lives here, in a table, and the trigger below applies it to any row whose
-- Expert is blank. lib/deal-fields.ts carries the same map for the dialog's prefill; this
-- one is the backstop, and the one that decides.
--
-- The names are Rahul's, set on 23 Nov 2026, and are NOT the historical majority — that
-- was measured first and disagrees for three of the six. Since July 2026 WEB-UK is Rahul
-- Kumar at 52% with a third of its work on Contractor, WEB-US is Gagandeep Singh at 43%
-- (Harshal at 10%), and LP/HUB are Harshvardhan Sharma at ~89%. These are who is
-- ACCOUNTABLE for the department now, which history cannot tell you. Anyone tempted to
-- "fix" them towards the majority should change the row here, with a reason, instead.

create table if not exists public.dept_expert_defaults (
  dept       text primary key,
  expert     text not null,
  note       text,
  set_by     text,
  set_at     timestamptz not null default now()
);

insert into public.dept_expert_defaults (dept, expert, note, set_by) values
  ('WEB-AU',          'KS',               'Matches the recent majority too: 66% of WEB-AU since Jul 2026.', 'rahul.k@mavlers.com'),
  ('WEB-UK',          'Rahul Kumar',      'Also the recent majority, 52%.',                                  'rahul.k@mavlers.com'),
  ('WEB-US',          'Harshal Mehuriya', 'Accountability, not history: the column itself says Gagandeep Singh 43%, Harshal 10%.', 'rahul.k@mavlers.com'),
  ('LP',              'Pratik Bhatt',     'Accountability, not history: the column says Harshvardhan Sharma ~89%.', 'rahul.k@mavlers.com'),
  ('HUB',             'Pratik Bhatt',     'Accountability, not history: the column says Harshvardhan Sharma ~89%.', 'rahul.k@mavlers.com'),
  ('AI & Automation', 'Rahul Kaushal',    'Set 23 Nov 2026; the four existing lines (all Telfer Digital) were filled with it.', 'rahul.k@mavlers.com')
on conflict (dept) do nothing;

-- Readable by the dashboard, writable by nobody through the API. A new table in public is
-- served by PostgREST the moment it exists, so the grants are spelled out rather than
-- left at whatever the role happens to have.
revoke all on public.dept_expert_defaults from anon, authenticated;
grant select on public.dept_expert_defaults to anon, authenticated;

create or replace function public.fill_expert_from_dept()
returns trigger language plpgsql as $$
begin
  -- Only ever fills a BLANK. A name on the row is somebody's decision about that project
  -- and this must not reach over it — including "Contractor", which is a real answer.
  if coalesce(btrim(new.expert), '') = '' and coalesce(btrim(new.service_dept), '') <> '' then
    select d.expert into new.expert
      from public.dept_expert_defaults d
     where d.dept = btrim(new.service_dept);
  end if;
  return new;
end $$;

drop trigger if exists fill_expert_from_dept on public.opportunities;
create trigger fill_expert_from_dept
  before insert or update on public.opportunities
  for each row execute function public.fill_expert_from_dept();
