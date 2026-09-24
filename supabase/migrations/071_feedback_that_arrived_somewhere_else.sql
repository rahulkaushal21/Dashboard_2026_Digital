-- Feedback that arrived somewhere the system cannot see.
--
-- The board reads two places: the feedback tab and the email review. Praise on a Slack
-- message, in a call, or in a meeting reaches neither — so the warmest thing a client
-- said all quarter can be invisible, and the PM who heard it has nowhere to put it.
--
-- APPROVAL IS THE QUALITY BAR HERE. Everything else on this board is scored by
-- feedback_quality(), because nobody vouched for it — it was scraped. A manual entry is
-- different: a person typed it and a second person signed it off. Scoring it again would
-- be the machine overruling two humans who were actually there, and would quietly reject
-- real praise for not containing the right adjectives.
--
-- That is also why approval is not optional. Without it this is a box anyone can type a
-- testimonial into, and a board of testimonials nobody vouched for is worth nothing.
--
-- Verified end to end: a PM submits, it does NOT reach the board, a PM who is neither the
-- approver nor an admin is refused ("This one is for rahul.k@mavlers.com to approve."),
-- the submitter cannot wave through their own, the named approver approves, and it
-- appears as source 'manual' with no score.

create table if not exists public.feedback_approvers (
  dept_pattern text primary key,   -- matched case-insensitively against the service dept
  email        text not null,
  name         text not null,
  note         text
);

comment on table public.feedback_approvers is
  'Who signs off manually entered feedback, by service department. A table rather than a rule in code, so it changes without a deploy.';

insert into public.feedback_approvers (dept_pattern, email, name, note) values
  ('WEB-AU', 'rahul.k@mavlers.com', 'Rahul Kaushal', 'Web AU/UK/US'),
  ('WEB-UK', 'rahul.k@mavlers.com', 'Rahul Kaushal', 'Web AU/UK/US'),
  ('WEB-US', 'rahul.k@mavlers.com', 'Rahul Kaushal', 'Web AU/UK/US'),
  ('HUB',    'pratik@mavlers.com',  'Pratik',        'Hub'),
  ('LP',     'pratik@mavlers.com',  'Pratik',        'LP'),
  ('LP/HUB', 'pratik@mavlers.com',  'Pratik',        'LP and Hub together')
on conflict (dept_pattern) do update set email = excluded.email, name = excluded.name, note = excluded.note;

alter table public.feedback_approvers enable row level security;
grant select on public.feedback_approvers to anon, authenticated;
revoke insert, update, delete on public.feedback_approvers from anon, authenticated;

-- Who signs this one off. An unrecognised department has no approver rather than a
-- default one: sending it to the wrong person is worse than saying nobody is assigned.
create or replace function public.feedback_approver_for(p_dept text)
returns text language sql stable as $$
  select a.email from public.feedback_approvers a
   where upper(btrim(coalesce(p_dept,''))) = upper(a.dept_pattern)
   limit 1
$$;

create table if not exists public.manual_feedback (
  id            bigserial primary key,
  company_name  text not null,
  client_email  text,
  quote         text not null,
  channel       text not null default 'Slack',   -- Slack, Call, Meeting, WhatsApp, In person
  happened_on   date not null default current_date,
  service_dept  text,
  pm_owner      text,
  project       text,
  submitted_by  text not null,
  submitted_at  timestamptz not null default now(),
  status        text not null default 'pending', -- pending | approved | rejected
  decided_by    text,
  decided_at    timestamptz,
  decide_note   text
);

comment on table public.manual_feedback is
  'Client praise that arrived on Slack, a call or in person. Shows on the Delights board only once its department''s approver has signed it off.';

create index if not exists manual_feedback_status_idx on public.manual_feedback (status, submitted_at desc);

alter table public.manual_feedback enable row level security;
grant select on public.manual_feedback to anon, authenticated;
revoke insert, update, delete on public.manual_feedback from anon, authenticated;

create or replace function public.submit_manual_feedback(
  p_company text, p_quote text, p_channel text default 'Slack',
  p_happened_on date default null, p_client_email text default null,
  p_service_dept text default null, p_pm_owner text default null, p_project text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_actor text := public.jwt_email(); v_id bigint;
begin
  if v_actor is null then raise exception 'Sign in to add feedback.' using errcode = '42501'; end if;
  if coalesce(btrim(p_company),'') = '' then raise exception 'Which client is this from?' using errcode = '22023'; end if;
  -- Not a length rule for its own sake: an approver cannot judge "client was happy", and
  -- neither can anyone reading it in six months.
  if length(btrim(coalesce(p_quote,''))) < 20 then
    raise exception 'Write down what they actually said — a few words is not feedback.' using errcode = '22023';
  end if;

  insert into public.manual_feedback
    (company_name, client_email, quote, channel, happened_on, service_dept, pm_owner, project, submitted_by)
  values (btrim(p_company), nullif(btrim(coalesce(p_client_email,'')),''), btrim(p_quote),
          coalesce(nullif(btrim(coalesce(p_channel,'')),''), 'Slack'),
          coalesce(p_happened_on, current_date),
          nullif(btrim(coalesce(p_service_dept,'')),''), nullif(btrim(coalesce(p_pm_owner,'')),''),
          nullif(btrim(coalesce(p_project,'')),''), v_actor)
  returning id into v_id;
  return v_id;
end $$;

-- Approve or reject. The department's approver, or an admin. NOT the person who submitted
-- it, unless they are one of those anyway — a testimonial you vouch for yourself is the
-- thing this is here to prevent.
create or replace function public.decide_manual_feedback(p_id bigint, p_approve boolean, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_actor    text := public.jwt_email();
  v_row      public.manual_feedback;
  v_approver text;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.manual_feedback where id = p_id;
  if not found then raise exception 'No such feedback (#%).', p_id using errcode = 'P0002'; end if;

  v_approver := public.feedback_approver_for(v_row.service_dept);
  if not (public.is_dashboard_admin() or (v_approver is not null and v_actor = v_approver)) then
    raise exception 'This one is for % to approve.', coalesce(v_approver, 'an admin') using errcode = '42501';
  end if;
  if v_actor = v_row.submitted_by and not public.is_dashboard_admin() then
    raise exception 'Somebody else has to sign off feedback you entered.' using errcode = '42501';
  end if;

  update public.manual_feedback
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_actor, decided_at = now(),
         decide_note = nullif(btrim(coalesce(p_note,'')),'')
   where id = p_id;
  return true;
end $$;

revoke execute on function public.submit_manual_feedback(text, text, text, date, text, text, text, text) from public, anon;
grant  execute on function public.submit_manual_feedback(text, text, text, date, text, text, text, text) to authenticated;
revoke execute on function public.decide_manual_feedback(bigint, boolean, text) from public, anon;
grant  execute on function public.decide_manual_feedback(bigint, boolean, text) to authenticated;

-- Approved manual feedback joins the board as a third source, UNSCORED on purpose.
create or replace view public.web_real_feedback as
select 'sheet'::text                    as source,
       f.id,
       f.agency                         as company_name,
       f.client_email,
       btrim(f.comments)                as quote,
       nullif(btrim(f.evidence),'')     as evidence,
       f.project_names                  as project,
       (f.added_date)::date             as at,
       f.feedback_type,
       f.pc_sme,
       f.geo,
       public.feedback_quality(f.comments) as score
from public.feedback f
where lower(coalesce(f.nature,'')) = 'positive'
  and (
    public.feedback_quality(f.comments) >= 5
    or (coalesce(btrim(f.comments),'') = '' and btrim(coalesce(f.evidence,'')) ~* '^https?://')
  )
union all
select 'email', s.id, s.company_name, s.client_email, btrim(s.summary), null,
       s.source_subject, (s.source_date)::date, s.signal_type, null, null,
       public.feedback_quality(s.summary)
from public.email_signals s
where s.sentiment = 'Positive' and public.feedback_quality(s.summary) >= 5
union all
select 'manual', m.id, m.company_name, m.client_email, m.quote, null,
       m.project, m.happened_on,
       m.channel,          -- "Slack", "Call", "Meeting" — where it was actually said
       m.pm_owner, null,
       null                -- unscored on purpose: a person approved it
from public.manual_feedback m
where m.status = 'approved';

comment on view public.web_real_feedback is
  'Client feedback that is actually feedback: scraped text scored at 5+ by feedback_quality(), a review screenshot standing in for words, or a manual entry a second person signed off.';

alter view public.web_real_feedback set (security_invoker = true);
grant select on public.web_real_feedback to anon, authenticated;
