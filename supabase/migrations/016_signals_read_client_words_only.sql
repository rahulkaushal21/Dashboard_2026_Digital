-- The commitment signals were reading OUR OWN sales language back as if the client
-- had said it, and the tick was surviving a decision the dashboard had already made.
--
-- 1. QUOTED CHAINS. Ingest trims reply chains, but its safety valve keeps the raw
--    body whenever trimming would leave under 200 characters -- which is exactly
--    the short "no, not yet" reply. CodLab/RAPsheet proved it: Ryan Doherty's 4 Aug
--    reply was "No, still no progress with seed funding. I'll be sure to advise
--    when I get an opportunity to proceed with the app" -- a refusal -- but the
--    stored body ran to 60,000 characters and matched "move forward" somewhere in
--    our own quoted follow-ups. The deal wore the committed-in-email tick.
--    Corpus-wide: 1,464 -> 668 approve matches. Over half were quoted text.
--
-- 2. CONDITIONAL PHRASING. "when I get an opportunity to proceed" is not an
--    approval. Patterns tightened: 668 -> 415.
--
-- 3. SHARED SUBJECTS. This view groups by subject, so 377 of 20,237 subject keys
--    used by more than one client domain were letting one client's "please proceed"
--    light up another client's deal. Those are now unattributable and suppressed.
--
-- 4. SCHEDULING. "Please go ahead and send over the calendar invite" approves a
--    meeting, not a quote. Hana Lab carried the tick on exactly that sentence.
--
-- Net: the committed-in-email list went from 18 deals to 4, each one verified
-- against the client's own words.
create or replace function public.email_new_text(t text) returns text
language sql immutable parallel safe as $$
  select coalesce(
    substring(t from '^([\s\S]*?)(?=\nOn [\s\S]{0,160}wrote:|\n[[:space:]]*>|\nFrom:[[:space:]]|\n_{10,}|\n-{3,}[[:space:]]*Original Message)'),
    t)
$$;

comment on function public.email_new_text(text) is
  'The sender''s own new text: everything before the first quoted-chain marker. Never match commitment language against a full body -- it contains our words too.';

drop materialized view if exists email_thread_signals cascade;

create materialized view email_thread_signals as
with ext as (
  select lower(regexp_replace(subject, '^((re|fw|fwd)\s*:\s*)+', '', 'i')) as subj_key,
         split_part(lower(from_addr), '@', 2) as dom,
         coalesce(body, snippet) as raw
  from email_inbox
  where subject is not null and length(trim(subject)) > 12
    and from_addr !~~* '%mavlers%' and from_addr !~~* '%uplers%'
),
keys as (select subj_key, count(distinct dom) > 1 as ambiguous_subject from ext group by 1),
-- Only bodies that could possibly match go through the extraction; running it over
-- the whole 64k-row corpus times out, and the rest contribute false anyway.
cand as (
  select subj_key, lower(public.email_new_text(raw)) as nb
  from ext
  where raw ~* '(approv|proceed|go ?ahead|move forward|signed off|invoice|purchase order|deposit|payment structure|50/50|wp-admin|sftp|cpanel|credential|added you to|invite to|access for|login details|kick ?off|questionnaire|packaged all assets|brief attached)'
),
agg as (
  select subj_key,
    bool_or(
      nb ~ '(we are approved|is approved|received the approval|signed off on|please proceed|happy to proceed|ready to proceed|(please |you can |we can |happy to |ready to |let us |lets )go ?ahead|gave the go-?ahead|go-?ahead (given|confirmed)|(like|want|happy|ready|keen) to move forward|lets move forward)'
      and not (
        nb ~ 'go ?ahead and (send|book|schedule|set ?up|share)[^.]{0,40}(invite|calendar|call|meeting|time|slot|zoom|link)'
        and not nb ~ '(we are approved|is approved|received the approval|signed off on|please proceed|happy to proceed|ready to proceed|gave the go-?ahead|go-?ahead (given|confirmed)|(like|want|happy|ready|keen) to move forward)'
      )
    ) as sig_approve,
    bool_or(nb ~ '(invoice|purchase order|deposit|payment structure|50/50)') as sig_money,
    bool_or(nb ~ '(wp-admin|sftp|cpanel|credentials|added you to|invite to|access for|login details)') as sig_access,
    bool_or(nb ~ '(kick ?off|questionnaire|packaged all assets|brief attached)') as sig_kickoff
  from cand group by 1
)
select k.subj_key,
       case when k.ambiguous_subject then false else coalesce(a.sig_approve, false) end as sig_approve,
       case when k.ambiguous_subject then false else coalesce(a.sig_money, false) end as sig_money,
       case when k.ambiguous_subject then false else coalesce(a.sig_access, false) end as sig_access,
       case when k.ambiguous_subject then false else coalesce(a.sig_kickoff, false) end as sig_kickoff,
       k.ambiguous_subject
from keys k left join agg a on a.subj_key = k.subj_key;

create unique index if not exists email_thread_signals_key on email_thread_signals (subj_key);
revoke all on email_thread_signals from anon, authenticated;
