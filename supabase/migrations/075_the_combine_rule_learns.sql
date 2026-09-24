-- "Ad-hoc only" was a guess. Let the business correct it.
--
-- Billing several jobs on one invoice started life restricted to ad-hoc work, because a
-- month of small jobs on one bill is the case it was built for. But a fixed list cannot
-- know what this business actually invoices together, and the people doing it do. Rahul,
-- 25 Sep 2026: "we'll learn when people will do it, system will learn and understand...
-- in most of the cases people will mark adhoc after marking confirm, so system can self
-- understand and improvise."
--
-- So the rule now has a memory. A project type that has been billed together before
-- needs no permission. A type that has not is asked about ONCE, at the moment of
-- confirming — and the answer is the precedent. Nobody is asked about that type again.
-- web_combine_history is not a settings table anybody maintains; it is simply what has
-- happened, read back.
--
-- TWO THINGS DO NOT LEARN, and they are a different kind of rule: an invoice goes to
-- ONE client in ONE currency. No amount of precedent makes that untrue, so they stay
-- hard refusals.
--
-- The other half of the correction is what a blank project type inherits. It used to be
-- stamped 'Ad-hoc' no matter what, which threw away the only evidence of what the person
-- meant — they had just chosen a type on the deal carrying the invoice, one step earlier
-- in the confirm dialog. Blanks now inherit THAT. The system learns from the answer
-- instead of overwriting it with its own assumption.
create or replace view public.web_combine_history
  with (security_invoker = true) as
select lower(btrim(o.project_type))  as type_key,
       min(btrim(o.project_type))    as project_type,
       count(distinct o.rolled_into) as invoices,
       count(*)                      as jobs,
       max(o.confirmed_at)           as last_used
  from public.opportunities o
 where o.rolled_into is not null
   and coalesce(btrim(o.project_type),'') <> ''
 group by 1;

comment on view public.web_combine_history is
  'What people have actually billed together, by project type. Evidence, not a rule: the first time a type is combined it is an override, and every time after that it is precedent.';

revoke all on public.web_combine_history from public, anon, authenticated;
grant select on public.web_combine_history to anon, authenticated;

-- roll_up_opportunities gains p_override. See the live definition for the body; the
-- change from 064 is the project-type gate (precedent instead of a fixed list), the
-- inheritance of the primary's type onto blanks, and the project type recorded in the
-- event detail so the history can be audited later.
--
-- Proven end to end on 25 Sep 2026 and then removed: two New Development deals refused
-- with "No New Development job has been billed on one invoice before"; the same call
-- with p_override => true succeeded and web_combine_history gained the row; a second
-- pair of New Development deals then rolled up with NO override at all. All four rows
-- deleted afterwards, so the precedent table is empty again and the system has learned
-- nothing from a test.
