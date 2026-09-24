-- project_type was blank on ALL 951 deals, so nothing could be filtered, grouped or billed
-- by it — and the ad-hoc rule added in 064 had nothing to read.
--
-- It is blank because the Quotes tab has no such column: only the confirm dialog ever sets
-- it, and that started this month. But the answer is mostly already in the data, because
-- most of these deals have BOOKED and the revenue sheet records what kind of work it was.
-- So this fills it from evidence, strongest first, and logs which evidence was used against
-- each deal so a wrong one can be traced rather than argued about:
--
--   1. sheet line, by quote  — the booked line for this exact quote says what it was   230
--   2. sheet line, by value  — same client, same amount to the dollar                  185
--   3. what it is called     — 'retainer', 'maintenance', 'additional pages'…           59
--   4. the client's own norm — only where 90%+ of their revenue is one kind of work     68
--
-- THE FOURTH RULE WAS MEASURED, NOT ASSUMED. Run against the 1,663 booked lines it would
-- have been guessing about, a 70% bar gets the answer right 74.3% of the time — one in
-- four wrong, which in a report is worse than a blank. 80% gives 86.0%, 90% gives 92.9%,
-- 95% gives 96.8%. 90% is where it stops being a guess, and the 138 deals filled at the
-- first attempt's looser bar were set back to blank using the log each fill had written.
--
-- NOTHING ELSE IS GUESSED. 409 deals are still blank, 307 of them still open, and they
-- stay blank: an invented project type is worse than an empty one, because empty is
-- visibly waiting for somebody and wrong is a number in a report. The function only ever
-- fills blanks, so it is safe to re-run and never overwrites a value set by hand.

create or replace function public.infer_project_types()
returns table (source text, filled integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with blank as (
    select * from public.opportunities where coalesce(btrim(project_type),'') = ''
  ),
  by_quote as (
    select b.id, max(btrim(l.engagement_model)) as model
    from blank b
    join public.web_project_ledger l
      on coalesce(nullif(btrim(b.quote_id),''), nullif(btrim(b.quote_key),'')) = nullif(btrim(l.quote_id),'')
    where coalesce(btrim(l.engagement_model),'') <> ''
    group by 1
    having count(distinct btrim(l.engagement_model)) = 1   -- one answer, or it is not evidence
  ),
  by_value as (
    select b.id, max(btrim(l.engagement_model)) as model
    from blank b
    join public.web_project_ledger l
      on lower(regexp_replace(coalesce(b.company_name,''),'[^a-zA-Z0-9]','','g'))
       = lower(regexp_replace(coalesce(l.company_name,''),'[^a-zA-Z0-9]','','g'))
     and coalesce(b.est_value,0) > 0
     and abs(coalesce(b.est_value,0) - coalesce(l.amount_usd,0)) < 1
    where coalesce(btrim(l.engagement_model),'') <> ''
    group by 1
    having count(distinct btrim(l.engagement_model)) = 1
  ),
  by_text as (
    select id, case
      when txt ~* 'retainer|dedicated resource|monthly hours|full[- ]time'      then 'Dedicated'
      when txt ~* 'maintenance|maintanance|support pack|\mamc\M'                then 'Maintanance'
      when txt ~* 'additional page|extra page'                                  then 'Additional Pages'
      when txt ~* 'change request'                                              then 'Change Request'
      when txt ~* 'new (website|site|build|development)|revamp|redesign|migration' then 'New Development'
      end as model
    from (select id, coalesce(source_subject,'') || ' ' || coalesce(summary,'') as txt from blank) t
  ),
  client_models as (
    select lower(regexp_replace(coalesce(company_name,''),'[^a-zA-Z0-9]','','g')) as ck,
           btrim(engagement_model) as model, sum(amount_usd) as usd
    from public.web_project_ledger
    where coalesce(btrim(engagement_model),'') <> ''
    group by 1, 2
  ),
  client_top as (
    select distinct on (ck) ck, model, usd, sum(usd) over (partition by ck) as tot
    from client_models order by ck, usd desc
  ),
  by_client as (
    select b.id, t.model
    from blank b
    join client_top t on t.ck = lower(regexp_replace(coalesce(b.company_name,''),'[^a-zA-Z0-9]','','g'))
    where t.usd / nullif(t.tot, 0) >= 0.9     -- measured: 92.9% correct, against 74.3% at 0.7
  ),
  best as (
    select b.id,
           coalesce(q.model, v.model, x.model, c.model) as model,
           case when q.model is not null then 'sheet line, by quote'
                when v.model is not null then 'sheet line, by value'
                when x.model is not null then 'what it is called'
                when c.model is not null then 'the client''s own norm'
           end as src
    from blank b
    left join by_quote  q on q.id = b.id
    left join by_value  v on v.id = b.id
    left join by_text   x on x.id = b.id and x.model is not null
    left join by_client c on c.id = b.id
  ),
  applied as (
    update public.opportunities o
       set project_type = best.model
      from best
     where o.id = best.id
       and best.model is not null
       and coalesce(btrim(o.project_type),'') = ''
    returning o.id, best.model, best.src
  ),
  logged as (
    insert into public.opportunity_events (opportunity_id, event, actor, detail)
    select id, 'project_type_inferred', 'system',
           jsonb_build_object('project_type', model, 'evidence', src)
    from applied
    returning 1
  )
  select a.src, count(*)::integer from applied a group by 1 order by 2 desc;
end $$;

comment on function public.infer_project_types() is
  'Fills blank project_type from evidence — the booked line, the deal name, or the client''s own pattern at 90%+ — and logs which evidence was used. Only ever fills blanks.';

revoke execute on function public.infer_project_types() from public, anon;
grant  execute on function public.infer_project_types() to authenticated, service_role;

-- Which deals were filled in rather than stated, and on what evidence. A project type
-- that looks wrong can be traced to the reason it is there instead of being argued about.
-- A value later cleared or corrected by hand drops out: it is no longer evidence of
-- anything, and leaving it here would make a corrected deal look machine-set for good.
create or replace view public.web_project_type_evidence as
select * from (
  select distinct on (e.opportunity_id)
         e.opportunity_id            as id,
         o.company_name,
         o.source_subject,
         o.project_type              as project_type_now,
         e.detail->>'project_type'   as inferred,
         e.detail->>'evidence'       as evidence,
         e.at                        as inferred_at
  from public.opportunity_events e
  join public.opportunities o on o.id = e.opportunity_id
  where e.event = 'project_type_inferred'
  order by e.opportunity_id, e.at desc
) t
where coalesce(btrim(project_type_now),'') = btrim(inferred);

comment on view public.web_project_type_evidence is
  'Deals whose project type was filled in from evidence rather than stated, and which evidence was used.';

alter view public.web_project_type_evidence set (security_invoker = true);
grant select on public.web_project_type_evidence to anon, authenticated;

-- Run it once, here. Re-running is safe and fills whatever has become inferable since.
select * from public.infer_project_types();
