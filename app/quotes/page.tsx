'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getQuotes, type Quote } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const isWon = (s?: string) => /confirm|won/i.test(s || '')
const isLost = (s?: string) => /cancel|lost|no confirmation|not responding/i.test(s || '')

export default function Quotes() {
  const [q, setQ] = useState<Quote[]>([])
  useEffect(() => { getQuotes().then(setQ) }, [])
  const won = q.filter(x => isWon(x.status))
  const lost = q.filter(x => isLost(x.status))
  const decided = won.length + lost.length
  const conv = decided ? (won.length / decided) * 100 : 0
  const totalUsd = q.reduce((s, x) => s + (x.usd_value || 0), 0)
  return (
    <div>
      <Header title="Quotes" subtitle="Pipeline, win rate & lost reasons — from the sheet" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Quotes shared" value={String(q.length)} />
        <KPICard label="Won" value={String(won.length)} />
        <KPICard label="Lost" value={String(lost.length)} />
        <KPICard label="Conversion rate" value={`${conv.toFixed(0)}%`} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Agency', 'Value', 'Status', 'Type', 'GEO', 'Owner'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{q.slice(0, 200).map(x => (
              <tr key={x.id} className="border-b border-mav-line/60"><td className="px-4 py-3">{x.agency || '—'}</td><td className="px-4 py-3">{x.usd_value ? fmtUsd(x.usd_value) : '—'}</td><td className="px-4 py-3 text-mav-muted">{x.status}</td><td className="px-4 py-3 text-mav-muted">{x.business_type}</td><td className="px-4 py-3 text-mav-muted">{x.geo}</td><td className="px-4 py-3 text-mav-muted">{x.sales_person}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="text-sm font-medium mb-1">Lost / cancelled</div>
          <div className="text-xs text-mav-muted mb-4">Total pipeline value: {fmtUsd(totalUsd)}</div>
          <ul className="space-y-3 text-sm">{lost.slice(0, 30).map(l => (
            <li key={l.id}><div className="flex justify-between"><span>{l.agency || '—'}</span><span className="text-mav-muted">{l.usd_value ? fmtUsd(l.usd_value) : ''}</span></div><div className="text-xs text-red-400 mt-0.5">{l.status}</div></li>
          ))}</ul>
        </div>
      </div>
    </div>
  )
}
