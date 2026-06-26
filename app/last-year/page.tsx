'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, type BookingRow } from '@/lib/supabase'

const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const pad = (n: number) => String(n).padStart(2, '0')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
const curM = now.getMonth() + 1
const curMM = pad(curM)
// fiscal year (Apr–Mar) that the current month falls in
const tyStart = curM >= 4 ? now.getFullYear() : now.getFullYear() - 1
const lyStart = tyStart - 1
const curMonthKey = `${now.getFullYear()}-${curMM}`   // cap "to date" at the current calendar month
const spLabel = (yr: number) => `Apr–${SHORT[curM]} '${String(yr).slice(2)}`

// --- fiscal quarters (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar) ---------
type FQ = { fy: number; q: number }
const fqOf = (y: number, m: number): FQ =>
  m >= 4 && m <= 6 ? { fy: y, q: 1 } : m >= 7 && m <= 9 ? { fy: y, q: 2 } : m >= 10 ? { fy: y, q: 3 } : { fy: y - 1, q: 4 }
const decQ = (f: FQ): FQ => f.q > 1 ? { fy: f.fy, q: f.q - 1 } : { fy: f.fy - 1, q: 4 }
const qStartMonth = (q: number) => q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1
const qCalYear = (f: FQ) => f.q === 4 ? f.fy + 1 : f.fy
const qRange = (f: FQ): [string, string] => {
  const sm = qStartMonth(f.q); const y = qCalYear(f)
  return [`${y}-${pad(sm)}`, `${y}-${pad(sm + 2)}`]
}
const qLabel = (f: FQ) => { const sm = qStartMonth(f.q); const y = qCalYear(f); return `${SHORT[sm]}–${SHORT[sm + 2]} '${String(y).slice(2)}` }
// last 4 quarters, oldest → newest (newest = current quarter)
const QS: FQ[] = (() => { const cur = fqOf(now.getFullYear(), curM); const a = [cur]; for (let i = 0; i < 3; i++) a.unshift(decQ(a[0])); return a })()
const LAST_I = QS.length - 1            // this quarter
const PREV_I = QS.length - 2            // last quarter

type Row = { client: string; fyLast: number; fyTd: number; spLy: number; spTy: number; qv: number[]; upcoming: number }

export default function LastYearReview() {
  const [rows, setRows] = useState<BookingRow[]>([])
  const [q, setQ] = useState('')
  const [mv, setMv] = useState('')      // quarter movement filter
  useEffect(() => { getBookingsFull().then(setRows) }, [])

  const data = useMemo(() => {
    const m = new Map<string, Row>()
    const between = (k: string, a: string, b: string) => k >= a && k <= b
    rows.forEach(r => {
      const c = (r.company_name || '').trim()
      if (!c) return
      const k = (r.booking_month || '').slice(0, 7)
      const amt = r.booking_amount || 0
      const cur = m.get(c) || { client: c, fyLast: 0, fyTd: 0, spLy: 0, spTy: 0, qv: QS.map(() => 0), upcoming: 0 }
      if (between(k, `${lyStart}-04`, `${tyStart}-03`)) cur.fyLast += amt
      // "to date" = current fiscal year up to (and including) the current month only
      if (k >= `${tyStart}-04` && k <= curMonthKey) cur.fyTd += amt
      else if (k > curMonthKey) cur.upcoming += amt   // future-dated/scheduled bookings, shown separately
      if (between(k, `${lyStart}-04`, `${lyStart}-${curMM}`)) cur.spLy += amt
      if (between(k, `${tyStart}-04`, `${tyStart}-${curMM}`)) cur.spTy += amt
      QS.forEach((fq, i) => { const [a, b] = qRange(fq); if (between(k, a, b)) cur.qv[i] += amt })
      m.set(c, cur)
    })
    return [...m.values()]
  }, [rows])

  const qStatus = (r: Row) => {
    const tq = r.qv[LAST_I], lq = r.qv[PREV_I]
    if (lq > 0 && tq <= 0) return 'Dropped'
    if (lq <= 0 && tq > 0) return 'New'
    if (tq > lq) return 'Up'
    if (tq < lq) return 'Down'
    return 'Flat'
  }
  const qDelta = (r: Row) => r.qv[LAST_I] - r.qv[PREV_I]
  const qPct = (r: Row) => r.qv[PREV_I] > 0 ? Math.round((qDelta(r) / r.qv[PREV_I]) * 100) : null

  const view = useMemo(() => data
    .filter(r => r.client.toLowerCase().includes(q.toLowerCase()))
    .filter(r => !mv || qStatus(r) === mv)
    .filter(r => r.fyLast || r.fyTd || r.qv.some(v => v))
    .sort((a, b) => b.fyTd - a.fyTd || b.fyLast - a.fyLast), [data, q, mv])

  const tot = (sel: (r: Row) => number) => view.reduce((s, r) => s + sel(r), 0)
  const aggTq = data.reduce((s, r) => s + r.qv[LAST_I], 0)
  const aggLq = data.reduce((s, r) => s + r.qv[PREV_I], 0)
  const qoqPct = aggLq > 0 ? Math.round(((aggTq - aggLq) / aggLq) * 100) : null
  const dropped = data.filter(r => qStatus(r) === 'Dropped').length
  const newq = data.filter(r => qStatus(r) === 'New').length
  const upcoming = data.reduce((s, r) => s + r.upcoming, 0)

  const badge = (s: string) => ({
    Up: 'bg-green-500/15 text-green-400', New: 'bg-green-500/15 text-green-400',
    Down: 'bg-amber-500/15 text-amber-400', Dropped: 'bg-red-500/15 text-red-400',
    Flat: 'bg-mav-line text-mav-muted',
  } as Record<string, string>)[s] || 'bg-mav-line text-mav-muted'
  const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

  return (
    <div>
      <Header title="Last Year Review" subtitle={`Year-on-year + quarter-over-quarter — who's growing, slipping or dropped off`} />

      <div className="mb-4 text-xs text-mav-muted bg-mav-panel border border-mav-line rounded-lg px-3 py-2">
        Revenue data starts April 2025, so early quarters may be partial. <span className="text-white">&ldquo;To date&rdquo;</span> counts Apr&nbsp;{tyStart} through {SHORT[curM]}&nbsp;{tyStart} only — future-dated bookings are held out. <span className="text-white">Dropped</span> = had revenue last quarter ({qLabel(QS[PREV_I])}) but none this quarter ({qLabel(QS[LAST_I])}).
        {upcoming > 0 && <span> Excludes <span className="text-mav-yellow">{money(upcoming)}</span> in future-dated/scheduled bookings beyond {SHORT[curM]}&nbsp;{tyStart}.</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label={`FY ${lyStart}-${String(tyStart).slice(2)} (Apr–Mar)`} value={money(tot(r => r.fyLast))} />
        <KPICard label={`FY ${tyStart}-${String(tyStart + 1).slice(2)} to date`} value={money(tot(r => r.fyTd))} />
        <KPICard label={`${qLabel(QS[PREV_I])} → ${qLabel(QS[LAST_I])}`} value={(qoqPct == null ? '—' : (qoqPct >= 0 ? '+' : '') + qoqPct + '%')} change={qoqPct} />
        <KPICard label="Dropped / New this Qtr" value={`${dropped} / ${newq}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client…" className={`${sel} w-56`} />
        <select value={mv} onChange={e => setMv(e.target.value)} className={sel}>
          <option value="">All movements (Qtr)</option>
          <option value="Dropped">Dropped (gave last Qtr, not this)</option>
          <option value="New">New this quarter</option>
          <option value="Up">Up vs last quarter</option>
          <option value="Down">Down vs last quarter</option>
          <option value="Flat">Flat</option>
        </select>
        <span className="text-xs text-mav-muted ml-auto">{view.length} clients · scroll right for all quarters →</span>
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-5 py-3 font-medium sticky left-0 bg-mav-panel">Client</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY {String(lyStart).slice(2)}-{String(tyStart).slice(2)}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY {String(tyStart).slice(2)} TD</th>
                {QS.map((f, i) => <th key={i} className="px-4 py-3 font-medium text-right whitespace-nowrap">{qLabel(f)}{i === LAST_I ? ' (this)' : i === PREV_I ? ' (last)' : ''}</th>)}
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">QoQ Δ</th>
                <th className="px-5 py-3 font-medium">Qtr trend</th>
              </tr>
            </thead>
            <tbody>
              {view.map(r => {
                const st = qStatus(r); const p = qPct(r); const d = qDelta(r)
                return (
                  <tr key={r.client} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-3 font-medium whitespace-nowrap sticky left-0 bg-mav-panel">{r.client}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{r.fyLast ? money(r.fyLast) : '—'}</td>
                    <td className="px-4 py-3 text-right">{r.fyTd ? money(r.fyTd) : '—'}</td>
                    {r.qv.map((v, i) => <td key={i} className={`px-4 py-3 text-right whitespace-nowrap ${i === LAST_I ? '' : 'text-mav-muted'}`}>{v ? money(v) : '—'}</td>)}
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${d > 0 ? 'text-green-400' : d < 0 ? 'text-red-400' : 'text-mav-muted'}`}>
                      {d === 0 ? '—' : (d > 0 ? '+' : '') + money(d)}{p != null && <span className="text-xs text-mav-muted ml-1">({p >= 0 ? '+' : ''}{p}%)</span>}
                    </td>
                    <td className="px-5 py-3"><span className={`text-xs px-2 py-1 rounded-full ${badge(st)}`}>{st}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
