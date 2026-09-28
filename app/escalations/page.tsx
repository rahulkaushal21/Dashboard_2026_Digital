'use client'
import { useEffect, useMemo, useState } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import { useUnit } from '@/components/BusinessUnitProvider'
import { UnplacedNote } from '@/components/UnitToggle'
import { inUnit, unitOf } from '@/lib/business-unit'

import MultiSelect from '@/components/MultiSelect'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import KPICard from '@/components/KPICard'
import { daysSince, fmtDay, type CardDetails, type DetailCol } from '@/components/CardDetail'
import { KPIRow, FilterBar, Panel } from '@/components/PageParts'
import { getEscalations, getEscalationDepts, type Escalation } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
const isMajor = (x: Escalation) => /major/i.test(x.business_impact || '') || /major/i.test(x.escalation_type || '')

type SortField = 'date' | 'company' | 'type'

// An empty selection means "all", exactly as the old "All GEOs" option did.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())

// The log opens on when, who, what kind and how bad; GEO is one tick away in Columns.
// The long free-text cells are truncated with the full text on hover.
const COLS: ColumnDef[] = [
  { key: 'date', label: 'Date', default: true },
  { key: 'company', label: 'Company', locked: true },
  { key: 'type', label: 'Type', default: true },
  { key: 'situation', label: 'Situation', default: true },
  { key: 'impact', label: 'Impact', default: true },
  { key: 'geo', label: 'GEO' },
  { key: 'subject', label: 'Subject', default: true },
]

export default function Escalations() {
  const cols = useColumns('escalations', COLS)
  const [all, setAll] = useState<Escalation[]>([])
  // ── Business unit ───────────────────────────────────────────────────────────
  // Escalations carry no department and no PM: service_type says 'Managed' on 782 of
  // 844 rows, and raised_by is the process person who logged it, not the owner.
  // escalation_dept_mv places 703 of them — from the client where the company is a real
  // client, and from the region that sits in the company_name column on 461 others.
  //
  // The rest come back absent and are COUNTED, not hidden. An escalation nobody can
  // place must not read as an escalation that did not happen.
  const [escDepts, setEscDepts] = useState<Map<number, string>>(new Map())
  const { unit } = useUnit()
  useEffect(() => { getEscalationDepts().then(setEscDepts).catch(() => {}) }, [])
  const unplaced = useMemo(
    () => unit === 'all' ? 0 : all.filter(x => unitOf(escDepts.get(Number(x.id))) === null).length,
    [all, escDepts, unit])
  // The department's rows, before any other filter. The dropdown options and the "My
  // clients" hidden count read from this so they never offer another department's GEOs.
  const inDept = useMemo(() => all.filter(x => inUnit(escDepts.get(Number(x.id)), unit)), [all, escDepts, unit])

  const [search, setSearch] = useState('')
  const [fType, setFType] = useState<string[]>([])
  const [fGeo, setFGeo] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('date')
  const [sortAsc, setSortAsc] = useState(false)
  const [sel, setSel] = useState<Escalation | null>(null)
  // Starts on this person's own clients. An escalation names a company, not a PM, so
  // "mine" comes from the client record's PC/SME. One click shows everybody's.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])

  useEffect(() => { getEscalations().then(setAll) }, [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  
  const e = useMemo(() => {
    let result = inDept
      .filter(x => !justMine || mine.ownsClient(x.company_name))
      .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
      .filter(x => keeps(fType, x.escalation_type))
      .filter(x => keeps(fGeo, x.geo))
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
  }, [inDept, search, fType, fGeo, from, to, sortBy, sortAsc, justMine, mine])
  
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
  
  // ── Card drill-downs ──────────────────────────────────────────────────────────
  // Each card opens the rows it counts: the escalations themselves for the first two,
  // and one row per company / per type (built from the same filtered list) for the
  // distinct counts, so the panel's row count is the card's figure.
  const escDate = (x: Escalation) => x.tracking_date || x.month || ''
  const major = useMemo(() => e.filter(isMajor), [e])
  const escCols: DetailCol<Escalation>[] = [
    { key: 'company', label: 'Company', value: x => x.company_name || '—', wide: true, sort: x => (x.company_name || '').toLowerCase() },
    { key: 'type', label: 'Type', value: x => x.escalation_type || '—', sort: x => (x.escalation_type || '').toLowerCase() },
    { key: 'impact', label: 'Impact', value: x => x.business_impact || '—', wide: true },
    { key: 'date', label: 'Date', value: x => fmtDay(escDate(x)), sort: escDate },
    { key: 'age', label: 'Days since', value: x => daysSince(escDate(x)) ?? '—', align: 'right', sort: x => daysSince(escDate(x)) ?? -1 },
  ]
  const escDetails = (rows: Escalation[], subtitle: string): CardDetails<Escalation> => ({
    subtitle, rows, columns: escCols, defaultSort: 'date',
    groupBy: x => (x.geo || '').trim() || 'No GEO',
    rowKey: x => x.id, onRowClick: x => setSel(x),
  })
  type Agg = { key: string; n: number; major: number; last: string; geos: string[] }
  const aggBy = (rows: Escalation[], k: (x: Escalation) => string | undefined): Agg[] => {
    const m = new Map<string, Agg>()
    for (const x of rows) {
      const key = (k(x) || '').trim(); if (!key) continue
      const a = m.get(key) || m.set(key, { key, n: 0, major: 0, last: '', geos: [] }).get(key)!
      a.n++; if (isMajor(x)) a.major++
      if (escDate(x) > a.last) a.last = escDate(x)
      const g = (x.geo || '').trim(); if (g && !a.geos.includes(g)) a.geos.push(g)
    }
    return Array.from(m.values())
  }
  const byCompany = useMemo(() => aggBy(e, x => x.company_name), [e]) // eslint-disable-line react-hooks/exhaustive-deps
  const byType = useMemo(() => aggBy(e, x => x.escalation_type), [e]) // eslint-disable-line react-hooks/exhaustive-deps
  const aggDetails = (rows: Agg[], label: string, subtitle: string): CardDetails<Agg> => ({
    subtitle, rows, rowKey: a => a.key, defaultSort: 'n',
    columns: [
      { key: 'name', label, value: a => a.key, wide: true, sort: a => a.key.toLowerCase() },
      { key: 'n', label: 'Escalations', value: a => a.n, align: 'right', sort: a => a.n, total: rs => rs.reduce((s, a) => s + a.n, 0) },
      { key: 'major', label: 'Major', value: a => a.major, align: 'right', sort: a => a.major, total: rs => rs.reduce((s, a) => s + a.major, 0) },
      { key: 'last', label: 'Latest', value: a => fmtDay(a.last), sort: a => a.last },
      { key: 'age', label: 'Days since', value: a => daysSince(a.last) ?? '—', align: 'right', sort: a => daysSince(a.last) ?? -1 },
      { key: 'geo', label: 'GEO', value: a => a.geos.join(', ') || '—', wide: true },
    ],
  })

  const reset = () => { setSearch(''); setFType([]); setFGeo([]); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Major Process Gap" subtitle="Client escalations & experience triggers — filter by type, GEO and date, click headers to sort" />
      <UnplacedNote n={unplaced} noun="escalations" className="-mt-3 mb-4" />

      {/* The cards read the filtered list, so they always describe the table below. */}
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Major process gaps" value={String(e.length)}
          details={escDetails(e, 'Every escalation matching the filters, by GEO')} />
        <KPICard tone="red" label="Major impact" value={String(major.length)}
          details={escDetails(major, 'Escalations whose impact or type says major')} />
        <KPICard label="Companies" value={String(uniq(e.map(x => x.company_name)).length)}
          details={aggDetails(byCompany, 'Company', 'One row per company in the filtered list')} />
        <KPICard label="Types" value={String(uniq(e.map(x => x.escalation_type)).length)}
          details={aggDetails(byType, 'Type', 'One row per escalation type in the filtered list')} />
      </KPIRow>

      <FilterBar right={
        <button onClick={reset} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">Reset</button>
      }>
        {mine.canScope && (
          <MineFilter on={justMine} onChange={setJustMine} label="My clients"
            hidden={inDept.filter(x => !mine.ownsClient(x.company_name)).length} />
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company…" className={`${selCls} w-44`} />
        <MultiSelect label="All types" options={uniq(inDept.map(x => x.escalation_type))} selected={fType} onChange={setFType} className="w-44" />
        <MultiSelect label="All GEO" options={uniq(inDept.map(x => x.geo))} selected={fGeo} onChange={setFGeo} className="w-36" />
        <div className="basis-full h-0" />
        <span className="text-xs text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} aria-label="From" />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} aria-label="To" />
      </FilterBar>

      <Panel flush title="Escalations"
        info={`Click a row for the full record and the email insight. Click Date, Company or Type to sort.${e.length > 400 ? ' The table shows the first 400 rows; narrow the filters to see the rest.' : ''}`}
        right={<div className="flex items-center gap-3"><span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{Math.min(e.length, 400)} of {e.length} shown</span><ColumnPicker cols={cols} /></div>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              {([
                ['date', <button key="date" onClick={() => handleSort('date')} className="hover:text-mav-fg cursor-pointer">Date{getSortIndicator('date')}</button>],
                ['company', <button key="company" onClick={() => handleSort('company')} className="hover:text-mav-fg cursor-pointer">Company{getSortIndicator('company')}</button>],
                ['type', <button key="type" onClick={() => handleSort('type')} className="hover:text-mav-fg cursor-pointer">Type{getSortIndicator('type')}</button>],
                ['situation', 'Situation'],
                ['impact', 'Impact'],
                ['geo', 'GEO'],
                ['subject', 'Subject'],
              ] as [string, React.ReactNode][]).filter(([k]) => cols.on(k)).map(([k, h]) => <th key={k} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>{e.slice(0, 400).map(x => (
            <tr key={x.id} onClick={() => setSel(x)} className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
              {cols.on('date') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{x.tracking_date || x.month || '—'}</td>}
              <td className="px-3 py-2.5"><ClientLink name={x.company_name} /></td>
              {cols.on('type') && <td className="px-3 py-2.5"><span className={`text-xs ${isMajor(x) ? 'text-red-400' : 'text-mav-muted'}`}>{x.escalation_type || '—'}</span></td>}
              {cols.on('situation') && <td className="px-3 py-2.5 text-mav-muted max-w-[14rem] truncate" title={x.situation_type || ''}>{x.situation_type}</td>}
              {cols.on('impact') && <td className="px-3 py-2.5 text-mav-muted max-w-[12rem] truncate" title={x.business_impact || ''}>{x.business_impact}</td>}
              {cols.on('geo') && <td className="px-3 py-2.5 text-mav-muted">{x.geo}</td>}
              {cols.on('subject') && <td className="px-3 py-2.5 text-mav-muted truncate max-w-xs" title={x.email_subject || ''}>{x.email_subject}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      </Panel>
      {sel && <EscalationDetail e={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="flex gap-3 py-2 border-b border-mav-line/40 last:border-0">
      <div className="w-32 shrink-0 text-xs uppercase tracking-wide text-mav-muted pt-0.5">{label}</div>
      <div className="text-sm text-mav-fg/90 break-words min-w-0">{children}</div>
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
            <div className="text-lg font-semibold text-mav-fg">{e.company_name || 'Major process gap'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full border ${major ? 'border-red-500/50 text-red-400' : 'border-mav-line text-mav-muted'}`}>{e.escalation_type || 'Major process gap'}</span>
              {e.business_impact && <span className="px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">{e.business_impact} impact</span>}
              {e.geo && <span className="px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">{e.geo}</span>}
              <span className="text-mav-muted">{e.tracking_date || e.month || ''}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-mav-muted hover:text-mav-fg text-xl leading-none px-2">×</button>
        </div>
        <div className="p-5">
          {e.evidence && (
            <div className="mb-4 rounded-lg bg-mav-dark/50 border border-mav-line p-4">
              <div className="text-xs uppercase tracking-wide text-mav-yellow mb-1">What happened — email insight</div>
              <div className="text-sm text-mav-fg/90 italic whitespace-pre-wrap">“{e.evidence}”</div>
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
