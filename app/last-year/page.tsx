'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, type BookingRow } from '@/lib/supabase'

const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const pad = (n: number) => String(n).padStart(2, '0')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
const curM = now.getMonth() + 1          // 1-12
const curMM = pad(curM)
// "this year" FY starts Apr of (curM>=4 ? thisCalendarYear : lastCalendarYear)
const tyStart = curM >= 4 ? now.getFullYear() : now.getFullYear() - 1   // e.g. 2026
const lyStart = tyStart - 1                                              // 2025
const spLabel = (yr: number) => `Apr–${SHORT[curM]} '${String(yr).slice(2)}`

type Row = {
  client: string
  fyPrev: number      // FY (lyStart-1 .. lyStart) i.e. Apr 2024 – Mar 2025
  fyLast: number      // FY (lyStart .. tyStart)  i.e. Apr 2025 – Mar 2026
  fyTd: number        // FY (tyStart ..)          i.e. Apr 2026 – to date
  spLy: number        // same window last year
  spTy: number        // same window this year
}

export default function LastYearReview() {
  const [rows, setRows] = useState<BookingRow[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => { getBookingsFull().then(setRows) }, [])

  const data = useMemo(() => {
    const m = new Map<string, Row>()
    const between = (k: string, a: string, b: string) => k >= a && k <= b
    rows.forEach(r => {
      const c = (r.company_name || '').trim()
      if (!c) return
      const k = (r.booking_month || '').slice(0, 7)
      const amt = r.booking_amount || 0
      const cur = m.get(c) || { client: c, fyPrev: 0, fyLast: 0, fyTd: 0, spLy: 0, spTy: 0 }
      if (between(k, `${lyStart - 1}-04`, `${lyStart}-03`)) cur.fyPrev += amt
      if (between(k, `${lyStart}-04`, `${tyStart}-03`)) cur.fyLast += amt
      if (k >= `${tyStart}-04`) cur.fyTd += amt
      if (between(k, `${lyStart}-04`, `${lyStart}-${curMM}`)) cur.spLy += amt
      if (between(k, `${tyStart}-04`, `${tyStart}-${curMM}`)) cur.spTy += amt
      m.set(c, cur)
    })
    return [...m.values()]
  }, [rows])

  const statusOf = (r: Row) => {
    if (r.spLy <= 0 && r.spTy > 0) return 'New'
    if (r.spLy > 0 && r.spTy <= 0) return 'Lost'
    if (r.spTy > r.spLy) return 'Growing'
    if (r.spTy < r.spLy) return 'Shrinking'
    return 'Flat'
  }
  const pct = (r: Row) => r.spLy > 0 ? Math.round(((r.spTy - r.spLy) / r.spLy) * 100) : null

  const view = useMemo(() => data
    .filter(r => r.client.toLowerCase().includes(q.toLowerCase()))
    .filter(r => !status || statusOf(r) === status)
    .filter(r => r.fyPrev || r.fyLast || r.fyTd)
    .sort((a, b) => b.fyLast - a.fyLast), [data, q, status])

  const tot = (sel: (r: Row) => number) => view.reduce((s, r) => s + sel(r), 0)
  const allTyLy = useMemo(() => ({ ly: data.reduce((s, r) => s + r.spLy, 0), ty: data.reduce((s, r) => s + r.spTy, 0) }), [data])
  const yoyPct = allTyLy.ly > 0 ? Math.round(((allTyLy.ty - allTyLy.ly) / allTyLy.ly) * 100) : null
  const growing = data.filter(r => statusOf(r) === 'Growing' || statusOf(r) === 'New').length
  const shrinking = data.filter(r => statusOf(r) === 'Shrinking' || statusOf(r) === 'Lost').length

  const badge = (s: string) => {
    const map: Record<string, string> = {
      Growing: 'bg-green-500/15 text-green-400', New: 'bg-green-500/15 text-green-400',
      Shrinking: 'bg-red-500/15 text-red-400', Lost: 'bg-red-500/15 text-red-400',
      Flat: 'bg-mav-line text-mav-muted',
    }
    return map[s] || 'bg-mav-line text-mav-muted'
  }
  const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

  return (
    <div>
      <Header title="Last Year Review" subtitle={`Year-on-year business from the web revenue sheet — who's growing and who's slipping`} />

      <div className="mb-4 text-xs text-mav-muted bg-mav-panel border border-mav-line rounded-lg px-3 py-2">
        Note: the revenue sheet currently holds data from April 2025 onward, so the <span className="text-white">Apr 2024–Mar 2025</span> column is mostly empty.
        The reliable comparison is like-for-like <span className="text-white">{spLabel(lyStart)}</span> vs <span className="text-white">{spLabel(tyStart)}</span>.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label={`FY ${lyStart}-${String(tyStart).slice(2)} (Apr–Mar)`} value={money(tot(r => r.fyLast))} />
        <KPICard label={`FY ${tyStart}-${String(tyStart + 1).slice(2)} to date`} value={money(tot(r => r.fyTd))} />
        <KPICard label={`${spLabel(lyStart)} → ${spLabel(tyStart)}`} value={(yoyPct == null ? '—' : (yoyPct >= 0 ? '+' : '') + yoyPct + '%')} change={yoyPct} />
        <KPICard label="Growing / Shrinking" value={`${growing} / ${shrinking}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client…" className={`${sel} w-56`} />
        <select value={status} onChange={e => setStatus(e.target.value)} className={sel}>
          <option value="">All movements</option>
          <option value="Growing">Growing</option>
          <option value="Shrinking">Shrinking</option>
          <option value="New">New</option>
          <option value="Lost">Lost</option>
          <option value="Flat">Flat</option>
        </select>
        <span className="text-xs text-mav-muted ml-auto">{view.length} clients</span>
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY 24-25</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY 25-26</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY 26 to date</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{spLabel(lyStart)}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{spLabel(tyStart)}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">YoY Δ</th>
                <th className="px-5 py-3 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {view.map(r => {
                const st = statusOf(r); const p = pct(r); const d = r.spTy - r.spLy
                return (
                  <tr key={r.client} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-3 font-medium whitespace-nowrap">{r.client}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{r.fyPrev ? money(r.fyPrev) : '—'}</td>
                    <td className="px-4 py-3 text-right">{r.fyLast ? money(r.fyLast) : '—'}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{r.fyTd ? money(r.fyTd) : '—'}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{r.spLy ? money(r.spLy) : '—'}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{r.spTy ? money(r.spTy) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${d > 0 ? 'text-green-400' : d < 0 ? 'text-red-400' : 'text-mav-muted'}`}>
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
