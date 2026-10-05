-- 129 — a removed line is gone from the quote views too
--
-- Removing a line on the Project sheet page records it in ledger_deletions, and the
-- ledger view hides it, so every revenue figure built on web_project_ledger — the
-- dashboard's segment table, Business Numbers, the KB report — stops counting it.
--
-- A dashboard line is also a won opportunity, and two views read the opportunities
-- table directly: web_dashboard_quotes (the Quotes tab the sheet-writer fills) and
-- web_business_quotes (quote counts by business). Those kept showing the removed line.
-- Both now skip an opportunity whose ledger key, 'opp:<id>', has a deletion.
--
-- ledger_deletions is read directly rather than through web_ledger_deletions_in_force:
-- the in-force view re-checks the whole ledger per row, and an opportunity's id never
-- drifts the way a sheet row number does, so the fingerprint guard is not needed here.
-- The browser-side readers (getOpportunities, getProjectSheet) apply the same rule from
-- the in-force view, which is the one the anon key can see.

create or replace view public.web_business_quotes as
 WITH w AS (
         SELECT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date AS this_start,
            CURRENT_DATE AS this_end,
            ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) - '1 mon'::interval))::date AS prev_start,
            (((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) - '1 mon'::interval) + ((CURRENT_DATE)::timestamp with time zone - date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))))::date AS prev_end
        ), client_dept AS (
         SELECT lower(btrim(web_sheet_rows.agency)) AS client_key,
            web_sheet_rows.service_dept,
            row_number() OVER (PARTITION BY (lower(btrim(web_sheet_rows.agency))) ORDER BY (sum(web_sheet_rows.usd_value)) DESC) AS rn
           FROM web_sheet_rows
          WHERE ((COALESCE(btrim(web_sheet_rows.agency), ''::text) <> ''::text) AND (COALESCE(btrim(web_sheet_rows.service_dept), ''::text) <> ''::text))
          GROUP BY (lower(btrim(web_sheet_rows.agency))), web_sheet_rows.service_dept
        ), geo_dept AS (
         SELECT t.geo,
            t.dept
           FROM ( VALUES ('US/CANADA'::text,'WEB-US'::text), ('US'::text,'WEB-US'::text), ('UK/EU'::text,'WEB-UK'::text), ('UK'::text,'WEB-UK'::text), ('AU/NZ'::text,'WEB-AU'::text), ('AU'::text,'WEB-AU'::text)) t(geo, dept)
        ), q AS (
         SELECT biz_bucket(quotes.service_dept) AS bucket,
            quotes.added_date AS on_date,
            quotes.usd_value,
            lower(COALESCE(quotes.status, ''::text)) AS status
           FROM quotes
        UNION ALL
         SELECT COALESCE(NULLIF(biz_bucket(o.service_dept), 'Other'::text), biz_bucket(cd.service_dept), g.dept, 'Other'::text) AS "coalesce",
            (COALESCE(o.source_date, o.confirmed_at))::date AS "coalesce",
            o.est_value,
            lower(COALESCE(o.status, ''::text)) AS lower
           FROM ((opportunities o
             LEFT JOIN client_dept cd ON (((cd.rn = 1) AND (cd.client_key = lower(btrim(o.company_name))))))
             LEFT JOIN geo_dept g ON ((g.geo = upper(btrim(COALESCE(o.geo, ''::text))))))
          WHERE (o.origin = ANY (ARRAY['pm'::text, 'email'::text]))
            AND NOT EXISTS (SELECT 1 FROM ledger_deletions dl WHERE dl.row_key = 'opp:' || o.id)
        ), buckets AS (
         SELECT unnest(ARRAY['LP/HUB'::text, 'WEB-AU'::text, 'WEB-UK'::text, 'WEB-US'::text, 'AI & Automation'::text, 'Other'::text]) AS bucket
        )
 SELECT b.bucket,
    count(q.*) FILTER (WHERE ((q.on_date >= w.this_start) AND (q.on_date <= w.this_end))) AS this_quotes,
    count(q.*) FILTER (WHERE ((q.on_date >= w.prev_start) AND (q.on_date <= w.prev_end))) AS prev_quotes,
    COALESCE(sum(q.usd_value) FILTER (WHERE ((q.on_date >= w.this_start) AND (q.on_date <= w.this_end))), (0)::numeric) AS this_quotes_usd,
    COALESCE(sum(q.usd_value) FILTER (WHERE ((q.on_date >= w.prev_start) AND (q.on_date <= w.prev_end))), (0)::numeric) AS prev_quotes_usd,
    count(q.*) FILTER (WHERE (q.status !~ 'confirm|won|lost|cancel|reject|drop'::text)) AS open_quotes,
    COALESCE(sum(q.usd_value) FILTER (WHERE (q.status !~ 'confirm|won|lost|cancel|reject|drop'::text)), (0)::numeric) AS open_quotes_usd
   FROM ((buckets b
     CROSS JOIN w)
     LEFT JOIN q ON ((q.bucket = b.bucket)))
  GROUP BY b.bucket;

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
    o.project_type,
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
   FROM ((opportunities o
     LEFT JOIN pm_directory d ON ((d.active AND directory_owner_match(o.pm_owner, d.email))))
     LEFT JOIN client_dept cd ON (((cd.rn = 1) AND (cd.client_key = lower(btrim(o.company_name))))))
  WHERE (o.origin = ANY (ARRAY['pm'::text, 'email'::text, 'recurring'::text]))
    AND NOT EXISTS (SELECT 1 FROM ledger_deletions dl WHERE dl.row_key = 'opp:' || o.id);
