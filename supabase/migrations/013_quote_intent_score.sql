-- Buying-intent score for open opportunities.
--
-- Fitted on the 675 quotes that have actually been decided (Confirmed or
-- Cancelled), which convert at 72.7% overall. Three factors carry almost all of
-- the signal; each is an empirical rate from that history, not a guess:
--
--   1. RELATIONSHIP. A quote with a blank Agency converts at 13.5% — the single
--      strongest predictor in the data, and NOT a proxy for price: among small
--      quotes (<$2.5k) a named agency converts at 80.2% against 21.1% for a
--      blank one. Depth matters too, but not monotonically: first-time clients
--      54%, 2-20 quotes 82-86%, and 20+ quotes drops to 24.6% because that
--      bucket is resellers shopping us around (Telfer Digital: 24 quotes,
--      10 won, $102,773 quoted against $27,905 won).
--   2. PRICE BAND. Strictly monotonic: 91% under $250, 84%, 77%, 60%, 56%,
--      49%, and 6.7% at $10k+ (1 win in 15 — a thin base, treat as directional).
--   3. RECENCY. Half of confirmed quotes close in 2 days, 90% within 11.
--
-- On recency the source matters. The sheet's own "Confirmed in Days" column is
-- typed by the team and unverifiable, so it is deliberately NOT used here.
-- `added_date` is also sheet-entered: against the first email on the same
-- subject its median lag is 1 day, but the mean is 9.8 and the 90th percentile
-- 28 — 22% of rows are logged over a week late and 9% over a month late. A
-- late-logged quote therefore looks staler than it is. So recency prefers the
-- LAST EMAIL on the deal and only falls back to the sheet date, and
-- `intent_basis` records which was used so a score can always be audited.
-- Email covers a minority of open quotes (email_inbox holds ~10 rolling days
-- plus the backfill), which is exactly why the fallback exists.

-- Per-agency decided history, used for the relationship factor.
create or replace view quote_agency_history as
select lower(trim(agency)) as agency_key,
       count(*)                                                 as decided,
       count(*) filter (where lower(status) = 'confirmed')       as confirmed
from quotes
where lower(coalesce(status, '')) in ('confirmed', 'cancelled')
  and agency is not null and trim(agency) <> ''
group by 1;

-- Last inbound/outbound activity per normalised subject line. Stripping the
-- Re:/Fw: prefixes is what lets a sheet row find its own email thread, since
-- the Quotes tab copies the subject but rarely the exact prefix.
create or replace view email_subject_touch as
select lower(regexp_replace(subject, '^((re|fw|fwd)\s*:\s*)+', '', 'i')) as subj_key,
       max(msg_date)::date as last_touch
from email_inbox
where subject is not null and length(trim(subject)) > 12
group by 1;

create or replace view quote_intent as
with base as (
  select o.id, o.company_name, o.origin, o.est_value, o.status, o.won,
         o.source_subject, o.thread_id, o.quote_key,
         coalesce(o.first_date, o.source_date)::date as sheet_date,
         -- open = not decided either way
         (not o.won and lower(coalesce(o.status, '')) not in ('lost', 'won', 'cancelled')) as is_open
  from opportunities o
),
-- Recency, email first. An email-origin row knows its own thread; a sheet row
-- has to be matched on subject.
touched as (
  select b.*,
         coalesce(
           (select max(e.msg_date)::date from email_inbox e where e.thread_id = b.thread_id),
           (select t.last_touch from email_subject_touch t
             where t.subj_key = lower(regexp_replace(coalesce(b.source_subject, ''),
                                                     '^((re|fw|fwd)\s*:\s*)+', '', 'i'))
               and length(trim(coalesce(b.source_subject, ''))) > 12)
         ) as last_email
  from base b
),
factored as (
  select t.*,
         h.decided, h.confirmed,
         case when t.last_email is not null then 'email'
              when t.sheet_date is not null then 'sheet-date'
              else 'none' end as intent_basis,
         coalesce(t.last_email, t.sheet_date) as as_of,
         -- 1. relationship
         case
           when t.company_name is null or trim(t.company_name) = '' then 0.15
           when h.decided is null then 0.54                      -- never decided a quote with us
           when h.decided >= 20 then 0.35                        -- reseller pattern
           -- Laplace-smoothed toward the 72.7% base rate so a client with two
           -- wins is not scored as a certainty.
           else least(0.95, greatest(0.35, (h.confirmed + 4.0 * 0.727) / (h.decided + 4.0)))
         end as rel_f,
         -- 2. price band
         case
           when t.est_value is null or t.est_value = 0 then 0.60
           when t.est_value <   250 then 0.91
           when t.est_value <   500 then 0.84
           when t.est_value <  1000 then 0.77
           when t.est_value <  2500 then 0.60
           when t.est_value <  5000 then 0.56
           when t.est_value < 10000 then 0.49
           else 0.07
         end as band_f,
         -- 3. recency
         case
           when coalesce(t.last_email, t.sheet_date) is null then 0.50
           when current_date - coalesce(t.last_email, t.sheet_date) <=  4 then 1.00
           when current_date - coalesce(t.last_email, t.sheet_date) <= 11 then 0.85
           when current_date - coalesce(t.last_email, t.sheet_date) <= 25 then 0.55
           when current_date - coalesce(t.last_email, t.sheet_date) <= 60 then 0.25
           else 0.08
         end as rec_f
  from touched t
  left join quote_agency_history h on h.agency_key = lower(trim(t.company_name))
)
select id, company_name, est_value, status, is_open, intent_basis,
       case when as_of is null then null else current_date - as_of end as days_since_touch,
       decided as client_decided_quotes, confirmed as client_confirmed_quotes,
       round(rel_f::numeric, 3)  as relationship_factor,
       round(band_f::numeric, 3) as value_factor,
       round(rec_f::numeric, 3)  as recency_factor,
       -- Dividing by the base rate turns the product back into a probability
       -- rather than a product of three sub-1 numbers. Capped at 97: nothing
       -- here is certain until the sheet says Confirmed.
       case when not is_open then null
            else least(97, greatest(1, round(100 * rel_f * band_f * rec_f / 0.727)))
       end as intent_score,
       case when not is_open then null
            when least(97, round(100 * rel_f * band_f * rec_f / 0.727)) >= 80 then 'A'
            when least(97, round(100 * rel_f * band_f * rec_f / 0.727)) >= 60 then 'B'
            when least(97, round(100 * rel_f * band_f * rec_f / 0.727)) >= 35 then 'C'
            when least(97, round(100 * rel_f * band_f * rec_f / 0.727)) >= 15 then 'D'
            else 'E'
       end as intent_tier,
       -- Data-hygiene flags, worth surfacing on their own: a blank Agency costs
       -- ~59 points of win rate, and a quote past 60 days is beyond the 95th
       -- percentile close time (25 days) and needs a human decision.
       (est_value is not null and est_value > 0
         and (company_name is null or trim(company_name) = '')) as flag_no_agency,
       (is_open and as_of is not null and current_date - as_of > 60) as flag_stale
from factored;

comment on view quote_intent is
  'Buying-intent score per open opportunity, fitted on 675 decided quotes. '
  'Recency prefers last email over the sheet date because added_date is logged '
  'late on 22% of rows; intent_basis says which was used.';

-- What the app reads.
create or replace view web_quote_intent as
select id, intent_score, intent_tier, intent_basis, days_since_touch,
       relationship_factor, value_factor, recency_factor,
       client_decided_quotes, client_confirmed_quotes, flag_no_agency, flag_stale
from quote_intent
where is_open;

-- Only the app-facing view is exposed. `email_subject_touch` and `quote_intent`
-- stay internal: the first carries raw subject lines out of `email_inbox`, which
-- is service-role only (confidential client mail), and the second carries
-- company names and values. Postgres views run with the owner's privileges
-- (security_invoker is off by default), so web_quote_intent can still read
-- through them without granting the browser any access to either.
revoke all on quote_agency_history, email_subject_touch, quote_intent from anon, authenticated;
grant select on web_quote_intent to anon, authenticated;
