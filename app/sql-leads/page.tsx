'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getSqlLeads, type SqlLead } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function SqlLeads() {
  const [all, setAll] = useState<SqlLead[]>([])
  const [search, setSearch] = useState('')
  const [fVenture, setFVenture] = useState('')
  const [fRegion, setFRegion] = useState('')
  const [fOwner, setFOwner] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => { getSqlLeads().then(setAll) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const s = useMemo(() => all
    .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => !fVenture || (x.venture || '') === fVenture)
    .filter(x => !fRegion || (x.prospect_region || '') === fRegion)
    .filter(x => !fOwner || (x.assigned_to || '') === fOwner)
    .filter(x => inRange(x.lead_date)), [all, search, fVenture, fRegion, fOwner, from, to])

  const topIndustry = useMemo(() => {
    const m: Record<string, number> = {}; s.forEach(x => { const k = (x.industry || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  }, [s])
  const reset = () => { setSearch(''); setFVenture(''); setFRegion(''); setFOwner(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="SQL / Leads" subtitle="Sales-qualified leads — filter by venture, region, owner and date" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company…" className={`${selCls} w-44`} />
        <select value={fVenture} onChange={e => setFVenture(e.target.value)} className={selCls}><option value="">All ventures</option>{uniq(all.map(x => x.venture)).map(v => <option key={v} value={v}>{v}</option>)}</select>
        <select value={fRegion} onChange={e => setFRegion(e.target.value)} className={selCls}><option value="">All regions</option>{uniq(all.map(x => x.prospect_region)).map(r => <option key={r} value={r}>{r}</option>)}</select>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)} className={selCls}><option value="">All owners</option>{uniq(all.map(x => x.assigned_to)).map(o => <option key={o} value={o}>{o}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="SQLs" value={String(s.length)} />
        <KPICard label="Ventures" value={String(uniq(s.map(x => x.venture)).length)} />
        <KPICard label="Regions" value={String(uniq(s.map(x => x.prospect_region)).length)} />
        <KPICard label="Top industry" value={topIndustry} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Date', 'Company', 'Industry', 'Persona', 'Venture', 'Region', 'Owner'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{s.map(x => (
            <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
              <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.lead_date || `${x.month || ''} ${x.year || ''}`}</td>
              <td className="px-4 py-3">{x.company_name}</td>
              <td className="px-4 py-3 text-mav-muted">{x.industry}</td>
              <td className="px-4 py-3 text-mav-muted">{x.persona}</td>
              <td className="px-4 py-3 text-mav-muted">{x.venture}</td>
              <td className="px-4 py-3 text-mav-muted">{x.prospect_region}</td>
              <td className="px-4 py-3 text-mav-muted">{x.assigned_to}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
