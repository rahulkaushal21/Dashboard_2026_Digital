'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getSqlLeads, type SqlLead } from '@/lib/supabase'

export default function SqlLeads() {
  const [s, setS] = useState<SqlLead[]>([])
  useEffect(() => { getSqlLeads().then(setS) }, [])
  const ventures = new Set(s.map(x => x.venture)).size
  const geos = new Set(s.map(x => x.prospect_region)).size
  return (
    <div>
      <Header title="SQL / Leads" subtitle="Sales-qualified leads by persona, venture and geo" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KPICard label="Total SQLs" value={String(s.length)} />
        <KPICard label="Ventures" value={String(ventures)} />
        <KPICard label="Regions" value={String(geos)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Company','Industry','Persona','Venture','Region','Owner'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{s.map(x => (
            <tr key={x.id} className="border-b border-mav-line/60"><td className="px-4 py-3">{x.company_name}</td><td className="px-4 py-3 text-mav-muted">{x.industry}</td><td className="px-4 py-3 text-mav-muted">{x.persona}</td><td className="px-4 py-3 text-mav-muted">{x.venture}</td><td className="px-4 py-3 text-mav-muted">{x.prospect_region}</td><td className="px-4 py-3 text-mav-muted">{x.assigned_to}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
