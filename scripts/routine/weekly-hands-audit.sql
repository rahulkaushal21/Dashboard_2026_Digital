-- Weekly: what the team's hands did, and what the system should learn from it.
--
-- Run every Monday for the seven days just gone, then write the findings into the
-- "What the team's own hands tell us" section of FULL-REFRESH-PROMPT.md. The point is
-- not the counts. It is that a correction made by hand is EVIDENCE THE SYSTEM WAS
-- WRONG, and the only way the system stops being wrong is if somebody reads them.
--
-- Set the window once; every query below uses it.
\set since '2026-10-16'

-- 1. Who did what. Exclude web@uplers.com and claude: those are tests and the routine,
--    not the team, and counting them flatters the usage figures.
select actor, count(*) total,
       count(*) filter (where event = 'edited')    edited,
       count(*) filter (where event = 'confirmed') confirmed,
       count(*) filter (where event = 'created')   created,
       count(*) filter (where event in ('merged', 'unmerged')) merges
from opportunity_events
where at >= :'since'::date and actor not in ('web@uplers.com', 'claude')
group by 1 order by 2 desc;

-- 2. WHICH FIELDS ARE CORRECTED — the most useful query here. A field the team keeps
--    fixing is a field the sync should stop guessing at.
select k as field, count(*) n, count(distinct actor) people
from opportunity_events e, lateral jsonb_object_keys(e.detail->'changed') k
where e.at >= :'since'::date and e.event = 'edited'
  and jsonb_typeof(e.detail->'changed') = 'object'
  -- A field logged with from = to was never touched; the editor sends every field.
  and (e.detail->'changed'->k->>'from') is distinct from (e.detail->'changed'->k->>'to')
group by 1 order by 2 desc;

-- 3. Deals closed by hand, and whether anyone said why. A sweep (many rows, one actor,
--    one hour) is one decision, not N — report it as one.
select coalesce(email_lost_by, '?') who, date_trunc('hour', email_lost_at) hr, count(*) n,
       count(*) filter (where coalesce(btrim(email_lost_reason), '') = '') no_reason,
       sum(coalesce(est_value, 0))::int value
from opportunities
where email_lost_at >= :'since'::date
group by 1, 2 order by 3 desc;

-- 4. Deals created by hand = threads the scan did not find. Read each one and say why.
select o.id, o.company_name, o.est_value, o.pm_owner, o.created_at::date, left(o.source_subject, 90) subj
from opportunities o
where o.origin = 'pm' and o.created_at >= :'since'::date
order by o.created_at desc;

-- 5. Merges, with the reason. Four of October's six were my own round-trip tests.
select e.at::date d, e.actor, e.event, e.detail->>'project' proj, e.detail->>'into' into_id,
       left(coalesce(e.detail->>'reason', ''), 120) reason, e.detail->>'company' company
from opportunity_events e
where e.at >= :'since'::date and e.event in ('merged', 'unmerged', 'rolled_up')
order by e.at;

-- 6. ESCALATIONS THE USER THREW OUT, AND WHY. The single richest source of learning on
--    the whole dashboard: every dismissal reason is a sentence saying what the detector
--    should never have flagged. Read the text, not the count.
select company_name, signal_type, status, resolved_by, coalesce(resolved_at, updated_at)::date d,
       reason
from critical_escalations
where dismissed = true and coalesce(btrim(reason), '') <> ''
  and coalesce(resolved_at, updated_at) >= :'since'::date
order by d desc;

-- 7. Escalations marked fixed. Note how many carry no resolution note: a fix with no
--    note teaches nothing and cannot be reused the next time the same thing happens.
select count(*) fixed,
       count(*) filter (where coalesce(btrim(resolution_note), '') = '') without_note
from critical_escalations
where status = 'fixed' and coalesce(resolved_at, updated_at) >= :'since'::date;

-- 8. Feedback added by hand, and what happened to it.
select status, count(*) n, count(distinct submitted_by) people
from manual_feedback where submitted_at >= :'since'::date group by 1 order by 2 desc;
