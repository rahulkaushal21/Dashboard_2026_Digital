// Supabase writers. The Claude routine reads each Business Sheet tab via the
// Google Sheets/Drive connector (private — no publishing) and Gmail for new
// opportunities, maps rows to these shapes, and calls the matching writer.
// Dedup is by src_row_hash (sheet rows) or thread_id (email).
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const SB = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
export async function getConfig() {
  const { data } = await SB.from('app_settings').select('*').eq('id', 1).single()
  return data || {}
}
export const hash = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex')

// High-water mark for the email scan: the timestamp of the last successful scan.
// The routine scans threads NEWER than this (with 1h overlap) so no mail is
// missed even after the laptop sleeps for hours. Returns null on a cold start.
export async function getLastScan() {
  const { data } = await SB.from('sync_runs').select('ran_at')
    .eq('source', 'email-opportunities-scan').eq('ok', true)
    .order('ran_at', { ascending: false }).limit(1)
  return data?.[0]?.ran_at || null
}

// Heartbeat: advance the high-water mark every run, even when 0 rows are written,
// so the next window starts from here (otherwise a quiet run would re-scan forever).
export async function markScan(message, rows_upserted = 0) {
  await SB.from('sync_runs').insert({ source: 'email-opportunities-scan', rows_upserted, ok: true, message })
}

// Failure heartbeat: record that a run could NOT complete (e.g. the Gmail
// connector token expired and needs re-authorization). Writes ok:false, which
// (a) getLastScan ignores — so the high-water mark does NOT advance and the next
// successful run still catches up the full backlog, and (b) the dashboard reads
// to flip the "Opportunities scan" light red with a reconnect prompt, so a silent
// auth lapse becomes visible instead of the scan just quietly doing nothing.
export async function markScanFailed(message) {
  await SB.from('sync_runs').insert({ source: 'email-opportunities-scan', rows_upserted: 0, ok: false, message })
}

async function upsert(table, rows, conflict) {
  if (!rows?.length) return 0
  const { error } = await SB.from(table).upsert(rows, { onConflict: conflict })
  if (error) throw error
  await SB.from('sync_runs').insert({ source: table, rows_upserted: rows.length, ok: true })
  return rows.length
}

// Each row should already be mapped to the table's columns (see ROUTINE.md).
export const writeBookings     = (r) => upsert('bookings', r, 'src_row_hash')
export const writeQuotes       = (r) => upsert('quotes', r, 'src_row_hash')
export const writeSqlLeads      = (r) => upsert('sql_leads', r, 'src_row_hash')
export const writeOpportunities = (r) => upsert('opportunities', r, 'thread_id')
export const writeFeedback      = (r) => upsert('feedback', r, 'thread_id')
export const writeEscalations   = (r) => upsert('escalations', r, 'thread_id')
export const writeQuoteConversions = (r) => upsert('quote_conversions', r, 'thread_id')
// Per-email sentiment signal for any client-facing message with a discernible
// tone (not just explicit feedback). Deduped on thread_id.
export const writeEmailSignals  = (r) => upsert('email_signals', r, 'thread_id')

// Rebuild the derived clients table from the synced tabs.
export async function rebuildClients() {
  const { data: b } = await SB.from('bookings').select('company_name, booking_amount, booking_month, geo, sme, sales_person')
  const { data: q } = await SB.from('quotes').select('agency, business_type, geo')
  const { data: f } = await SB.from('feedback').select('agency, nature, added_date')
  const { data: s } = await SB.from('sql_leads').select('company_name, industry')
  const ind = new Map((s || []).map(x => [x.company_name, x.industry]))
  const m = new Map()
  for (const x of b || []) {
    const c = m.get(x.company_name) || { company_name: x.company_name, ltv_usd: 0 }
    c.ltv_usd += Number(x.booking_amount) || 0
    c.geo = x.geo; c.sme = x.sme; c.sales_person = x.sales_person
    if (!c.last_booking_month || x.booking_month > c.last_booking_month) c.last_booking_month = x.booking_month
    c.industry = ind.get(x.company_name) || c.industry
    c.client_status = 'active'
    m.set(x.company_name, c)
  }
  const rows = [...m.values()]
  if (rows.length) await SB.from('clients').upsert(rows, { onConflict: 'company_name' })
  return rows.length
}
