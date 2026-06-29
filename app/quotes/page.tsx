'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getQuotes, getConversions, type Quote, type QuoteConversion } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

type SortField = 'quote_id' | 'agency' | 'usd_value' | 'status'

export default function Quotes() {
  const [q, setQ] = useState<Quote[]>([]); const [c, setC] = useState<QuoteConversion[]>([])
  const [designOnly, setDesignOnly] = useState(false)
  const [sortBy, setSortBy] = useState<SortField>('quote_id')
  const [sortAsc, setSortAsc] = useState(false)
  
  useEffect(() => { getQuotes().then(setQ); getConversions().then(setC) }, [])
  
  const won = c.filter(x => x.outcome === 'won'); const lost = c.filter(x => x.outcome === 'lost')
  const decided = won.length + lost.length
  const conv = decided ? (won.length / decided) * 100 : 0
  const isDesign = (x: Quote) => /design/i.test((x as { technology?: string }).technology || '')
  const designCount = q.filter(isDesign).length
  
  const rows = useMemo(() => {
    let result = designOnly ? q.filter(isDesign) : q
    
    // Apply sorting
    result = [...result].sort((a, b) => {
      let aVal: string | number, bVal: string | number
      
      switch (sortBy) {
        case 'quote_id':
          aVal = (a.quote_id || '').toLowerCase()
          bVal = (b.quote_id || '').toLowerCase()
          break
        case 'agency':
          aVal = (a.agency || '').toLowerCase()
          bVal = (b.agency || '').toLowerCase()
          break
        case 'usd_value':
          aVal = a.usd_value || 0
          bVal = b.usd_value || 0
          break
        case 'status':
          aVal = (a.status || '').toLowerCase()
          bVal = (b.status || '').toLowerCase()
          break
        default:
          aVal = 0
          bVal = 0
      }
      
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })
    
    return result
  }, [q, designOnly, sortBy, sortAsc])
  
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(field)
      setSortAsc(false)
    }
  }

  const getSortIndicator = (field: string) => {
    if (sortBy !== field) return ' ↕'
    return sortAsc ? ' ↑' : ' ↓'
  }
  
  return (
    <div>
      <Header title="Quotes" subtitle="Pipeline from the sheet · won/lost from email · Design and every other technology tagged" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Quotes shared" value={String(q.length)} />
        <KPICard label="Won" value={String(won.length)} />
        <KPICard label="Lost" value={String(lost.length)} />
        <KPICard label="Conversion rate" value={`${conv.toFixed(0)}%`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setDesignOnly(v => !v)}
          className={`text-sm px-3 py-2 rounded-md border transition-colors ${designOnly ? 'bg-mav-yellow text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>
          🎨 Design only{designCount ? ` (${designCount})` : ''}
        </button>
        <span className="text-xs text-mav-muted ml-auto">{rows.length} quotes</span>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                {[
                  <button key="quote_id" onClick={() => handleSort('quote_id')} className="hover:text-white cursor-pointer">Quote{getSortIndicator('quote_id')}</button>,
                  <button key="agency" onClick={() => handleSort('agency')} className="hover:text-white cursor-pointer">Agency{getSortIndicator('agency')}</button>,
                  <button key="usd_value" onClick={() => handleSort('usd_value')} className="hover:text-white cursor-pointer">Value{getSortIndicator('usd_value')}</button>,
                  'Tech',
                  <button key="status" onClick={() => handleSort('status')} className="hover:text-white cursor-pointer">Status{getSortIndicator('status')}</button>,
                  'Type',
                  'Owner'
                ].map((h, i) => <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>{rows.map(x => {
              const tech = (x as { technology?: string }).technology
              return (
              <tr key={x.id} className={`border-b border-mav-line/60 ${isDesign(x) ? 'bg-mav-yellow/5' : ''}`}>
                <td className="px-4 py-3 whitespace-nowrap">{x.quote_id}</td>
                <td className="px-4 py-3">{x.agency}</td>
                <td className="px-4 py-3 whitespace-nowrap">{x.usd_value ? fmtUsd(x.usd_value) : '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{tech ? <span className={isDesign(x) ? 'text-mav-yellow font-medium' : 'text-mav-muted'}>{tech}</span> : <span className="text-mav-muted">—</span>}</td>
                <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.status}</td>
                <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.business_type}</td>
                <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.sales_person}</td>
              </tr>
            )})}</tbody>
          </table>
          </div>
        </div>
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="text-sm font-medium mb-4">Lost — reasons</div>
          <ul className="space-y-3 text-sm">{lost.map(l => (
            <li key={l.id}><div className="flex justify-between"><span>{l.company_name}</span><span className="text-mav-muted">{l.amount_usd ? fmtUsd(l.amount_usd) : ''}</span></div><div className="text-xs text-red-400 mt-0.5">{l.lost_reason}</div></li>
          ))}</ul>
        </div>
      </div>
    </div>
  )
}
