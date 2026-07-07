'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getEscalations, type Escalation } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const isMajor = (x: Escalation) => /major/i.test(x.business_impact || '') || /major/i.test(x.escalation_type || '')

type SortField = 'date' | 'company' | 'type'

export default function Escalations() {
  const [all, setAll] = useState<Escalation[]>([])
  const [search, setSearch] = useState('')
  const [fType, setFType] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('date')
  const [sortAsc, setSortAsc] = useState(false)
  const [sel, setSel] = useState<Escalation | null>(null)

  useEffect(() => { getEscalations().then(setAll) }, [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  
  const e = useMemo(() => {
    let result = all
      .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
      .filter(x => !fType || (x.escalation_type || '') === fType)
      .filter(x => !fGeo || (x.geo || '') === fGeo)
      .filter(x => inRange(x.tracking_date))
    
    // Apply sorting
    result = [...result].sort((a, b) => {
      let aVal: string | number, bVal: string | number
      
      switch (sortBy) {
        case 'date':
          aVal = a.tracking_date || a.month || ''
          bVal = b.tracking_date || b.month || ''
          break
        case 'company':
          aVal = (a.company_name || '').toLowerCase()
          bVal = (b.company_name || '').toLowerCase()
          break
        case 'type':
          aVal = (a.escalation_type || '').toLowerCase()
          bVal = (b.escalation_type || '').toLowerCase()
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
  }, [all, search, fType, fGeo, from, to, sortBy, sortAsc])
  
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(field)
      setSortAsc(field === 'date' ? true : false)
    }
  }

  const getSortIndicator = (field: string) => {
    if (sortBy !== field) return ' ↕'
    return sortAsc ? ' ↑' : ' ↓'
  }
  
  const reset = () => { setSearch(''); setFType(''); setFGeo(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Escalations" subtitle="Client escalations & experience triggers — filter by type, GEO and date, click headers to sort" />
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
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              {[
                <button key="date" onClick={() => handleSort('date')} className="hover:text-white cursor-pointer">Date{getSortIndicator('date')}</button>,
                <button key="company" onClick={() => handleSort('company')} className="hover:text-white cursor-pointer">Company{getSortIndicator('company')}</button>,
                <button key="type" onClick={() => handleSort('type')} className="hover:text-white cursor-pointer">Type{getSortIndicator('type')}</button>,
                'Situation',
                'Impact',
                'GEO',
                'Subject'
              ].map((h, i) => <th key={i} className="px-4 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>{e.slice(0, 400).map(x => (
            <tr key={x.id} onClick={() => setSel(x)} className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
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
      {sel && <EscalationDetail e={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="flex gap-3 py-2 border-b border-mav-line/40 last:border-0">
      <div className="w-32 shrink-0 text-xs uppercase tracking-wide text-mav-muted pt-0.5">{label}</div>
      <div className="text-sm text-white/90 break-words min-w-0">{children}</div>
    </div>
  )
}

function EscalationDetail({ e, onClose }: { e: Escalation; onClose: () => void }) {
  const major = /major|high/i.test(e.business_impact || '') || /major/i.test(e.escalation_type || '')
  const isLink = (s?: string) => !!s && /^https?:\/\//i.test(s)
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div onClick={ev => ev.stopPropagation()} className="bg-mav-panel border border-mav-line rounded-xl w-full max-w-2xl my-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-mav-line">
          <div>
            <div className="text-lg font-semibold text-white">{e.company_name || 'Escalation'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full border ${major ? 'border-red-500/50 text-red-400' : 'border-mav-line text-mav-muted'}`}>{e.escalation_type || 'Escalation'}</span>
              {e.business_impact && <span className="px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">{e.business_impact} impact</span>}
              {e.geo && <span className="px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">{e.geo}</span>}
              <span className="text-mav-muted">{e.tracking_date || e.month || ''}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-mav-muted hover:text-white text-xl leading-none px-2">×</button>
        </div>
        <div className="p-5">
          {e.evidence && (
            <div className="mb-4 rounded-lg bg-mav-dark/50 border border-mav-line p-4">
              <div className="text-xs uppercase tracking-wide text-mav-yellow mb-1">What happened — email insight</div>
              <div className="text-sm text-white/90 italic whitespace-pre-wrap">“{e.evidence}”</div>
            </div>
          )}
          <div className="rounded-lg border border-mav-line/60 px-4">
            <Row label="Subject">{e.email_subject}</Row>
            <Row label="Situation">{e.situation_type}</Row>
            <Row label="Project">{e.project_name}</Row>
            <Row label="Reference">{e.reference_id}</Row>
            <Row label="Deal type">{e.deal_type}</Row>
            <Row label="Service">{e.service_type}</Row>
            <Row label="Source">{e.source}</Row>
            <Row label="Raised by">{e.raised_by}</Row>
            <Row label="From">{e.source_sender}</Row>
            <Row label="Email date">{e.source_date ? new Date(e.source_date).toLocaleString() : ''}</Row>
            <Row label="Week">{e.week}</Row>
            <Row label="Link">{isLink(e.link) ? <a href={e.link} target="_blank" rel="noreferrer" className="text-mav-yellow hover:underline break-all">{e.link}</a> : e.link}</Row>
          </div>
          {!e.evidence && (
            <div className="mt-3 text-xs text-mav-muted">This escalation came from the tracking sheet — no captured email insight. The subject and situation above summarise it.</div>
          )}
        </div>
      </div>
    </div>
  )
}
