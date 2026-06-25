'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getClients, getOpportunities, getLastSync, type RevenueRow, type Client, type Opportunity } from '@/lib/supabase'
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

export default function Dashboard() {
  const [rev, setRev] = useState<RevenueRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])

  const init = presetRange('mtd')
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [preset, setPreset] = useState('mtd')

  const [syncRev, setSyncRev] = useState<string | null>(null)
  const [syncOpp, setSyncOpp] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const load = async () => {
    setRefreshing(true)
    const [r, c, o, sr, so] = await Promise.all([
      getRevenue(), getClients(), getOpportunities(),
      getLastSync('web-revenue-appscript'), getLastSync('email-opportunities-scan'),
    ])
    setRev(r); setClients(c); setOpps(o); setSyncRev(sr); setSyncOpp(so); setRefreshing(false)
  }
  useEffect(() => { load() }, [])

  const applyPreset = (key: string) => { const r = presetRange(key); setFrom(r.from); setTo(r.to); setPreset(key) }
  const onFrom = (v: string) => { setFrom(v); setPreset('') }
  const onTo = (v: string) => { setTo(v); setPreset('') }

  // month-level range test ('YYYY-MM-DD' first-of-month vs from/to)
  const inMonthRange = (m?: string) => { if (!m) return false; const d = m.slice(0, 10); return d >= from && d <= to }
  const inDayRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return false; return v >= from && v <= to }

  const rangeRev = useMemo(() => rev.filter(r => inMonthRange(r.month)), [rev, from, to])

  // monthly totals within range (drives chart + period total)
  const monthSeries = useMemo(() => {
    const m: Record<string, number> = {}
    rangeRev.forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return Object.keys(m).sort().map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(m[k]) }))
  }, [rangeRev])

  // full-data monthly totals (for MoM of the latest in-range month vs the prior calendar month)
  const allMonthTotals = useMemo(() => {
    const m: Record<string, number> = {}
    rev.forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return m
  }, [rev])

  // Revenue trend chart always shows the trailing 3 months (current + 2 prior),
  // independent of the KPI date filter.
  const trendSeries = useMemo(() => {
    const keys: string[] = []
    for (let i = 2; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }
    return keys.map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(allMonthTotals[k] || 0) }))
  }, [allMonthTotals])

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
        <button onClick={load} disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white hover:border-mav-yellow disabled:opacity-50">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
    </div>
  )
}
