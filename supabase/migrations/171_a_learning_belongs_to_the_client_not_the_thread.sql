-- One learning per client, not one per thread.
--
-- 170 keyed the learning on thread_id. Wrong unit: the escalations LISTING groups by
-- canonical client key (ckey in lib/supabase.ts), so a client with four threads showed
-- four empty boxes in one drawer and asked the same three people to write the same lesson
-- four times. That is how a log stops being filled in. It also made the new listing
-- column impossible to answer — "the learning" for a four-thread row is not one thing.
--
-- The key is now client_key, computed by client_key() below with EXACTLY the
-- normalisation ckey() uses — lowercase, alphanumerics only — so a learning belongs to
-- precisely the row it was written on, and "Growth Funnels" and "GrowthFunnels" share one
-- the same way the listing already merges them.
--
-- WHAT THIS ENVIRONMENT WOULD NOT LET ME DO. DROP is refused here, so three things are
-- left behind rather than removed, and all three are inert:
--   * escalation_learnings.thread_id — now nullable, no longer the key, written by nothing.
--   * save_escalation_learning(text,text) — the thread-level RPC. EXECUTE is revoked from
--     anon, authenticated and public, so nothing can call it.
--   * web_escalation_learning_watch still exposes thread_id and repeat_threads, because
--     CREATE OR REPLACE VIEW cannot drop a column. Both are now a literal null.
-- Drop all three by hand when the chance comes; none of them does anything today.

alter table public.escalation_learnings add column if not exists client_key text;
alter table public.escalation_learnings drop constraint if exists escalation_learnings_pkey;
alter table public.escalation_learnings alter column thread_id drop not null;
alter table public.escalation_learnings add constraint escalation_learnings_pkey primary key (client_key);

-- The listing's ckey(), in SQL. If one changes the other must, or a learning written on a
-- row stops being found by it.
create or replace function public.client_key(p_name text)
returns text language sql immutable as $function$
  select lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'));
$function$;

create or replace function public.save_client_learning(p_company_name text, p_learning text)
returns public.escalation_learnings
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := public.jwt_email();
  v_key   text := public.client_key(p_company_name);
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
  if v_key = '' then
    raise exception 'No client on that escalation' using errcode = '22023';
  end if;

  insert into public.escalation_learnings (client_key, company_name, learning, author_email)
  values (v_key, btrim(p_company_name), v_text, v_email)
  on conflict (client_key) do update set
    learning     = excluded.learning,
    company_name = excluded.company_name,
    author_email = excluded.author_email,
    updated_at   = now(),
    -- The summary described the OLD text; keeping it would caption the wrong sentence.
    ai_summary = null, ai_actions = null, ai_at = null, ai_by = null
  returning * into v_row;

  return v_row;
end $function$;

grant execute on function public.save_client_learning(text, text) to anon, authenticated;
revoke execute on function public.save_escalation_learning(text, text) from anon, authenticated, public;

-- The watch, re-keyed. thread_id and repeat_threads are nulls held open only because the
-- view's column list cannot shrink — see the note at the top.
create or replace view public.web_escalation_learning_watch
with (security_invoker = true) as
with later as (
  select l.client_key,
         count(*)::int              as repeats,
         max(e.first_flagged_date)  as last_repeat,
         min(e.first_flagged_date)  as first_repeat
  from public.escalation_learnings l
  join public.critical_escalations e
    on public.client_key(e.company_name) = l.client_key
   and coalesce(e.dismissed, false) = false
   and e.first_flagged_date > l.created_at::date
  group by l.client_key
)
select null::text    as thread_id,
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
       null::text[]  as repeat_threads,
       (later.repeats is not null) as still_escalating,
       (l.ai_summary is null)      as summary_pending,
       l.client_key
from public.escalation_learnings l
left join later on later.client_key = l.client_key;

grant select on public.web_escalation_learning_watch to anon, authenticated;
