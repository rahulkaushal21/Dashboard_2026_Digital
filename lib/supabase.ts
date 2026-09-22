import { createClient } from '@supabase/supabase-js'
import { isNbdOwner } from './nbd'
import { VOCAB_FALLBACK, normBusinessType, type SheetVocabField } from './deal-fields'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const supabase = url && anon ? createClient(url, anon, {
auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
}) : null
export const isLive = !!supabase

// Every write in this app goes through an RPC. Wrapping .rpc once here means the read
// cache is dropped on all of them — confirming a deal, retiring an expert, filing a QBR —
// rather than each helper having to remember. A helper that forgets is the bug this
// avoids: the write succeeds, the page refetches, and the old rows come back from cache.
if (supabase) {
  const rpc = supabase.rpc.bind(supabase)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(supabase as any).rpc = (...args: any[]) => { clearReadCache(); return (rpc as any)(...args) }
}

export interface Client {
company_name: string; client_type?: string; industry?: string; geo?: string
pc_sme?: string; sales_person?: string; ltv_usd?: number; sentiment?: string
rag_status?: string; client_status?: string; email?: string
journey?: string; action_steps?: string; last_booking_month?: string
website?: string; ai_focus?: boolean; industry_note?: string
}
export interface Opportunity {
id: number; company_name?: string; is_new_client?: boolean; rfq?: boolean
rfq_status?: string; geo?: string; sales_person?: string; source_subject?: string
source_date?: string; first_date?: string; summary?: string; source?: string; sources?: string[]; pm_owner?: string
gist?: string; win_probability?: number; win_reason?: string; company_note?: string
won?: boolean; won_amount?: number; flag?: string; status?: string; source_tags?: string[]; business_type?: string
// Owner is on the NBD team (lib/nbd.ts), so this deal can be genuinely new business.
// `mis_tagged_new` marks a row the Quotes sheet calls "New" under a non-NBD owner —
// shown as Repeat, with an error flag asking for the sheet to be corrected.
nbd_owner?: boolean; mis_tagged_new?: boolean
value?: number; technology?: string; service?: string; journey?: string; quote_ref?: string
quote_date?: string; origin?: string; est_value?: number; next_step?: string; enriched?: boolean
// Entered by hand from the dashboard (origin='pm'). `channel` is where the deal came
// from when email did not catch it — referral, LinkedIn, upsell, event, inbound.
channel?: string; currency?: string; service_dept?: string; project_type?: string
created_by?: string; created_at?: string; confirmed_by?: string; confirmed_at?: string
contact_email?: string
// The revenue sheet's own columns, asked for at confirmation. `client_name` is the
// PERSON at the client; company_name is the agency, which is what the sheet calls
// "Agency". `quote_price` is the figure quoted before negotiation, against local_value
// which is what it actually closed at — the gap between them is the discount.
client_name?: string; client_type?: string; service_type?: string; delivery_type?: string
quote_price?: number; start_date?: string; delivery_date?: string
// The sheet's two human-facing labels. `quote_id` is NOT quote_key: that one is this
// row's identity and what the Quotes janitors match on, so it is never hand-edited.
project_id?: string; quote_id?: string
// Who built it, and what it cost if it went outside. 'Contractor' in `expert` is the
// sheet's own marker for outsourced work, and the three contractor fields only mean
// anything alongside it — the database clears them if the expert changes back.
expert?: string; contractor_name?: string
outsource_price?: number; outsource_currency?: string
internal_delivery?: string; internal_hrs?: number; actual_hrs?: number
integration?: string; invoice_no?: string; invoice_currency?: string
invoice_amount?: number; feedback_status?: string
// DELIVERY state (Under Development / Delivered / On Hold / Cancelled). Deliberately
// not `status`, which is the SALES state and is overwritten by the Quotes sync every
// 30 minutes — writing "Delivered" there would push a won deal back into open pipeline.
delivery_status?: string
// The figure as QUOTED, in `currency`. est_value is always USD — every total, forecast
// and scorecard adds est_value up without asking what currency it was.
local_value?: number
// "Might not come" — a human call that this open quote probably won't convert.
// The deal stays Open (it isn't Lost), but it's discounted from the realistic view.
unlikely?: boolean; unlikely_reason?: string; unlikely_at?: string; unlikely_by?: string
// Lost, called from email evidence. Held apart from `status` because the sheet sync
// overwrites `status` every 30 min — so while the Quotes sheet still says Open, the two
// disagree, and that disagreement is what raises the "update the sheet" alert.
email_lost?: boolean; email_lost_reason?: string; email_lost_at?: string; email_lost_by?: string
// Confirmed Won from the dashboard — the mirror image of email_lost, and held apart
// from `won`/`status` for the same reason: the sheet sync overwrites both.
email_won?: boolean; email_won_reason?: string; email_won_at?: string; email_won_by?: string
// When the sheet sync last confirmed this row's status — the fallback date for
// placing a win in the right quarter when email_won_at is absent.
status_checked_at?: string
// Matched to a line in the revenue sheet while the Quotes row still reads Open —
// i.e. delivered and invoiced, but nobody set the sheet to Confirmed. Derived every
// load by matchBookedQuotes(); nothing is written to the database.
booked_month?: string; booked_amount?: number; booked_ambiguous?: boolean
// Buying-intent score, 1-97, from the `web_quote_intent` view (open deals only).
// Fitted on the 515 quotes decided since April 2026 — the window where the business
// actually converts at 89%, rather than all 675, which included a Jan-Mar era running
// at 0-47% and dragged every score down. Four factors: the client's own confirm
// history, the price band, what the client has said in email, and how long the deal
// has been silent. It answers "will this convert", which is NOT what win_probability
// records — that is a human's judgement of the deal and is left untouched.
// `intent_basis` says whether recency came from email or from the sheet's own
// date; the sheet is logged over a week late on 22% of rows, so email wins where
// it exists. Absent for won/lost rows.
// Row this deal occupies in the Quotes tab, so a flag can say where to go and
// not just what is wrong. Sheet-origin rows only — an email-origin deal has no line yet.
sheet_row?: number
intent_score?: number; intent_tier?: 'A' | 'B' | 'C' | 'D' | 'E'
intent_basis?: 'email' | 'sheet-date' | 'none'; days_since_touch?: number
intent_relationship?: number; intent_value_factor?: number; intent_recency?: number
// Fourth factor, read from the client's own words rather than sheet metadata.
// Fitted on April-2026+ decided quotes: invoice/payment talk 96.3%, "approved /
// please proceed" 95.9%, access handed over 92.5%, kickoff returned 89.5% — against
// 71.1% for a thread showing none of them. Only mail from outside mavlers/uplers is
// scanned, so our own chasing cannot manufacture a positive.
intent_signal?: number; signal_label?: string
// Open in the sheet, but the client has already committed in writing. The sheet
// lags email by over a week on 22% of rows, so these are the likeliest unlogged wins.
flag_committed_in_email?: boolean
client_decided_quotes?: number; client_confirmed_quotes?: number
flag_no_agency?: boolean; flag_stale?: boolean
}

// Group the many raw quote "technology" values into a handful of service lines.
export const serviceOf = (tech?: string): string => {
const t = (tech || '').toLowerCase()
if (!t.trim()) return 'Other / Unspecified'
if (/shopify|woocommerce|magento|bigcommerce/.test(t)) return 'E-commerce'
if (/design|banner|figma/.test(t)) return 'Design'
if (/hubspot|ghl|gohighlevel|marketo|klaviyo|pardot/.test(t)) return 'Marketing Automation'
if (/mobile app|react native|flutter|ios|android|web & mobile|web and mobile/.test(t)) return 'App Development'
if (/\bai\b|automation/.test(t)) return 'AI / Automation'
if (/wordpress|\bwp\b|webflow|wix|squarespace|html|php|laravel|react|memberclicks|lp /.test(t)) return 'Web Development'
return 'Other / Unspecified'
}

// Status of an open quote -> a rough close likelihood + a plain-English read.
const quoteOutlook = (status?: string): { prob: number; read: string } => {
const v = (status || '').toLowerCase()
if (/final approval/.test(v)) return { prob: 75, read: 'Late stage — awaiting final approval; likely to close.' }
if (/quote shared/.test(v)) return { prob: 50, read: 'Quote shared — in play, awaiting the client’s decision.' }
if (/waiting for details|waiting for detail/.test(v)) return { prob: 40, read: 'Early — waiting on client details/scope before it can progress.' }
if (/on hold/.test(v)) return { prob: 25, read: 'On hold — stalled and at risk unless re-engaged.' }
return { prob: 45, read: 'Open quote — outcome not yet clear from the sheet.' }
}
export interface RevenueRow { client_name: string; month: string; amount_usd: number }
export interface BookingRow { id: number; company_name?: string; booking_month?: string; booking_date?: string; booking_amount?: number; service_name?: string; technology?: string; engagement_model?: string; geo?: string; sme?: string; sales_person?: string; contact_email?: string }
export interface Feedback { id: number; agency?: string; nature?: string; comments?: string; added_date?: string; project_names?: string; geo?: string; feedback_type?: string }
export interface EmailSignal { id: number; thread_id?: string; company_name?: string; client_email?: string; signal_type?: string; sentiment?: string; summary?: string; source_subject?: string; source_date?: string }

// Table reads, cached and paged in parallel.
//
// Two things made the dashboard feel slow, and neither was the database.
//
// 1. PAGES WERE FETCHED ONE AFTER ANOTHER. Supabase caps a request at 1,000 rows, so
//    3,042 bookings meant four round trips in a queue — the fourth could not start until
//    the third came back. The first request now asks for the exact count, and the
//    remaining pages go out together.
// 2. EVERY PAGE REFETCHED EVERYTHING. Moving from Clients to Opportunities and back
//    pulled the same 3,000 bookings again. Reads are now held for a minute and shared:
//    two components asking for the same table at the same time make one request, not two.
//
// The cache is cleared on every write (see the supabase.rpc wrapper below), so a
// confirmed deal shows up immediately — the staleness that remains is another person's
// change taking up to a minute to appear, which is what a 30-minute sheet sync already
// implies.
const READ_TTL_MS = 60_000
type CacheEntry = { at: number; rows: any[] | null; inflight?: Promise<any[] | null> }
const readCache = new Map<string, CacheEntry>()
/** Drop everything held. Called after any write so nobody reads their own stale data. */
export function clearReadCache() { readCache.clear() }

async function read<T>(table: string, cols = '*', orderBy?: string): Promise<T[] | null> {
if (!supabase) return null
const key = `${table}|${cols}|${orderBy || ''}`
// A shallow copy per caller: the cached array is shared, and several pages sort what
// they are handed in place. Without this, one page's sort would silently reorder
// another's — including the paginated reads that require a stable order.
const copy = (rows: any[] | null) => (rows ? (rows.slice() as T[]) : null)
const hit = readCache.get(key)
if (hit?.inflight) return hit.inflight.then(copy)
if (hit && Date.now() - hit.at < READ_TTL_MS) return copy(hit.rows)

// IMPORTANT: pass a stable `orderBy` (a unique column) for any table over 1000 rows.
// Without an ORDER BY, Postgres may return rows in a different order on each page
// request — and while the revenue sync is writing, that drops or duplicates boundary
// rows, making totals slightly off and flaky.
const PAGE = 1000
const page = (from: number, exact = false) => {
  let q = supabase!.from(table).select(cols, exact ? { count: 'exact' } : undefined).range(from, from + PAGE - 1)
  if (orderBy) q = q.order(orderBy, { ascending: true })
  return q
}

const run = (async (): Promise<T[] | null> => {
  const first = await page(0, true)
  if (first.error) return null
  const head = (first.data || []) as T[]
  const total = first.count ?? head.length
  if (head.length === 0) return null
  if (head.length >= PAGE && total > head.length) {
    const starts: number[] = []
    for (let from = PAGE; from < total; from += PAGE) starts.push(from)
    const rest = await Promise.all(starts.map(from => page(from)))
    for (const r of rest) {
      // A failed page would silently shorten the table, and a half-loaded revenue tab
      // is worse than a slow one: the totals would simply be wrong with no sign of it.
      if (r.error) return null
      head.push(...((r.data || []) as T[]))
    }
  }
  return head.length ? head : null
})()

readCache.set(key, { at: Date.now(), rows: null, inflight: run })
const rows = await run
readCache.set(key, { at: Date.now(), rows })
return copy(rows)
}

// Every client on the Client-Backup tab of the business sheet (2,000+ rows across
// both BUs), whether or not they have ever booked revenue. Revenue clients carry
// `matched_client`, which is how the directory links back to `web_clients` without
// listing the same company twice.
export interface ClientDirectory {
id: number
company_name: string
industry?: string          // the 13-bucket group the UI filters on
industry_detail?: string   // the granular industry it was merged from
industry_sheet?: string
industry_source?: string
industry_confidence?: string
domain?: string
website_url?: string
bu?: string
am_name?: string
head?: string
geo?: string
direct_agency?: string
technology?: string
email?: string
matched_client?: string
is_revenue_client?: boolean
notes?: string
// AI stance, classified from the site title/description already cached on the
// directory row. 'native' = the company's own product is AI; 'adjacent' = its
// positioning leans on AI or automation; 'none' = neither; undefined = no site
// text was captured, so unknown rather than no.
ai_stance?: 'native' | 'adjacent' | 'none'
ai_evidence?: string
}

export async function getClientDirectory(): Promise<ClientDirectory[]> {
// >1000 rows, so an explicit stable order is required or pagination drops rows.
return (await read<ClientDirectory>('web_client_directory', '*', 'id')) || []
}

export async function getClients(): Promise<Client[]> {
const live = await read<Client>('web_clients')
return live && live.length ? live : (await import('./mockData')).mockClients
}

export async function getLastSync(source: string): Promise<string | null> {
if (!supabase) return null
const { data } = await supabase.from('sync_runs').select('ran_at').eq('source', source).order('ran_at', { ascending: false }).limit(1)
return data && data.length ? (data[0] as { ran_at: string }).ran_at : null
}

// Like getLastSync but also returns ok/message of the most recent run, so the UI
// can distinguish a healthy scan from a failed one (e.g. Gmail auth expired ->
// the routine writes an ok:false heartbeat via markScanFailed).
export interface SyncStatus { ran_at: string; ok: boolean; message?: string }
export async function getLastSyncStatus(source: string): Promise<SyncStatus | null> {
if (!supabase) return null
const { data } = await supabase.from('sync_runs').select('ran_at, ok, message').eq('source', source).order('ran_at', { ascending: false }).limit(1)
return data && data.length ? (data[0] as SyncStatus) : null
}

// ---- On-demand sense-check trigger (dashboard button) ----
// Queues a scan request; the serverless hourly runner claims and processes it
// (and it also runs every hour on its own). Rapid repeats coalesce server-side.
export interface ScanRequest { id: number; status: string; requested_at?: string; finished_at?: string; note?: string }
export async function requestScan(by?: string): Promise<ScanRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('request_scan', { p_by: by ?? null })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  return (row as ScanRequest) || null
}
export async function getLatestScanRequest(): Promise<ScanRequest | null> {
  if (!supabase) return null
  const { data } = await supabase.rpc('latest_scan_request')
  const row = Array.isArray(data) ? data[0] : data
  return (row as ScanRequest) || null
}

const isOpenQuote = (s?: string) => {
const v = (s || '').trim().toLowerCase()
// Open pipeline = shared / awaiting details / awaiting approval. Confirmed = won,
// Cancelled = closed-lost, On Hold = parked — all excluded from Opportunities.
return v !== '' && v !== 'confirmed' && v !== 'cancelled' && v !== 'on hold'
}

// Levenshtein distance similarity: returns 0-1 score (1 = identical)
const similarity = (a: string, b: string): number => {
const s1 = (a || '').trim().toLowerCase()
const s2 = (b || '').trim().toLowerCase()
if (s1 === s2) return 1
if (!s1 || !s2) return 0

const matrix: number[][] = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(0))
for (let i = 0; i <= s1.length; i++) matrix[0][i] = i
for (let j = 0; j <= s2.length; j++) matrix[j][0] = j

for (let j = 1; j <= s2.length; j++) {
for (let i = 1; i <= s1.length; i++) {
const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
matrix[j][i] = Math.min(
matrix[j][i - 1] + 1,
matrix[j - 1][i] + 1,
matrix[j - 1][i - 1] + cost
)
}
}

const maxLen = Math.max(s1.length, s2.length)
return maxLen === 0 ? 1 : 1 - (matrix[s2.length][s1.length] / maxLen)
}

// ---- Booked, but the Quotes sheet still says Open -------------------------
// The Quotes tab is maintained by hand, so a deal that has already been delivered
// and INVOICED (it shows up in the revenue sheet) can sit there reading "Quote
// Shared" indefinitely. The money is then counted twice — once as booked revenue,
// once as live pipeline. This matches open quote lines against revenue lines so
// the deal drops out of the pipeline and the team gets told to fix the sheet row.
//
// Matching is deliberately strict, because a false positive silently removes a
// LIVE deal while a false negative only costs us an alert:
//   • same client (name key) and the same amount to the dollar, and
//   • the booking lands in the quote's own month or one of the 6 months after, and
//   • the booking is not already explained by a quote that is already Won — those
//     claim their bookings first, oldest quote to earliest booking.
// If more open quotes compete for a free booking than there are bookings (a client
// re-quoting the same price — Telfer's two $1,200 lines), nothing is auto-closed:
// every candidate is marked ambiguous so a human says which one shipped.
export interface BookedMatch { month?: string; amount: number; ambiguous: boolean }
const BOOKED_WINDOW_MONTHS = 6
type MatchOpp = { id: number; company_name?: string; est_value?: number; status?: string; won?: boolean; origin?: string; first_date?: string; source_date?: string }
type MatchRev = { company_name?: string; booking_amount?: number; booking_month?: string }
export function matchBookedQuotes(opps: MatchOpp[], revenue: MatchRev[]): Map<number, BookedMatch> {
const out = new Map<number, BookedMatch>()
const key = (name?: string, amt?: number) => `${(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${Math.round(amt || 0)}`
// 'YYYY-MM-…' -> a comparable month ordinal. Revenue rows carry booking_month only.
const monthNo = (d?: string) => { const m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? Number(m[1]) * 12 + Number(m[2]) : null }

const bookings = new Map<string, { month: number; raw: string; taken: boolean }[]>()
for (const r of revenue) {
const mo = monthNo(r.booking_month)
if (!r.company_name || !r.booking_amount || mo == null) continue
const k = key(r.company_name, r.booking_amount)
if (!bookings.has(k)) bookings.set(k, [])
bookings.get(k)!.push({ month: mo, raw: r.booking_month!, taken: false })
}
if (!bookings.size) return out
for (const list of bookings.values()) list.sort((a, b) => a.month - b.month)

// group the sheet quotes that carry a real price by client+amount
const groups = new Map<string, MatchOpp[]>()
for (const o of opps) {
if (o.origin !== 'sheet' || !o.company_name || !o.est_value) continue
const k = key(o.company_name, o.est_value)
if (!bookings.has(k)) continue
if (!groups.has(k)) groups.set(k, [])
groups.get(k)!.push(o)
}

const isWon = (o: MatchOpp) => o.won === true || /^(won|confirmed)$/i.test((o.status || '').trim())
const isLost = (o: MatchOpp) => /lost|cancel/i.test(o.status || '')
const quoteMonth = (o: MatchOpp) => monthNo(o.first_date || o.source_date)

for (const [k, list] of groups) {
const free = bookings.get(k)!
const claim = (from: number | null) => {          // earliest untaken booking at/after `from`
const hit = free.find(b => !b.taken && (from == null || b.month >= from))
if (hit) hit.taken = true
return hit
}
// 1. deals already Won take their booking first — oldest quote, earliest booking
for (const o of list.filter(isWon).sort((a, b) => (quoteMonth(a) ?? 0) - (quoteMonth(b) ?? 0))) claim(quoteMonth(o))
// 2. whatever revenue is left over is unexplained — an open quote may have caused it
const open = list.filter(o => !isWon(o) && !isLost(o))
const eligible = open.filter(o => {
const qm = quoteMonth(o)
return qm != null && free.some(b => !b.taken && b.month >= qm && b.month <= qm + BOOKED_WINDOW_MONTHS)
})
if (!eligible.length) continue
const spare = free.filter(b => !b.taken).length
const ambiguous = eligible.length > spare
for (const o of eligible) {
const b = ambiguous ? free.find(x => !x.taken) : claim(quoteMonth(o))
if (!b) continue
out.set(o.id, { month: b.raw, amount: Math.round(o.est_value || 0), ambiguous })
}
}
return out
}

export async function getOpportunities(): Promise<Opportunity[]> {
// SINGLE SOURCE OF TRUTH: the opportunities table. One row per DEAL.
//  • origin='sheet'  — one row per line in the Business-Sheet "Quotes" tab
//    (price, confirmation status, agency, subject, GEO, AM=sales_person, PC=pm_owner),
//    synced + brief-generated by the sync_quotes_to_opportunities() DB function and
//    refreshed every 30 min. Brief + %/next-step get enriched from reviewweb@uplers.com email.
//  • origin='email' — opportunities found in email that are NOT in the Quotes sheet.
// No live re-derivation or per-company collapsing — each quote stands as its own deal.
const rows = (await read<any>('opportunities')) || []
const norm = (s?: string) => (s || '').trim().toLowerCase()
// Buying-intent scores, open deals only. Keyed by opportunity id so a miss just
// leaves the badge off rather than breaking the row.
const intent = new Map<number, any>()
for (const r of (await read<any>('web_quote_intent')) || []) intent.set(r.id, r)
// Quotes-tab row number per opportunity, so "fix the sheet" flags can name the row.
const sheetRow = new Map<number, number>()
for (const r of (await read<any>('web_quote_sheet_row')) || []) sheetRow.set(r.id, r.sheet_row)
// collapse GEO into 3 buckets: US (incl. Canada/N.America), AU (incl. APAC/NZ), UK (rest)
const geo3 = (g?: string) => {
const v = (g || '').toLowerCase()
if (!v.trim()) return ''
if (/\bau\b|au\/|nz|apac|australia|new zealand|asia[\s-]?pac/.test(v)) return 'AU'
if (/\bus\b|us\/|usa|u\.s|united states|canada|north america/.test(v)) return 'US'
return 'UK'
}
// companies anywhere in the revenue sheet = existing/repeat clients
const booked = (await read<{ company_name: string; booking_amount: number; booking_month: string }>('web_revenue', 'company_name, booking_amount, booking_month', 'id')) || []
const revenueSet = new Set(booked.map(b => norm(b.company_name)).filter(Boolean))
const bookedMatch = matchBookedQuotes(rows, booked)
const out: Opportunity[] = rows.map((o: any) => {
const iq = intent.get(o.id)
const value = o.est_value ?? o.won_amount
const inRevenue = revenueSet.has(norm(o.company_name))
// Business Type from the Quotes tab (col P): 'New' | 'Repeat' | 'New Repeat' | null.
// A booked client sending regular work is normal REPEAT business — "Repeat" and
// "New Repeat" must never be flagged. Only a genuine contradiction counts.
const bt = norm(o.business_type)
const taggedRepeat = bt.includes('repeat')       // 'repeat' or 'new repeat'
const taggedNewOnly = bt === 'new'               // pure "New"
// NBD gate: only the new-business team opens genuinely new accounts. A deal the
// sheet tags "New" under an account manager is repeat work on an existing client,
// so it counts as Repeat here and the row carries a MIS-TAGGED flag — see nbd.ts.
const nbd = isNbdOwner(o.sales_person)
// Only a SHEET row can be mis-tagged: it has a Business Type cell someone can correct.
// An email deal has no Quotes line, and its `is_new_client` is the scan's guess rather
// than a recorded decision — the NBD gate still reads it as Repeat, but quietly, because
// there is nothing to go and fix. (Email rows also put a client CATEGORY in this column
// — 'Agency', 'Direct' — a different axis entirely, so it must not be read as New.)
const wrongNew = !nbd && taggedNewOnly && o.origin === 'sheet'
const repeat = taggedRepeat || inRevenue || o.is_new_client === false || !nbd
// Review flags for still-open deals, in priority order (one flag shown, most urgent first):
//  1. CONFIRM-LAG — someone confirmed it Won here but the sheet line is still Open
//  2. LOST-LAG    — someone marked it Lost here but the sheet line is still Open
//  3. WON-LAG     — email reads confirmed but the deal is still Open (sheet not updated yet)
//  4. type        — booked/existing client mislabelled pure "New" in the sheet
//  5. text        — brief reads like existing/confirmed work
//
// Review means "the sheet and the dashboard disagree, and a person must reconcile
// them". It is NOT a chase list. An age-based "stale, follow up" flag used to live
// here and fired on 169 of 203 open deals — 83% — which buried the handful of real
// mismatches it exists to surface. Ageing is a sales signal, not a data defect, and
// now lives in the intent score's recency factor and its stale badge instead.
let flag: string | undefined
const bm = bookedMatch.get(o.id)
// "row 771" when we know it, "that row" when we don't, so the sentence always reads.
const sr = sheetRow.get(o.id)
const atRow = sr ? `row ${sr}` : 'that row'
if (!o.won && norm(o.status) !== 'lost' && !norm(o.status).includes('cancel')) {
// Every flag below is a DATA DEFECT: two sources that disagree, or a mis-tag that
// miscounts revenue. None of them is a chase-list entry. A deal being closed is not
// a defect, so "the client confirmed this, go enter it" flags were removed — an
// email-origin deal has no Quotes line to disagree with in the first place.
const lostLag = o.email_lost && o.origin === 'sheet'
const confirmLag = o.email_won && o.origin === 'sheet'
if (bm && !bm.ambiguous) flag = `⚠ ALREADY BOOKED, OPEN IN SHEET — $${bm.amount.toLocaleString('en-US')} for this client was invoiced in the revenue sheet (${(bm.month || '').slice(0, 7)}), but its Quotes-sheet line still reads Open. Set ${atRow} to Confirmed — until you do, this money is counted twice.`
else if (bm) flag = `⚠ POSSIBLY ALREADY BOOKED — a $${bm.amount.toLocaleString('en-US')} booking for this client (${(bm.month || '').slice(0, 7)}) matches this quote AND another open quote at the same price. Check which one shipped and set ${atRow} to Confirmed.`
else if (confirmLag) flag = `⚠ CONFIRMED HERE, OPEN IN SHEET — this was marked Won on the dashboard, but its Quotes-sheet line still reads Open. Set ${atRow} to Confirmed so it books as revenue.`
else if (lostLag) flag = `⚠ LOST IN EMAIL, OPEN IN SHEET — this was marked Lost here, but its Quotes-sheet line still reads Open. Set ${atRow} to Cancelled so it stops counting as live pipeline.`
else if (wrongNew) flag = `⚠ NOT NBD, TAGGED “NEW” — Quotes ${atRow}${sr ? ` (${o.quote_key || o.quote_ref || 'no ref'})` : ` ${o.quote_key || o.quote_ref || '(no ref)'}`} is tagged New Business (col P) but its owner${o.sales_person ? ` (${o.sales_person})` : ' is blank and'} is not on the NBD team, so it counts as Repeat. Either set col P to Repeat, or put the NBD owner who actually opened the account in the Account/Sales Person column.`
else if (inRevenue && taggedNewOnly) flag = 'Booked/existing client but tagged “New” in the Quotes sheet (Business Type, col P) — should be Repeat.'
}
return {
...o,
geo: geo3(o.geo),
value: value != null ? Math.round(value) : undefined,
won_amount: o.won_amount != null ? Math.round(o.won_amount) : undefined,
source: o.origin,
// Dual source: a sheet quote line whose client is ALSO active in email is tracked from BOTH
// the Quotes sheet and email — show both tags. `email_tracked` is set by
// reconcile_opportunities() (company name == external sender domain), or when an email twin
// gets merged into the sheet row.
sources: (o.origin === 'sheet' && o.email_tracked) ? ['sheet', 'email'] : [o.origin],
source_tags: (o.origin === 'sheet' && o.email_tracked) ? ['sheet', 'email'] : [o.origin],
service: serviceOf(o.technology),
quote_ref: o.quote_key || o.quote_ref || undefined,
sheet_row: sr,
is_new_client: !repeat,
nbd_owner: nbd,
mis_tagged_new: wrongNew,
business_type: o.business_type || undefined,
first_date: o.first_date || o.source_date,
booked_month: bm && !bm.ambiguous ? bm.month : undefined,
booked_amount: bm ? bm.amount : undefined,
booked_ambiguous: bm ? bm.ambiguous : undefined,
intent_score: iq?.intent_score ?? undefined,
intent_tier: iq?.intent_tier ?? undefined,
intent_basis: iq?.intent_basis ?? undefined,
days_since_touch: iq?.days_since_touch ?? undefined,
intent_relationship: iq?.relationship_factor ?? undefined,
intent_value_factor: iq?.value_factor ?? undefined,
intent_recency: iq?.recency_factor ?? undefined,
intent_signal: iq?.signal_factor ?? undefined,
signal_label: iq?.signal_label ?? undefined,
flag_committed_in_email: iq?.flag_committed_in_email || undefined,
client_decided_quotes: iq?.client_decided_quotes ?? undefined,
client_confirmed_quotes: iq?.client_confirmed_quotes ?? undefined,
flag_no_agency: iq?.flag_no_agency || undefined,
flag_stale: iq?.flag_stale || undefined,
flag,
} as Opportunity
})
return out.length ? out : (await import('./mockData')).mockOpportunities
}
export async function getRevenue(): Promise<RevenueRow[]> {
const live = await read<{ company_name: string; booking_month: string; booking_amount: number }>('web_revenue',
'company_name, booking_month, booking_amount', 'id')
if (live && live.length) return live.map(b => ({ client_name: b.company_name, month: b.booking_month, amount_usd: b.booking_amount }))
return (await import('./mockData')).mockRevenue
}
export async function getBookingsFull(): Promise<BookingRow[]> { return (await read<BookingRow>('web_revenue', 'id, company_name, booking_month, booking_date, booking_amount, service_name, technology, engagement_model, geo, sme, sales_person, contact_email', 'id')) || [] }
export async function getFeedback(): Promise<Feedback[]> { return (await read<Feedback>('feedback', 'id, agency, nature, comments, added_date, project_names, geo, feedback_type')) || [] }
// Feedback keyed to the PM who owns it, for the PM scorecard. Kept apart from
// getFeedback() because that one is the Delights feed and selects a different set
// of columns; this one needs pc_sme and the month the feedback lands in.
//
// `month_year` is blank on most rows, so the scorecard falls back to added_date.
// Between the two, all 67 rows are dated. 39 of them came in from email rather
// than the sheet, which is why the PM feedback count is genuinely "email and
// sheet combined" without any extra join.
export interface PmFeedbackRow { id: number; pc_sme?: string; month_year?: string; added_date?: string; csat?: number; feedback_type?: string; nature?: string; agency?: string; comments?: string; evidence?: string; source_sender?: string; thread_id?: string }
export async function getPmFeedback(): Promise<PmFeedbackRow[]> {
  return (await read<PmFeedbackRow>('feedback', 'id, pc_sme, month_year, added_date, csat, feedback_type, nature, agency, comments, evidence, source_sender, thread_id')) || []
}

export async function getEmailSignals(): Promise<EmailSignal[]> { return (await read<EmailSignal>('email_signals', 'id, thread_id, company_name, client_email, signal_type, sentiment, summary, source_subject, source_date')) || [] }

// The human verdicts recorded on Critical Escalations, so every board can honour them.
// Without this the Clients page kept calling a client At risk off the same email signal
// someone had already dismissed as "not our escalation" one screen away.
//   settled   — thread marked fixed or the client turned positive: real, and over.
//   dismissed — "Not an issue": never ours to begin with, so it should leave no trace.
// A thread marked 'unresolved' appears in NEITHER set: it is still live risk.
export async function getEscalationVerdicts(): Promise<{ dismissed: Set<string>; settled: Set<string>; unresolved: Set<string> }> {
  const empty = { dismissed: new Set<string>(), settled: new Set<string>(), unresolved: new Set<string>() }
  if (!supabase) return empty
  const { data, error } = await supabase.from('critical_escalations').select('thread_id, status, dismissed')
  if (error || !data) return empty
  const out = { dismissed: new Set<string>(), settled: new Set<string>(), unresolved: new Set<string>() }
  for (const r of data as { thread_id: string; status?: string; dismissed?: boolean }[]) {
    if (!r.thread_id) continue
    if (r.dismissed) out.dismissed.add(r.thread_id)
    else if (r.status === 'fixed' || r.status === 'positive') out.settled.add(r.thread_id)
    else if (r.status === 'unresolved') out.unresolved.add(r.thread_id)
  }
  return out
}

// ---- Critical escalations (customer-side major negative feedback) ----
// A PERSISTENT record of client-triggered red flags. A DB trigger captures every
// email_signal that turns sentiment='Negative' into critical_escalations ONCE and
// keeps it — so when the client later goes positive the escalation does NOT drop
// off; it stays in the list to be manually marked Fixed/Positive, preserving the
// "was escalated → now solved" story. The row's `escalation_summary` is the original
// negative insight; `latest_*` is joined live from the thread's current signal so
// the resolution is visible. geo is joined from the client record. A row can be
// Removed (dismissed) only by a human, for genuine false-positives.
// One underlying escalation thread for a client.
export interface EscalationItem {
  thread_id: string; signal_type?: string; escalation_summary?: string; source_subject?: string
  client_email?: string; first_flagged_date?: string; status?: string; resolution_note?: string
  resolved_at?: string; resolved_by?: string; latest_summary?: string; latest_sentiment?: string
}
// One row PER CLIENT (a client can have several escalation threads — they roll up here).
export interface CriticalEscalation {
  company_name: string; geo?: string; client_email?: string; signal_type?: string
  items: EscalationItem[]; threadIds: string[]; count: number
  // Rolled up across the client's threads, worst-first: any thread still untriaged makes
  // the client 'open'; else any thread a human marked still-broken makes it 'unresolved';
  // only when every thread is fixed or turned positive does the client read 'resolved'.
  status: 'open' | 'unresolved' | 'resolved'
  headline?: string                    // most-recent escalation text (the card summary)
  latest_summary?: string; latest_sentiment?: string
  first_flagged_date?: string; last_flagged_date?: string; resolved_at?: string; resolved_by?: string
}
const ckey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
// The table stores 'open' | 'unresolved' | 'fixed' | 'positive'; the board shows the last
// two as one settled state. RANK orders them worst-first for the roll-up and the sort.
const rollUp = (s?: string): 'open' | 'unresolved' | 'resolved' => s === 'open' ? 'open' : s === 'unresolved' ? 'unresolved' : 'resolved'
const RANK: Record<'open' | 'unresolved' | 'resolved', number> = { open: 0, unresolved: 1, resolved: 2 }
export async function getCriticalEscalations(): Promise<CriticalEscalation[]> {
  if (!supabase) return []
  const [escRes, sigRes, clients] = await Promise.all([
    supabase.from('critical_escalations').select('thread_id, company_name, client_email, signal_type, escalation_summary, source_subject, first_flagged_date, status, resolution_note, resolved_at, resolved_by').eq('dismissed', false).order('first_flagged_date', { ascending: false }),
    supabase.from('email_signals').select('thread_id, summary, sentiment, source_date'),
    getClients(),
  ])
  const rows = (escRes.data as (EscalationItem & { company_name?: string })[]) || []
  const latest = new Map<string, { summary?: string; sentiment?: string; source_date?: string }>()
  for (const s of (sigRes.data as { thread_id: string; summary?: string; sentiment?: string; source_date?: string }[]) || []) if (s.thread_id) latest.set(s.thread_id, s)
  const geoBy = new Map<string, string>()
  for (const c of clients) { const k = ckey(c.company_name); if (k && c.geo) geoBy.set(k, c.geo) }
  const geoFor = (name?: string): string => {
    const k = ckey(name); if (!k) return ''
    if (geoBy.has(k)) return geoBy.get(k) as string
    for (const [gk, g] of geoBy) { if (gk.length >= 4 && (gk.startsWith(k) || k.startsWith(gk))) return g }
    return ''
  }
  // group by canonical client key (merges "Growth Funnels"/"GrowthFunnels", ZULU 8's many threads, etc.)
  const groups = new Map<string, CriticalEscalation>()
  for (const r of rows) {
    const key = ckey(r.company_name) || r.thread_id
    const l = latest.get(r.thread_id)
    const item: EscalationItem = { thread_id: r.thread_id, signal_type: r.signal_type, escalation_summary: r.escalation_summary, source_subject: r.source_subject, client_email: r.client_email, first_flagged_date: r.first_flagged_date, status: r.status, resolution_note: r.resolution_note, resolved_at: r.resolved_at, resolved_by: r.resolved_by, latest_summary: l?.summary, latest_sentiment: l?.sentiment }
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { company_name: r.company_name || '(unknown client)', geo: geoFor(r.company_name), client_email: r.client_email, signal_type: r.signal_type, items: [item], threadIds: [r.thread_id], count: 1, status: rollUp(r.status), headline: r.escalation_summary, latest_summary: l?.summary, latest_sentiment: l?.sentiment, first_flagged_date: r.first_flagged_date, last_flagged_date: r.first_flagged_date, resolved_at: r.resolved_at, resolved_by: r.resolved_by })
    } else {
      g.items.push(item); g.threadIds.push(r.thread_id); g.count++
      // worst status across the client's threads wins
      if (RANK[rollUp(r.status)] < RANK[g.status]) g.status = rollUp(r.status)
      // rows arrive newest-first, so the first seen is the headline; track the date span
      if ((r.first_flagged_date || '') < (g.first_flagged_date || '')) g.first_flagged_date = r.first_flagged_date
      if ((r.first_flagged_date || '') > (g.last_flagged_date || '')) g.last_flagged_date = r.first_flagged_date
    }
  }
  // sort: open clients first, then by most-recent activity
  return [...groups.values()].sort((a, b) => (a.status === b.status ? (b.last_flagged_date || '').localeCompare(a.last_flagged_date || '') : RANK[a.status] - RANK[b.status]))
}
// Mark ALL of a client's escalation threads. They stay in the list either way.
// 'unresolved' is the deliberate middle: someone looked and it is still broken.
export async function markEscalationStatus(threadIds: string[], status: 'open' | 'unresolved' | 'fixed' | 'positive', opts?: { actor?: string; note?: string }): Promise<boolean> {
  if (!supabase || !threadIds.length) return false
  const { error } = await supabase.rpc('mark_escalations_status', { p_thread_ids: threadIds, p_status: status, p_actor: opts?.actor ?? null, p_note: opts?.note ?? null })
  return !error
}
// Flag/unflag an open quote as "might not come". Reversible; never changes the deal's
// real status — Won/Lost still come from the sheet and email evidence alone.
// Goes through an RPC, not a table update: `opportunities` has RLS enabled with a
// SELECT-only policy, so a direct .update() from the browser silently affects 0 rows.
// The RPC returns the row count so a no-op is reported as a failure, not a fake save.
export async function setOpportunityUnlikely(id: number, unlikely: boolean, opts?: { actor?: string; reason?: string }): Promise<boolean> {
if (!supabase || !id) return false
const { data, error } = await supabase.rpc('set_opportunity_unlikely', {
p_id: id, p_unlikely: unlikely, p_actor: opts?.actor ?? null, p_reason: opts?.reason ?? null,
})
return !error && Number(data) > 0
}
// Call a deal Lost from email evidence (reversible). Writes `email_lost`, NOT `status` —
// the sheet sync rewrites `status` every 30 min, so a direct status write would vanish.
// Same RLS reasoning as setOpportunityUnlikely: an RPC returning the row count, so a
// write that matched nothing is reported as a failure instead of a silent success.
export async function setOpportunityLost(id: number, lost: boolean, opts?: { actor?: string; reason?: string }): Promise<boolean> {
if (!supabase || !id) return false
const { data, error } = await supabase.rpc('set_opportunity_lost', {
p_id: id, p_lost: lost, p_actor: opts?.actor ?? null, p_reason: opts?.reason ?? null,
})
return !error && Number(data) > 0
}
// Confirm a deal as Won from the dashboard (reversible). Writes `email_won`, not `won`,
// so the 30-minute sheet sync can't wipe it. The RPC clears any Lost / "might not come"
// flag on the same deal — the three calls are mutually exclusive by construction.
export async function setOpportunityConfirmed(id: number, confirmed: boolean, opts?: { actor?: string; reason?: string }): Promise<boolean> {
if (!supabase || !id) return false
const { data, error } = await supabase.rpc('set_opportunity_confirmed', {
p_id: id, p_confirmed: confirmed, p_actor: opts?.actor ?? null, p_reason: opts?.reason ?? null,
})
return !error && Number(data) > 0
}

// Remove a client's escalations (false-positive / not actually major). Reversible.
export async function dismissEscalation(threadIds: string[], opts?: { actor?: string; reason?: string }): Promise<boolean> {
  if (!supabase || !threadIds.length) return false
  const { error } = await supabase.rpc('dismiss_escalations', { p_thread_ids: threadIds, p_actor: opts?.actor ?? null, p_reason: opts?.reason ?? null })
  return !error
}

// ---- Delights (clients who shared genuinely great appreciation) ----
// Sourced ONLY from the business/web-revenue sheet's feedback tab (feedback.nature =
// 'Positive'): the curated, substantive testimonials — Tanium, Cohort, Poloko, HexaGroup…
// Deliberately NOT from email_signals, so routine "thanks / looks good / approved"
// praise (ZULU 8, C7, BEGE, Aurelian…) does NOT clutter this board. One card per client;
// the detail lists every testimonial. When the praise lives in a screenshot rather than
// text, `evidence` carries the image link and `project` names the work.
export interface DelightItem { quote?: string; project?: string; evidence?: string; date?: string; type?: string; source?: 'sheet' | 'email'; subject?: string }
export interface Delight {
  company_name: string; geo?: string; count: number
  headline?: string; headline_project?: string; headline_evidence?: string
  items: DelightItem[]; date?: string; client_email?: string
  sheet_count?: number; email_count?: number
}
// Real appreciation as it reads in a client's own email. The bar is deliberately
// narrow: a client saying "looks good", "thanks!" or "approved" is doing their job,
// not paying a compliment, and letting those in is what buried the sheet testimonials
// the first time. Every word here is one a client only writes when they mean it.
// "outstanding" is NOT on the list — in this inbox it means an unpaid invoice far more
// often than praise (YLP Legal, 29 Jul).
const PRAISE_RE = /(brilliant|impressed|amazing|fantastic|excellent|superb|exceptional|delighted|great (work|job|service)|thank you so much|really appreciate|appreciate (your|the) (help|effort|support|work|quick)|above and beyond|best (agency|partner|team)|pleasure to work|top[- ]notch|nailed it|love (it|the))/i
// Clients this board never features, however warm a single line reads. Matched on a
// token so every spelling of the name is covered ("Sprung", "Made by Sprung").
// Sprung — the "Excellent!" was an acknowledgement inside the thread where staging sat
//   exposed, the sync queue ran to 61M rows and the disk went critical. A fix confirmed
//   mid-incident is not a testimonial.
// ScholarStack — "looking forward to working with you again" is a client restarting,
//   which is good news but not praise. ("working with you again" is also off PRAISE_RE
//   now, so no other account can qualify on that line alone.)
const NOT_DELIGHTS = ['sprung', 'scholarstack']
const isNotDelight = (name?: string) => { const k = ckey(name); return !!k && NOT_DELIGHTS.some(n => k.includes(n)) }
export async function getDelights(): Promise<Delight[]> {
  if (!supabase) return []
  const [fbRes, sigRes, clients] = await Promise.all([
    supabase.from('feedback').select('agency, nature, feedback_type, geo, comments, evidence, project_names, client_email, added_date').ilike('nature', 'positive'),
    supabase.from('email_signals').select('company_name, client_email, signal_type, summary, source_subject, source_date').eq('sentiment', 'Positive'),
    getClients(),
  ])
  const geoBy = new Map<string, string>()
  for (const c of clients) { const k = ckey(c.company_name); if (k && c.geo) geoBy.set(k, c.geo) }
  const geoFor = (name?: string, fallback?: string): string => {
    const k = ckey(name)
    if (k && geoBy.has(k)) return geoBy.get(k) as string
    for (const [gk, g] of geoBy) { if (k && gk.length >= 4 && (gk.startsWith(k) || k.startsWith(gk))) return g }
    return fallback || ''
  }
  // Quality bar — only genuinely great appreciation. A row qualifies when it carries the
  // client's actual words (a real comment) OR a real screenshot of their praise (an http
  // evidence link — a Text-Feedback/Clutch capture like Cohort, Nibbleedge, Poloko).
  // Excluded: the auto-logged placeholder "Client appreciation received — positive feedback
  // logged" whose only "evidence" is a "Ref: MEM…" string — that's an internal log line, not
  // the client's words (ZULU 8, Carlotta + Gee, 24/8, Freela, Studio Nash…), i.e. the noise.
  const isGeneric = (c?: string) => /appreciation received|positive feedback logged|feedback logged/i.test(c || '')
  const groups = new Map<string, Delight>()
  for (const f of (fbRes.data as { agency?: string; feedback_type?: string; geo?: string; comments?: string; evidence?: string; project_names?: string; client_email?: string; added_date?: string }[]) || []) {
    const key = ckey(f.agency); if (!key || isNotDelight(f.agency)) continue
    const comment = (f.comments || '').trim()
    const realQuote = comment && !isGeneric(comment) ? comment : ''
    const realEvidence = /^https?:\/\//i.test((f.evidence || '').trim()) ? (f.evidence || '').trim() : ''
    if (!realQuote && !realEvidence) continue   // drop generic auto-logged rows (Ref: MEM…)
    const item: DelightItem = { quote: realQuote || undefined, project: f.project_names || undefined, evidence: realEvidence || undefined, date: (f.added_date || '').slice(0, 10), type: f.feedback_type }
    const g = groups.get(key)
    if (!g) groups.set(key, { company_name: f.agency || '', geo: geoFor(f.agency, f.geo), count: 1, items: [item], date: item.date, client_email: f.client_email || undefined })
    else { g.count++; g.items.push(item); if (!g.geo) g.geo = geoFor(f.agency, f.geo); if (!g.client_email && f.client_email) g.client_email = f.client_email; if ((item.date || '') > (g.date || '')) g.date = item.date }
  }
  const bySheet = new Map([...groups].map(([k, g]) => [k, g.items.length]))
  // Praise read out of the email review — the same appreciation, just never typed into
  // the feedback sheet. Merged into the client's existing card so one company is still
  // one card; the item carries source:'email' and the subject line it came from, so a
  // testimonial can always be traced back to the thread.
  for (const g of (sigRes.data as { company_name?: string; client_email?: string; signal_type?: string; summary?: string; source_subject?: string; source_date?: string }[]) || []) {
    const key = ckey(g.company_name); if (!key || isNotDelight(g.company_name)) continue
    const summary = (g.summary || '').trim()
    if (!PRAISE_RE.test(summary)) continue
    const item: DelightItem = { quote: summary, project: g.source_subject || undefined, date: (g.source_date || '').slice(0, 10), type: g.signal_type, source: 'email', subject: g.source_subject || undefined }
    const ex = groups.get(key)
    if (!ex) groups.set(key, { company_name: g.company_name || '', geo: geoFor(g.company_name), count: 1, items: [item], date: item.date, client_email: g.client_email || undefined })
    else { ex.count++; ex.items.push(item); if (!ex.client_email && g.client_email) ex.client_email = g.client_email; if ((item.date || '') > (ex.date || '')) ex.date = item.date }
  }
  // headline = the strongest testimonial (longest quote); fall back to a screenshot one
  for (const [k, g] of groups) {
    g.items.forEach(i => { if (!i.source) i.source = 'sheet' })
    g.sheet_count = bySheet.get(k) || 0
    g.email_count = g.items.length - g.sheet_count
  }
  for (const g of groups.values()) {
    // A curated sheet testimonial always outranks an email summary for the headline —
    // it's the client's polished words, whereas an email item is our own write-up of
    // the thread. Email only carries the headline when the sheet has nothing.
    const byLen = (a: DelightItem, b: DelightItem) => (b.quote?.length || 0) - (a.quote?.length || 0)
    const quoted = g.items.filter(i => i.quote)
    const withQuote = [...quoted.filter(i => i.source !== 'email').sort(byLen), ...quoted.filter(i => i.source === 'email').sort(byLen)]
    const pick = withQuote[0] || g.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    g.headline = pick?.quote; g.headline_project = pick?.project; g.headline_evidence = pick?.evidence
  }
  return [...groups.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

// `pc_sme` (col H) and `project_type` (col I) are what the PM scorecard's Q2C
// reads: the Q2C% for PM tab counts quotes whose Project Type is New Development,
// which is a far larger and more meaningful set than the Business Type column
// (432 rows against 74). getQuotes() selects '*', so both already come back.
export interface Quote { id: number; quote_id?: string; added_date?: string; agency?: string; usd_value?: number; status?: string; business_type?: string; geo?: string; sales_person?: string; confirmed_in_days?: number; technology?: string; client_email?: string; pc_sme?: string; project_type?: string; subject_project?: string }
export interface QuoteConversion { id: number; company_name?: string; outcome?: string; lost_reason?: string; amount_usd?: number; decided_at?: string }
export interface SqlLead { id: number; month?: string; year?: number; venture?: string; industry?: string; persona?: string; company_name?: string; prospect_region?: string; assigned_to?: string; lead_date?: string }
export interface Escalation { id: number; company_name?: string; geo?: string; situation_type?: string; escalation_type?: string; business_impact?: string; month?: string; week?: string; email_subject?: string; tracking_date?: string; project_name?: string; reference_id?: string; deal_type?: string; service_type?: string; link?: string; source?: string; raised_by?: string; evidence?: string; source_sender?: string; source_date?: string }

// The source Google Sheet's header row sometimes lands in the synced data as a
// real row (e.g. company_name = "Company Name", escalation_type = "Escalation
// Type"). Drop any row whose fields literally repeat the column titles.
const eq = (a: string | undefined, b: string) => (a || '').trim().toLowerCase() === b
const has = (a: string | undefined, b: string) => (a || '').trim().toLowerCase().includes(b)
// The source sheet's header/instruction rows sometimes land as data. Match them even
// when the columns are drifted by one (e.g. company_name="Business Unit",
// geo="Company Name", situation_type="Which is the missing word as per you").
const isEscalationHeaderRow = (e: Escalation) =>
  eq(e.company_name, 'company name') || eq(e.escalation_type, 'escalation type') ||
  eq(e.situation_type, 'type of situation') || eq(e.business_impact, 'business impact') ||
  eq(e.email_subject, 'email subject line') ||
  eq(e.raised_by, 'name') || eq(e.month, 'month') || eq(e.geo, 'company name') ||
  eq(e.company_name, 'business unit') || eq(e.business_impact, 'escalation type') ||
  has(e.situation_type, 'missing word') || has(e.email_subject, 'deal type/client category')
const isSqlHeaderRow = (s: SqlLead) =>
  eq(s.company_name, 'company name') || eq(s.industry, 'industry') ||
  eq(s.persona, 'persona') || eq(s.venture, 'venture')

export async function getQuotes(): Promise<Quote[]> { const l = await read<Quote>('quotes'); return l && l.length ? l : (await import('./mockData')).mockQuotes }
export async function getConversions(): Promise<QuoteConversion[]> { const l = await read<QuoteConversion>('quote_conversions'); return l && l.length ? l : (await import('./mockData')).mockConversions }
export async function getSqlLeads(): Promise<SqlLead[]> { const l = await read<SqlLead>('sql_leads'); const rows = l?.filter(s => !isSqlHeaderRow(s)); return rows && rows.length ? rows : (await import('./mockData')).mockSqlLeads }
export async function getEscalations(): Promise<Escalation[]> { const l = await read<Escalation>('escalations', 'id, company_name, geo, situation_type, escalation_type, business_impact, month, week, email_subject, tracking_date, project_name, reference_id, deal_type, service_type, link, source, raised_by, evidence, source_sender, source_date'); const rows = l?.filter(e => !isEscalationHeaderRow(e)); return rows && rows.length ? rows : (await import('./mockData')).mockEscalations }

// ---------------------------------------------------------------------------
// Learning & Development (Operations → L&D)
// ---------------------------------------------------------------------------
// One row per learner per weekly snapshot, loaded by the `sync-lnd` edge function.
// The sheet's own "Overall Progress" column is NOT trusted: its definition changed
// between the 21 Jul and 29 Jul 2026 snapshots (in-progress modules began counting
// as half), which made nine learners appear to advance without completing a single
// module. It is stored as `sheet_progress` for audit and never displayed. Every
// figure on the page is derived here from the raw counts.
export interface LndRow {
  id: number
  snapshot_date: string
  // Canonical identity. `learner_name` is the short name the weekly summary tab
  // happens to use and it is NOT stable — the sheet renamed two people mid-programme
  // ("Divya Arora" -> "Arora Anilkumar", "Ketul Gajera" -> "Gajera Harsukhlal"), which
  // split each of them into two learners. Always key and display on these two.
  learner_key?: string | null
  learner_full_name?: string | null
  level: string
  learner_name: string
  reporting_manager?: string | null
  total_modules: number
  completed: number
  in_progress: number
  not_started: number
  sheet_progress?: number | null
  last_activity?: string | null
  remarks?: string | null
}

// Credited progress — in-progress modules count as half. This is the agreed
// definition; `strictPct` is the completed-only figure shown alongside it.
export const creditedPct = (r: Pick<LndRow, 'completed' | 'in_progress' | 'total_modules'>) =>
  r.total_modules > 0 ? ((r.completed + 0.5 * r.in_progress) / r.total_modules) * 100 : 0
export const strictPct = (r: Pick<LndRow, 'completed' | 'total_modules'>) =>
  r.total_modules > 0 ? (r.completed / r.total_modules) * 100 : 0

export async function getLnd(): Promise<LndRow[]> {
  const l = await read<LndRow>(
    'lnd_snapshots',
    'id, snapshot_date, level, learner_name, learner_key, learner_full_name, reporting_manager, total_modules, completed, in_progress, not_started, sheet_progress, last_activity, remarks',
  )
  return l || []
}

// One row per learner per assigned course, from the level tabs of the mastersheet.
export interface LndModule {
  id: number
  learner_key?: string | null
  learner_full_name: string
  user_id?: string | null
  email?: string | null
  sub_department?: string | null
  level?: string | null
  track?: string | null
  stream?: string | null
  course: string
  // The Pre-Assessment is the programme's entry gate, not a course. The sheet lists
  // it as a module, so leaving it in overstates learning: 23 of the cohort's 40
  // completions are this one row. Flagged in Postgres so it can be reported apart.
  is_assessment?: boolean | null
  status?: string | null
  completion_pct?: number | null
  is_complete?: boolean | null
  started_on?: string | null
  last_accessed_on?: string | null
  completed_on?: string | null
}

export async function getLndModules(): Promise<LndModule[]> {
  const l = await read<LndModule>(
    'lnd_modules',
    'id, learner_key, learner_full_name, user_id, email, sub_department, level, track, stream, course, is_assessment, status, completion_pct, is_complete, started_on, last_accessed_on, completed_on',
  )
  return l || []
}

// How fast quotes actually close, from the Quotes tab's own days-to-confirm column.
// This is what lets the AI Insights panel argue that an ageing deal is stale from
// evidence rather than from a threshold someone picked: if nine in ten confirmed
// quotes land inside N days, a deal sitting at 20N is not "in progress".
export async function getQuoteCloseSpeed(): Promise<{ median: number; p90: number; n: number } | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('quotes').select('confirmed_in_days').not('confirmed_in_days', 'is', null)
  if (error || !data) return null
  const days = data
    .map((r: any) => Number(r.confirmed_in_days))
    .filter((n: number) => Number.isFinite(n) && n >= 0 && n < 400)
    .sort((a: number, b: number) => a - b)
  if (days.length < 30) return null
  const at = (q: number) => days[Math.min(days.length - 1, Math.floor(days.length * q))]
  return { median: at(0.5), p90: at(0.9), n: days.length }
}

// ---------------------------------------------------------------------------
// Historical revenue (pre-FY25-26), loaded from the yearly spreadsheets listed
// in revenue_sources. Deliberately separate from web_revenue — see
// supabase/migrations/010_revenue_history.sql for why.
// ---------------------------------------------------------------------------
export interface RevenueHistoryRow {
  id: number; source_key: string; company_name: string; booking_month: string
  booking_amount: number; engagement_model?: string; technology?: string; service_dept?: string
  geo?: string; project_id?: string; project_status?: string; client_name?: string
}
export interface RevenueSource {
  key: string; label: string; csv_url: string; enabled: boolean; immutable: boolean
  last_synced_at?: string; last_rows?: number; last_total?: number; last_message?: string
}
// `id` is the stable ordering column the paginator needs — this table is well
// over the 1000-row page cap.
export async function getRevenueHistory(): Promise<RevenueHistoryRow[]> {
  return (await read<RevenueHistoryRow>('revenue_history',
    'id, source_key, company_name, booking_month, booking_amount, engagement_model, technology, service_dept, geo, project_id, project_status, client_name',
    'id')) || []
}
export async function getRevenueSources(): Promise<RevenueSource[]> {
  return (await read<RevenueSource>('revenue_sources',
    'key, label, csv_url, enabled, immutable, last_synced_at, last_rows, last_total, last_message', 'key')) || []
}

// ---- Entering and confirming a deal from the dashboard ---------------------
//
// From 1 Oct 2026 the dashboard is where a deal exists, so these two calls are the
// entry point rather than the Quotes tab. Both go through SECURITY DEFINER RPCs that
// take the actor from the Google JWT, NOT from an argument — the client cannot claim
// to be somebody else, and it cannot talk its way past the rules by calling the REST
// API directly. Everything below is a convenience wrapper; the database is the guard.
//
// They return an `error` STRING rather than a boolean, because the useful information
// is in the refusal: "still missing: Geography, Project type" is what the person has
// to act on, and a bare false would throw it away.

export type PmTeam = 'LP/HUB' | 'WEB-AU' | 'WEB-UK' | 'WEB-US'
export interface DirectoryMember { email: string; name: string; slug: string; team: PmTeam | null; aliases: string[]; active: boolean }

/** The signed-in person's directory row, or null if they are not on it. */
export async function getDirectoryMember(email?: string | null): Promise<DirectoryMember | null> {
  if (!supabase || !email) return null
  const { data, error } = await supabase.from('pm_directory')
    .select('email, name, slug, team, aliases, active')
    .eq('email', email.trim().toLowerCase()).eq('active', true).maybeSingle()
  if (error || !data) return null
  return data as DirectoryMember
}

// Mirror of directory_owner_match() in the database, for deciding whether to SHOW the
// confirm button. One cell can name several people ("Malav Modi / Kalgi Shah"), so it
// is split on the same separators lib/nbd.ts uses and each part matched exactly.
// Substring matching is what the aliases exist to avoid: 'Rahul Kaushal' must never
// match Rahul Jain.
const ownerParts = (s?: string) => (s || '').split(/[,/&]|\band\b/i).map(x => x.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
export const ownerMatches = (cell: string | undefined, aliases: string[]) =>
  ownerParts(cell).some(p => aliases.includes(p))

/**
 * May this person confirm this deal, as far as the browser can tell?
 *
 * A PM is named in pm_owner. Admins may confirm anything. `team` is a pod label for
 * grouping the team and has no part in this.
 *
 * THIS IS FOR SHOWING THE BUTTON ONLY. The same rule is enforced in the database and
 * that is the one that counts — this copy just avoids offering an action that would
 * be refused.
 */
export function canConfirmLocally(o: Opportunity, me: DirectoryMember | null, isAdmin: boolean): boolean {
  if (isAdmin) return true
  if (!me) return false
  return ownerMatches(o.pm_owner, me.aliases)
}

export interface NewOpportunity {
  company: string; channel?: string; est_value?: number | null; currency?: string
  quote_date?: string | null; service_dept?: string; project_type?: string
  technology?: string; business_type?: string; sales_person?: string
  pm_owner?: string; geo?: string; subject?: string; note?: string; force?: boolean
  contact_email?: string
}

/** Create a deal by hand. Returns its id, or the database's own refusal message. */
export async function addOpportunity(v: NewOpportunity): Promise<{ id?: number; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { data, error } = await supabase.rpc('add_opportunity', {
    p_company: v.company, p_channel: v.channel ?? null,
    p_est_value: v.est_value ?? null, p_currency: v.currency ?? 'USD',
    p_quote_date: v.quote_date || null, p_service_dept: v.service_dept ?? null,
    p_project_type: v.project_type ?? null, p_technology: v.technology ?? null,
    p_business_type: v.business_type ?? null, p_sales_person: v.sales_person ?? null,
    p_pm_owner: v.pm_owner ?? null, p_geo: v.geo ?? null,
    p_subject: v.subject ?? null, p_note: v.note ?? null, p_force: v.force ?? false,
    p_contact_email: v.contact_email ?? null,
  })
  if (error) return { error: error.message }
  return { id: Number(data) }
}

export interface ConfirmFields {
  est_value?: number | null; currency?: string; quote_date?: string | null
  service_dept?: string; project_type?: string; sales_person?: string
  pm_owner?: string; geo?: string; confirmed_on?: string | null; note?: string
  /** The project title. Editable at confirm time because an email-sourced deal inherits
   *  the mail's subject line, which is rarely what the project should be called. */
  subject?: string
  // The revenue sheet's columns. Every one of these is prefilled from the client's own
  // history before the PM sees it, so confirming is a check rather than a form fill.
  client_name?: string; client_type?: string; service_type?: string; delivery_type?: string
  technology?: string; contact_email?: string; business_type?: string
  quote_price?: number | null; start_date?: string | null; delivery_date?: string | null
  delivery_status?: string
  /** The sheet's human-facing labels. Not quote_key, which is this row's identity. */
  project_id?: string; quote_id?: string
  /** Who built it. 'Contractor' means outsourced, and then the three below apply. */
  expert?: string; contractor_name?: string
  outsource_price?: number | null; outsource_currency?: string
}

/**
 * Fill the gaps and confirm, in ONE call, so a form that fails halfway cannot leave a
 * deal half-completed. `missing` comes back parsed when the completeness gate refuses,
 * so the form can tick off exactly what is still needed.
 */
export async function confirmOpportunityFull(id: number, f: ConfirmFields): Promise<{ ok: boolean; error?: string; missing?: string[] }> {
  if (!supabase || !id) return { ok: false, error: 'Supabase not configured' }
  const { error } = await supabase.rpc('confirm_opportunity', {
    p_id: id, p_est_value: f.est_value ?? null, p_currency: f.currency ?? null,
    p_quote_date: f.quote_date || null, p_service_dept: f.service_dept ?? null,
    p_project_type: f.project_type ?? null, p_sales_person: f.sales_person ?? null,
    p_pm_owner: f.pm_owner ?? null, p_geo: f.geo ?? null,
    p_confirmed_on: f.confirmed_on || null, p_note: f.note ?? null,
    p_subject: f.subject ?? null,
    p_client_name: f.client_name ?? null, p_client_type: f.client_type ?? null,
    p_service_type: f.service_type ?? null, p_delivery_type: f.delivery_type ?? null,
    p_technology: f.technology ?? null, p_contact_email: f.contact_email ?? null,
    p_quote_price: f.quote_price ?? null, p_start_date: f.start_date || null,
    p_delivery_date: f.delivery_date || null, p_delivery_status: f.delivery_status ?? null,
    p_business_type: f.business_type ?? null,
    p_project_id: f.project_id ?? null, p_quote_id: f.quote_id ?? null,
    p_expert: f.expert ?? null, p_contractor_name: f.contractor_name ?? null,
    p_outsource_price: f.outsource_price ?? null, p_outsource_currency: f.outsource_currency ?? null,
  })
  if (!error) return { ok: true }
  const m = /still missing:\s*(.+)$/.exec(error.message)
  return { ok: false, error: error.message, missing: m ? m[1].split(',').map(x => x.trim()) : undefined }
}

/** What this deal still needs before it can be confirmed. Empty = ready. */
export async function opportunityMissingFields(id: number): Promise<string[]> {
  if (!supabase || !id) return []
  const { data, error } = await supabase.rpc('opportunity_missing_fields', { p_id: id })
  if (error || !data) return []
  return data as string[]
}

export interface DuplicateHit { id: number; company_name?: string; est_value?: number; status?: string; origin?: string; source_date?: string; why: string }

/**
 * Deals that might already be this one. ADVISORY — it warns, it never blocks.
 *
 * The broad "similar value" arm is here because an email-sourced deal is usually named
 * for the end client while a hand-entered one is named for the agency, so the names
 * differ on exactly the duplicates worth catching. That is a judgement for a human,
 * which is why it warns rather than refusing; only same-client-and-value is a hard stop.
 */
export async function findPossibleDuplicates(company: string, estValue?: number | null): Promise<DuplicateHit[]> {
  if (!supabase || !company.trim()) return []
  const { data, error } = await supabase.rpc('find_possible_duplicates', { p_company: company, p_est_value: estValue ?? null })
  if (error || !data) return []
  return data as DuplicateHit[]
}

// ---- Managing the PM directory (Settings) ---------------------------------
//
// Writes go straight at the table rather than through an RPC, because the RLS
// policy on pm_directory already does the work: reads for any signed-in user,
// writes only where is_dashboard_admin() passes against the Google JWT. A
// non-admin's insert affects zero rows and returns an error, which is exactly
// the behaviour an RPC would have given us.
//
// This is an AUTHORISATION table — anyone who can add a row can grant themselves
// the right to confirm somebody else's revenue — so it is deliberately as tightly
// held as dashboard_admins.

export async function listDirectory(): Promise<DirectoryMember[]> {
  if (!supabase) return []
  const { data } = await supabase.from('pm_directory')
    .select('email, name, slug, team, aliases, active')
    .order('team', { ascending: true }).order('name', { ascending: true })
  return (data as DirectoryMember[]) || []
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Add somebody to the directory.
 *
 * Aliases are the spellings this person appears under in the free-text owner
 * columns, and they are what decides whose deals somebody may confirm. They are
 * matched EXACTLY, never as substrings, which is why a bare first name is worth
 * thinking twice about: two people here share one, and a careless alias hands one
 * person's deals to the other.
 */
export async function addDirectoryMember(m: { email: string; name: string; team: PmTeam | null; aliases: string[]; note?: string }, addedBy: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const email = m.email.trim().toLowerCase()
  const aliases = m.aliases.map(a => a.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
  if (!email || !m.name.trim()) return { error: 'Name and email are both required.' }
  if (!aliases.length) return { error: 'At least one alias is needed, or none of their deals will match them.' }
  const { error } = await supabase.from('pm_directory').insert({
    email, name: m.name.trim(), slug: slugify(m.name), team: m.team || null,
    aliases, active: true, added_by: addedBy, note: m.note || null,
  })
  return error ? { error: error.message } : {}
}

export async function updateDirectoryMember(email: string, patch: Partial<{ name: string; team: PmTeam | null; aliases: string[]; active: boolean }>): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const body: any = { ...patch }
  if (patch.aliases) body.aliases = patch.aliases.map(a => a.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
  if (patch.name) body.slug = slugify(patch.name)
  const { error } = await supabase.from('pm_directory').update(body).eq('email', email.trim().toLowerCase())
  return error ? { error: error.message } : {}
}

/**
 * Remove somebody. Deactivating is usually the better move for a leaver: their
 * past deals keep a resolvable owner for the audit trail, and nothing they ever
 * confirmed becomes unattributable.
 */
export async function removeDirectoryMember(email: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { error } = await supabase.from('pm_directory').delete().eq('email', email.trim().toLowerCase())
  return error ? { error: error.message } : {}
}

/** How many live deals this person is named on — what they would lose if deactivated. */
export async function directoryMemberDealCount(m: DirectoryMember): Promise<number> {
  if (!supabase) return 0
  const { data } = await supabase.from('opportunities').select('id, pm_owner').eq('won', false)
  if (!data) return 0
  return (data as any[]).filter(r => ownerMatches(r.pm_owner, m.aliases)).length
}

// ---- The work list --------------------------------------------------------
//
// Everything the system can derive, it derives. What it cannot is a number nobody has
// written down and a decision nobody has made — so exactly those two things come back
// to a person, plus deals somebody started confirming and never finished.
//
// The reasons are ranked in the database and each deal appears ONCE, under its most
// urgent reason. A deal that is both missing a value and awaiting confirmation is one
// piece of work, not two, and listing it twice would make the queue look worse than it
// is while teaching people to skim it.

export type NeedsReason = 'confirm_started' | 'awaiting_confirmation' | 'missing_value'
export interface NeedsInputRow {
  id: number; company_name?: string; est_value?: number; currency?: string
  status?: string; origin?: string; pm_owner?: string; sales_person?: string
  deal_date?: string; owner_email?: string | null; days_waiting: number
  reason: NeedsReason; detail: string; priority: number
}

export async function getNeedsInput(): Promise<NeedsInputRow[]> {
  if (!supabase) return []
  const { data } = await supabase.from('web_needs_input').select('*').order('priority').order('days_waiting', { ascending: false })
  return (data as NeedsInputRow[]) || []
}

// ---- Currency ------------------------------------------------------------
//
// est_value is USD everywhere in this dashboard. A quote raised in GBP and stored raw
// would overstate the pipeline by a third, so the local figure lives in local_value and
// est_value holds the conversion. Rates are held in the database rather than hard-coded
// because they move, and a rate nobody can change without a deploy is a rate that goes
// stale silently.

export interface FxRate { currency: string; rate_to_usd: number; updated_at?: string; updated_by?: string }

export async function getFxRates(): Promise<FxRate[]> {
  if (!supabase) return []
  const { data } = await supabase.from('fx_rates').select('*').order('currency')
  return (data as FxRate[]) || []
}

export async function saveFxRate(currency: string, rate: number, updatedBy: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  if (!(rate > 0)) return { error: 'A rate has to be greater than zero.' }
  const { error } = await supabase.from('fx_rates')
    .upsert({ currency: currency.trim().toUpperCase(), rate_to_usd: rate, updated_by: updatedBy, updated_at: new Date().toISOString() })
  return error ? { error: error.message } : {}
}

export async function deleteFxRate(currency: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { error } = await supabase.from('fx_rates').delete().eq('currency', currency.trim().toUpperCase())
  return error ? { error: error.message } : {}
}

/** Convert with a rate table already loaded, for a live preview while typing. */
export const toUsd = (amount: number | null | undefined, currency: string | undefined, rates: FxRate[]): number | null => {
  if (amount == null || Number.isNaN(amount)) return null
  const c = (currency || 'USD').trim().toUpperCase()
  // 'EURO' appears in older sheet rows; it means EUR.
  const key = c === 'EURO' ? 'EUR' : c
  const r = rates.find(x => x.currency.toUpperCase() === key)?.rate_to_usd
  return Math.round(amount * (r ?? 1) * 100) / 100
}

// ---- Client memory --------------------------------------------------------
//
// What we already know about a client, so nobody retypes it. Everything here is read
// back from the client's own history — their last deal and their revenue rows — rather
// than guessed, which is why the form can fill six fields from three characters.
//
// Loaded once when the form opens and filtered in the browser. A round trip per
// keystroke would be slower and no more accurate; the list is small enough that holding
// it is cheaper than fetching it repeatedly.

export interface ClientDefaults {
  client_key: string; company_name: string; currency?: string; geo?: string
  sales_person?: string; pm_owner?: string; technology?: string; service_dept?: string
  project_type?: string; contact_email?: string
  deals: number; booking_months: number; lifetime_usd?: number
  last_seen?: string; is_existing_client: boolean
}

export async function getClientDefaults(): Promise<ClientDefaults[]> {
  if (!supabase) return []
  const { data } = await supabase.from('web_client_defaults').select('*')
  return (data as ClientDefaults[]) || []
}

/**
 * Clients matching what has been typed. Three characters minimum — below that almost
 * everything matches and the list is noise rather than help.
 *
 * A match at the START of the name outranks one in the middle, then longer-standing
 * clients come first, so typing "hex" puts HexaGroup at the top rather than some company
 * with "hex" buried in it.
 */
export function searchClients(all: ClientDefaults[], q: string, limit = 8): ClientDefaults[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < 3) return []
  return all
    .filter(c => c.client_key.includes(needle))
    .sort((a, b) => {
      const as = a.client_key.startsWith(needle) ? 0 : 1
      const bs = b.client_key.startsWith(needle) ? 0 : 1
      if (as !== bs) return as - bs
      return (b.booking_months + b.deals) - (a.booking_months + a.deals)
    })
    .slice(0, limit)
}

// ---- Recurring work (the Project sheet) -----------------------------------
//
// Dedicated and retainer clients bill every month for the same thing. Nobody should
// retype them, and nothing should book them automatically either: one dedicated client
// in this data billed steadily for nine months and then stopped, and auto-confirming
// would have invented nine months of revenue that looked exactly like the real thing.
//
// So each month is one deliberate click, carrying last month's figure forward.

export interface RecurringMonthRow {
  recurring_id: number; company_name: string; monthly_value?: number; currency?: string
  engagement_model?: string; service_dept?: string; technology?: string; geo?: string
  pm_owner?: string; sales_person?: string; active: boolean
  paused_at?: string; pause_reason?: string; start_month?: string; end_month?: string
  owner_email?: string | null
  draft_id?: number | null; draft_month?: string | null
  state?: 'pending' | 'confirmed' | 'dismissed' | null
  draft_amount?: number | null; opportunity_id?: number | null
  decided_by?: string | null; decided_at?: string | null
  suggested_amount?: number
}

export async function getRecurringMonth(): Promise<RecurringMonthRow[]> {
  if (!supabase) return []
  const { data } = await supabase.from('web_recurring_month').select('*').order('company_name')
  return (data as RecurringMonthRow[]) || []
}

/** Book one month of a retainer. Creates the month if it does not exist, then confirms it. */
export async function addRecurringMonth(recurringId: number, month: string, amount?: number | null, note?: string): Promise<{ id?: number; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { data, error } = await supabase.rpc('add_recurring_month', {
    p_recurring_id: recurringId, p_month: month, p_amount: amount ?? null, p_note: note ?? null,
  })
  if (error) return { error: error.message }
  return { id: Number(data) }
}

export interface RecurringDeal {
  id?: number; company_name: string; monthly_value?: number | null; currency?: string
  engagement_model?: string; service_dept?: string; technology?: string; geo?: string
  pm_owner?: string; sales_person?: string; start_month: string; end_month?: string | null
  active?: boolean; note?: string
}

export async function saveRecurringDeal(d: RecurringDeal, actor: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const body = { ...d, created_by: actor }
  const { error } = d.id
    ? await supabase.from('recurring_deals').update(body).eq('id', d.id)
    : await supabase.from('recurring_deals').insert(body)
  return error ? { error: error.message } : {}
}

// ---- The month's entries, in revenue-sheet shape ---------------------------
//
// Deliberately the same columns, in the same order, as the revenue sheet: company,
// contact, department, engagement model, technology, GEO, PM, AM, date, amount. The
// sheet becomes a dump of this rather than the other way round, so matching its shape is
// what makes the two comparable while both exist.

export interface ProjectSheetRow {
  id: number; company_name?: string; contact_email?: string; service_dept?: string
  project_type?: string; technology?: string; geo?: string; pm_owner?: string
  sales_person?: string; confirmed_at?: string; est_value?: number
  local_value?: number; currency?: string; source_subject?: string; origin?: string
}

/** Everything confirmed in the given month (YYYY-MM). */
export async function getProjectSheet(month: string): Promise<ProjectSheetRow[]> {
  if (!supabase) return []
  const start = `${month}-01`
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1).toISOString().slice(0, 10)
  const { data } = await supabase.from('opportunities')
    .select('id, company_name, contact_email, service_dept, project_type, technology, geo, pm_owner, sales_person, confirmed_at, est_value, local_value, currency, source_subject, origin')
    .eq('won', true).gte('confirmed_at', start).lt('confirmed_at', end)
    .order('company_name')
  return (data as ProjectSheetRow[]) || []
}

/**
 * Copy a revenue-sheet line into a month.
 *
 * It does NOT write to web_revenue — that table is full-replaced on every sync, so a row
 * added there vanishes within half an hour. The copy becomes a confirmed entry in our own
 * record, which is what the Project sheet shows.
 */
export async function duplicateBookingToMonth(bookingId: number, month: string, amount?: number | null, note?: string): Promise<{ id?: number; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { data, error } = await supabase.rpc('duplicate_booking_to_month', {
    p_booking_id: bookingId, p_month: `${month}-01`, p_amount: amount ?? null, p_note: note ?? null,
  })
  if (error) return { error: error.message }
  return { id: Number(data) }
}

// ---- The Web, Hub & LP ledger ---------------------------------------------
//
// The sheet's own lines and everything confirmed in the dashboard, in one list with a
// column saying which is which. They lived on two pages first, which was the wrong shape:
// reconciling a month means reading one list, not cross-referencing two.

export interface LedgerRow {
  // 'raw' is a line of the Web, Hub & LP tab itself; 'dashboard' is one confirmed
  // here. ('sheet' was the old web_revenue aggregate and no longer appears.)
  // For a sheet line, source_id is the SHEET'S OWN ROW NUMBER, not a sheet_raw id:
  // sheet_raw is replaced wholesale on every sync and its ids are reassigned within the
  // hour. sheet_raw_id is that live id, carried for the one thing that still needs it —
  // duplicating a row into next month, which acts on this minute's snapshot.
  row_key: string; source: 'raw' | 'sheet' | 'dashboard'; source_id: number
  sheet_raw_id?: number
  company_name?: string; project_name?: string; contact_email?: string
  service_dept?: string; engagement_model?: string; technology?: string; geo?: string
  pm_owner?: string; sales_person?: string; booking_month?: string
  amount_usd?: number; local_value?: number; currency?: string
  in_sheet: boolean; confirmed_at?: string; confirmed_by?: string
  // The rest of the revenue sheet's columns. Sheet-side rows carry null for the ones
  // web_revenue never stored — the values are in the source spreadsheet and the
  // dashboard has never held them, so a blank here means "not here", not "empty".
  project_id?: string; quote_id?: string
  client_name?: string; client_type?: string; service_type?: string; delivery_type?: string
  delivery_status?: string; start_date?: string; delivery_date?: string
  expert?: string; internal_delivery?: string; internal_hrs?: number; actual_hrs?: number
  integration?: string; quote_price?: number; outsource_price?: number
  invoice_no?: string; invoice_currency?: string; invoice_amount?: number
  business_type?: string
  // An outsourced build: who did it, and what it cost in outsource_currency.
  contractor_name?: string; outsource_currency?: string
}

/**
 * The columns somebody fills in after the deal is won — delivery's and finance's.
 *
 * Every field is optional and undefined means LEAVE ALONE, so a form that sends three
 * of them cannot blank the other nine. An empty string clears a text field.
 */
export interface ProjectFieldEdits {
  project_id?: string; quote_id?: string; expert?: string
  internal_delivery?: string | null; internal_hrs?: number | null; actual_hrs?: number | null
  integration?: string; outsource_price?: number | null
  invoice_no?: string; invoice_currency?: string; invoice_amount?: number | null
  feedback_status?: string; delivery_status?: string
  delivery_date?: string | null; start_date?: string | null
  contractor_name?: string; outsource_currency?: string
}

/**
 * Save those later-known fields. The RPC can reach these columns and no others — not the
 * value, not the owner, not whether the deal is won — so a row already booked as revenue
 * cannot be quietly repriced from a grid.
 */
export async function updateProjectFields(id: number, f: ProjectFieldEdits): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || !id) return { ok: false, error: 'Supabase not configured' }
  const t = (v?: string) => v === undefined ? null : v
  const n = (v?: number | null) => v ?? null
  const { error } = await supabase.rpc('update_project_fields', {
    p_id: id,
    p_project_id: t(f.project_id), p_quote_id: t(f.quote_id), p_expert: t(f.expert),
    p_internal_delivery: f.internal_delivery || null,
    p_internal_hrs: n(f.internal_hrs), p_actual_hrs: n(f.actual_hrs),
    p_integration: t(f.integration), p_outsource_price: n(f.outsource_price),
    p_invoice_no: t(f.invoice_no), p_invoice_currency: t(f.invoice_currency),
    p_invoice_amount: n(f.invoice_amount), p_feedback_status: t(f.feedback_status),
    p_delivery_status: t(f.delivery_status),
    p_delivery_date: f.delivery_date || null, p_start_date: f.start_date || null,
    p_contractor_name: t(f.contractor_name), p_outsource_currency: t(f.outsource_currency),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function getProjectLedger(): Promise<LedgerRow[]> {
  return (await read<LedgerRow>('web_project_ledger', '*', 'row_key')) || []
}

/** Copy one ledger line into a month, whichever side it came from. */
export async function copyRowToMonth(source: string, id: number, month: string, amount?: number | null): Promise<{ id?: number; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { data, error } = await supabase.rpc('copy_row_to_month', {
    p_source: source, p_id: id, p_month: `${month}-01`, p_amount: amount ?? null,
  })
  if (error) return { error: error.message }
  return { id: Number(data) }
}

// ---- The revenue sheet as a source of answers -----------------------------
//
// Two lookups that exist so a PM confirming a deal is CHECKING fields rather than
// filling them in: what the sheet's columns are allowed to contain, and what this
// particular client's last project said. 403 of the 405 clients in the sheet can supply
// all five of the fields the dialog newly asks for.


export type SheetVocab = Record<SheetVocabField, string[]>

/**
 * Dropdown options, in order of how often the sheet actually uses them — so the option
 * on 97% of rows sits at the top of the list rather than alphabetically in the middle.
 *
 * Falls back to a short hard-coded list rather than an empty dropdown: a select with no
 * options would make the deal unconfirmable, which is a worse failure than a short list.
 */
export async function getSheetVocab(): Promise<SheetVocab> {
  const out = { ...VOCAB_FALLBACK } as SheetVocab
  if (!supabase) return out
  const { data, error } = await supabase.from('web_sheet_vocab').select('field, value, uses')
  if (error || !data?.length) return out
  const byField: Record<string, { value: string; uses: number }[]> = {}
  for (const r of data as any[]) (byField[r.field] ||= []).push({ value: r.value, uses: Number(r.uses) })
  for (const k of Object.keys(byField)) {
    out[k as SheetVocabField] = byField[k].sort((a, b) => b.uses - a.uses).map(x => x.value)
  }
  // Business type is the one field whose sheet spellings are folded rather than taken as
  // given: Repeat, New Repeat and Existing all mean a client who has bought before, and
  // the split was two people typing rather than a distinction anybody uses. Deduped after
  // folding so the dropdown does not offer Repeat twice.
  out.business_type = Array.from(new Set((out.business_type || []).map(normBusinessType).filter(Boolean)))
  return out
}

export interface SheetClientDefaults {
  client_key: string; company_name?: string; client_name?: string; client_email?: string
  client_type?: string; service_type?: string; delivery_type?: string; technology?: string
  geo?: string; currency?: string; service_dept?: string; project_type?: string
  pc_sme?: string; sales_person?: string; sheet_projects: number
}

/**
 * What the sheet already knows about every client, keyed on the lower-cased Agency name.
 *
 * Fetched as a map rather than a per-deal query because the confirm dialog is opened from
 * list pages where several deals may be confirmed in a row — one fetch, then every dialog
 * opens instantly.
 */
export async function getSheetClientDefaults(): Promise<Record<string, SheetClientDefaults>> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('web_sheet_client_defaults').select('*')
  if (error || !data) return {}
  const map: Record<string, SheetClientDefaults> = {}
  for (const r of data as SheetClientDefaults[]) map[r.client_key] = r
  return map
}

/** The sheet's entry for one company, matched the way the view is keyed. */
export function sheetDefaultsFor(
  map: Record<string, SheetClientDefaults>, company?: string,
): SheetClientDefaults | undefined {
  const k = (company || '').trim().toLowerCase()
  return k ? map[k] : undefined
}

/**
 * The dashboard's short geo code for whatever the sheet wrote.
 *
 * The sheet says 'US/Canada', the dashboard stores 'US'. Matching on a prefix would be
 * wrong in both directions here, so the regions are matched explicitly and anything
 * unrecognised comes back undefined rather than guessed — a wrong geo is worse than none,
 * because it is silently wrong on every regional total.
 */
export function geoCodeFromSheet(v?: string): string | undefined {
  const s = (v || '').trim().toLowerCase()
  if (!s) return undefined
  if (s.startsWith('us')) return 'US'
  if (s.startsWith('uk') || s.startsWith('eu')) return 'UK'
  if (s.startsWith('au') || s.startsWith('nz')) return 'AU'
  if (s.startsWith('other')) return 'Other'
  return undefined
}

// ---- Managed lists: who builds the work ------------------------------------
//
// The experts and the contractors, held in one table because they are the same shape and
// the same person maintains both. Read by everyone, changed only by admins, from
// Settings — a list that needs a deploy to change is a list that goes stale.

export const CONTRACTOR = 'Contractor'

export interface PickItem { kind: 'expert' | 'contractor'; value: string; sort: number; active: boolean }

/**
 * Active entries of one list, A-Z.
 *
 * Alphabetical rather than a curated order: this is a list of people you scan for one
 * name, and the only ordering that helps is the one where you already know where to look.
 * Sorting happens here, in the browser's own collator, so accents and case behave the way
 * a reader expects rather than the way byte order does.
 */
export async function getPickList(kind: 'expert' | 'contractor'): Promise<string[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('pick_lists')
    .select('value').eq('kind', kind).eq('active', true)
  if (error || !data) return []
  return (data as any[]).map(r => r.value).sort((a, b) => a.localeCompare(b))
}

/** Every entry including the retired ones — Settings needs to see what it can turn back on. */
export async function getPickListAll(kind: 'expert' | 'contractor'): Promise<PickItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('pick_lists').select('*').eq('kind', kind)
  if (error || !data) return []
  return (data as PickItem[]).sort((a, b) => a.value.localeCompare(b.value))
}

export async function addPickItem(kind: 'expert' | 'contractor', value: string, sort = 100): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const v = value.trim()
  if (!v) return { error: 'A name is needed.' }
  const { error } = await supabase.from('pick_lists').insert({ kind, value: v, sort })
  // The primary key is (kind, value), so a duplicate is refused by the database rather
  // than by a check here that could be raced.
  if (error) return { error: /duplicate key/i.test(error.message) ? `${v} is already on the list.` : error.message }
  return {}
}

/**
 * Retire or restore an entry.
 *
 * Deliberately not a delete. A retired expert is still named on every project they built,
 * and removing the row would leave those rows pointing at a value the list no longer
 * offers — which is exactly the state that makes a dropdown silently drop somebody's
 * work. Setting active=false stops it being offered on new deals and changes nothing
 * that has already happened.
 */
export async function setPickItemActive(kind: 'expert' | 'contractor', value: string, active: boolean): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { error } = await supabase.from('pick_lists').update({ active }).eq('kind', kind).eq('value', value)
  return error ? { error: error.message } : {}
}

export async function setPickItemSort(kind: 'expert' | 'contractor', value: string, sort: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { error } = await supabase.from('pick_lists').update({ sort }).eq('kind', kind).eq('value', value)
  return error ? { error: error.message } : {}
}

// ---- Contractors -----------------------------------------------------------
//
// Held as records rather than as names on a list, because a contractor has an agency, a
// currency they invoice in and an address. A list of strings would have meant retyping
// the currency on every project and getting it wrong on some of them.
//
// PMs can add them as well as admins: the PM placing the work is the one who knows who it
// went to, and making them ask first is how a list goes stale and names end up in a notes
// field instead.

export interface Contractor {
  name: string; agency?: string; default_currency: string; email?: string
  active: boolean; added_by?: string; added_at?: string
}

/** Contractors still taking work, A–Z. */
export async function getContractors(includeRetired = false): Promise<Contractor[]> {
  if (!supabase) return []
  let q = supabase.from('contractors').select('*')
  if (!includeRetired) q = q.eq('active', true)
  const { data, error } = await q
  if (error || !data) return []
  return (data as Contractor[]).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveContractor(c: Partial<Contractor> & { name: string }, actor?: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const name = c.name.trim()
  if (!name) return { error: 'A name is needed.' }
  const { error } = await supabase.from('contractors').upsert({
    name,
    agency: c.agency?.trim() || null,
    default_currency: (c.default_currency || 'USD').trim().toUpperCase(),
    email: c.email?.trim() || null,
    active: c.active ?? true,
    added_by: actor || null,
  })
  return error ? { error: error.message } : {}
}

/**
 * Retire or restore. Never a delete — a contractor is named on every project they built,
 * and removing the row would leave those pointing at a name the list no longer offers.
 */
export async function setContractorActive(name: string, active: boolean): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' }
  const { error } = await supabase.from('contractors').update({ active }).eq('name', name)
  return error ? { error: error.message } : {}
}

// ---- Client 360 -------------------------------------------------------------
//
// Eleven figures per client, worked out in the database rather than here. The page loads
// bookings for EVERY client in order to answer questions about ONE, and a modal average
// like "mostly built in" is easy to get subtly wrong twice in two places.
//
// Built on the revenue tab itself, so it can see delivery dates, experts and project
// types that the web_revenue aggregate never carried.

export interface Client360 {
  client_key: string; company_name?: string
  projects: number; lifetime_usd?: number; avg_value?: number
  first_month?: string; last_month?: string; months_active: number; tenure_months?: number
  last_delivered?: string; last_amount?: number; last_project?: string
  strongest_month?: string; strongest_amount?: number
  handled_by?: string; handled_by_pct?: number
  built_in?: string; built_in_pct?: number
  revenue_split?: { name: string; amount: number; pct: number }[]
  // The full mix behind the single-winner "mostly built in" figure above: every
  // technology, service type and service dept this client has bought, by revenue.
  tech_split?: Mix[]; service_split?: Mix[]; dept_split?: Mix[]
  sales_cycle_days?: number; sales_cycle_n?: number
}
export interface Mix { name: string; amount: number; projects: number; pct: number }

/** Keyed on the lower-cased company name, the same way the view is. */
export async function getClient360(): Promise<Record<string, Client360>> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('web_client_360').select('*')
  if (error || !data) return {}
  const map: Record<string, Client360> = {}
  for (const r of data as Client360[]) map[r.client_key] = r
  return map
}

// ── Client 360: the three per-client blocks loaded only when a drawer opens ───────────
// Fetched per client rather than for all 405 at once. Delivery history alone is 3,218
// rows across every client; pulling the lot to show one account's twelve projects is a
// page that gets slower every month the sheet grows.

/** One delivered project, straight off the revenue sheet. */
export interface ClientProject {
  id: number; project_id?: string; quote_id?: string; project_name?: string
  project_type?: string; technology?: string; service_type?: string; service_dept?: string
  booking_month?: string; start_date?: string; delivery_date?: string
  project_status?: string; pc_sme?: string; expert?: string
  internal_hrs?: number; actual_hrs?: number
  currency?: string; confirmed_price?: number; usd_value?: number
}
export async function getClientProjects(company: string): Promise<ClientProject[]> {
  if (!supabase || !company.trim()) return []
  const { data, error } = await supabase.from('web_sheet_rows')
    .select('id, project_id, quote_id, project_name, project_type, technology, service_type, service_dept, booking_month, start_date, delivery_date, project_status, pc_sme, expert, internal_hrs, actual_hrs, currency, confirmed_price, usd_value')
    .ilike('agency', company.trim())
    .order('booking_month', { ascending: false })
  if (error || !data) return []
  return data as ClientProject[]
}

/** Every quote this client was ever sent — won, lost or still open. */
export interface ClientQuote {
  id: number; quote_id?: string; added_date?: string; subject_project?: string
  technology?: string; project_type?: string; status?: string
  currency_type?: string; estimated_cost?: number; usd_value?: number
  pc_sme?: string; sales_person?: string; business_type?: string; confirmed_in_days?: number
}
export async function getClientQuotes(company: string): Promise<ClientQuote[]> {
  if (!supabase || !company.trim()) return []
  const { data, error } = await supabase.from('quotes')
    .select('id, quote_id, added_date, subject_project, technology, project_type, status, currency_type, estimated_cost, usd_value, pc_sme, sales_person, business_type, confirmed_in_days')
    .ilike('agency', company.trim())
    .order('added_date', { ascending: false })
  if (error || !data) return []
  return data as ClientQuote[]
}

/** A written-up quarterly review. The one Client 360 block nobody can derive. */
export interface ClientQbr {
  id: number; client_key: string; company_name: string; qbr_date: string
  summary?: string; action_mavlers?: string; action_client?: string
  opportunities?: string; next_roadmap?: string; source?: string
  added_by?: string; added_at?: string; updated_by?: string; updated_at?: string
}
export async function getClientQbrs(company: string): Promise<ClientQbr[]> {
  if (!supabase || !company.trim()) return []
  const { data, error } = await supabase.from('client_qbr').select('*')
    .eq('client_key', company.trim().toLowerCase())
    .order('qbr_date', { ascending: false })
  if (error || !data) return []
  return data as ClientQbr[]
}

/** Writes through the RPC, which takes the author from the signed-in session. */
export async function saveClientQbr(company: string, qbrDate: string, f: {
  summary?: string; action_mavlers?: string; action_client?: string
  opportunities?: string; next_roadmap?: string; source?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' }
  const { error } = await supabase.rpc('save_client_qbr', {
    p_company: company.trim(), p_qbr_date: qbrDate,
    p_summary: f.summary || null, p_action_mavlers: f.action_mavlers || null,
    p_action_client: f.action_client || null, p_opportunities: f.opportunities || null,
    p_next_roadmap: f.next_roadmap || null, p_source: f.source || null,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Web, Hub & LP: editing a sheet row ───────────────────────────────────────────────
//
// A sheet row's blanks cannot be written back to sheet_raw — that table is re-synced from
// the spreadsheet, so the edit would vanish at the next sync without an error. They go
// into an overlay instead (sheet_row_overrides) and the view lays them over the top.
//
// The RPC refuses anybody who is not the row's own PC/SME or an admin. canEditLedgerRow
// below is the same rule in the browser, used to decide what to OFFER — the database is
// what enforces it.

export interface SheetRowEdits {
  project_id?: string; quote_id?: string; expert?: string
  contractor_name?: string; outsource_currency?: string; outsource_price?: number | null
  delivery_status?: string; start_date?: string | null; delivery_date?: string | null
  internal_delivery?: string | null; internal_hrs?: number | null; actual_hrs?: number | null
  integration?: string; invoice_no?: string; invoice_currency?: string; invoice_amount?: number | null
}

export async function updateSheetRowFields(rowIndex: number, f: SheetRowEdits): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || !rowIndex) return { ok: false, error: 'Supabase not configured' }
  const t = (v?: string) => v === undefined ? null : v
  const n = (v?: number | null) => v ?? null
  const { error } = await supabase.rpc('update_sheet_row_fields', {
    p_row_index: rowIndex,
    p_project_id: t(f.project_id), p_quote_id: t(f.quote_id), p_expert: t(f.expert),
    p_contractor_name: t(f.contractor_name), p_outsource_currency: t(f.outsource_currency),
    p_outsource_price: n(f.outsource_price), p_project_status: t(f.delivery_status),
    p_start_date: f.start_date || null, p_delivery_date: f.delivery_date || null,
    p_internal_delivery: f.internal_delivery || null,
    p_internal_hrs: n(f.internal_hrs), p_actual_hrs: n(f.actual_hrs),
    p_integration: t(f.integration), p_invoice_no: t(f.invoice_no),
    p_invoice_currency: t(f.invoice_currency), p_invoice_amount: n(f.invoice_amount),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Save to whichever side of the ledger this row came from. */
export async function saveLedgerRow(row: LedgerRow, f: SheetRowEdits): Promise<{ ok: boolean; error?: string }> {
  return row.source === 'raw'
    ? updateSheetRowFields(row.source_id, f)   // source_id is the sheet's row number
    : updateProjectFields(row.source_id, f)
}

/**
 * Whether to OFFER an edit on this row. Mirrors the rule both RPCs enforce: the row's own
 * PC/SME, or an admin. A row with no PC/SME named is admin-only — nobody can claim it by
 * being the only person looking at it.
 */
export function canEditLedgerRow(row: LedgerRow, me: DirectoryMember | null, isAdmin: boolean): boolean {
  if (isAdmin) return true
  if (!me || !(row.pm_owner || '').trim()) return false
  return ownerMatches(row.pm_owner, me.aliases)
}

// ── Business numbers ─────────────────────────────────────────────────────────────────
//
// One screen for "how is Web doing this month". Per service, this month against the SAME
// DAYS last month — on the 22nd, a whole August against three weeks of September says
// every service is collapsing, every month, until the 30th.

export interface BizRow {
  bucket: string
  this_start: string; this_end: string; prev_start: string; prev_end: string
  this_revenue: number; prev_revenue: number
  this_deals: number; prev_deals: number
  this_clients: number; prev_clients: number
  // From web_business_quotes, joined on the bucket.
  this_quotes: number; prev_quotes: number
  this_quotes_usd: number; prev_quotes_usd: number
  open_quotes: number; open_quotes_usd: number
}

/** The five services the business is run by, plus Other, in a fixed order. */
export const BIZ_ORDER = ['LP/HUB', 'WEB-AU', 'WEB-UK', 'WEB-US', 'AI & Automation', 'Other']

export async function getBusinessNumbers(): Promise<BizRow[]> {
  if (!supabase) return []
  const [n, q] = await Promise.all([
    supabase.from('web_business_numbers').select('*'),
    supabase.from('web_business_quotes').select('*'),
  ])
  if (n.error || !n.data) return []
  const byBucket = new Map<string, any>()
  for (const r of (q.data as any[]) || []) byBucket.set(r.bucket, r)
  const num = (v: any) => Number(v ?? 0)
  return (n.data as any[])
    .map(r => {
      const x = byBucket.get(r.bucket) || {}
      return {
        ...r,
        this_revenue: num(r.this_revenue), prev_revenue: num(r.prev_revenue),
        this_deals: num(r.this_deals), prev_deals: num(r.prev_deals),
        this_clients: num(r.this_clients), prev_clients: num(r.prev_clients),
        this_quotes: num(x.this_quotes), prev_quotes: num(x.prev_quotes),
        this_quotes_usd: num(x.this_quotes_usd), prev_quotes_usd: num(x.prev_quotes_usd),
        open_quotes: num(x.open_quotes), open_quotes_usd: num(x.open_quotes_usd),
      } as BizRow
    })
    // Biggest first, but always in a stable order when two are equal, so the table does
    // not reshuffle between loads.
    .sort((a, b) => b.this_revenue - a.this_revenue || BIZ_ORDER.indexOf(a.bucket) - BIZ_ORDER.indexOf(b.bucket))
}

/**
 * The open deals worth a leader's attention, biggest first.
 *
 * Only deals carrying a real quoted value: a deal with no figure is not a small deal, it
 * is an unpriced one, and ranking it as $0 would bury it. Those are counted separately so
 * the gap is visible rather than silently dropped.
 */
export async function getBigOpenDeals(limit = 25): Promise<{ rows: Opportunity[]; unpriced: number }> {
  if (!supabase) return { rows: [], unpriced: 0 }
  const { data, error } = await supabase.from('opportunities')
    .select('id, company_name, source_subject, gist, est_value, local_value, currency, pm_owner, sales_person, service_dept, geo, status, rfq_status, source_date, win_probability, origin, quote_key, quote_id')
    .eq('won', false).or('unlikely.is.null,unlikely.eq.false').is('email_lost', null)
  if (error || !data) return { rows: [], unpriced: 0 }
  const live = (data as Opportunity[]).filter(o => !/lost|cancel|reject|drop/i.test(o.status || ''))
  const priced = live.filter(o => (o.est_value || 0) > 0)
  return {
    rows: priced.sort((a, b) => (b.est_value || 0) - (a.est_value || 0)).slice(0, limit),
    unpriced: live.length - priced.length,
  }
}
