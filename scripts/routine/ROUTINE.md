# Claude routine — every 30 minutes (LOCAL Claude schedule)

Runs from a local Claude session (session cron, `7,37 * * * *` — every 30 min at
:07/:37). It MUST be local, not cloud: the scan needs the Gmail + Google Sheets
connectors, which the headless cloud routines don't have. Consequence: it only
fires while a Claude session is running and the Mac is awake — overnight/off
periods are skipped, but the dynamic scan window (step B) catches up the backlog
on the next run, so no mail is lost, only delayed.

MODE: continuous account sense-check. At this 30-min cadence the per-run volume is
small (tens of threads, mostly automated), so the goal is THOROUGH not fast: cheap
triage is used ONLY to discard machine noise; EVERY thread with a real external
human (a client, prospect, or partner) is OPENED and deep-read in full — not judged
from its snippet. The point is to never miss an opportunity, feedback, or
escalation, and to keep a live read on how each account is moving.

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

IMPORTANT — system mails are NOT opportunities. Auto-generated pipeline mail from
notifications@uplers.com (e.g. "… has generated a RFQ", "Quote ( QUT… ) Request")
and invoice-app alerts are created AFTER the client's real email enquiry and are
already represented in the sheet's Quotes tab. Do NOT write them into
`opportunities` (that double-counts). Opportunities come from only two sources:
(1) a genuine client EMAIL enquiry, and (2) the SHEET Quotes tab (step A). Invoice
notifications also must not become quote_conversions (they correspond to sheet
bookings). The sheet and inbox are set by the admin in Settings — never hardcode them.

## 0b. Connector failure -> leave a VISIBLE heartbeat (don't fail silently)
If the Gmail connector returns a re-authorization / expired-token error (or a hard,
unrecoverable connector failure) so the email scan CANNOT run, do NOT just stop:
call `markScanFailed('Gmail auth expired — reconnect the Gmail connector')` (from
writers.mjs) and end the run. This writes an `ok:false` heartbeat, which:
- does NOT advance the high-water mark (getLastScan only reads ok:true), so the next
  successful run still catches up the whole backlog — no mail lost; and
- flips the dashboard's "Opportunities scan" light RED with a reconnect prompt, so a
  silent auth lapse becomes visible instead of the scan quietly doing nothing.
NEVER call markScan (the success heartbeat) on a failed run — that would advance the
window past mail you never scanned. Use markScanFailed for failure, markScan for success.

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

DYNAMIC WINDOW (no gaps, recall is the priority): call getLastScan() (from
writers.mjs). Compute `h = max(1, ceil(hoursSince(lastScan)))`, capped at 48;
if lastScan is null use 6. Search `in:inbox newer_than:{h}h`. NOTE: Gmail's
`newer_than` unit `m` means MONTHS, not minutes — never use it; the smallest safe
unit is `h` (hours), so the floor is 1h. At the 30-min cadence the gap is ~0.5h so
h=1 → a 1h window (~2× overlap, which dedup makes harmless); a slept laptop just
means a bigger next window (up to the 48h cap), never lost mail.

PAGINATE FULLY: do NOT stop at the first page of search_threads. Loop with the
page cursor until results are exhausted. Triage cheaply ONLY to discard pure
machine noise — newsletters, promos, calendar invites/accepts, OOO auto-replies,
monitoring/deploy/error alerts (Kinsta, Wordfence, Render…), HR/billing/system
mail, notifications@uplers.com RFQ/invoice mails, and Google Drive/Docs share
notices. For EVERYTHING ELSE — any thread with a genuine external human
(client / prospect / partner domain) — OPEN and deep-read the full thread body,
even if the last message looks routine. Do not classify a real client thread from
its snippet. Dedup on thread_id means re-seeing an overlapped thread is harmless;
on a re-seen thread, only look for NEW messages since its stored source_date.

Be conservative on what you WRITE: only write a row when the evidence is
explicit. Always capture thread_id (dedup), source_sender, source_date, and a
short `evidence` quote of the exact line that justifies the classification. When
unsure whether something is feedback/escalation/conversion, DO NOT write it —
but DO still record a sentiment signal (see Sentiment below) if the client tone
is clear.

- Opportunities -> writeOpportunities : a NEW business enquiry that arrives as a
  GENUINE client email (the client, or a Mavlers person forwarding/relaying the
  client's request). Record company_name, new vs repeat, rfq + status, geo,
  sales_person, subject, sender, date, summary. NEVER create an opportunity from a
  system-generated mail (notifications@uplers.com "… has generated a RFQ" /
  "Quote ( QUT… ) Request", invoice-app alerts) — those are downstream of the real
  client email and are already covered by the sheet Quotes tab. Skip them here.
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
- Escalations -> writeEscalations : run an ESCALATION KEYWORD SWEEP over EVERY
  thread (subject + snippet, and the body if a keyword hits) — not just the ones
  you deep-read for opportunities. Trigger words/phrases (case-insensitive):
  "major issue", "major impact", "critical", "urgent" (in a negative context),
  "escalate"/"escalation", "disappointed", "dissatisfied", "unacceptable"/"not
  acceptable", "complaint", "frustrated", "unhappy", "poor experience", "worst",
  "let down", "deleted"/"no backup", "missed deadline"/"delay", "refund",
  "cancel"/"terminate", "legal", "concern(s)", "not happy". A hit means: open the
  thread and decide if it's a GENUINE client escalation (an external client
  expressing a real problem/dissatisfaction) — internal chatter, routine questions
  and system mail don't count. If genuine, record company_name, geo, situation_type
  (Functional|Technical), escalation_type, business_impact (Low|Medium|High),
  email_subject, evidence (quote the exact triggering line). Dedup on thread_id.
  Flag any company with >3 in a quarter for the alert.
- Sentiment -> writeEmailSignals : for EVERY client-facing thread with a clear
  tone (broader than explicit feedback — appreciation, frustration, urgency,
  churn risk, upsell interest all count). This is the "scan all emails for
  sentiment" pass, so recall matters here: one signal per client thread. Record
  company_name, client_email, signal_type (e.g. praise|complaint|risk|request|
  neutral), sentiment (Positive|Negative|Neutral), summary (one line),
  source_subject, source_sender, source_date, thread_id. Skip pure internal/
  automated mail (no external client on the thread). Dedup on thread_id.

## B2. Enrich + RE-CHECK open quotes against their client email
The dashboard merges the sheet Quotes tab into Opportunities by company name.
ALL account-manager / PM client mail forwards to web@uplers.com, so the client
threads ARE in this inbox — find them by the quote's CLIENT EMAIL (client_email),
not just the domain. Scope = OPEN quotes: Quote Shared / Waiting for Final
Approval / Waiting for details. (Confirmed=won, Cancelled=lost, On Hold=parked —
skip for enrichment, but you may re-check On Hold to catch a revival.)

Pull the open quotes from Supabase (there are <100). For EACH, search Gmail by
client_email for the latest thread and write ONE opportunities row (via
writeOpportunities, dedup thread_id, company_name = the quote's agency so it
merges with the sheet value/status):
  - gist       : 1–2 line brief of what the client asked / latest state.
  - journey    : dated bullet trail (enquiry → quote → replies → current ask).
  - win_reason : your read on whether it closes and why (engagement, budget
    pushback, silence, approval language).
  - win_probability : 0–100.

MOVEMENT RE-CHECK (every run): for open quotes that ALREADY have an enrichment
row, look for NEW messages in the thread since source_date. If there is movement,
refresh gist/journey and MOVE win_probability up or down by the latest email
sentiment — a warm/approving reply raises it, silence or price pushback lowers it
— and update source_date to the newest message. No movement → leave it. Do this
only where a genuine client thread exists; skip silently otherwise. Highest-value
open quotes first if you are time-limited.

## C. Finally
0. ACCOUNT-MOVEMENT SENSE-CHECK (the point of the 30-min cadence): after writing,
   step back and report a one-paragraph pulse on how the book of business is
   moving THIS run — new opportunities surfaced, any open escalations still
   unresolved (and for how long), sentiment trend (count of Positive / Neutral /
   Negative signals this run), and any account whose trajectory clearly shifted
   (warming, cooling, churn-risk, upsell). This is a sense-check for the user, not
   a DB write. If nothing moved, say so plainly ("quiet window, no movement").
1. Call rebuildClients() to refresh the derived clients table (LTV from bookings,
   industry from SQLs, latest sentiment from feedback).
2. Call markScan(msg, totalRowsWritten) with a one-line summary
   (e.g. `window=6h · threads=412 · opps=3 feedback=2 signals=57`). This advances
   the high-water mark so the next run's window starts here — ALWAYS call it on a
   SUCCESSFUL run, even a 0-row one, or the window will keep growing. (If the run
   could not scan because a connector auth expired, call markScanFailed instead —
   see §0b — and do NOT call markScan.)
