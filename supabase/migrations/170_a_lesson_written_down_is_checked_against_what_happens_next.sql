-- Learnings on a critical escalation, and a watch on whether they held.
--
-- Krunal Shah, Hiren Purohit and Pratik Bhatt write what they took away from each
-- critical escalation. The point is not the record: it is the next question, which the
-- watch at the bottom of this file asks — did the same client escalate again AFTER the
-- lesson was written down? A learnings log nobody checks is a diary. This one is graded.
--
-- WHO. The three are named in a TABLE, not in the function, for the same reason
-- incentive_viewers is a table: the list changes and a migration should not be needed to
-- change it. The browser's copy of the list (ESCALATION_LEARNING_EMAILS in lib/access.ts)
-- only decides whether to SHOW the box; this table is what decides whether a write lands.
-- Keep the two in step — someone added here but not there sees no box; someone added
-- there but not here gets a refusal when they press Save.
--
-- THE TWO KRUNALS ARE A TRAP. krunal.s@mavlers.com is Krunal Shah, who is on this list.
-- krunal@mavlers.com is Krunal Bakraniya, a different person. The obvious guess for
-- "Krunal" is the wrong address.

create table if not exists public.escalation_learning_authors (
  email text primary key,
  note  text,
  added_at timestamptz not null default now()
);

insert into public.escalation_learning_authors (email, note) values
  ('krunal.s@mavlers.com', 'Krunal Shah - asked for 16 Nov 2026. NOT krunal@, who is Krunal Bakraniya'),
  ('hiren@mavlers.com',    'Hiren Purohit - asked for 16 Nov 2026'),
  ('pratik@mavlers.com',   'Pratik Bhatt - asked for 16 Nov 2026'),
  -- The owner was not in the three asked for, but is the person who seeds and tests this
  -- and who manages the list. Add or remove an author with an insert or delete here; no
  -- migration, and no deploy, is needed to change who may write.
  ('web@uplers.com',       'Owner - manages the list and seeds/tests the feature')
on conflict (email) do nothing;

create or replace function public.may_write_learning(p_email text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.escalation_learning_authors a
    where a.email = lower(btrim(coalesce(p_email, '')))
  );
$function$;

-- One learning per escalation thread, editable in place. Not one row per edit: the three
-- of them are writing a conclusion, and a conclusion that gets refined should read as one
-- statement rather than a thread of its own. updated_at carries the revision.
create table if not exists public.escalation_learnings (
  thread_id    text primary key references public.critical_escalations(thread_id) on delete cascade,
  -- Copied, not joined. An escalation can be dismissed or re-keyed; the lesson and the
  -- client it was about should survive that, because the watch reads across both.
  company_name text,
  learning     text not null,
  author_email text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Written by the refresh, where Claude already reads and judges. Null until then, and
  -- the UI says so rather than showing an empty summary as if the AI had nothing to say.
  ai_summary   text,
  ai_actions   text[],
  ai_at        timestamptz,
  ai_by        text
);

create index if not exists escalation_learnings_company_idx on public.escalation_learnings (company_name);
create index if not exists escalation_learnings_created_idx on public.escalation_learnings (created_at desc);

-- Tier 2: anon reads, as it does every other table on this dashboard. Writes go through
-- the RPC below and nowhere else.
alter table public.escalation_learnings enable row level security;
alter table public.escalation_learning_authors enable row level security;

drop policy if exists escalation_learnings_read on public.escalation_learnings;
create policy escalation_learnings_read on public.escalation_learnings for select using (true);

grant select on public.escalation_learnings to anon, authenticated;

-- A NEW TABLE IN public IS PUBLISHED. Both of these arrived with anon holding INSERT and
-- UPDATE from the schema's default privileges — RLS was already denying the writes, since
-- the only policy is for SELECT, but a grant nobody intended is one permissive policy away
-- from being live. Checked with has_table_privilege after the DDL rather than assumed.
revoke insert, update, delete, truncate, references, trigger
  on public.escalation_learnings from anon, authenticated;
-- The author list is NOT world-readable at all: it is a list of who holds a privilege,
-- which belongs behind the function that uses it.
revoke all on public.escalation_learning_authors from anon, authenticated;

/**
 * Save or revise the learning on one escalation.
 *
 * The writer is taken from the JWT, never from an argument. mark_escalations_status next
 * door takes p_actor from the caller and believes it, which means the browser decides who
 * did it; that is tolerable for a status flag and not for a named person's stated
 * conclusion. Returns the saved row so the caller cannot mistake a no-op for a save.
 */
create or replace function public.save_escalation_learning(p_thread_id text, p_learning text)
returns public.escalation_learnings
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := public.jwt_email();
  v_row   public.escalation_learnings;
  v_text  text := btrim(coalesce(p_learning, ''));
begin
  if v_email is null then
    raise exception 'Sign in to add a learning' using errcode = '42501';
  end if;
  if not public.may_write_learning(v_email) then
    raise exception 'Only Krunal Shah, Hiren Purohit and Pratik Bhatt record learnings on escalations'
      using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write the learning before saving' using errcode = '22023';
  end if;

  insert into public.escalation_learnings (thread_id, company_name, learning, author_email)
  select p_thread_id, e.company_name, v_text, v_email
  from public.critical_escalations e
  where e.thread_id = p_thread_id
  on conflict (thread_id) do update set
    learning     = excluded.learning,
    author_email = excluded.author_email,
    updated_at   = now(),
    -- The summary described the OLD text. Clearing it is the honest move: the next
    -- refresh writes a new one, and until then the UI says it is pending rather than
    -- showing action steps drawn from a sentence that is no longer there.
    ai_summary   = null,
    ai_actions   = null,
    ai_at        = null,
    ai_by        = null
  returning * into v_row;

  if v_row.thread_id is null then
    raise exception 'No escalation with that thread id' using errcode = 'P0002';
  end if;
  return v_row;
end $function$;

revoke execute on function public.save_escalation_learning(text, text) from public;
grant execute on function public.save_escalation_learning(text, text) to anon, authenticated;

/**
 * THE WATCH: lessons written down, and escalated against anyway.
 *
 * A row appears when a client escalated AFTER a learning was recorded on an earlier
 * escalation of theirs. Compared on first_flagged_date against the learning's created_at,
 * so "after" means after it was written, not after the escalation it was written on.
 *
 * Deliberately no time limit. A ninety-day window was considered and rejected: it would
 * quietly retire the worst cases — the ones where the same thing comes back twice a year
 * — which are exactly the ones a learnings log exists to catch.
 *
 * Dismissed escalations are excluded from the REPEATS but not from the learnings: a
 * lesson taken from an escalation that was later dismissed is still a lesson.
 */
create or replace view public.web_escalation_learning_watch
with (security_invoker = true) as
with later as (
  select l.thread_id,
         count(e.thread_id)::int                as repeats,
         max(e.first_flagged_date)              as last_repeat,
         min(e.first_flagged_date)              as first_repeat,
         array_agg(e.thread_id order by e.first_flagged_date desc) as repeat_threads
  from public.escalation_learnings l
  join public.critical_escalations e
    on e.company_name = l.company_name
   and e.thread_id <> l.thread_id
   and coalesce(e.dismissed, false) = false
   and e.first_flagged_date > l.created_at::date
  group by l.thread_id
)
select l.thread_id,
       l.company_name,
       l.learning,
       l.author_email,
       l.created_at,
       l.updated_at,
       l.ai_summary,
       l.ai_actions,
       l.ai_at,
       coalesce(later.repeats, 0) as repeats_since,
       later.first_repeat,
       later.last_repeat,
       later.repeat_threads,
       (later.repeats is not null)                  as still_escalating,
       (l.ai_summary is null)                       as summary_pending
from public.escalation_learnings l
left join later on later.thread_id = l.thread_id;

grant select on public.web_escalation_learning_watch to anon, authenticated;
