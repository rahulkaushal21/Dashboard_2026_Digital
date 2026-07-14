import { createClient } from '@supabase/supabase-js'
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
value?: number; technology?: string; service?: string; journey?: string; quote_ref?: string
quote_date?: string; origin?: string; est_value?: number; next_step?: string; enriched?: boolean
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

export async function getOpportunities(): Promise<Opportunity[]> {
// SINGLE SOURCE OF TRUTH: the opportunities table. One row per DEAL.
//  • origin='sheet'  — one row per line in the Business-Sheet "Quotes" tab
//    (price, confirmation status, agency, subject, GEO, AM=sales_person, PC=pm_owner),
//    synced + brief-generated by the sync_quotes_to_opportunities() DB function and
//    refreshed every 30 min. Brief + %/next-step get enriched from web@uplers.com email.
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
const booked = (await read<{ company_name: string; booking_amount: number }>('web_revenue', 'company_name, booking_amount', 'id')) || []
const revenueSet = new Set(booked.map(b => norm(b.company_name)).filter(Boolean))
const confirmedLike = /(\bapproved\b|\bretainer\b|existing client|already a client|migration complete|signed off|renewed|go ?ahead given)/i
const out: Opportunity[] = rows.map((o: any) => {
const value = o.est_value ?? o.won_amount
const inRevenue = revenueSet.has(norm(o.company_name))
// Business Type from the Quotes tab (col P): 'New' | 'Repeat' | 'New Repeat' | null.
// A booked client sending regular work is normal REPEAT business — "Repeat" and
// "New Repeat" must never be flagged. Only a genuine contradiction counts.
const bt = norm(o.business_type)
const taggedRepeat = bt.includes('repeat')       // 'repeat' or 'new repeat'
const taggedNewOnly = bt === 'new'               // pure "New"
const repeat = taggedRepeat || inRevenue || o.is_new_client === false
// Data-quality flag: an already-booked (existing) client still tagged pure "New"
// in the Quotes sheet — the label is wrong and should be Repeat. Nothing else flags.
let flag: string | undefined
if (!o.won && norm(o.status) !== 'lost') {
if (inRevenue && taggedNewOnly) flag = 'Booked/existing client but tagged “New” in the Quotes sheet (Business Type, col P) — should be Repeat.'
else if (confirmedLike.test(`${o.summary || ''} ${o.gist || ''}`)) flag = 'Reads as confirmed / existing business — verify it belongs under Opportunities'
}
return {
...o,
geo: geo3(o.geo),
value: value != null ? Math.round(value) : undefined,
won_amount: o.won_amount != null ? Math.round(o.won_amount) : undefined,
source: o.origin,
sources: [o.origin],
source_tags: [o.origin],
service: serviceOf(o.technology),
quote_ref: o.quote_key || o.quote_ref || undefined,
is_new_client: !repeat,
business_type: o.business_type || undefined,
first_date: o.first_date || o.source_date,
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
