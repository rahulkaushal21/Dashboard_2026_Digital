-- 131 — a scanned deal takes the client's usual project type
--
-- Rahul, 5 Oct 2026: "I still can see Project type column I blank, why?"
--
-- Because the email scan does not always say. 89 of the 156 dashboard rows in the Quotes
-- tab have no project_type: 83 of them open deals found in mail, where nothing in the
-- thread named a type and nobody has opened the deal to set one. The scan is right not
-- to guess — Project Type = New Development is the Q2C set, so a guessed type would move
-- a PM's quarterly score.
--
-- What CAN be filled without guessing: the client's usual type. web_sheet_client_defaults
-- holds, per client, the project type most of their project-sheet lines carry. 14 of the
-- 89 are clients with that history, and they take it here. The other 75 stay blank for
-- the PM to set; the dashboard's Needs-input list is where they surface.
--
-- Appended to the view from 129 (the deletion rule) — nothing else changes.

create or replace view public.web_dashboard_quotes as
 WITH client_dept AS (
         SELECT lower(btrim(web_sheet_rows.agency)) AS client_key,
            web_sheet_rows.service_dept,
            row_number() OVER (PARTITION BY (lower(btrim(web_sheet_rows.agency))) ORDER BY (sum(web_sheet_rows.usd_value)) DESC) AS rn
           FROM web_sheet_rows
          WHERE ((COALESCE(btrim(web_sheet_rows.agency), ''::text) <> ''::text) AND (COALESCE(btrim(web_sheet_rows.service_dept), ''::text) <> ''::text))
          GROUP BY (lower(btrim(web_sheet_rows.agency))), web_sheet_rows.service_dept
        )
 SELECT
        CASE
            WHEN (o.quote_id IS NOT NULL) THEN o.quote_id
            WHEN (o.quote_key ~* '^QUT'::text) THEN o.quote_key
            ELSE NULL::text
        END AS quote_id,
    (COALESCE(o.source_date, o.confirmed_at, o.first_date))::date AS added_date,
    COALESCE(NULLIF(btrim(o.service_dept), ''::text), d.team, cd.service_dept) AS service_dept,
    o.technology,
    o.source_subject AS subject_project,
    o.company_name AS agency,
    COALESCE(NULLIF(btrim(o.contact_email), ''::text), ( SELECT NULLIF(btrim(c.email), ''::text) AS "nullif"
           FROM clients c
          WHERE ((lower(btrim(c.company_name)) = lower(btrim(o.company_name))) AND (COALESCE(btrim(c.email), ''::text) <> ''::text))
         LIMIT 1), ( SELECT NULLIF(btrim(s.client_email), ''::text) AS "nullif"
           FROM email_signals s
          WHERE ((lower(btrim(s.company_name)) = lower(btrim(o.company_name))) AND (COALESCE(btrim(s.client_email), ''::text) <> ''::text))
          ORDER BY s.source_date DESC NULLS LAST
         LIMIT 1)) AS client_email,
    o.pm_owner AS pc_sme,
    COALESCE(NULLIF(btrim(o.project_type), ''::text), NULLIF(btrim(sd.project_type), ''::text)) AS project_type,
    COALESCE(o.currency, 'USD'::text) AS currency_type,
    COALESCE(o.local_value, o.est_value) AS estimated_cost,
    o.est_value AS usd_value,
    COALESCE(NULLIF(btrim(o.status), ''::text),
        CASE
            WHEN o.won THEN 'Confirmed'::text
            WHEN o.email_lost THEN 'Lost'::text
            WHEN o.unlikely THEN 'Unlikely'::text
            ELSE 'Open'::text
        END) AS status,
    o.gist AS notes,
    o.geo,
    o.business_type,
    o.sales_person,
        CASE
            WHEN (o.won AND (o.confirmed_at IS NOT NULL) AND (o.source_date IS NOT NULL)) THEN GREATEST(0, ((o.confirmed_at)::date - (o.source_date)::date))
            ELSE NULL::integer
        END AS confirmed_in_days
   FROM (((opportunities o
     LEFT JOIN pm_directory d ON ((d.active AND directory_owner_match(o.pm_owner, d.email))))
     LEFT JOIN client_dept cd ON (((cd.rn = 1) AND (cd.client_key = lower(btrim(o.company_name))))))
     LEFT JOIN web_sheet_client_defaults sd ON (sd.client_key = lower(regexp_replace(COALESCE(o.company_name, ''::text), '[^a-zA-Z0-9]'::text, ''::text, 'g'::text))))
  WHERE (o.origin = ANY (ARRAY['pm'::text, 'email'::text, 'recurring'::text]))
    AND NOT EXISTS (SELECT 1 FROM ledger_deletions dl WHERE dl.row_key = 'opp:' || o.id);
