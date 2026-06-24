'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getRevenue, type RevenueRow } from '@/lib/supabase'
import { fmtUsd, topClients } from '@/lib/metrics'

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function Pareto() {
  const [r, setR] = useState<RevenueRow[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  useEffect(() => { getRevenue().then(setR) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const filtered = useMemo(() => r.filter(x => inRange(x.month)), [r, from, to])
  const all = topClients(filtered, 1000)
  const total = all.reduce((s, x) => s + x.revenue, 0)
  const cut = Math.max(1, Math.ceil(all.length * 0.2))
  const top20 = all.slice(0, cut)
  const top20rev = top20.reduce((s, x) => s + x.revenue, 0)
  const share = total ? (top20rev / total) * 100 : 0
  const reset = () => { setFrom(''); setTo('') }

  return (
    <div>
      <Header title="20 / 80 Rule" subtitle="How much revenue the top 20% of clients drive — filter by date range" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
        <span className="text-xs text-mav-muted ml-2">{all.length} clients in view</span>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KPICard label="Top 20% clients" value={String(cut)} />
        <KPICard label="Their revenue" value={fmtUsd(top20rev)} />
        <KPICard label="Share of total" value={`${share.toFixed(0)}%`} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['#', 'Client', 'Revenue', '% of total'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{top20.map((c, i) => (
            <tr key={c.client_name} className="border-b border-mav-line/60"><td className="px-4 py-3 text-mav-muted">{i + 1}</td><td className="px-4 py-3">{c.client_name}</td><td className="px-4 py-3">{fmtUsd(c.revenue)}</td><td className="px-4 py-3 text-mav-muted">{total ? ((c.revenue / total) * 100).toFixed(1) : '0'}%</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
