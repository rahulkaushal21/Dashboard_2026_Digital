'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getOpportunities, type Opportunity } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const badge = (s?: string) => {
  const map: Record<string, string> = { pending: 'bg-amber-500/15 text-amber-400', received: 'bg-blue-500/15 text-blue-400', quoted: 'bg-purple-500/15 text-purple-300', won: 'bg-green-500/15 text-green-400', lost: 'bg-red-500/15 text-red-400' }
  return map[(s || '').toLowerCase()] || 'bg-mav-line text-mav-muted'
}
const SRC_ORDER = ['spreadsheet', 'email']
const srcTag = (s: string) => s === 'email' ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400'
const srcLabel = (s: string) => s === 'email' ? 'Email' : 'Sheet'
const probColor = (p?: number) => p == null ? 'bg-mav-line text-mav-muted' : p >= 60 ? 'bg-green-500/15 text-green-400' : p >= 45 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
const probBar = (p?: number) => p == null ? 'bg-mav-line' : p >= 60 ? 'bg-green-500' : p >= 45 ? 'bg-amber-500' : 'bg-red-500'
const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')

export default function Opportunities() {
  const [all, setAll] = useState<Opportunity[]>([])
  const [search, setSearch] = useState(''); const [fType, setFType] = useState(''); const [fGeo, setFGeo] = useState('')
  const [fOwner, setFOwner] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel, setSel] = useState<Opportunity | null>(null)
  useEffect(() => { getOpportunities().then(setAll) }, [])

  const inRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return !from && !to; if (from && v < from) return false; if (to && v > to) return false; return true }
  const o = useMemo(() => all
    .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => !fType || (x.is_new_client ? 'New' : 'Repeat') === fType)
    .filter(x => !fGeo || (x.geo || '') === fGeo)
    .filter(x => !fOwner || (x.sales_person || '') === fOwner)
    .filter(x => inRange(x.source_date))
    .sort((a, b) => new Date(b.source_date || 0).getTime() - new Date(a.source_date || 0).getTime()), [all, search, fType, fGeo, fOwner, from, to])
  const reset = () => { setSearch(''); setFType(''); setFGeo(''); setFOwner(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Opportunities" subtitle="Open quotes from the sheet + new business from email, newest first" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client…" className={`${selCls} w-44`} />
        <select value={fType} onChange={e => setFType(e.target.value)} className={selCls}><option value="">All types</option><option value="New">New</option><option value="Repeat">Repeat</option></select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(all.map(x => x.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)} className={selCls}><option value="">All owners</option>{uniq(all.map(x => x.sales_person)).map(ow => <option key={ow} value={ow}>{ow}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open opps" value={String(o.filter(x => !x.won).length)} />
        <KPICard label="Won" value={String(o.filter(x => x.won).length)} />
        <KPICard label="Won value" value={money(o.filter(x => x.won).reduce((s, x) => s + (x.won_amount || 0), 0))} />
        <KPICard label="GEOs" value={String(uniq(o.map(x => x.geo)).length)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Client', 'Win %', 'Source', 'Type', 'Owner', 'GEO', 'Subject', 'Date'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{o.map(x => (
            <tr key={x.id} onClick={() => setSel(x)} className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
              <td className="px-4 py-3">{x.company_name}{x.won && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold whitespace-nowrap">✓ Won · {money(x.won_amount)}</span>}{x.summary && <div className="text-xs text-mav-muted">{x.summary.slice(0, 80)}</div>}</td>
              <td className="px-4 py-3">{x.win_probability != null ? <span className={`text-xs font-semibold px-2 py-1 rounded-full ${probColor(x.win_probability)}`}>{x.win_probability}%</span> : <span className="text-xs text-mav-muted">—</span>}</td>
              <td className="px-4 py-3 whitespace-nowrap">{(x.sources || (x.source ? [x.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full mr-1 ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}</td>
              <td className="px-4 py-3">{x.is_new_client ? 'New' : 'Repeat'}</td>
              <td className="px-4 py-3 text-mav-muted">{x.sales_person}{x.pm_owner && <div className="text-xs text-mav-yellow mt-0.5">PM: {x.pm_owner}</div>}</td>
              <td className="px-4 py-3 text-mav-muted">{x.geo}</td>
              <td className="px-4 py-3 text-mav-muted truncate max-w-xs">{x.source_subject}</td>
              <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.source_date || '').slice(0, 10)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {sel && (
        <div className="fixed inset-0 z-40" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold">{sel.company_name}</h2>
                <div className="mt-1 flex flex-wrap gap-1">{(sel.sources || (sel.source ? [sel.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}</div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            {sel.won && <div className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-400 font-semibold">✓ Won — {money(sel.won_amount)} confirmed (booked in the revenue sheet)</div>}

            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs uppercase tracking-wide text-mav-muted">Conversion probability</span>
                <span className={`text-2xl font-bold ${sel.win_probability == null ? 'text-mav-muted' : sel.win_probability >= 60 ? 'text-green-400' : sel.win_probability >= 45 ? 'text-amber-400' : 'text-red-400'}`}>{sel.win_probability != null ? sel.win_probability + '%' : '—'}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-mav-dark overflow-hidden"><div className={`h-full ${probBar(sel.win_probability)}`} style={{ width: (sel.win_probability ?? 0) + '%' }} /></div>
            </div>

            {sel.gist && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">What&apos;s happening</div><p className="text-sm leading-relaxed">{sel.gist}</p></div>}
            {sel.win_reason && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Why this probability</div><p className="text-sm leading-relaxed text-mav-muted">{sel.win_reason}</p></div>}
            {sel.company_note && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Company</div><p className="text-sm leading-relaxed italic text-mav-muted">{sel.company_note}</p></div>}
            {!sel.gist && <p className="text-sm text-mav-muted mb-5">No email-thread analysis yet for this lead — it currently comes from an open quote in the sheet. {sel.summary}</p>}

            <div className="border-t border-mav-line pt-4 grid grid-cols-2 gap-y-3 text-sm">
              <div><div className="text-xs text-mav-muted">Owner</div>{sel.sales_person || '—'}</div>
              <div><div className="text-xs text-mav-muted">PM looped in</div>{sel.pm_owner || '—'}</div>
              <div><div className="text-xs text-mav-muted">Type</div>{sel.is_new_client ? 'New' : 'Repeat'}</div>
              <div><div className="text-xs text-mav-muted">RFQ status</div><span className={`text-xs px-2 py-1 rounded-full ${badge(sel.rfq_status)}`}>{sel.rfq_status || (sel.rfq ? 'RFQ' : '—')}</span></div>
              <div><div className="text-xs text-mav-muted">GEO</div>{sel.geo || '—'}</div>
              <div><div className="text-xs text-mav-muted">Date</div>{(sel.source_date || '').slice(0, 10) || '—'}</div>
              <div className="col-span-2"><div className="text-xs text-mav-muted">Subject</div>{sel.source_subject || '—'}</div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
