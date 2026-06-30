# Claude routine — every 2 hours (cloud)

Create at claude.ai/code/routines, pointed at this repo. Runs on Anthropic's
cloud (laptop can be off). Min interval 1h, so use 2h.

## Environment
- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY        (routine env only)
- Network access: ON
- Connectors: Google Sheets/Drive (read the Business Sheet privately — NO
  publishing), Gmail (the stringent scan).

## 0. Read runtime config first
Call getConfig() (from writers.mjs). Use config.business_sheet_url as the sheet
to read in step A, and config.scan_gmail_address only as a label/notice — the central inbox (web@uplers.com)
receives most mail via FORWARDING, so `to:`/`deliveredto:` filters miss it. The
Gmail connector is already authorized as that account, so scan the inbox directly:
`in:inbox newer_than:1d`. (If you later need to scope to a specific alias, add a
`to:`/`deliveredto:` clause then.)

High-precision shortcut: structured system mails from notifications@uplers.com are
the most reliable opportunity source. An RFQ notification ("… has generated a RFQ")
carries Client Name, Client Email, Geo, Engagement Model, Service, and Budget as
labelled fields — parse these directly into `opportunities`. Invoice-generated
notifications already correspond to sheet bookings, so do NOT also write them as
quote_conversions (avoids double-counting won deals). These are edited by the admin in
the Settings panel, so never hardcode the sheet or inbox here.

## A. Business Sheet -> Supabase  (deterministic, via the Sheets connector)
Read ONLY these tabs. Map each row, set src_row_hash = hash(identifying fields),
call the writer.
- "Booking Data_Master" -> writeBookings    : company_name, booking_month,
   booking_amount, engagement_model, service_name, geo, sme, sales_person, invoice_number
- "Quotes"              -> writeQuotes       : quote_id, added_date, agency, client_email,
   estimated_cost, usd_value, status, business_type, geo, sales_person, confirmed_in_days,
   technology, notes          (this is quotes SHARED — the pipeline, not the outcome)
- "Web Sqls"            -> writeSqlLeads      : month, year, venture, lead_date, email_address,
   industry, persona, company_name, prospect_region, assigned_to, query_about, esp
Ignore every other tab (Web/Hub/LP, Invoice Match, Feedback, Escalation,
Chase, Dashboards, Pivot, Claude Cache) — they are out of scope or stale.

## B. Email scan -> Supabase  (STRINGENT — precision over recall)
The sheet is NOT current on these, so they come from the central inbox. Read
threads newer than the last run. Be conservative: only write a row when the
evidence is explicit. Always capture thread_id (dedup), source_sender,
source_date, and a short `evidence` quote of the exact line that justifies the
classification. When unsure, DO NOT write a row.

- Opportunities -> writeOpportunities : a NEW RFQ/business enquiry not already in
  the Quotes tab. Record company_name, new vs repeat, rfq + status, geo,
  sales_person, subject, sender, date, summary.
- Quote conversion -> writeQuoteConversions : ONLY when a quote is explicitly
  confirmed won or lost (e.g. "we're going ahead", PO attached, or a clear
  decline). Record outcome (won|lost), lost_reason if stated, amount, decided_at,
  evidence, company_name, and quote_ref (match to Quotes.quote_id only if certain,
  else null). Do not infer won/lost from silence.
- Feedback -> writeFeedback : ONLY an explicit client statement of satisfaction
  or dissatisfaction. Record nature (Positive|Negative|Neutral), agency/company,
  geo, client_email, project_names, comments, evidence. Set feedback_type='Email'
  and DO NOT set src_row_hash (leave null) — that keeps these rows safe from the
  sheet-sync replace, which only deletes rows where src_row_hash is not null.
  Dedup on thread_id. Ignore internal chatter.
  High-precision shortcut: the standardized log mails
  "Well done team! We have received a positive feedback from - <Client> - Ref: MEM…"
  (from *.uplers.in senders) are canonical POSITIVE feedback — map agency=<Client>,
  nature=Positive, evidence="Ref: MEM…", comments=the appreciation summary.
  Note: subjects like "<Client> - Client Feedback - Major Impact" are NEGATIVE
  experience situations — route those to writeEscalations, NOT as positive feedback.
- Escalations -> writeEscalations : ONLY a real client escalation (not a routine
  question or internal note). Record company_name, geo, situation_type
  (Functional|Technical), escalation_type, business_impact (Low|Medium|High),
  email_subject, evidence. Flag any company with >3 in a quarter for the alert.

## C. Finally
Call rebuildClients() to refresh the derived clients table (LTV from bookings,
industry from SQLs, latest sentiment from feedback).
