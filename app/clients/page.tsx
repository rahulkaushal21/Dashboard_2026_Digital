'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { getClients, type Client } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const dot = (rag?: string) => rag === 'Red' ? 'bg-red-400' : rag === 'Amber' ? 'bg-amber-400' : 'bg-green-400'

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [q, setQ] = useState('')
  useEffect(() => { getClients().then(setClients) }, [])
  const rows = clients.filter(c => c.company_name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <Header title="Clients" subtitle="Portfolio, health and engagement detail" />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…"
        className="mb-4 w-full md:w-72 bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>{['','Client','Type','Industry','GEO','Owner','LTV','Sentiment'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.company_name} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dot(c.rag_status)}`} /></td>
                <td className="px-4 py-3">{c.company_name}</td>
                <td className="px-4 py-3 text-mav-muted">{c.client_type}</td>
                <td className="px-4 py-3 text-mav-muted">{c.industry}</td>
                <td className="px-4 py-3 text-mav-muted">{c.geo}</td>
                <td className="px-4 py-3 text-mav-muted">{c.pc_sme}</td>
                <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                <td className="px-4 py-3 text-mav-muted">{c.sentiment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
