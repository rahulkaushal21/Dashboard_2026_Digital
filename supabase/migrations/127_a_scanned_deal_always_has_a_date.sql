-- 127 — a scanned deal always has a date in the Quotes tab
--
-- Rahul, 4 Oct 2026: "the quote data which you moved from dashboard has few entries
-- without dates, i think that shouldnt be the case as each opportunity we scan from
-- email should have some date."
--
-- Right, and the dates existed all along — the view simply never looked at them.
-- web_dashboard_quotes is what sheet-writer appends to the Quotes tab for deals that
-- live only on the dashboard, and its Added Date read:
--
--     COALESCE(o.source_date, o.confirmed_at)::date AS added_date
--
-- source_date is the date of the mail the scan read; confirmed_at is the day a deal was
-- won. An OPEN email deal has neither when the scan did not record source_date — but it
-- does have first_date, which a trigger sets to the moment the row was created and which
-- is therefore never null on anything the scan made. 15 of the 151 dashboard rows printed
-- a blank Added Date, and 14 of them had a perfectly good first_date sitting unused.
--
-- first_date is appended LAST rather than slotted in after source_date on purpose. Put
-- earlier it would also change rows that currently print confirmed_at, rewriting dates
-- already in the spreadsheet. Appended, it can only fill a blank.

create or replace view public.web_dashboard_quotes as
 WITH client_dept AS (
         SELECT lower(btrim(web_sheet_rows.agency)) AS client_key,
            web_sheet_rows.service_dept,
            row_number() OVER (PARTITION BY (lower(btrim(web_sheet_rows.agency))) ORDER BY (sum(web_sheet_rows.usd_value)) DESC) AS rn
           FROM web_sheet_rows
          WHERE COALESCE(btrim(web_sheet_rows.agency), ''::text) <> ''::text AND COALESCE(btrim(web_sheet_rows.service_dept), ''::text) <> ''::text
          GROUP BY (lower(btrim(web_sheet_rows.agency))), web_sheet_rows.service_dept
        )
 SELECT
        CASE
            WHEN o.quote_id IS NOT NULL THEN o.quote_id
            WHEN o.quote_key ~* '^QUT'::text THEN o.quote_key
            ELSE NULL::text
        END AS quote_id,
    COALESCE(o.source_date, o.confirmed_at, o.first_date)::date AS added_date,
    COALESCE(NULLIF(btrim(o.service_dept), ''::text), d.team, cd.service_dept) AS service_dept,
    o.technology,
    o.source_subject AS subject_project,
    o.company_name AS agency,
    COALESCE(NULLIF(btrim(o.contact_email), ''::text), ( SELECT NULLIF(btrim(c.email), ''::text) AS "nullif"
           FROM clients c
          WHERE lower(btrim(c.company_name)) = lower(btrim(o.company_name)) AND COALESCE(btrim(c.email), ''::text) <> ''::text
         LIMIT 1), ( SELECT NULLIF(btrim(s.client_email), ''::text) AS "nullif"
           FROM email_signals s
          WHERE lower(btrim(s.company_name)) = lower(btrim(o.company_name)) AND COALESCE(btrim(s.client_email), ''::text) <> ''::text
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
            WHEN o.won AND o.confirmed_at IS NOT NULL AND o.source_date IS NOT NULL THEN GREATEST(0, o.confirmed_at::date - o.source_date::date)
            ELSE NULL::integer
        END AS confirmed_in_days
   FROM opportunities o
     LEFT JOIN pm_directory d ON d.active AND directory_owner_match(o.pm_owner, d.email)
     LEFT JOIN client_dept cd ON cd.rn = 1 AND cd.client_key = lower(btrim(o.company_name))
  WHERE o.origin = ANY (ARRAY['pm'::text, 'email'::text, 'recurring'::text]);

-- The fifteenth row had no date anywhere, and chasing it found a mis-linked thread.
--
-- Mo Diamonds was on the board twice, which is correct — two different deals — but the
-- thread id was on the wrong one. Opportunity 752 is a January 2026 "Hey - Modiamonds"
-- quote, $200, Lost; it carried thread 19fec76808439561, whose messages are all August
-- 2026 and about Shopify front-end development. That is opportunity 2945626, $2,500,
-- still open, which had no thread and no date at all.
--
-- thread_id carries a UNIQUE constraint, so this could not be a straight update: 752 has
-- to let go before 2945626 can take it. The date is the first message in the thread,
-- 10 Aug 2026 16:16 UTC, not a guess.
--
-- Worth knowing for the scan: a thread attached to the wrong deal is not cosmetic. The
-- critical-escalation trigger keys on thread_id, so a complaint on this conversation
-- would have been filed against a quote lost in January.
--   update public.opportunities set thread_id = null where id = 752;
--   update public.opportunities
--      set source_date = '2026-08-10 16:16:39+00', first_date = coalesce(first_date, '2026-08-10 16:16:39+00'),
--          thread_id = '19fec76808439561'
--    where id = 2945626;
