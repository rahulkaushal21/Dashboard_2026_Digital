# Claude routine — every 4 hours (LOCAL Claude schedule)

Runs from a local Claude session (durable cron, `13 */4 * * *`). It MUST be
local, not cloud: the scan needs the Gmail + Google Sheets connectors, which the
headless cloud routines don't have. Consequence: it only fires while a Claude
session is running and the Mac is awake — overnight/off periods are skipped, but
the dynamic scan window (step B) catches up the backlog on the next run, so no
mail is lost, only delayed.

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

## B. Email scan -> Supabase  (HIGH VOLUME — scan everything, write precisely)
The central inbox receives ~100 emails/hour (~400–500 per 4h window; a cold
start after an overnight gap can be more). Two rules that matter at this volume:

DYNAMIC WINDOW (no gaps): call getLastScan() (from writers.mjs). Compute
`h = ceil(hoursSince(lastScan)) + 1`, capped at 48; if lastScan is null use 6.
Search `in:inbox newer_than:{h}h`. This scans exactly what arrived since the last
successful run plus a 1h overlap — so a slept laptop just means a bigger next
window, never lost mail.

PAGINATE FULLY: do NOT stop at the first page of search_threads. Loop with the
page cursor until results are exhausted — expect hundreds of threads. Triage
cheaply first (subject + sender + snippet); only open/read the body of threads
that look client-facing or match the shortcuts below. Dedup on thread_id means
re-seeing an overlapped thread is harmless.

Be conservative on what you WRITE: only write a row when the evidence is
explicit. Always capture thread_id (dedup), source_sender, source_date, and a
short `evidence` quote of the exact line that justifies the classification. When
unsure whether something is feedback/escalation/conversion, DO NOT write it —
but DO still record a sentiment signal (see Sentiment below) if the client tone
is clear.

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
- Sentiment -> writeEmailSignals : for EVERY client-facing thread with a clear
  tone (broader than explicit feedback — appreciation, frustration, urgency,
  churn risk, upsell interest all count). This is the "scan all emails for
  sentiment" pass, so recall matters here: one signal per client thread. Record
  company_name, client_email, signal_type (e.g. praise|complaint|risk|request|
  neutral), sentiment (Positive|Negative|Neutral), summary (one line),
  source_subject, source_sender, source_date, thread_id. Skip pure internal/
  automated mail (no external client on the thread). Dedup on thread_id.

## C. Finally
1. Call rebuildClients() to refresh the derived clients table (LTV from bookings,
   industry from SQLs, latest sentiment from feedback).
2. Call markScan(msg, totalRowsWritten) with a one-line summary
   (e.g. `window=6h · threads=412 · opps=3 feedback=2 signals=57`). This advances
   the high-water mark so the next run's window starts here — ALWAYS call it,
   even on a 0-row run, or the window will keep growing.
