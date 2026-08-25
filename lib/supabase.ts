import { createClient } from '@supabase/supabase-js'
import { isNbdOwner } from './nbd'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const supabase = url && anon ? createClient(url, anon, {
auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
}) : null
export const isLive = !!supabase

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
// Matched to a line in the revenue sheet while the Quotes row still reads Open —
// i.e. delivered and invoiced, but nobody set the sheet to Confirmed. Derived every
// load by matchBookedQuotes(); nothing is written to the database.
booked_month?: string; booked_amount?: number; booked_ambiguous?: boolean
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
export interface BookingRow { id: number; company_name?: string; booking_month?: string; booking_date?: string; booking_amount?: number; service_name?: string; geo?: string; sales_person?: string; contact_email?: string }
export interface Feedback { id: number; agency?: string; nature?: string; comments?: string; added_date?: string; project_names?: string; geo?: string; feedback_type?: string }
export interface EmailSignal { id: number; company_name?: string; client_email?: string; signal_type?: string; sentiment?: string; summary?: string; source_subject?: string; source_date?: string }

async function read<T>(table: string, cols = '*', orderBy?: string): Promise<T[] | null> {
if (!supabase) return null
// Paginate: Supabase caps each request at 1000 rows, so fetch in pages.
// IMPORTANT: pass a stable `orderBy` (a unique column) for any table over
// 1000 rows. Without an ORDER BY, Postgres may return rows in a different
// order on each page request — and while the revenue sync is writing, that
// drops or duplicates boundary rows, making totals slightly off and flaky.
const PAGE = 1000
const all: T[] = []
for (let from = 0; ; from += PAGE) {
let q = supabase.from(table).select(cols).range(from, from + PAGE - 1)
if (orderBy) q = q.order(orderBy, { ascending: true })
const { data, error } = await q
if (error) return all.length ? all : null
if (!data || data.length === 0) break
all.push(...(data as T[]))
if (data.length < PAGE) break
}
return all.length ? all : null
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
const confirmedLike = /(\bapproved\b|\bretainer\b|existing client|already a client|migration complete|signed off|renewed|go ?ahead given)/i
// A deal the EMAIL scan judged confirmed/approved (email origin only, so the sheet
// never false-triggers). rfq_status set by the scan, or a >=90% email deal.
const emailWon = /approv|go-?ahead|email-?confirmed|verbal go|\bwon\b/
const STALE_DAYS = 21
const nowMs = Date.now()
const daysSince = (d?: string) => { const t = Date.parse(d || ''); return Number.isFinite(t) ? Math.floor((nowMs - t) / 86400000) : null }
const out: Opportunity[] = rows.map((o: any) => {
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
const wrongNew = !nbd && (taggedNewOnly || o.is_new_client === true) && !taggedRepeat
const repeat = taggedRepeat || inRevenue || o.is_new_client === false || !nbd
// Review flags for still-open deals, in priority order (one flag shown, most urgent first):
//  1. CONFIRM-LAG — someone confirmed it Won here but the sheet line is still Open
//  2. LOST-LAG    — someone marked it Lost here but the sheet line is still Open
//  3. WON-LAG     — email reads confirmed but the deal is still Open (sheet not updated yet)
//  4. type        — booked/existing client mislabelled pure "New" in the sheet
//  5. STALE       — no dated movement in >21d; chase or confirm it's still live
//  6. text        — brief reads like existing/confirmed work
let flag: string | undefined
const bm = bookedMatch.get(o.id)
if (!o.won && norm(o.status) !== 'lost' && !norm(o.status).includes('cancel')) {
const emailConfirmed = o.origin === 'email' && (emailWon.test(norm(o.rfq_status)) || (o.win_probability || 0) >= 90)
// Only sheet-origin rows can be "out of sync with the sheet" — an email-origin deal has
// no Quotes line to correct, so a call made there needs no follow-up action.
const lostLag = o.email_lost && o.origin === 'sheet'
const confirmLag = o.email_won && o.origin === 'sheet'
const age = daysSince(o.source_date || o.first_date)
if (bm && !bm.ambiguous) flag = `⚠ ALREADY BOOKED, OPEN IN SHEET — $${bm.amount.toLocaleString('en-US')} for this client was invoiced in the revenue sheet (${(bm.month || '').slice(0, 7)}), but its Quotes-sheet line still reads Open. Set that row to Confirmed — until you do, this money is counted twice.`
else if (bm) flag = `⚠ POSSIBLY ALREADY BOOKED — a $${bm.amount.toLocaleString('en-US')} booking for this client (${(bm.month || '').slice(0, 7)}) matches this quote AND another open quote at the same price. Check which one shipped and set that Quotes row to Confirmed.`
else if (confirmLag) flag = '⚠ CONFIRMED HERE, OPEN IN SHEET — this was marked Won on the dashboard, but its Quotes-sheet line still reads Open. Set that row to Confirmed so it books as revenue.'
else if (lostLag) flag = '⚠ LOST IN EMAIL, OPEN IN SHEET — this was marked Lost here, but its Quotes-sheet line still reads Open. Set that row to Cancelled so it stops counting as live pipeline.'
else if (emailConfirmed) flag = '⚠ REVIEW URGENT — client confirmed this in email but it is still Open. Mark it Confirmed in the Quotes sheet so it books as Won.'
else if (wrongNew) flag = `⚠ NOT NBD, TAGGED “NEW” — this quote is tagged New Business in the Quotes sheet (col P) but its owner${o.sales_person ? ` (${o.sales_person})` : ' is blank and'} is not on the NBD team, so it is being counted as Repeat. Either fix col P to Repeat, or set the NBD owner who actually opened the account.`
else if (inRevenue && taggedNewOnly) flag = 'Booked/existing client but tagged “New” in the Quotes sheet (Business Type, col P) — should be Repeat.'
else if (age !== null && age > STALE_DAYS) flag = `⚠ Stale — no movement in ${age} days. Follow up or confirm the deal is still live.`
else if (confirmedLike.test(`${o.summary || ''} ${o.gist || ''}`)) flag = 'Reads as confirmed / existing business — verify it belongs under Opportunities'
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
is_new_client: !repeat,
nbd_owner: nbd,
mis_tagged_new: wrongNew,
business_type: o.business_type || undefined,
first_date: o.first_date || o.source_date,
booked_month: bm && !bm.ambiguous ? bm.month : undefined,
booked_amount: bm ? bm.amount : undefined,
booked_ambiguous: bm ? bm.ambiguous : undefined,
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
export async function getBookingsFull(): Promise<BookingRow[]> { return (await read<BookingRow>('web_revenue', 'id, company_name, booking_month, booking_date, booking_amount, service_name, geo, sales_person, contact_email', 'id')) || [] }
export async function getFeedback(): Promise<Feedback[]> { return (await read<Feedback>('feedback', 'id, agency, nature, comments, added_date, project_names, geo, feedback_type')) || [] }
export async function getEmailSignals(): Promise<EmailSignal[]> { return (await read<EmailSignal>('email_signals', 'id, company_name, client_email, signal_type, sentiment, summary, source_subject, source_date')) || [] }

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
  status: 'open' | 'resolved'          // open if ANY underlying thread is still open
  headline?: string                    // most-recent escalation text (the card summary)
  latest_summary?: string; latest_sentiment?: string
  first_flagged_date?: string; last_flagged_date?: string; resolved_at?: string; resolved_by?: string
}
const ckey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
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
      groups.set(key, { company_name: r.company_name || '(unknown client)', geo: geoFor(r.company_name), client_email: r.client_email, signal_type: r.signal_type, items: [item], threadIds: [r.thread_id], count: 1, status: r.status === 'open' ? 'open' : 'resolved', headline: r.escalation_summary, latest_summary: l?.summary, latest_sentiment: l?.sentiment, first_flagged_date: r.first_flagged_date, last_flagged_date: r.first_flagged_date, resolved_at: r.resolved_at, resolved_by: r.resolved_by })
    } else {
      g.items.push(item); g.threadIds.push(r.thread_id); g.count++
      if (r.status === 'open') g.status = 'open'
      // rows arrive newest-first, so the first seen is the headline; track the date span
      if ((r.first_flagged_date || '') < (g.first_flagged_date || '')) g.first_flagged_date = r.first_flagged_date
      if ((r.first_flagged_date || '') > (g.last_flagged_date || '')) g.last_flagged_date = r.first_flagged_date
    }
  }
  // sort: open clients first, then by most-recent activity
  return [...groups.values()].sort((a, b) => (a.status === b.status ? (b.last_flagged_date || '').localeCompare(a.last_flagged_date || '') : a.status === 'open' ? -1 : 1))
}
// Mark ALL of a client's escalation threads. status: 'open' | 'fixed' | 'positive'. They stay in the list.
export async function markEscalationStatus(threadIds: string[], status: 'open' | 'fixed' | 'positive', opts?: { actor?: string; note?: string }): Promise<boolean> {
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
export interface DelightItem { quote?: string; project?: string; evidence?: string; date?: string; type?: string }
export interface Delight {
  company_name: string; geo?: string; count: number
  headline?: string; headline_project?: string; headline_evidence?: string
  items: DelightItem[]; date?: string; client_email?: string
}
export async function getDelights(): Promise<Delight[]> {
  if (!supabase) return []
  const [fbRes, clients] = await Promise.all([
    supabase.from('feedback').select('agency, nature, feedback_type, geo, comments, evidence, project_names, client_email, added_date').ilike('nature', 'positive'),
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
    const key = ckey(f.agency); if (!key) continue
    const comment = (f.comments || '').trim()
    const realQuote = comment && !isGeneric(comment) ? comment : ''
    const realEvidence = /^https?:\/\//i.test((f.evidence || '').trim()) ? (f.evidence || '').trim() : ''
    if (!realQuote && !realEvidence) continue   // drop generic auto-logged rows (Ref: MEM…)
    const item: DelightItem = { quote: realQuote || undefined, project: f.project_names || undefined, evidence: realEvidence || undefined, date: (f.added_date || '').slice(0, 10), type: f.feedback_type }
    const g = groups.get(key)
    if (!g) groups.set(key, { company_name: f.agency || '', geo: geoFor(f.agency, f.geo), count: 1, items: [item], date: item.date, client_email: f.client_email || undefined })
    else { g.count++; g.items.push(item); if (!g.geo) g.geo = geoFor(f.agency, f.geo); if (!g.client_email && f.client_email) g.client_email = f.client_email; if ((item.date || '') > (g.date || '')) g.date = item.date }
  }
  // headline = the strongest testimonial (longest quote); fall back to a screenshot one
  for (const g of groups.values()) {
    const withQuote = g.items.filter(i => i.quote).sort((a, b) => (b.quote?.length || 0) - (a.quote?.length || 0))
    const pick = withQuote[0] || g.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    g.headline = pick?.quote; g.headline_project = pick?.project; g.headline_evidence = pick?.evidence
  }
  return [...groups.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

export interface Quote { id: number; quote_id?: string; added_date?: string; agency?: string; usd_value?: number; status?: string; business_type?: string; geo?: string; sales_person?: string; confirmed_in_days?: number; technology?: string; client_email?: string }
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
