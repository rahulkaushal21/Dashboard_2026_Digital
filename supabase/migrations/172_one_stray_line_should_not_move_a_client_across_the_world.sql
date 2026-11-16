-- web_clients.geo took the region of the client's MOST RECENT booking row.
--
-- Underdog Digital, raised by Rahul on 16 Nov 2026: "underdog is US". It is. Five
-- quotes say US/Canada and three of its four revenue lines say US/Canada — $9,050 of
-- it. The fourth, $530 booked in Sep 2026, is typed AU/NZ, and because it is the most
-- recent line it was the whole client's region: the Delights page and the Clients page
-- both filed a US client under AU/NZ, and anyone filtering AU/NZ saw a client that has
-- never been there.
--
-- "Latest row wins" only makes sense if a client can move region, which they do not,
-- while a mistyped cell is routine. The region is now where the client's MONEY is:
-- the geo holding the largest share of their booking value, ties broken by the most
-- recent month. 'Others' is sorted last so a real region always beats the junk bucket
-- even when 'Others' holds more — accessiBe, WEBITEERS and The Trade Desk keep their
-- named region under this rule, which a pure value sort would have taken off them.
--
-- Ten clients change, every one of them onto the region holding most of their revenue:
--   Kerry Inc. UK/EU→US/Canada ($18,495)   Inbox Army US/Canada→UK/EU ($13,216)
--   Underdog Digital AU/NZ→US/Canada       Vested AU/NZ→US/Canada
--   Kristens Kick Ass Ice Cream UK/EU→US   wearequantum UK/EU→AU/NZ
--   Kenect US/Canada→UK/EU                 gooddigital US/Canada→AU/NZ
--   ensembletechnology US/Canada→AU/NZ     SequriX US/Canada→UK/EU
--
-- The $530 AU/NZ line is still wrong in the revenue sheet and still counts as AU/NZ
-- revenue on every page that reads web_revenue directly — this fixes who the CLIENT
-- is, not that one line. The line itself has to be corrected in the sheet, or the
-- hourly sync will simply write it back.
--
-- geo_pick is a CTE joined once, not a scalar subquery per row: a function or
-- correlated lookup inside this view goes quadratic and has silently blanked a page
-- here before.

create or replace view public.web_clients as
 WITH cl AS (
         SELECT lower(TRIM(BOTH FROM clients.company_name)) AS k,
            max(clients.sentiment) AS sentiment,
            max(clients.rag_status) AS rag_status,
            max(clients.client_status) AS client_status,
            max(clients.client_type) AS client_type,
            max(clients.journey) AS journey,
            max(clients.action_steps) AS action_steps,
            max(clients.email) AS email
           FROM clients
          GROUP BY (lower(TRIM(BOTH FROM clients.company_name)))
        ), geo_pick AS (
         SELECT DISTINCT ON (t.company_name) t.company_name,
            t.geo
           FROM ( SELECT web_revenue.company_name,
                    web_revenue.geo,
                    sum(web_revenue.booking_amount) AS amt,
                    max(web_revenue.booking_month) AS last_m
                   FROM web_revenue
                  WHERE COALESCE(web_revenue.geo, ''::text) <> ''::text
                  GROUP BY web_revenue.company_name, web_revenue.geo) t
          ORDER BY t.company_name, (t.geo = 'Others'::text), t.amt DESC NULLS LAST, t.last_m DESC
        )
 SELECT wr.company_name,
    cl.client_type,
    ci.industry,
    gp.geo,
    (array_agg(wr.sme ORDER BY wr.booking_month DESC) FILTER (WHERE COALESCE(wr.sme, ''::text) <> ''::text))[1] AS pc_sme,
    (array_agg(wr.sales_person ORDER BY wr.booking_month DESC) FILTER (WHERE COALESCE(wr.sales_person, ''::text) <> ''::text))[1] AS sales_person,
    round(sum(wr.booking_amount), 2) AS ltv_usd,
    cl.sentiment,
    COALESCE(NULLIF(cl.rag_status, ''::text), 'Green'::text) AS rag_status,
    COALESCE(NULLIF(cl.client_status, ''::text), 'active'::text) AS client_status,
    COALESCE((array_agg(wr.contact_email ORDER BY wr.booking_month DESC) FILTER (WHERE COALESCE(wr.contact_email, ''::text) <> ''::text))[1], cl.email) AS email,
    cl.journey,
    cl.action_steps,
    max(wr.booking_month) AS last_booking_month,
    ci.website,
    COALESCE(ci.ai_focus, false) AS ai_focus,
    NULL::text AS industry_note
   FROM web_revenue wr
     LEFT JOIN client_industry ci ON lower(TRIM(BOTH FROM ci.company_name)) = lower(TRIM(BOTH FROM wr.company_name))
     LEFT JOIN cl ON cl.k = lower(TRIM(BOTH FROM wr.company_name))
     LEFT JOIN geo_pick gp ON gp.company_name = wr.company_name
  GROUP BY wr.company_name, ci.industry, ci.website, ci.ai_focus, cl.client_type, cl.sentiment, cl.rag_status, cl.client_status, cl.journey, cl.action_steps, cl.email, gp.geo;
