-- Refit after the signal correction, plus: a decision made on the dashboard is final.
--
-- REFIT. The old sig_f rates (money .963 / approve .959 / access .925 / kickoff
-- .895 / none .711) were fitted on the contaminated signal, so they described a
-- population that included our own quoted words. Refitted on the 527 quotes decided
-- since 1 Apr 2026, base rate 88.43%:
--
--   no thread   342 quotes  89.18%  -> 0.892
--   money        16 quotes  93.75%  -> 0.938   THIN BASE, directional only
--   approve      63 quotes  95.24%  -> 0.952   the only solidly-fitted lift
--   access       12 quotes  91.67%  -> 0.917   THIN BASE
--   kickoff       2 quotes 100.00%  -> 0.884   NOT FITTABLE: held at the base rate
--                                              so it claims no lift in either
--                                              direction. Do not read 100% as real.
--   none         92 quotes  79.35%  -> 0.794   the real discriminator
--
-- The discriminating signal is the ABSENCE of commitment language: a thread we can
-- read where nobody committed converts 79%, against 95% where they did.
-- Normalisation means recomputed on the same population: rel .8597, band .8891,
-- sig .8840.
--
-- DASHBOARD IS FINAL. email_won / email_lost are a person's explicit call, held
-- outside status/won because the sheet sync rewrites those every 30 minutes.
-- is_open ignored them, so a deal confirmed here -- ZULU 8's MySQL 8.0 upgrade,
-- $415, confirmed 5 Aug on the Director's "Approved, please proceed" -- still
-- counted as open pipeline, still scored, and still wore the committed tick. A
-- confirmed quote must stop being served back as outstanding work. `unlikely` is
-- deliberately NOT terminal: it is a caution, not a decision.
--
-- flag_committed_in_email now requires sig_approve alone. Money talk was dropped
-- from it: "invoice" appears in plenty of threads that are not a commitment.
create or replace view quote_intent as
with base as (
  select o.id, o.company_name, o.origin, o.est_value, o.status, o.won, o.source_subject, o.thread_id,
    coalesce(o.first_date, o.source_date)::date as sheet_date,
    not o.won
      and (lower(coalesce(o.status,'')) <> all (array['lost','won','cancelled']))
      and not coalesce(o.email_won, false)
      and not coalesce(o.email_lost, false) as is_open,
    lower(regexp_replace(coalesce(o.source_subject,''), '^((re|fw|fwd)\s*:\s*)+', '', 'i')) as subj_key
  from opportunities o
), touched as (
  select b.*, coalesce(tt.last_touch, st.last_touch) as last_email,
    g.sig_approve, g.sig_money, g.sig_access, g.sig_kickoff,
    g.subj_key is not null as has_thread
  from base b
    left join email_thread_touch tt on tt.thread_id = b.thread_id
    left join email_subject_touch st on st.subj_key = b.subj_key and length(trim(coalesce(b.source_subject,''))) > 12
    left join email_thread_signals g on g.subj_key = b.subj_key and length(trim(coalesce(b.source_subject,''))) > 12
), factored as (
  select t.*, h.decided, h.confirmed,
    case when t.last_email is not null then 'email'
         when t.sheet_date is not null then 'sheet-date' else 'none' end as intent_basis,
    coalesce(t.last_email, t.sheet_date) as as_of,
    case when t.company_name is null or trim(t.company_name) = '' then 0.750
         when h.decided is null then 0.765
         when h.decided >= 20 then 0.420
         else least(0.97, greatest(0.42, (h.confirmed::numeric + 4.0 * 0.8843) / (h.decided::numeric + 4.0))) end as rel_f,
    case when t.est_value is null or t.est_value = 0 then 0.890
         when t.est_value < 250 then 0.965 when t.est_value < 500 then 0.938
         when t.est_value < 1000 then 0.918 when t.est_value < 2500 then 0.815
         when t.est_value < 5000 then 0.791 when t.est_value < 10000 then 0.667
         else 0.250 end as band_f,
    case when not t.has_thread then 0.892
         when t.sig_money then 0.938
         when t.sig_approve then 0.952
         when t.sig_access then 0.917
         when t.sig_kickoff then 0.884
         else 0.794 end as sig_f,
    case when coalesce(t.last_email, t.sheet_date) is null then 0.50
         when (current_date - coalesce(t.last_email, t.sheet_date)) <= 11 then 1.00
         when (current_date - coalesce(t.last_email, t.sheet_date)) <= 25 then 0.80
         when (current_date - coalesce(t.last_email, t.sheet_date)) <= 60 then 0.45
         else 0.12 end as rec_f
  from touched t
    left join quote_agency_history h on h.agency_key = lower(trim(t.company_name))
), scored as (
  select f.*, least(0.97, greatest(0.01,
    0.8843 * (f.rel_f / 0.8597) * (f.band_f / 0.8891) * (f.sig_f / 0.8840) * f.rec_f)) as p
  from factored f
)
select id, company_name, est_value, status, is_open, intent_basis,
  case when as_of is null then null::integer else current_date - as_of end as days_since_touch,
  decided as client_decided_quotes, confirmed as client_confirmed_quotes,
  round(rel_f, 3) as relationship_factor, round(band_f, 3) as value_factor,
  round(sig_f, 3) as signal_factor, round(rec_f, 3) as recency_factor,
  case when sig_money then 'invoice/payment discussed'
       when sig_approve then 'client said approved / proceed'
       when sig_access then 'access or credentials shared'
       when sig_kickoff then 'kickoff doc or assets returned'
       when has_thread then 'no commitment signal in the thread'
       else null::text end as signal_label,
  case when not is_open then null::numeric else round(100::numeric * p) end as intent_score,
  case when not is_open then null::text
       when p >= 0.80 then 'A' when p >= 0.60 then 'B'
       when p >= 0.35 then 'C' when p >= 0.15 then 'D' else 'E' end as intent_tier,
  est_value is not null and est_value > 0 and (company_name is null or trim(company_name) = '') as flag_no_agency,
  is_open and as_of is not null and (current_date - as_of) > 60 as flag_stale,
  is_open and coalesce(sig_approve, false) as flag_committed_in_email
from scored;

create or replace view web_quote_intent as
select id, intent_score, intent_tier, intent_basis, days_since_touch,
       relationship_factor, value_factor, signal_factor, recency_factor, signal_label,
       client_decided_quotes, client_confirmed_quotes,
       flag_no_agency, flag_stale, flag_committed_in_email
from quote_intent;

revoke all on quote_intent from anon, authenticated;
revoke all on web_quote_intent from anon, authenticated;
grant select on web_quote_intent to anon, authenticated;
