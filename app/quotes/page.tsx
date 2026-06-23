'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getQuotes, type Quote } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const isWon = (s?: string) => /confirm|won/i.test(s || '')
const isLost = (s?: string) => /cancel|lost|no confirmation|not responding/i.test(s || '')
const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function Quotes() {
  const [all, setAll] = useState<Quote[]>([])
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [fOwner, setFOwner] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => { getQuotes().then(setAll) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const q = useMemo(() => all
    .filter(x => (x.agency || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => !fStatus || (x.status || '') === fStatus)
    .filter(x => !fGeo || (x.geo || '') === fGeo)
    .filter(x => !fOwner || (x.sales_person || '') === fOwner)
    .filter(x => inRange(x.added_date)), [all, search, fStatus, fGeo, fOwner, from, to])

  const won = q.filter(x => isWon(x.status)); const lost = q.filter(x => isLost(x.status))
  const decided = won.length + lost.length; const conv = decided ? (won.length / decided) * 100 : 0
  const totalUsd = q.reduce((s, x) => s + (x.usd_value || 0), 0)
  const reset = () => { setSearch(''); setFStatus(''); setFGeo(''); setFOwner(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Quotes" subtitle="Pipeline, win rate & lost reasons — filter by status, GEO, owner and date" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agency…" className={`${selCls} w-44`} />
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={selCls}><option value="">All status</option>{uniq(all.map(x => x.status)).map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(all.map(x => x.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)} className={selCls}><option value="">All owners</option>{uniq(all.map(x => x.sales_person)).map(o => <option key={o} value={o}>{o}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard label="Quotes" value={String(q.length)} />
        <KPICard label="Won" value={String(won.length)} />
        <KPICard label="Lost" value={String(lost.length)} />
        <KPICard label="Conversion" value={`${conv.toFixed(0)}%`} />
        <KPICard label="Pipeline value" value={fmtUsd(totalUsd)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Date', 'Agency', 'Value', 'Status', 'Type', 'GEO', 'Owner'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{q.slice(0, 300).map(x => (
            <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
              <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.added_date || '—'}</td>
              <td className="px-4 py-3">{x.agency || '—'}</td>
              <td className="px-4 py-3">{x.usd_value ? fmtUsd(x.usd_value) : '—'}</td>
              <td className="px-4 py-3"><span className={`text-xs ${isWon(x.status) ? 'text-green-400' : isLost(x.status) ? 'text-red-400' : 'text-mav-muted'}`}>{x.status}</span></td>
              <td className="px-4 py-3 text-mav-muted">{x.business_type}</td>
              <td className="px-4 py-3 text-mav-muted">{x.geo}</td>
              <td className="px-4 py-3 text-mav-muted">{x.sales_person}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
