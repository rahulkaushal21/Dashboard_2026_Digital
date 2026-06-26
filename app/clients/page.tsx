'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getClients, type Client } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const dot = (rag?: string) => rag === 'Red' ? 'bg-red-400' : rag === 'Amber' ? 'bg-amber-400' : 'bg-green-400'
const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()

const sentTone = (s?: string) => {
  const v = (s || '').toLowerCase()
  if (/(positive|happy|good|great|strong|delight)/.test(v)) return 'bg-green-500/15 text-green-400'
  if (/(negative|unhappy|poor|bad|risk|frustrat|churn|escalat)/.test(v)) return 'bg-red-500/15 text-red-400'
  if (/(neutral|stable|ok|mixed)/.test(v)) return 'bg-amber-500/15 text-amber-400'
  return 'bg-mav-line text-mav-muted'
}
const ragTone = (r?: string) => r === 'Red' ? 'bg-red-500/15 text-red-400' : r === 'Amber' ? 'bg-amber-500/15 text-amber-400' : r === 'Green' ? 'bg-green-500/15 text-green-400' : 'bg-mav-line text-mav-muted'

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [q, setQ] = useState('')
  const [ind, setInd] = useState('')
  const [aiOnly, setAiOnly] = useState(false)
  const [selC, setSelC] = useState<Client | null>(null)
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
      <Header title="Clients" subtitle="Portfolio by industry — filter by sector, spot AI & Automation, click a client for full detail" />

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

      <p className="text-xs text-mav-muted mb-4">Industries are auto-classified from each client&apos;s name &amp; website; &quot;Other / Unclassified&quot; covers small or ambiguous accounts. Click any row to see sentiment, status, journey &amp; next steps.</p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>{['', 'Client', 'Industry', 'GEO', 'Owner', 'Sentiment', 'LTV'].map(h => <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.company_name} onClick={() => setSelC(c)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${c.ai_focus ? 'bg-mav-yellow/5' : ''}`}>
                  <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dot(c.rag_status)}`} /></td>
                  <td className="px-4 py-3">{c.company_name}{c.ai_focus && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold whitespace-nowrap">⚡ AI &amp; Automation</span>}{c.website && <div className="text-xs text-mav-muted">{c.website}</div>}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{c.industry || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted">{c.geo}</td>
                  <td className="px-4 py-3 text-mav-muted">{c.pc_sme}</td>
                  <td className="px-4 py-3">{c.sentiment ? <span className={`text-xs px-2 py-1 rounded-full ${sentTone(c.sentiment)}`}>{c.sentiment}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
                  <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selC && (
        <div className="fixed inset-0 z-40" onClick={() => setSelC(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot(selC.rag_status)}`} />
                  <h2 className="text-xl font-semibold">{selC.company_name}</h2>
                </div>
                {selC.ai_focus && <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold">⚡ AI &amp; Automation</span>}
                {selC.website && <div className="text-xs text-mav-muted mt-1">{selC.website}</div>}
              </div>
              <button onClick={() => setSelC(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
              {selC.sentiment && <span className={`text-xs px-2 py-1 rounded-full ${sentTone(selC.sentiment)}`}>Sentiment: {selC.sentiment}</span>}
              {selC.rag_status && <span className={`text-xs px-2 py-1 rounded-full ${ragTone(selC.rag_status)}`}>RAG: {selC.rag_status}</span>}
              {selC.client_status && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{selC.client_status}</span>}
            </div>

            <div className="border-t border-mav-line pt-4 grid grid-cols-2 gap-y-3 text-sm">
              <div><div className="text-xs text-mav-muted">Industry</div>{selC.industry || '—'}</div>
              <div><div className="text-xs text-mav-muted">Type</div>{selC.client_type || '—'}</div>
              <div><div className="text-xs text-mav-muted">GEO</div>{selC.geo || '—'}</div>
              <div><div className="text-xs text-mav-muted">Owner</div>{selC.pc_sme || selC.sales_person || '—'}</div>
              <div><div className="text-xs text-mav-muted">Lifetime value</div>{selC.ltv_usd ? fmtUsd(selC.ltv_usd) : '—'}</div>
              <div><div className="text-xs text-mav-muted">Last booking</div>{(selC.last_booking_month || '').slice(0, 7) || '—'}</div>
              {selC.email && <div className="col-span-2"><div className="text-xs text-mav-muted">Email</div>{selC.email}</div>}
            </div>

            {selC.industry_note && <div className="mt-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Industry note</div><p className="text-sm leading-relaxed text-mav-muted">{selC.industry_note}</p></div>}
            {selC.journey && <div className="mt-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Journey</div><p className="text-sm leading-relaxed whitespace-pre-wrap">{selC.journey}</p></div>}
            {selC.action_steps && <div className="mt-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Next steps</div><p className="text-sm leading-relaxed whitespace-pre-wrap">{selC.action_steps}</p></div>}
            {!selC.journey && !selC.action_steps && !selC.industry_note && <p className="text-sm text-mav-muted mt-5">No journey or action-step notes recorded for this client yet.</p>}
          </aside>
        </div>
      )}
    </div>
  )
}
