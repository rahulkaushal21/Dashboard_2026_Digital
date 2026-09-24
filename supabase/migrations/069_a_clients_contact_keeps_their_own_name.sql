-- A client contact keeps their own name.
--
-- gsmith@zulu8.com.au is Guy Smith. Across 115 rows the source sheet calls him "Guy
-- Smith" (95), "GUY Smith" (6), "Guy" (6), "Guy smith" (5), "Guy-Smith" (1) — and, on one
-- row typed in September 2026, "Gay". The dashboard printed it faithfully, which is not
-- the same as printing it correctly. A person's name is not a field to be relaxed about.
--
-- Two mechanisms, and the difference between them matters:
--
--   1. SPELLING FORMS, fixed automatically. "GUY Smith", "Guy smith" and "Guy-Smith" are
--      the same letters in a different shape, so the commonest shape wins. This can never
--      invent a name, because it only ever picks a spelling that already exists for that
--      same person.
--
--   2. WRONG NAMES, fixed only by hand, in contact_name_fixes. "Gay" is not a casing
--      variant of "Guy" — it is different letters, and no rule can safely tell a typo
--      from a genuinely different person. Guessing is how smazariego@zulu8.com.au ends up
--      labelled "Guy Smith", which is a second person's name on a first person's email:
--      the same mistake, made confidently.
--
-- Keyed on EMAIL, never on the name, because the email is the part that identifies
-- somebody. The old spelling stays in the sheet; only what we display changes.

create table if not exists public.contact_name_fixes (
  email   text primary key,
  name    text not null,
  note    text,
  set_by  text,
  set_at  timestamptz not null default now()
);

comment on table public.contact_name_fixes is
  'What a client contact is actually called, when the sheet gets it wrong. Keyed on email. Only ever affects what is displayed.';

alter table public.contact_name_fixes enable row level security;
grant select on public.contact_name_fixes to anon, authenticated;
revoke insert, update, delete on public.contact_name_fixes from anon, authenticated;

insert into public.contact_name_fixes (email, name, note, set_by) values
  ('gsmith@zulu8.com.au', 'Guy Smith', 'Sheet has "Gay" on one September 2026 row, and five other spellings elsewhere.', 'system'),
  ('guy@zulu8.com.au',    'Guy Smith', 'Same person, second address.', 'system')
on conflict (email) do update set name = excluded.name, note = excluded.note, set_at = now();

-- The commonest spelling of each name, per contact. Grouped by the LETTERS of the name,
-- so only genuine variants of one spelling compete with each other.
--
-- READS THE SOURCES, NOT THE LEDGER. The first cut read web_project_ledger, and
-- contact_display_name() is used inside that same view: ledger → function → forms →
-- ledger. Applying it hung, which is the cheapest way to find a cycle.
create or replace view public.web_contact_name_forms as
select email, letters, name as best_form from (
  select email, letters, name, count(*) as n,
         row_number() over (partition by email, letters order by count(*) desc, name) as rn
  from (
    select lower(btrim(s.client_email))                                        as email,
           lower(regexp_replace(coalesce(s.client_name,''), '[^a-zA-Z]', '', 'g')) as letters,
           btrim(s.client_name)                                                as name
    from public.web_sheet_rows s
    where coalesce(btrim(s.client_email),'') <> '' and coalesce(btrim(s.client_name),'') <> ''
    union all
    select lower(btrim(o.contact_email)),
           lower(regexp_replace(coalesce(o.client_name,''), '[^a-zA-Z]', '', 'g')),
           btrim(o.client_name)
    from public.opportunities o
    where coalesce(btrim(o.contact_email),'') <> '' and coalesce(btrim(o.client_name),'') <> ''
  ) src
  group by email, letters, name
) t
where rn = 1;

alter view public.web_contact_name_forms set (security_invoker = true);
grant select on public.web_contact_name_forms to anon, authenticated;

create or replace function public.contact_display_name(p_email text, p_name text)
returns text
language sql stable as $$
  select coalesce(
    (select f.name from public.contact_name_fixes f
      where f.email = lower(btrim(coalesce(p_email,'')))),
    (select v.best_form from public.web_contact_name_forms v
      where v.email = lower(btrim(coalesce(p_email,'')))
        and v.letters = lower(regexp_replace(coalesce(p_name,''), '[^a-zA-Z]', '', 'g'))),
    nullif(btrim(coalesce(p_name,'')), '')
  )
$$;

comment on function public.contact_display_name(text, text) is
  'What to call a client contact: a correction if one has been recorded, else the commonest spelling of that same name for that same email, else what the sheet says.';

-- Applied to both branches of the ledger in place, so every page shows the same name.
do $$
declare v_def text; v_new text;
begin
  select pg_get_viewdef('public.web_project_ledger'::regclass, true) into v_def;
  if position('contact_display_name' in v_def) > 0 then return; end if;
  v_new := replace(v_def, E'    s.client_name,',
                          E'    public.contact_display_name(s.client_email, s.client_name) AS client_name,');
  v_new := replace(v_new, E'    o.client_name,',
                          E'    public.contact_display_name(o.contact_email, o.client_name) AS client_name,');
  if v_new = v_def then raise exception 'no client_name column matched — recreate by hand'; end if;
  execute 'create or replace view public.web_project_ledger as ' || v_new;
end $$;
