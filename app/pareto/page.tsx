'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getRevenue, type RevenueRow } from '@/lib/supabase'
import { fmtUsd, topClients } from '@/lib/metrics'

export default function Pareto() {
  const [r, setR] = useState<RevenueRow[]>([])
  useEffect(() => { getRevenue().then(setR) }, [])
  const all = topClients(r, 1000)
  const total = all.reduce((s, x) => s + x.revenue, 0)
  const cut = Math.max(1, Math.ceil(all.length * 0.2))
  const top20 = all.slice(0, cut)
  const top20rev = top20.reduce((s, x) => s + x.revenue, 0)
  const share = total ? (top20rev / total) * 100 : 0
  return (
    <div>
      <Header title="20 / 80 Rule" subtitle="How much revenue the top 20% of clients drive" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KPICard label="Top 20% clients" value={String(cut)} />
        <KPICard label="Their revenue" value={fmtUsd(top20rev)} />
        <KPICard label="Share of total" value={`${share.toFixed(0)}%`} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['#','Client','Revenue','% of total'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{top20.map((c, i) => (
            <tr key={c.client_name} className="border-b border-mav-line/60"><td className="px-4 py-3 text-mav-muted">{i + 1}</td><td className="px-4 py-3">{c.client_name}</td><td className="px-4 py-3">{fmtUsd(c.revenue)}</td><td className="px-4 py-3 text-mav-muted">{((c.revenue / total) * 100).toFixed(1)}%</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
