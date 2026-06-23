'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getEscalations, type Escalation } from '@/lib/supabase'

const impact = (i?: string) => i === 'High' ? 'text-red-400' : i === 'Medium' ? 'text-amber-400' : 'text-mav-muted'

export default function Escalations() {
  const [e, setE] = useState<Escalation[]>([])
  useEffect(() => { getEscalations().then(setE) }, [])
  const major = e.filter(x => x.escalation_type === 'Major')
  const high = e.filter(x => x.business_impact === 'High')
  const byCompany: Record<string, number> = {}; e.forEach(x => { byCompany[x.company_name || '?'] = (byCompany[x.company_name || '?'] || 0) + 1 })
  const repeat = Object.entries(byCompany).filter(([, n]) => n >= 3)
  return (
    <div>
      <Header title="Escalations" subtitle="Client escalations captured from email" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KPICard label="Total" value={String(e.length)} />
        <KPICard label="Major" value={String(major.length)} />
        <KPICard label="High impact" value={String(high.length)} />
      </div>
      {repeat.length > 0 && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 mb-6">Alert: {repeat.map(([c]) => c).join(', ')} have 3+ escalations this quarter.</div>}
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Company','GEO','Type','Nature','Impact','Subject'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{e.map(x => (
            <tr key={x.id} className="border-b border-mav-line/60"><td className="px-4 py-3">{x.company_name}</td><td className="px-4 py-3 text-mav-muted">{x.geo}</td><td className="px-4 py-3 text-mav-muted">{x.escalation_type}</td><td className="px-4 py-3 text-mav-muted">{x.situation_type}</td><td className={`px-4 py-3 ${impact(x.business_impact)}`}>{x.business_impact}</td><td className="px-4 py-3 text-mav-muted">{x.email_subject}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
