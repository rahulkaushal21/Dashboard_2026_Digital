'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getClients, type Client } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const dot = (rag?: string) => rag === 'Red' ? 'bg-red-400' : rag === 'Amber' ? 'bg-amber-400' : 'bg-green-400'
const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [q, setQ] = useState('')
  const [ind, setInd] = useState('')
  const [aiOnly, setAiOnly] = useState(false)
  useEffect(() => { getClients().then(setClients) }, [])

  const rows = useMemo(() => clients
    .filter(c => c.company_name.toLowerCase().includes(q.toLowerCase()))
    .filter(c => !ind || (c.industry || 'Other / Unclassified') === ind)
    .filter(c => !aiOnly || c.ai_focus)
    .sort((a, b) => (b.ltv_usd || 0) - (a.ltv_usd || 0)), [clients, q, ind, aiOnly])

  const industries = uniq(clients.map(c => c.industry))
  const aiCount = clients.filter(c => c.ai_focus).length

  return (
    <div>
      <Header title="Clients" subtitle="Portfolio by industry — filter by sector and spot AI & Automation focus" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className={`${sel} w-60`} />
        <select value={ind} onChange={e => setInd(e.target.value)} className={sel}>
          <option value="">All industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <button onClick={() => setAiOnly(v => !v)}
          className={`text-sm px-3 py-2 rounded-md border transition-colors ${aiOnly ? 'bg-mav-yellow text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>
          ⚡ AI &amp; Automation{aiCount ? ` (${aiCount})` : ''}
        </button>
        <span className="text-xs text-mav-muted ml-auto">{rows.length} clients</span>
      </div>

      <p className="text-xs text-mav-muted mb-4">Industries are auto-classified from each client&apos;s name &amp; website domain; &quot;Other / Unclassified&quot; covers small or ambiguous accounts.</p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>{['', 'Client', 'Industry', 'GEO', 'Owner', 'LTV'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.company_name} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 ${c.ai_focus ? 'bg-mav-yellow/5' : ''}`}>
                  <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dot(c.rag_status)}`} /></td>
                  <td className="px-4 py-3">{c.company_name}{c.ai_focus && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold whitespace-nowrap">⚡ AI &amp; Automation</span>}{c.website && <div className="text-xs text-mav-muted">{c.website}</div>}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{c.industry || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted">{c.geo}</td>
                  <td className="px-4 py-3 text-mav-muted">{c.pc_sme}</td>
                  <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
