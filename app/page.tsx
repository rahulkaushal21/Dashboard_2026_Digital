'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getClients, getOpportunities, getLastSync, getBookingsFull, getQuotes, type RevenueRow, type Client, type Opportunity, type BookingRow, type Quote } from '@/lib/supabase'
import { fmtUsd, topClients } from '@/lib/metrics'
import { RefreshCw } from 'lucide-react'

// --- date helpers ------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const prevMonthKey = (k: string) => {
  const [y, m] = k.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = (key: string) =>
  new Date(key + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })

const now = new Date()
function presetRange(key: string): { from: string; to: string } {
  const to = ymd(monthEnd(now))
  if (key === 'ytd') return { from: `${now.getFullYear()}-01-01`, to }
  const back = key === 'm3' ? 2 : key === 'm6' ? 5 : key === 'm12' ? 11 : 0 // 'mtd' -> 0
  return { from: ymd(monthStart(new Date(now.getFullYear(), now.getMonth() - back, 1))), to }
}

const PRESETS: { key: string; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'm3', label: 'Last 3 mo' },
  { key: 'm6', label: 'Last 6 mo' },
  { key: 'm12', label: 'Last 12 mo' },
  { key: 'ytd', label: 'YTD' },
]
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

const ago = (ts: string | null) => {
  if (!ts) return '—'
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const freshWithin = (ts: string | null, mins: number) => !!ts && (Date.now() - new Date(ts).getTime()) / 60000 < mins

// --- segment (service department) bifurcation --------------------------------
const SEG_ORDER = ['WEB-US', 'WEB-UK', 'WEB-AU', 'LP', 'HUB', 'Design', 'AI & Automation']
const segOf = (s?: string) => {
  const v = (s || '').trim()
  if (/design/i.test(v)) return 'Design'
  if (/^WEB-?US/i.test(v)) return 'WEB-US'
  if (/^WEB-?UK/i.test(v)) return 'WEB-UK'
  if (/^WEB-?AU/i.test(v)) return 'WEB-AU'
  if (/^LP/i.test(v)) return 'LP'
  if (/^HUB/i.test(v)) return 'HUB'
  if (/AI\s*&?\s*Auto/i.test(v)) return 'AI & Automation'
  return 'Other'
}
const qStatusTone = (s?: string) => {
  const v = (s || '').toLowerCase()
  if (/confirm|won/.test(v)) return 'bg-green-500/15 text-green-400'
  if (/cancel|lost/.test(v)) return 'bg-red-500/15 text-red-400'
  if (/shared|approval|pending|sent/.test(v)) return 'bg-amber-500/15 text-amber-400'
  return 'bg-mav-line text-mav-muted'
}

export default function Dashboard() {
  const [rev, setRev] = useState<RevenueRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [bookingRows, setBookingRows] = useState<BookingRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])

  const init = presetRange('mtd')
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [preset, setPreset] = useState('mtd')

  const [syncRev, setSyncRev] = useState<string | null>(null)
  const [syncOpp, setSyncOpp] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const load = async () => {
    setRefreshing(true)
    try {
      const [r, c, o, b, qs, sr, so] = await Promise.all([
        getRevenue(), getClients(), getOpportunities(), getBookingsFull(), getQuotes(),
        getLastSync('web-revenue-appscript'), getLastSync('email-opportunities-scan'),
      ])
      setRev(r); setClients(c); setOpps(o); setBookingRows(b); setQuotes(qs); setSyncRev(sr); setSyncOpp(so); setLastRefreshed(new Date())
    } finally { setRefreshing(false) }
  }
  useEffect(() => { load() }, [])

  const applyPreset = (key: string) => { const r = presetRange(key); setFrom(r.from); setTo(r.to); setPreset(key) }
  const onFrom = (v: string) => { setFrom(v); setPreset('') }
  const onTo = (v: string) => { setTo(v); setPreset('') }

  // month-level range test ('YYYY-MM-DD' first-of-month vs from/to)
  const inMonthRange = (m?: string) => { if (!m) return false; const d = m.slice(0, 10); return d >= from && d <= to }
  const inDayRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return false; return v >= from && v <= to }

  const rangeRev = useMemo(() => rev.filter(r => inMonthRange(r.month)), [rev, from, to])

  // monthly totals within range (drives period total)
  const monthSeries = useMemo(() => {
    const m: Record<string, number> = {}
    rangeRev.forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return Object.keys(m).sort().map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(m[k]) }))
  }, [rangeRev])

  // full-data monthly totals (for MoM + trend)
  const allMonthTotals = useMemo(() => {
    const m: Record<string, number> = {}
    rev.forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return m
  }, [rev])

  // Revenue trend chart always shows the trailing 3 months, independent of the KPI date filter.
  const trendSeries = useMemo(() => {
    const keys: string[] = []
    for (let i = 2; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }
    return keys.map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(allMonthTotals[k] || 0) }))
  }, [allMonthTotals])

  // --- segment x month matrix (trailing 6 months, independent of filter) -----
  const segMonths = useMemo(() => {
    const keys: string[] = []
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }
    return keys
  }, [])
  const segData = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    bookingRows.forEach(b => {
      const k = (b.booking_month || '').slice(0, 7)
      if (!segMonths.includes(k)) return
      const seg = segOf(b.service_name)
      m[seg] = m[seg] || {}
      m[seg][k] = (m[seg][k] || 0) + (b.booking_amount || 0)
    })
    return m
  }, [bookingRows, segMonths])
  const segRows = useMemo(() => {
    const rows = [...SEG_ORDER]
    if (segData['Other'] && Object.values(segData['Other']).some(v => v)) rows.push('Other')
    return rows
  }, [segData])
  const colTotal = (k: string) => segRows.reduce((s, seg) => s + (segData[seg]?.[k] || 0), 0)
  const rowTotal = (seg: string) => segMonths.reduce((s, k) => s + (segData[seg]?.[k] || 0), 0)

  // --- Design projects (tagged "Design" in the Quotes sheet technology column) ----
  const designQuotes = useMemo(() =>
    quotes.filter(q => /design/i.test(q.technology || ''))
      .slice().sort((a, b) => (b.added_date || '').localeCompare(a.added_date || '')), [quotes])
  const designTotal = designQuotes.reduce((s, q) => s + (q.usd_value || 0), 0)
  const designWon = designQuotes.filter(q => /confirm|won/i.test(q.status || '')).length
  // Design entries now tagged in the web-revenue report (service column)
  const designBookings = useMemo(() => bookingRows.filter(b => /design/i.test(b.service_name || '')), [bookingRows])
  const designBookingsTotal = designBookings.reduce((s, b) => s + (b.booking_amount || 0), 0)

  const periodTotal = monthSeries.reduce((s, x) => s + x.revenue, 0)
  const latestKey = monthSeries.length ? monthSeries[monthSeries.length - 1].key : null
  const mom = useMemo(() => {
    if (!latestKey) return null
    const prev = allMonthTotals[prevMonthKey(latestKey)]
    const cur = allMonthTotals[latestKey]
    return prev ? ((cur - prev) / prev) * 100 : null
  }, [latestKey, allMonthTotals])

  const activeClients = useMemo(() =>
    new Set(rangeRev.filter(r => (r.amount_usd || 0) !== 0).map(r => r.client_name)).size, [rangeRev])
  const openOpps = opps.filter(o => inDayRange(o.source_date) && (o.rfq_status === 'pending' || o.rfq_status === 'received')).length
  const bookings = rangeRev.length

  return (
    <div>
      <Header title="Dashboard" subtitle="Revenue, clients and pipeline at a glance" />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-xs">
        <span className="uppercase tracking-wide text-mav-muted">Last sync</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${freshWithin(syncRev, 45) ? 'bg-green-400' : syncRev ? 'bg-amber-400' : 'bg-mav-line'}`} />
          <span className="text-mav-muted">Web revenue</span><span className="font-medium">{ago(syncRev)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${freshWithin(syncOpp, 180) ? 'bg-green-400' : syncOpp ? 'bg-amber-400' : 'bg-mav-line'}`} />
          <span className="text-mav-muted">Opportunities scan</span><span className="font-medium">{ago(syncOpp)}</span>
        </span>
        <span className="ml-auto text-mav-muted">{refreshing ? 'Refreshing…' : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString()}` : ''}</span>
        <button onClick={load} disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white hover:border-mav-yellow disabled:opacity-50">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`text-sm px-3 py-2 rounded-md border transition-colors ${preset === p.key
              ? 'bg-mav-yellow text-black border-mav-yellow font-medium'
              : 'border-mav-line text-mav-muted hover:text-white'}`}>{p.label}</button>
        ))}
        <span className="text-xs text-mav-muted ml-2">From</span>
        <input type="date" value={from} onChange={e => onFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => onTo(e.target.value)} className={selCls} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Revenue (period)" value={fmtUsd(periodTotal)} change={mom} />
        <KPICard label="Active clients" value={String(activeClients)} />
        <KPICard label="Open opportunities" value={String(openOpps)} />
        <KPICard label="Bookings (period)" value={String(bookings)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2"><RevenueChart data={trendSeries} /></div>
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="text-sm font-medium mb-4">Top clients</div>
          {monthSeries.length === 0 ? (
            <p className="text-sm text-mav-muted">No revenue in the selected range.</p>
          ) : (
            <ul className="space-y-3">
              {topClients(rangeRev).map((c, i) => (
                <li key={c.client_name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className="text-mav-muted w-4">{i + 1}</span>{c.client_name}</span>
                  <span className="font-medium">{fmtUsd(c.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pt-5 mb-3">
          <div className="text-sm font-medium">Revenue by segment — month over month</div>
          <div className="text-xs text-mav-muted">Service department · trailing 6 months · USD</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-5 py-3 font-medium">Segment</th>
                {segMonths.map(k => <th key={k} className="px-4 py-3 font-medium text-right whitespace-nowrap">{monthLabel(k)}</th>)}
                <th className="px-5 py-3 font-medium text-right whitespace-nowrap">6-mo total</th>
              </tr>
            </thead>
            <tbody>
              {segRows.map(seg => (
                <tr key={seg} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                  <td className="px-5 py-3 font-medium whitespace-nowrap">{seg}</td>
                  {segMonths.map(k => <td key={k} className="px-4 py-3 text-right text-mav-muted whitespace-nowrap">{fmtUsd(segData[seg]?.[k] || 0)}</td>)}
                  <td className="px-5 py-3 text-right font-medium whitespace-nowrap">{fmtUsd(rowTotal(seg))}</td>
                </tr>
              ))}
              <tr className="border-t border-mav-line bg-mav-dark/30">
                <td className="px-5 py-3 font-semibold">Total</td>
                {segMonths.map(k => <td key={k} className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtUsd(colTotal(k))}</td>)}
                <td className="px-5 py-3 text-right font-semibold whitespace-nowrap">{fmtUsd(segMonths.reduce((s, k) => s + colTotal(k), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mt-6">
        <div className="flex items-baseline justify-between px-5 pt-5 mb-1">
          <div className="text-sm font-medium">Design projects</div>
          <div className="text-xs text-mav-muted">{designBookings.length} revenue entr{designBookings.length === 1 ? 'y' : 'ies'} ({fmtUsd(designBookingsTotal)}) · {designQuotes.length} quote{designQuotes.length === 1 ? '' : 's'} ({fmtUsd(designTotal)})</div>
        </div>
        <p className="px-5 text-xs text-mav-muted mb-3">A separate record of everything tagged <span className="text-white">Design</span>. Counts <span className="text-white">{designBookings.length}</span> Design entr{designBookings.length === 1 ? 'y' : 'ies'} booked in the web-revenue report plus Design-tagged quotes (e.g. &ldquo;Design (Web)&rdquo;). Design also appears as its own row in the segment table above. If the revenue count looks low, the sheet&apos;s latest Design edits may not have synced yet — hit Refresh after the next web-revenue sync.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>{['Client', 'Project', 'Type', 'GEO', 'Value', 'Status', 'Date'].map(h => <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {designQuotes.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-6 text-sm text-mav-muted">No Design-tagged projects found in the Quotes sheet.</td></tr>
              ) : designQuotes.map(q => (
                <tr key={q.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{q.agency || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted truncate max-w-xs">{(q as { subject_project?: string }).subject_project || q.technology || q.quote_id || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{q.technology || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{q.geo || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtUsd(q.usd_value || 0)}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${qStatusTone(q.status)}`}>{q.status || '—'}</span></td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(q.added_date || '').slice(0, 10) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
