-- 133 — "What the client said" is praise, not news
--
-- Rahul, 6 Oct 2026, on Project Centre Ltd / "Marketing Team Structure": "this is not
-- feedback or testimonial." Right. It is an account note — Marston restructured, a new
-- contact wants an intro call — tagged Positive by the scan because the news is good.
--
-- web_real_feedback's email branch let any Positive signal through on two tests that do
-- not ask what KIND of signal it is:
--   • feedback_quality(summary) >= 5 — the summary was long and well-formed, and
--   • verified_by <> '' — which the refresh scan sets to 'refresh-scan' on its own rows,
--     so "verified" meant "written by the scan", not "a person read this".
--
-- Two changes. The signal's type has to be about the relationship or the work, not the
-- pipeline: Expansion, Deal, Pipeline, New business, upsell, opportunity, sales,
-- commercial, interest, referral, enquiry, quote, contract, scope are out. And only a
-- person's email address counts as verification. Checked against every Positive signal
-- on 6 Oct: 13 rows before, 11 after — the 11 are all praise (Cazenove+Loyd, Underdog,
-- Art One, Fluid Ideas, Colliers, Apple Print, Key Funding, TiE, Neon Dynamo, Clear
-- Mind), and the two that go are this one and a "contact departure + referral" note.
-- Sheet and manual branches unchanged.

create or replace view public.web_real_feedback as
 SELECT 'sheet'::text AS source,
    f.id,
    f.agency AS company_name,
    f.client_email,
    btrim(f.comments) AS quote,
    NULLIF(btrim(f.evidence), ''::text) AS evidence,
    f.project_names AS project,
    f.added_date AS at,
    f.feedback_type,
    f.pc_sme,
    f.geo,
    feedback_quality(f.comments) AS score
   FROM feedback f
  WHERE lower(COALESCE(f.nature, ''::text)) = 'positive'::text AND (feedback_quality(f.comments) >= 5 OR COALESCE(btrim(f.comments), ''::text) = ''::text AND btrim(COALESCE(f.evidence, ''::text)) ~* '^https?://'::text)
UNION ALL
 SELECT 'email'::text AS source,
    s.id,
    s.company_name,
    s.client_email,
    btrim(s.summary) AS quote,
    NULL::text AS evidence,
    s.source_subject AS project,
    s.source_date::date AS at,
    s.signal_type AS feedback_type,
    NULL::text AS pc_sme,
    NULL::text AS geo,
    GREATEST(feedback_quality(s.summary), praise_quality(s.client_quote)) AS score
   FROM email_signals s
  WHERE s.sentiment = 'Positive'::text
    AND s.signal_type !~* 'expansion|deal|pipeline|new business|upsell|opportunit|sales|commercial|interest|referral|enquiry|quote|contract|scope|account sync|progress'
    AND (feedback_quality(s.summary) >= 5 OR praise_quality(s.client_quote) >= 4 OR COALESCE(btrim(s.verified_by), ''::text) ~~ '%@%'::text)
UNION ALL
 SELECT 'manual'::text AS source,
    m.id,
    m.company_name,
    m.client_email,
    m.quote,
    NULL::text AS evidence,
    m.project,
    m.happened_on AS at,
    m.channel AS feedback_type,
    m.pm_owner AS pc_sme,
    NULL::text AS geo,
    NULL::integer AS score
   FROM manual_feedback m
  WHERE m.status = 'approved'::text;
