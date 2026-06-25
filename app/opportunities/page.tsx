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

export default function Opportunities() {
  const [all, setAll] = useState<Opportunity[]>([])
  const [search, setSearch] = useState(''); const [fType, setFType] = useState(''); const [fGeo, setFGeo] = useState('')
  const [fOwner, setFOwner] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
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
        <KPICard label="Opportunities" value={String(o.length)} />
        <KPICard label="New clients" value={String(o.filter(x => x.is_new_client).length)} />
        <KPICard label="RFQs" value={String(o.filter(x => x.rfq).length)} />
        <KPICard label="GEOs" value={String(uniq(o.map(x => x.geo)).length)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Client', 'Type', 'RFQ status', 'Owner', 'GEO', 'Subject', 'Date'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{o.map(x => (
            <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
              <td className="px-4 py-3">{x.company_name}{x.summary && <div className="text-xs text-mav-muted">{x.summary.slice(0, 80)}</div>}</td>
              <td className="px-4 py-3">{x.is_new_client ? 'New' : 'Repeat'}</td>
              <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${badge(x.rfq_status)}`}>{x.rfq_status || (x.rfq ? 'RFQ' : '—')}</span></td>
              <td className="px-4 py-3 text-mav-muted">{x.sales_person}</td>
              <td className="px-4 py-3 text-mav-muted">{x.geo}</td>
              <td className="px-4 py-3 text-mav-muted truncate max-w-xs">{x.source_subject}</td>
              <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.source_date || '').slice(0, 10)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
