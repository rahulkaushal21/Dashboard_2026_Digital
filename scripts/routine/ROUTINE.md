# Claude routine — every 30 minutes (LOCAL Claude schedule)

Runs from a local Claude session (session cron, `7,37 * * * *` — every 30 min at
:07/:37). Email capture is now handled independently by the Apps Script (runs 24/7
on Google's servers into `email_inbox`), so no mail is ever lost even while this
routine is asleep — it just gets classified on the next run. This routine still
prefers local because step A (the Business Sheet sync) uses the Google Sheets
connector; the email classification itself only needs Supabase.

MODE: continuous account sense-check. At this 30-min cadence the per-run volume is
small (tens of threads, mostly automated), so the goal is THOROUGH not fast: cheap
triage is used ONLY to discard machine noise; EVERY thread with a real external
human (a client, prospect, or partner) is OPENED and deep-read in full — not judged
from its snippet. The point is to never miss an opportunity, feedback, or
escalation, and to keep a live read on how each account is moving.

MAIL SOURCE (changed): mail is NO LONGER pulled from the claude.ai Gmail connector
(its OAuth token kept expiring and stalling the scan). A Google Apps Script running
under web@uplers.com (scripts/routine/pull-gmail-to-supabase.gs) captures inbox mail
every 30 min into the PRIVATE Supabase `email_inbox` table, with a persistent cursor
so nothing is missed even across trigger outages (up to a 72h catch-up). This routine
now CLASSIFIES from `email_inbox` — it reads unprocessed rows from Supabase, deep-reads
them, writes the classification tables, and marks the rows processed. The Gmail
connector is not used at all; capture runs 24/7 on Google's servers even when no
Claude session is open, so off-hours mail piles up safely and is classified on the
next run.

## Environment
- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY        (routine env only)
- Network access: ON
- Connectors: Google Sheets/Drive (read the Business Sheet privately — NO
  publishing). Email classification reads Supabase `email_inbox` (no Gmail
  connector; capture is handled by the Apps Script).

## 0. Read runtime config first
Call getConfig() (from writers.mjs). Use config.business_sheet_url as the sheet
to read in step A. The email scan no longer touches the Gmail connector — it reads
already-captured mail from the private Supabase `email_inbox` table (see step B).

IMPORTANT — system mails are NOT opportunities. Auto-generated pipeline mail from
notifications@uplers.com (e.g. "… has generated a RFQ", "Quote ( QUT… ) Request")
and invoice-app alerts are created AFTER the client's real email enquiry and are
already represented in the sheet's Quotes tab. Do NOT write them into
`opportunities` (that double-counts). Opportunities come from only two sources:
(1) a genuine client EMAIL enquiry, and (2) the SHEET Quotes tab (step A). Invoice
notifications also must not become quote_conversions (they correspond to sheet
bookings). The sheet and inbox are set by the admin in Settings — never hardcode them.

## 0b. Capture-feed health check (don't classify a stale/empty inbox blindly)
The Apps Script → `email_inbox` capture is now the mail source. Before classifying,
sanity-check that capture is alive: look at the newest `email_inbox.inserted_at` and
the latest `sync_runs` row for source='gmail-ingest'.
- If there are unprocessed rows, classify them (step B) — normal path.
- If `email_inbox` has NO unprocessed rows AND the newest inserted_at is recent
  (< ~40 min), it's simply a quiet window — write a normal 0-row markScan.
- If the newest inserted_at is STALE (e.g. > 2h old) or gmail-ingest is logging
  errors, the Apps Script trigger has likely stalled: capture — not classification —
  is broken. Call `markScanFailed('Apps Script capture stalled — check the Gmail→Supabase trigger')`
  and end. This keeps the dashboard light RED and visible. Do NOT markScan when
  capture is dead, or the window would look healthy while no mail is arriving.
NEVER call markScan on a run where you could not actually see the mail. markScanFailed
for a broken feed, markScan for a real (even 0-row) classification pass.

SUPABASE/MCP UNREACHABLE (502 / connector down) is DIFFERENT from a stalled capture:
if Supabase itself errors so you cannot even read `email_inbox`, just SKIP this run
entirely — do NOT write markScanFailed (that heartbeat needs the same connection, and
capture via the Apps Script is independent and still running, so nothing is lost). The
unprocessed rows wait at `processed=false` and the next run that reaches Supabase
catches up the whole backlog. Optionally confirm the project itself is up (and capture
still flowing) via the REST API — `/rest/v1/sync_runs?source=eq.gmail-ingest` with the
anon key — which works even when the MCP proxy is down. Back off ~60s, retry a couple of
times, then report the outage and stop; do not fabricate a scan result.

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

## B. Email scan -> Supabase  (read from email_inbox, write precisely)
Mail is already captured in the private `email_inbox` table by the Apps Script
(gap-proof persistent cursor; see the MODE note and §0b). This routine's job is to
CLASSIFY it, not to pull it.

READ THE UNPROCESSED QUEUE: select from `email_inbox where processed=false`
(service-role only — this table is NOT public-read; it holds confidential client
mail). Prefer the external threads: `has_external=true`. Group by thread_id and
work newest-first. The full plaintext `body` (up to 60k chars) is already stored,
so you can deep-read every message without any Gmail call. There is no time window
to compute and nothing to paginate from Gmail — the queue IS the window, and the
Apps Script cursor guarantees no gaps (it catches up to 72h across any outage).

TRIAGE + DEEP-READ: triage cheaply ONLY to discard pure machine noise —
newsletters, promos, calendar invites/accepts, OOO auto-replies, monitoring/deploy/
error alerts (Kinsta, Wordfence, Render…), HR/billing/system mail,
notifications@uplers.com RFQ/invoice mails, Basecamp/Slack/Docs notifications, and
Drive share notices. For EVERYTHING ELSE — any thread with a genuine external human
(client / prospect / partner) — deep-read the full stored `body`, even if the last
message looks routine. Do not classify a real client thread from its snippet. Dedup
on thread_id means re-seeing a thread is harmless; only look for NEW messages.

CANONICAL COMPANY NAMES (so every write links to the right client on the dashboard):
always set `company_name` to the CLIENT'S booking name, not the end-product or
sub-brand. Put the product/sub-brand in the summary/company_note instead. The Clients
page lists booking-derived clients and links signals/opps/escalations by name — a
mismatched name orphans the row. Known canonical mappings (extend as you learn more):
- Solargraf / "Enphase (Solargraf)"            -> `Enphase Energy`
- ForHealth / Ray White / any "… (Zulu8)"      -> `ZULU 8`
- "The View From Here (TVFH)"                   -> `view from here`
- Amadeus / ForwardKeys / "Amadeus (ForwardKeys)" -> `Amadeus IT Group SA`
- Marston Holdings / Marston Recovery           -> `Project Centre Ltd`
- Regenative Labs / Humanandthebeast / any *@hummingbirdideas.com -> `Hummingbird Ideas`
  (Hummingbird Ideas is the agency/booking client; Regenative Labs etc. are its end
  clients — put the end-client/project in company_note)
When a new client appears under a parenthetical/product name, prefer the parent
company's booking name if it exists in `clients`; if unsure, use the plainest company
name and note the alias — the dashboard's token matching handles most variants, but an
exact booking name is best. Client sub-brands sharing one booking account (e.g. several
Zulu8 end-clients) all roll up under that one booking name.

RESOLVE THE COMPANY FROM THE SENDER — DON'T GUESS: before naming an opportunity/signal,
take the real sender address from `email_inbox.from_addr` and match its DOMAIN to an
existing `clients`/`quotes` row (e.g. `@hummingbirdideas.com` → the "Hummingbird Ideas"
client; a lone product name like "Regenative Labs" is usually an END client of that
booking account). This avoids orphaned/duplicate rows named after the product.

NEVER FABRICATE CONTACT FIELDS: `source_sender` / `client_email` must be the ACTUAL
address from the thread (`from_addr`), never an invented address like
`tim@<productname>.com`. If you don't have a real address, leave it null. (Learned the
hard way: a guessed email + product name filed a won deal under a non-existent client.)

MARK PROCESSED: after classifying the batch, set `processed=true` on the rows you
handled (including the noise you deliberately skipped) so the next run doesn't
re-triage them. `update email_inbox set processed=true where processed=false` once
the pass is complete.

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
  COLUMN HYGIENE: `company_name` = the canonical client name; `geo` = a REAL geo
  code (US|UK|AU), NEVER the company name. (The Clients page links escalations by
  company_name; putting the name in geo also corrupts the Escalations page's GEO
  column.) Leave geo null if unknown rather than duplicating the company name.
  DRIFT GUARD (sheet ingest): some escalation tabs carry an extra leading
  "Business Unit" column (values like "Digital BU" / "MarTech"). If it isn't
  stripped, every field shifts one left — company_name holds the BU, geo holds
  the real company, deal_type holds the geo, email_subject holds the category
  (Agency/Direct), and the REAL subject lands in `link`. Symptom: company_name IN
  ('Digital BU','MarTech'). To repair, shift each value one field right
  (company_name:=geo, geo:=deal_type, deal_type:=email_subject,
  email_subject:=link, ... escalation_type:=business_impact), drop the BU value,
  then canonicalize the recovered names. Fixed once for ids 63214-63256.
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

Pull the open quotes from Supabase (there are <100). For EACH, look for the client's
latest thread in `email_inbox` by client_email (the capture stores from/to/cc, so a
`from_addr/to_addrs/cc_addrs ilike '%client_email%'` match finds it). Only recent
mail is captured, so many open quotes will have no fresh thread this run — that's
fine, skip them silently. Where a thread IS present, write ONE opportunities row (via
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
   (e.g. `email_inbox: 41 threads · opps=2 conv=1 esc=1 signals=8`). This writes the
   success heartbeat that keeps the dashboard "Opportunities scan" light green —
   ALWAYS call it on a real classification pass, even a 0-row quiet one. (If the
   capture feed itself is stalled — stale email_inbox / gmail-ingest errors — call
   markScanFailed instead, see §0b, and do NOT call markScan.)
