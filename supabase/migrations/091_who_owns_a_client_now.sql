-- Ranking Carolina is Sankalp's now. The dashboard had no way to say that.
--
-- Ownership was derived entirely from lifetime revenue share: web_client_owners marks
-- whoever billed most as is_primary, and web_client_context.pm_owner picks the PM with
-- the largest amount in the ledger. Nitin Mishra holds $25,300 of Ranking Carolina's
-- $27,600, so he would have stayed its owner indefinitely — through the handover, and
-- through however many owners came after.
--
-- Revenue share answers "whose number is this". It cannot answer "who has the
-- relationship today", and the dashboard was using one answer for both questions.
--
-- The two are now separated:
--   * client_owner_overrides names the CURRENT owner. Explicit, dated and attributed,
--     because an unexplained reassignment is indistinguishable from a bug.
--   * Money is untouched. web_client_owners.usd still sums the name on each line, and
--     the PM scorecard still credits revenue by the line's own SME — Nitin keeps his
--     $25,300 and all 12 of his lines. Only is_primary and pm_owner move.
--
-- The override also enters a person with no billing yet, because somebody takes an
-- account over before they ever invoice against it.
--
-- Verified after: 569 clients, every one with exactly one primary; ledger unchanged at
-- $3,817,869; the $2,085 the owners view does not attribute is pre-existing (4 lines
-- with no SME, plus lines with no company name).

create table if not exists public.client_owner_overrides (
  client_key text primary key,
  person     text not null,
  note       text,
  set_by     text,
  set_at     timestamptz not null default now()
);
comment on table public.client_owner_overrides is
  'Who owns a client NOW. Revenue share answers "whose number is this"; it cannot answer "who has the relationship today", because the person who billed most keeps that title forever. Affects ownership only — never money.';
alter table public.client_owner_overrides enable row level security;
grant select on public.client_owner_overrides to anon, authenticated;
do $$ begin
  create policy "anyone signed in can read owner overrides"
    on public.client_owner_overrides for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

insert into public.client_owner_overrides (client_key, person, note, set_by) values
 ('rankingcarolina','Sankalp Waman Bhoyar',
  'Handed over from Nitin Mishra. Nitin holds $25,300 of the $27,600 lifetime, so revenue share would name him primary indefinitely.',
  'web@uplers.com')
on conflict (client_key) do update
  set person = excluded.person, note = excluded.note, set_by = excluded.set_by, set_at = now();

-- web_client_owners: a stated handover outranks revenue share for is_primary only.
create or replace view public.web_client_owners
with (security_invoker = true) as
 WITH keyed AS (
         SELECT lower(regexp_replace(COALESCE(r.company_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS client_key,
            btrim(t.part) AS person, r.booking_amount AS usd, 'line'::text AS src
           FROM web_revenue_lines r,
            LATERAL unnest(regexp_split_to_array(COALESCE(r.sme, ''), '\s*(,|/|&|\band\b)\s*')) t(part)
          WHERE COALESCE(btrim(t.part), '') <> ''
        UNION ALL
         SELECT lower(regexp_replace(COALESCE(o.company_name, ''), '[^a-zA-Z0-9]', '', 'g')),
            btrim(t.part), 0, 'opp'::text
           FROM opportunities o,
            LATERAL unnest(regexp_split_to_array(COALESCE(o.pm_owner, ''), '\s*(,|/|&|\band\b)\s*')) t(part)
          WHERE COALESCE(btrim(t.part), '') <> ''
        UNION ALL
         SELECT lower(regexp_replace(COALESCE(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')),
            btrim(t.part), 0, 'record'::text
           FROM clients c,
            LATERAL unnest(regexp_split_to_array(COALESCE(c.pc_sme, ''), '\s*(,|/|&|\band\b)\s*')) t(part)
          WHERE COALESCE(btrim(t.part), '') <> ''
        UNION ALL
         SELECT ov.client_key, btrim(ov.person), 0, 'override'::text
           FROM public.client_owner_overrides ov
          WHERE COALESCE(btrim(ov.person), '') <> ''
        ), rolled AS (
         SELECT keyed.client_key, canonical_person(keyed.person) AS person,
            sum(keyed.usd) AS usd,
            count(*) FILTER (WHERE keyed.src = 'line') AS lines,
            bool_or(keyed.src = 'record') AS on_record,
            bool_or(keyed.src = 'opp') AS on_deal
           FROM keyed WHERE keyed.client_key <> ''
          GROUP BY keyed.client_key, (canonical_person(keyed.person))
        )
 SELECT r.client_key, r.person, r.usd, r.lines, r.on_record, r.on_deal,
    row_number() OVER (PARTITION BY r.client_key ORDER BY
      (CASE WHEN ov.person IS NOT NULL AND canonical_person(ov.person) = r.person THEN 0 ELSE 1 END),
      r.usd DESC, r.on_record DESC, r.person) = 1 AS is_primary
   FROM rolled r
   LEFT JOIN public.client_owner_overrides ov ON ov.client_key = r.client_key;

-- web_client_context: only the PM facet defers to the handover. Department and
-- technology are facts about the WORK and stay keyed to the money.
create or replace view public.web_client_context
with (security_invoker = true) as
 WITH ranked AS (
         SELECT lower(regexp_replace(COALESCE(l.company_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS client_key,
            l.pm_owner, l.service_dept, l.technology, l.amount_usd
           FROM web_project_ledger l
          WHERE COALESCE(btrim(l.company_name), '') <> ''
        ), top_of AS (
         SELECT ranked.client_key, 'pm'::text AS facet, ranked.pm_owner AS value, sum(ranked.amount_usd) AS amt
           FROM ranked WHERE COALESCE(btrim(ranked.pm_owner), '') <> ''
          GROUP BY ranked.client_key, ranked.pm_owner
        UNION ALL
         SELECT ranked.client_key, 'dept', ranked.service_dept, sum(ranked.amount_usd)
           FROM ranked WHERE COALESCE(btrim(ranked.service_dept), '') <> ''
          GROUP BY ranked.client_key, ranked.service_dept
        UNION ALL
         SELECT ranked.client_key, 'tech', ranked.technology, sum(ranked.amount_usd)
           FROM ranked WHERE COALESCE(btrim(ranked.technology), '') <> ''
          GROUP BY ranked.client_key, ranked.technology
        ), picked AS (
         SELECT t.client_key, t.facet, t.value,
            row_number() OVER (PARTITION BY t.client_key, t.facet ORDER BY
              (CASE WHEN t.facet = 'pm' AND ov.person IS NOT NULL
                     AND canonical_person(ov.person) = canonical_person(t.value) THEN 0 ELSE 1 END),
              t.amt DESC NULLS LAST, t.value) AS rn
           FROM top_of t
           LEFT JOIN public.client_owner_overrides ov ON ov.client_key = t.client_key
        )
 SELECT c.client_key, max(c.company_name) AS company_name,
    max(p.value) FILTER (WHERE p.facet = 'pm') AS pm_owner,
    max(p.value) FILTER (WHERE p.facet = 'dept') AS service_dept,
    max(p.value) FILTER (WHERE p.facet = 'tech') AS technology
   FROM ( SELECT DISTINCT lower(regexp_replace(COALESCE(web_project_ledger.company_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS client_key,
            web_project_ledger.company_name
           FROM web_project_ledger
          WHERE COALESCE(btrim(web_project_ledger.company_name), '') <> '') c
     LEFT JOIN picked p ON p.client_key = c.client_key AND p.rn = 1
  GROUP BY c.client_key;

-- escalation_dept_mv reads web_client_context, so both derived copies are rebuilt.
refresh materialized view concurrently public.opportunity_dept_mv;
refresh materialized view concurrently public.escalation_dept_mv;
