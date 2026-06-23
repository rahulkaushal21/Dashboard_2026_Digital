'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getClients, type Client } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const sentColor = (s?: string) =>
  s === 'At Risk' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
  : s === 'Watch' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
  : s === 'Positive' ? 'bg-green-500/15 text-green-400 border border-green-500/30'
  : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'

const dot = (rag?: string) => rag === 'Red' ? 'bg-red-400' : rag === 'Amber' ? 'bg-amber-400' : 'bg-green-400'

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { getClients().then(setClients) }, [])
  const rows = clients
    .filter(c => c.company_name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.ltv_usd || 0) - (a.ltv_usd || 0))
  const atRisk = clients.filter(c => c.sentiment === 'At Risk').length
  const positive = clients.filter(c => c.sentiment === 'Positive').length
  const totalLtv = clients.reduce((s, c) => s + (c.ltv_usd || 0), 0)
  return (
    <div>
      <Header title="Clients" subtitle="Portfolio, health & last-quarter sentiment journey" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Clients" value={String(clients.length)} />
        <KPICard label="At risk" value={String(atRisk)} />
        <KPICard label="Positive" value={String(positive)} />
        <KPICard label="Total LTV" value={fmtUsd(totalLtv)} />
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…"
        className="mb-4 w-full md:w-72 bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>{['', 'Client', 'Sentiment', 'Industry', 'GEO', 'Owner', 'LTV', ''].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const isOpen = open === c.company_name
              const hasDetail = !!(c.journey || c.action_steps)
              return (
                <>
                  <tr key={c.company_name} onClick={() => hasDetail && setOpen(isOpen ? null : c.company_name)}
                    className={`border-b border-mav-line/60 hover:bg-mav-dark/40 ${hasDetail ? 'cursor-pointer' : ''}`}>
                    <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dot(c.rag_status)}`} /></td>
                    <td className="px-4 py-3 font-medium">{c.company_name}{c.email && <div className="text-xs text-mav-muted font-normal">{c.email}</div>}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${sentColor(c.sentiment)}`}>{c.sentiment || 'Neutral'}</span></td>
                    <td className="px-4 py-3 text-mav-muted">{c.industry || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.geo || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.pc_sme || '—'}</td>
                    <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                    <td className="px-4 py-3 text-mav-muted text-xs">{hasDetail ? (isOpen ? '▲' : '▼') : ''}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-mav-dark/30 border-b border-mav-line/60">
                      <td colSpan={8} className="px-6 py-4">
                        {c.journey && <div className="mb-3"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Last-quarter journey</div><div className="text-sm">{c.journey}</div></div>}
                        {c.action_steps && <div><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Action steps</div><div className="text-sm text-mav-yellow">{c.action_steps}</div></div>}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
