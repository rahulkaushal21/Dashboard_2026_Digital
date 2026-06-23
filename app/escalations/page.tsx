'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getEscalations, type Escalation } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const isMajor = (x: Escalation) => /major/i.test(x.business_impact || '') || /major/i.test(x.escalation_type || '')

export default function Escalations() {
  const [all, setAll] = useState<Escalation[]>([])
  const [search, setSearch] = useState('')
  const [fType, setFType] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => { getEscalations().then(setAll) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const e = useMemo(() => all
    .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => !fType || (x.escalation_type || '') === fType)
    .filter(x => !fGeo || (x.geo || '') === fGeo)
    .filter(x => inRange(x.tracking_date)), [all, search, fType, fGeo, from, to])
  const reset = () => { setSearch(''); setFType(''); setFGeo(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Escalations" subtitle="Client escalations & experience triggers — filter by type, GEO and date" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company…" className={`${selCls} w-44`} />
        <select value={fType} onChange={e => setFType(e.target.value)} className={selCls}><option value="">All types</option>{uniq(all.map(x => x.escalation_type)).map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(all.map(x => x.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Escalations" value={String(e.length)} />
        <KPICard label="Major impact" value={String(e.filter(isMajor).length)} />
        <KPICard label="Companies" value={String(uniq(e.map(x => x.company_name)).length)} />
        <KPICard label="Types" value={String(uniq(e.map(x => x.escalation_type)).length)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Date', 'Company', 'Type', 'Situation', 'Impact', 'GEO', 'Subject'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{e.slice(0, 400).map(x => (
            <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
              <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.tracking_date || x.month || '—'}</td>
              <td className="px-4 py-3">{x.company_name}</td>
              <td className="px-4 py-3"><span className={`text-xs ${isMajor(x) ? 'text-red-400' : 'text-mav-muted'}`}>{x.escalation_type || '—'}</span></td>
              <td className="px-4 py-3 text-mav-muted">{x.situation_type}</td>
              <td className="px-4 py-3 text-mav-muted">{x.business_impact}</td>
              <td className="px-4 py-3 text-mav-muted">{x.geo}</td>
              <td className="px-4 py-3 text-mav-muted truncate max-w-xs">{x.email_subject}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
