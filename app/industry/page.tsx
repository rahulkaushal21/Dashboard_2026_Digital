'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import BarCard from '@/components/BarCard'
import { getSqlLeads, type SqlLead } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function Industry() {
  const [all, setAll] = useState<SqlLead[]>([])
  const [fVenture, setFVenture] = useState(''); const [fRegion, setFRegion] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  useEffect(() => { getSqlLeads().then(setAll) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const s = useMemo(() => all
    .filter(x => !fVenture || (x.venture || '') === fVenture)
    .filter(x => !fRegion || (x.prospect_region || '') === fRegion)
    .filter(x => inRange(x.lead_date)), [all, fVenture, fRegion, from, to])

  const data = useMemo(() => {
    const counts: Record<string, number> = {}
    s.forEach(x => { const k = x.industry || 'Unknown'; counts[k] = (counts[k] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [s])
  const reset = () => { setFVenture(''); setFRegion(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Industry Focus" subtitle="Top industries by lead volume — filter by venture, region and date" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={fVenture} onChange={e => setFVenture(e.target.value)} className={selCls}><option value="">All ventures</option>{uniq(all.map(x => x.venture)).map(v => <option key={v} value={v}>{v}</option>)}</select>
        <select value={fRegion} onChange={e => setFRegion(e.target.value)} className={selCls}><option value="">All regions</option>{uniq(all.map(x => x.prospect_region)).map(r => <option key={r} value={r}>{r}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
        <span className="text-xs text-mav-muted ml-2">{s.length} leads in view</span>
      </div>
      <BarCard title="Top 10 industries by leads" data={data} />
    </div>
  )
}
