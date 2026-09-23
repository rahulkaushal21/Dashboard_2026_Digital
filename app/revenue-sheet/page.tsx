'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Header from '@/components/Header'
import Link from 'next/link'
import { getProjectLedger, copyRowToMonth, saveLedgerRow, canEditLedgerRow, getDirectoryMember, type DirectoryMember, type SheetRowEdits, type LedgerRow } from '@/lib/supabase'
import EditLedgerRowDialog from '@/components/EditLedgerRowDialog'
import { getStoredProfile, currentEmail } from '@/lib/access'

// Web, Hub & LP — the whole ledger, in the revenue sheet's own columns.
//
// TWO SOURCES, ONE LIST. The sheet's own lines and everything PMs have confirmed in the
// dashboard sit together, with a column saying which is which. They were on two separate
// pages first, which was wrong: reconciling a month means reading one list, not
// cross-referencing two. The "In sheet" column is the only distinction that matters, and
// it is the thing a handover to the spreadsheet is driven from.
//
// Filter to Dedicated, tick the rows, send them to next month. That is the monthly job,
// and it is the reason the multi-select exists — nineteen retainers one at a time is not
// a workflow anybody sustains.

const money = (n?: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const nextMonth = () => { const d = new Date(); return monthKey(new Date(d.getFullYear(), d.getMonth() + 1, 1)) }
const ym = (s?: string) => (s || '').slice(0, 7)
const uniq = (xs: (string | undefined)[]) => Array.from(new Set(xs.map(x => (x || '').trim()).filter(Boolean))).sort()
const monLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// The Web, Hub & LP tab's columns, in its order and under its names.
//
// The point is that somebody who knows the spreadsheet can read this page without
// translating. The dashboard's own names for these fields differ in places — "PC/SME" is
// pm_owner, "Agency" is company_name — and using the dashboard's names here would have
// made the two impossible to compare side by side, which is the whole job this page does.
//
// `compact` marks the handful worth seeing when the job is the monthly move rather than
// reconciliation. Thirty-five columns is right for checking a month against the sheet and
// far too many for ticking retainers.
type EditKind = 'text' | 'number' | 'date'
type Col = {
  key: string; label: string; compact?: boolean; right?: boolean
  get: (r: LedgerRow) => string
  // What this column sorts ON. Without it a date column would sort as the string it is
  // printed as, and Optimization would sort "9%" above "12%".
  sort?: (r: LedgerRow) => string | number
  // Set on the columns somebody fills in after the fact. Double-click writes straight
  // to this field; everything else is read-only here because it belongs to whoever
  // priced or booked the work, not to whoever is reconciling the month.
  edit?: keyof SheetRowEdits; kind?: EditKind
}

const dash = (v: unknown) => (v === null || v === undefined || v === '') ? '—' : String(v)
const d10 = (v?: string) => (v || '').slice(0, 10) || '—'
const num = (v?: number | null) => v == null ? '—' : Number(v).toLocaleString('en-US')

// Optimization is arithmetic on the two hour columns, so it is derived here rather than
// stored — there is no way for it to disagree with them.
const optimisation = (r: LedgerRow) => {
  const i = r.internal_hrs, a = r.actual_hrs
  if (i == null || a == null || !(i > 0)) return '—'
  return `${Math.round(((i - a) / i) * 100)}%`
}

const COLUMNS: Col[] = [
  { key: 'project_id', label: 'Project Id', get: r => dash(r.project_id), edit: 'project_id', kind: 'text' },
  { key: 'quote_id', label: 'Quote ID', get: r => dash(r.quote_id), edit: 'quote_id', kind: 'text' },
  { key: 'dept', label: 'Service Department', compact: true, get: r => dash(r.service_dept) },
  { key: 'project', label: 'Project Name', compact: true, get: r => dash(r.project_name) },
  { key: 'ptype', label: 'Project Type', compact: true, get: r => dash(r.engagement_model) },
  { key: 'tech', label: 'Technology', compact: true, get: r => dash(r.technology) },
  { key: 'conf', label: 'Confirmation Date', get: r => d10(r.confirmed_at), sort: r => r.confirmed_at || '' },
  { key: 'start', label: 'Start Date', get: r => d10(r.start_date), sort: r => r.start_date || '', edit: 'start_date', kind: 'date' },
  { key: 'delivery', label: 'Delivery Date', get: r => d10(r.delivery_date), sort: r => r.delivery_date || '', edit: 'delivery_date', kind: 'date' },
  { key: 'intdel', label: 'Internal Delivery', get: r => d10(r.internal_delivery), sort: r => r.internal_delivery || '', edit: 'internal_delivery', kind: 'date' },
  { key: 'inthrs', label: 'Internal hrs', right: true, get: r => num(r.internal_hrs), sort: r => r.internal_hrs ?? -1, edit: 'internal_hrs', kind: 'number' },
  { key: 'acthrs', label: 'Actual hrs', right: true, get: r => num(r.actual_hrs), sort: r => r.actual_hrs ?? -1, edit: 'actual_hrs', kind: 'number' },
  { key: 'opt', label: 'Optimization', right: true, get: optimisation, sort: r => (r.internal_hrs && r.internal_hrs > 0 && r.actual_hrs != null) ? (r.internal_hrs - r.actual_hrs) / r.internal_hrs : -999 },
  { key: 'status', label: 'Project Status', get: r => dash(r.delivery_status), edit: 'delivery_status', kind: 'text' },
  { key: 'stype', label: 'Service Type', get: r => dash(r.service_type) },
  { key: 'dtype', label: 'Delivery Type', get: r => dash(r.delivery_type) },
  { key: 'sme', label: 'PC/SME', compact: true, get: r => dash(r.pm_owner) },
  { key: 'expert', label: 'Expert', get: r => dash(r.expert), edit: 'expert', kind: 'text' },
  { key: 'integration', label: 'Integration', get: r => dash(r.integration), edit: 'integration', kind: 'text' },
  { key: 'agency', label: 'Agency', compact: true, get: r => dash(r.company_name) },
  { key: 'cname', label: 'Client Name', get: r => dash(r.client_name) },
  { key: 'cemail', label: 'Client Email', get: r => dash(r.contact_email) },
  { key: 'ctype', label: 'Client Type', get: r => dash(r.client_type) },
  { key: 'geo', label: 'Geo', compact: true, get: r => dash(r.geo) },
  { key: 'cur', label: 'Currency Type', get: r => dash(r.currency) },
  { key: 'qprice', label: 'Quote Price', right: true, get: r => num(r.quote_price), sort: r => r.quote_price ?? -1 },
  { key: 'cprice', label: 'Confirmed Price', right: true, get: r => num(r.local_value), sort: r => r.local_value ?? -1 },
  { key: 'usd', label: 'USD Conversion', compact: true, right: true, get: r => num(r.amount_usd), sort: r => r.amount_usd ?? -1 },
  { key: 'btype', label: 'Business Type', get: r => dash(r.business_type) },
  { key: 'am', label: 'Account/Sales Person', compact: true, get: r => dash(r.sales_person) },
  { key: 'outsrc', label: 'Outsource Price', right: true, get: r => num(r.outsource_price), sort: r => r.outsource_price ?? -1, edit: 'outsource_price', kind: 'number' },
  { key: 'invno', label: 'Invoice No', get: r => dash(r.invoice_no), edit: 'invoice_no', kind: 'text' },
  { key: 'invcur', label: 'Invoice Currency', get: r => dash(r.invoice_currency), edit: 'invoice_currency', kind: 'text' },
  { key: 'invamt', label: 'Invoice Amount', right: true, get: r => num(r.invoice_amount), sort: r => r.invoice_amount ?? -1, edit: 'invoice_amount', kind: 'number' },
  { key: 'month', label: 'Month-Year', compact: true, get: r => ym(r.booking_month) },
]

// WHICH DATE A LINE BELONGS TO — Start Date.
//
// The business reports on Start Date: the Business Overview sheet is built on it, and
// Business Numbers was corrected onto it after WEB-US read nearly double on Confirmation
// Date. Filtering and paging this page by anything else would put the same line in a
// different month depending on which screen you were looking at.
//
// A line with no start date falls back to its confirmation date, then to its booking
// month, rather than dropping out of every window and disappearing from the page.
const rowDate = (r: LedgerRow) =>
  (r.start_date || '').slice(0, 10) || (r.confirmed_at || '').slice(0, 10) || (r.booking_month || '')
const rowMonth = (r: LedgerRow) => rowDate(r).slice(0, 7)

export default function ProjectLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const [search, setSearch] = useState('')
  const [fDept, setFDept] = useState('')
  const [fModel, setFModel] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [fPm, setFPm] = useState('')
  const [fAm, setFAm] = useState('')
  const [fSource, setFSource] = useState('')
  // Opens on THIS MONTH rather than all 3,221 lines. The monthly job is this month's;
  // everything else is two clicks away. Set after mount, because working out "now" during
  // render makes the static export's prerendered HTML disagree with the browser.
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const filtersTouched = useRef(false)
  useEffect(() => {
    const m = monthKey(new Date())
    setFFrom(m); setFTo(m)
  }, [])
  const [page, setPage] = useState(0)
  // Sorting. Default is the newest entry in the month first, which is what somebody
  // reconciling today's bookings opens this page for.
  const [sortKey, setSortKey] = useState<string>('')
  const [sortAsc, setSortAsc] = useState(false)
  // Who is looking, so the page only OFFERS an edit on rows this person owns. The two
  // RPCs behind it enforce the same rule, so a hidden button is a courtesy, not the lock.
  const [me, setMe] = useState<DirectoryMember | null>(null)
  // One cell being edited in place: the row, the column, and what has been typed.
  const [cell, setCell] = useState<{ rowKey: string; col: string; value: string } | null>(null)
  const [cellBusy, setCellBusy] = useState(false)

  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Thirty-five columns is right for reconciling a month against the spreadsheet and far
  // too many for ticking retainers, which is the other thing this page is for.
  const [sheetView, setSheetView] = useState(true)
  const [editing, setEditing] = useState<LedgerRow | null>(null)
  const [target, setTarget] = useState(nextMonth)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const load = () => getProjectLedger().then(setRows).finally(() => setLoading(false))
  useEffect(() => {
    setIsAdmin(!!getStoredProfile()?.is_admin)
    getDirectoryMember(currentEmail()).then(m => {
      setMe(m)
      // A PM opens this page to work their own lines, so it starts on theirs. Only if
      // nobody has touched the filter, so a deliberate choice is never overwritten.
      if (m?.name) setFPm(prev => (prev === '' && !filtersTouched.current) ? m.name : prev)
    })
    load()
  }, [])

  const opts = useMemo(() => ({
    dept: uniq(rows.map(r => r.service_dept)),
    model: uniq(rows.map(r => r.engagement_model)),
    geo: uniq(rows.map(r => r.geo)),
    pm: uniq(rows.map(r => r.pm_owner)),
    am: uniq(rows.map(r => r.sales_person)),
  }), [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter(r => !q || (r.company_name || '').toLowerCase().includes(q) || (r.project_name || '').toLowerCase().includes(q) || (r.contact_email || '').toLowerCase().includes(q))
      .filter(r => !fDept || r.service_dept === fDept)
      .filter(r => !fModel || r.engagement_model === fModel)
      .filter(r => !fGeo || r.geo === fGeo)
      .filter(r => !fPm || r.pm_owner === fPm)
      .filter(r => !fAm || r.sales_person === fAm)
      .filter(r => !fSource || (fSource === 'sheet' ? r.in_sheet : !r.in_sheet))
      .filter(r => !fFrom || rowMonth(r) >= fFrom)
      .filter(r => !fTo || rowMonth(r) <= fTo)
      // Newest month first, and within a month the newest entry first — so today's
      // bookings are at the top on the 21st, then the 20th, then the 19th. A column sort
      // replaces the second half of that, never the month grouping, because the page is
      // paginated a month at a time.
      .sort((a, b) => {
        const byMonth = (b.booking_month || '').localeCompare(a.booking_month || '')
        if (byMonth) return byMonth
        if (sortKey) {
          const c = COLUMNS.find(x => x.key === sortKey)
          if (c) {
            const va = (c.sort || c.get)(a), vb = (c.sort || c.get)(b)
            const d = typeof va === 'number' && typeof vb === 'number'
              ? va - vb
              : String(va).localeCompare(String(vb), undefined, { numeric: true })
            if (d) return sortAsc ? d : -d
          }
        }
        return rowDate(b).localeCompare(rowDate(a)) || (a.company_name || '').localeCompare(b.company_name || '')
      })
  }, [rows, search, fDept, fModel, fGeo, fPm, fAm, fSource, fFrom, fTo, sortKey, sortAsc])

  useEffect(() => { setPage(0) }, [search, fDept, fModel, fGeo, fPm, fAm, fSource, fFrom, fTo])

  // One page per booking month. A fixed hundred rows split September across two pages and
  // put the tail of August on the first — the unit of work here is a month, so that is
  // the unit the pager moves in.
  const monthPages = useMemo(() => {
    const out: string[] = []
    for (const r of shown) { const m = rowMonth(r) || '—'; if (out[out.length - 1] !== m) if (!out.includes(m)) out.push(m) }
    return out
  }, [shown])

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortAsc(false); return }
    if (!sortAsc) { setSortAsc(true); return }
    setSortKey(''); setSortAsc(false)   // third click returns to newest-entry-first
  }

  // Awaiting Information is not revenue — the work is not agreed yet, so the figure is a
  // quote, not money. The lines STAY in the table, because somebody still has to chase
  // the missing information; they are only kept out of the money total, and the total
  // says so rather than quietly being short.
  const awaiting = shown.filter(r => /awaiting/i.test(r.delivery_status || ''))
  const counted = shown.filter(r => !/awaiting/i.test(r.delivery_status || ''))
  const total = counted.reduce((s, r) => s + (r.amount_usd || 0), 0)
  const awaitingTotal = awaiting.reduce((s, r) => s + (r.amount_usd || 0), 0)
  const clients = new Set(counted.map(r => (r.company_name || '').toLowerCase())).size
  const notInSheet = shown.filter(r => !r.in_sheet)
  const pages = Math.max(1, monthPages.length)
  const pageMonth = monthPages[Math.min(page, monthPages.length - 1)] || ''
  const pageRows = useMemo(() => shown.filter(r => (rowMonth(r) || '—') === pageMonth), [shown, pageMonth])
  const pageTotal = pageRows.reduce((s, r) => s + (r.amount_usd || 0), 0)

  const clearAll = () => { filtersTouched.current = true; setSearch(''); setFDept(''); setFModel(''); setFGeo(''); setFPm(''); setFAm(''); setFSource(''); setFFrom(''); setFTo('') }
  const anyFilter = search || fDept || fModel || fGeo || fPm || fAm || fSource || fFrom || fTo

  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })
  // Selects the whole FILTERED set, not just this page — the point of filtering to
  // Dedicated is to act on all of it, and a tick box that silently meant "these hundred"
  // would quietly drop the rest.
  const allPicked = shown.length > 0 && shown.every(r => picked.has(r.row_key))
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(shown.map(r => r.row_key)))

  const pickedRows = useMemo(() => shown.filter(r => picked.has(r.row_key)), [shown, picked])
  const pickedTotal = pickedRows.reduce((s, r) => s + (r.amount_usd || 0), 0)

  const moveSelected = async () => {
    if (!pickedRows.length) return
    setBusy(true); setStatus(''); setErrors([])
    let ok = 0; const errs: string[] = []
    // One at a time, so a row that is refused does not take the rest of the batch with
    // it. Every refusal is reported with the client's name.
    for (const r of pickedRows) {
      // copy_row_to_month works on the LIVE sheet_raw id, because it reads the row now.
      // Editing uses source_id (the sheet's own row number), which is the one that
      // survives a re-sync. Two ids for one row, each for the thing it is stable for.
      const rowId = r.source === 'raw' ? (r.sheet_raw_id ?? r.source_id) : r.source_id
      const res = await copyRowToMonth(r.source, rowId, target, r.local_value ?? r.amount_usd)
      if (res.error) errs.push(`${r.company_name}: ${res.error}`)
      else ok++
    }
    setBusy(false)
    setPicked(new Set())
    setStatus(`${ok} moved into ${monLabel(target)}${errs.length ? `, ${errs.length} could not be.` : '.'}`)
    setErrors(errs)
    load()
  }

  // ── Editing a cell in place ─────────────────────────────────────────────────────
  // Double-click, type, Enter. The alternative was opening a dialog to fill in one
  // Project Id, which nobody does for three hundred rows.
  //
  // One field per save, and a null means "not sent" to both RPCs — so this can FILL a
  // blank or change a value, and cannot clear one. Clearing is rare, destructive and
  // belongs in the full Edit dialog where you can see what else you are about to change.
  const rawOf = (r: LedgerRow, c: Col) => {
    const v = (r as any)[c.edit as string]
    if (v == null) return ''
    return c.kind === 'date' ? String(v).slice(0, 10) : String(v)
  }

  const saveCell = async () => {
    if (!cell) { return }
    const c = COLUMNS.find(x => x.key === cell.col)
    const r = rows.find(x => x.row_key === cell.rowKey)
    if (!c?.edit || !r) { setCell(null); return }
    const v = cell.value.trim()
    if (v === rawOf(r, c)) { setCell(null); return }
    const patch: SheetRowEdits = {}
    ;(patch as any)[c.edit] = c.kind === 'number' ? (v === '' ? null : Number(v)) : v
    setCellBusy(true); setErrors([])
    const res = await saveLedgerRow(r, patch)
    setCellBusy(false); setCell(null)
    if (!res.ok) { setErrors([`${r.company_name || 'row'}: ${res.error}`]); return }
    setStatus(`${c.label} saved on ${r.company_name || 'the row'}.`)
    load()
  }

  const exportCsv = () => {
    // Exports what is on screen, under the sheet's own headers, so a paste into the
    // spreadsheet lands in the right columns.
    const head = [...cols.map(c => c.label), 'In sheet']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = shown.map(r => [...cols.map(c => { const v = c.get(r); return v === '—' ? '' : v }), r.in_sheet ? 'yes' : 'no'].map(esc).join(','))
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `web-hub-lp-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const months = useMemo(() => {
    const out: string[] = []
    const d = new Date()
    for (let i = -1; i < 3; i++) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() + (i === -1 ? 1 : -i), 1)))
    return Array.from(new Set(out))
  }, [])

  const cols = useMemo(() => sheetView ? COLUMNS : COLUMNS.filter(c => c.compact), [sheetView])

  const sel = 'bg-mav-panel border border-mav-line rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
  const th = 'px-3 py-2 font-medium whitespace-nowrap'
  const td = 'px-3 py-2 whitespace-nowrap'

  return (
    <div>
      <Header title="Web, Hub & LP" subtitle="Every booked line, plus everything confirmed in the dashboard. Filter, tick, and move to the next month." />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, project or contact…" className={`${sel} w-56`} />
        <select value={fModel} onChange={e => setFModel(e.target.value)} className={sel}><option value="">All models</option>{opts.model.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fDept} onChange={e => setFDept(e.target.value)} className={sel}><option value="">All depts</option>{opts.dept.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={sel}><option value="">All GEOs</option>{opts.geo.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fPm} onChange={e => { filtersTouched.current = true; setFPm(e.target.value) }} className={sel}><option value="">All PMs</option>{opts.pm.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fAm} onChange={e => setFAm(e.target.value)} className={sel}><option value="">All AMs</option>{opts.am.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fSource} onChange={e => setFSource(e.target.value)} className={sel}>
          <option value="">Sheet + dashboard</option><option value="sheet">In the sheet</option><option value="dashboard">Confirmed here only</option>
        </select>
        <input type="month" value={fFrom} onChange={e => { filtersTouched.current = true; setFFrom(e.target.value) }} className={sel} title="From month — on Start Date" />
        <input type="month" value={fTo} onChange={e => { filtersTouched.current = true; setFTo(e.target.value) }} className={sel} title="To month — on Start Date" />
        {anyFilter && <button onClick={clearAll} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg transition-colors">Clear</button>}
        <button onClick={() => { filtersTouched.current = true; setFModel('Dedicated'); setFFrom(monthKey(new Date())); setFTo(monthKey(new Date())) }}
          className="text-xs px-3 py-1.5 rounded-md border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/15 transition-colors">
          This month&rsquo;s Dedicated
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-mav-muted">
          {loading ? 'Loading…' : <>{shown.length.toLocaleString()} line{shown.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'} · <span className="text-mav-fg">{money(total)}</span>
            <span className="ml-1 text-mav-muted/80">in {fFrom && fFrom === fTo ? monLabel(fFrom) : fFrom || fTo ? 'the chosen months' : 'all months'}{fPm ? `, ${fPm}` : ''}</span>
            {notInSheet.length > 0 && <span className="ml-2 text-amber-300">· {notInSheet.length} not in the sheet yet</span>}
            {awaiting.length > 0 && <span className="ml-2 text-amber-300">· {money(awaitingTotal)} awaiting information, not counted</span>}</>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSheetView(v => !v)}
            className="text-xs px-3 py-1.5 rounded-md border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/15 transition-colors">
            {sheetView ? 'Compact view' : 'All sheet columns'}
          </button>
          <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-md border border-mav-fg/20 text-mav-fg/70 hover:text-mav-fg hover:border-mav-fg/40 transition-colors">Export CSV</button>
        </div>
      </div>

      {/* The action bar only exists once something is ticked, so it never sits there as
          a control with no object. */}
      {pickedRows.length > 0 && (
        <div className="mb-4 rounded-lg border border-mav-yellow/40 bg-mav-yellow/10 px-4 py-2.5 flex flex-wrap items-center gap-3">
          <span className="text-sm"><span className="text-mav-yellow font-medium">{pickedRows.length} selected</span> <span className="text-mav-muted">· {money(pickedTotal)}</span></span>
          <span className="text-xs text-mav-muted">move to</span>
          <select value={target} onChange={e => setTarget(e.target.value)} className={sel}>
            {months.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
          </select>
          <button onClick={moveSelected} disabled={busy}
            className="text-xs px-4 py-1.5 rounded-md bg-green-500 text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
            {busy ? `Moving ${pickedRows.length}…` : `Move ${pickedRows.length} to ${monLabel(target)}`}
          </button>
          <button onClick={() => setPicked(new Set())} className="text-xs text-mav-muted hover:text-mav-fg">Clear selection</button>
        </div>
      )}

      {status && <div className="mb-3 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-300">{status}</div>}
      {errors.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300 space-y-0.5">
          {errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
          {errors.length > 8 && <div className="text-mav-muted">…and {errors.length - 8} more.</div>}
        </div>
      )}

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-fg/70 border-b border-mav-line">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all filtered" /></th>
              {/* Click to sort, click again to reverse, a third time to go back to
                  newest-entry-first. Month grouping is never overridden — the pager
                  moves a month at a time, so a sort that crossed months would page
                  through rows that have nothing to do with each other. */}
              {cols.map(c => (
                <th key={c.key} className={`${th} ${c.right ? 'text-right' : ''}`}>
                  <button onClick={() => handleSort(c.key)}
                    className={`inline-flex items-center gap-1 hover:text-mav-fg transition-colors ${sortKey === c.key ? 'text-mav-yellow' : ''}`}
                    title={`Sort by ${c.label}`}>
                    {c.label}
                    <span className="text-[10px] opacity-70">{sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
              <th className={th}>In sheet</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.row_key} className={`border-b border-mav-line/60 ${picked.has(r.row_key) ? 'bg-mav-yellow/5' : ''}`}>
                <td className="px-3 py-2"><input type="checkbox" checked={picked.has(r.row_key)} onChange={() => toggle(r.row_key)} aria-label={`Select ${r.company_name}`} /></td>
                {cols.map(c => {
                  const v = c.get(r)
                  const mine = canEditLedgerRow(r, me, isAdmin)
                  const editable = !!c.edit && mine
                  const open = cell?.rowKey === r.row_key && cell?.col === c.key
                  return (
                    <td key={c.key}
                      onDoubleClick={editable ? () => setCell({ rowKey: r.row_key, col: c.key, value: rawOf(r, c) }) : undefined}
                      className={`${td} ${c.right ? 'text-right' : ''} ${v === '—' ? 'text-mav-fg/25' : 'text-mav-fg/80'} ${open ? '' : 'max-w-[16rem] truncate'} ${editable && !open ? 'cursor-text hover:bg-mav-fg/5' : ''}`}
                      title={open ? '' : editable ? `${v === '—' ? 'Empty' : v} — double-click to edit` : (v === '—' ? '' : v)}>
                      {open ? (
                        <input autoFocus disabled={cellBusy}
                          type={c.kind === 'number' ? 'number' : c.kind === 'date' ? 'date' : 'text'}
                          value={cell!.value}
                          onChange={e => setCell({ ...cell!, value: e.target.value })}
                          onBlur={saveCell}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveCell() }
                            // Escape abandons the edit. Without it the only way out of a
                            // cell opened by accident is to save something.
                            if (e.key === 'Escape') { e.preventDefault(); setCell(null) }
                          }}
                          className="w-36 bg-mav-dark border border-mav-yellow rounded px-1.5 py-0.5 text-xs text-mav-fg outline-none" />
                      ) : c.key === 'agency' && v !== '—' ? (
                        // The Agency cell opens that client's Client 360 record: the row
                        // says what was billed, and the next question is always who they
                        // are. CSV export is untouched — it reads c.get(r), not this.
                        <Link href={`/clients?client=${encodeURIComponent(r.company_name || '')}`}
                          className="hover:text-mav-yellow transition-colors">{v}</Link>
                      ) : v}
                    </td>
                  )
                })}
                <td className={td}>
                  {r.in_sheet
                    ? <span className="text-xs text-mav-fg/50">yes</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/50 text-amber-300">pending</span>}
                </td>
                <td className={td}>
                  {/* Every row is editable now, sheet lines included — their answers go
                      into an overlay beside the sheet rather than into it. Offered only
                      to the row's own PC/SME, which is the rule both RPCs enforce. */}
                  {canEditLedgerRow(r, me, isAdmin)
                    ? <button onClick={() => setEditing(r)} className="text-xs text-mav-yellow hover:underline">Edit</button>
                    : <span className="text-xs text-mav-fg/25" title={`${r.pm_owner || 'Nobody'} owns this row`}>{r.pm_owner ? r.pm_owner.split(' ')[0] + "'s" : 'admin'}</span>}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && <tr><td colSpan={cols.length + 3} className="px-3 py-6 text-center text-mav-muted">Nothing matches those filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {monthPages.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
          <span className="text-mav-muted text-xs">
            Showing <span className="text-mav-fg">{pageMonth === '—' ? 'lines with no month' : monLabel(pageMonth)}</span>
            {' '}&middot; {pageRows.length.toLocaleString()} line{pageRows.length === 1 ? '' : 's'} &middot; {money(pageTotal)}
            {' '}&middot; month {Math.min(page, pages - 1) + 1} of {pages} &middot; ticking the header selects all {shown.length.toLocaleString()} filtered lines, not just this month
          </span>
          <div className="flex items-center gap-2">
            {/* A month picker as well as the arrows: stepping back to March one month at
                a time is eleven clicks. */}
            <select value={pageMonth} onChange={e => setPage(monthPages.indexOf(e.target.value))} className={sel}>
              {monthPages.map(m => <option key={m} value={m}>{m === '—' ? 'No month' : monLabel(m)}</option>)}
            </select>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg disabled:opacity-30 transition-colors">Newer month</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg disabled:opacity-30 transition-colors">Older month</button>
          </div>
        </div>
      )}

      <p className="text-xs text-mav-muted mt-4 max-w-3xl">
        Shown in the <span className="text-mav-fg">Web, Hub &amp; LP</span> tab&rsquo;s own columns and order.
        Filtering and paging are on <span className="text-mav-fg">Start Date</span>, the same basis as Business Numbers
        and the Business Overview sheet, so a line sits in the same month wherever you look at it.
        It opens on this month and on your own lines &mdash; clear the filters to see everything.
        <span className="text-amber-300"> Pending</span> means confirmed here and not yet carried into the sheet by the
        hourly writer. A greyed <span className="text-mav-fg/40">&mdash;</span> on a sheet line is a column the dashboard has
        never stored, not an empty one; those values are in the source spreadsheet.
        <br />
        <span className="text-mav-fg">Double-click a cell to fill it in</span> &mdash; Project Id, Quote ID, Expert, dates,
        hours, invoice &mdash; or use Edit at the end of the row for the lot. Only the row&rsquo;s own PC/SME can change it
        {isAdmin ? ', and you, as an admin' : ''}; the database refuses anybody else. Edits to a sheet line are kept beside
        the sheet, not in it, so the next sync cannot wipe them. One cell at a time can fill a blank or change a value but never clear one; use Edit for that.
      </p>

      {editing && (
        <EditLedgerRowDialog row={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setStatus('Saved.'); load() }} />
      )}
    </div>
  )
}
