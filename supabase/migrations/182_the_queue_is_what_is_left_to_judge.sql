-- The queue is what is left to judge
--
-- cross_sell_candidates (179) is the FINDER: it is expensive, so it is materialised and
-- rebuilt by the refresh chain. cross_sell_queue is what is still UNJUDGED: the finder
-- minus everything already recorded in cross_sells or dismissed in cross_sell_dismissals.
--
-- A view rather than a second matview, and rather than rebuilding the finder to know
-- about dismissals: the exclusion is two cheap anti-joins against small tables, so it
-- costs nothing at read time, and it means judging something takes effect IMMEDIATELY
-- instead of at the next chain run. Recording a decision should remove the row from the
-- queue that same second, or whoever is working through the queue sees it again.
--
-- (The finder itself keeps its own cross_sells exclusion from 179. It is redundant with
-- this view and harmless; rebuilding the matview to remove it would mean a DROP, which
-- the deploy connection refuses.)

create or replace view public.cross_sell_queue as
select c.*
from public.cross_sell_candidates c
where not exists (
  select 1 from public.cross_sells x
   where lower(btrim(x.client)) = lower(btrim(c.client))
     and lower(btrim(x.mail_subject)) = lower(btrim(c.mail_subject))
)
and not exists (
  select 1 from public.cross_sell_dismissals d
   where lower(btrim(d.client)) = lower(btrim(c.client))
     and lower(btrim(d.mail_subject)) = lower(btrim(c.mail_subject))
);

comment on view public.cross_sell_queue is
  'Cross-sell candidates still waiting on a judgement. The scan reads this, decides closed / open / dismissed, and the row leaves the queue at once. Never shown on the dashboard — the page shows answers, not questions. See migration 181.';

revoke all on public.cross_sell_queue from anon, public;
grant select on public.cross_sell_queue to authenticated;
