'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { getOpportunities, type Opportunity } from '@/lib/supabase'

const badge = (s?: string) => {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-400', received: 'bg-blue-500/15 text-blue-400',
    quoted: 'bg-purple-500/15 text-purple-300', won: 'bg-green-500/15 text-green-400', lost: 'bg-red-500/15 text-red-400',
  }
  return map[s || ''] || 'bg-mav-line text-mav-muted'
}

export default function Opportunities() {
  const [opps, setOpps] = useState<Opportunity[]>([])
  useEffect(() => { getOpportunities().then(setOpps) }, [])
  return (
    <div>
      <Header title="Opportunities" subtitle="RFQs and new / repeat business scanned from the central inbox" />
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>{['Client','Type','RFQ status','Owner','GEO','Subject','Date'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {opps.map(o => (
              <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                <td className="px-4 py-3">{o.company_name}</td>
                <td className="px-4 py-3">{o.is_new_client ? 'New' : 'Repeat'}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${badge(o.rfq_status)}`}>{o.rfq_status}</span></td>
                <td className="px-4 py-3">{o.sales_person}</td>
                <td className="px-4 py-3">{o.geo}</td>
                <td className="px-4 py-3 text-mav-muted">{o.source_subject}</td>
                <td className="px-4 py-3 text-mav-muted">{o.source_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
