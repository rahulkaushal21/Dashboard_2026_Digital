'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import MultiSelect from '@/components/MultiSelect'
import { NotSplitNote } from '@/components/UnitToggle'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import InvoiceMapping from './InvoiceMapping'
import {
  getInvoiceRecon, getProjectInvoiceStatus,
  type InvoiceRecon, type ProjectInvoiceStatus,
} from '@/lib/supabase'

// Invoices & Reconciliation
// -------------------------
// Two questions, deliberately on one page because the answer to each is the other's
// blind spot:
//
//   MONEY  — of the work we delivered, what has been invoiced, and has it been paid?
//   TRUTH  — of the invoices the app raised, which does the revenue sheet not know about?
//
// The second exists because the sheet is NOT a superset of the invoice app. 722 invoices
// worth $790,256 — 18% of our invoiced value since Jan 2025 — are in the app with no row
// in the sheet, and roughly half of that is recurring engagements: the sheet books a
// dedicated FTE contract ONCE, the app raises one invoice per month against it. A page
// that showed only the first question would report those as perfectly reconciled.

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const secBtn = 'text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg'
const toggleBtn = 'text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg'
const lbl = 'font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted'

/**
 * Search across every field a person might type.
 *
 * The first version searched company and project only, while the placeholder promised
 * "client, project, invoice" — so typing an invoice number or a project id returned
 * nothing and the box looked broken. It was not broken; it was lying about its scope.
 */
const hit = (q: string, ...fields: (string | null | undefined | string[])[]) => {
  const n = q.trim().toLowerCase()
  if (!n) return true
  return fields.some(f =>
    Array.isArray(f) ? f.some(v => (v || '').toLowerCase().includes(n))
                     : (f || '').toLowerCase().includes(n))
}
const usd = (n?: number | null) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString()}`
const uniq = (a: (string | null | undefined)[]) =>
  Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const keeps = (picked: string[], v?: string | null) =>
  picked.length === 0 || picked.includes((v || '').trim())

// Six states come from the invoice app; two are ours. 'Not raised' is delivered work
// nobody has billed, and 'No project id' is a blank cell in the sheet — they must not be
// merged, because one is missing money and the other is missing data entry.
const STATUS_TONE: Record<string, string> = {
  'Overdue': 'text-red-400 border-red-500/40',
  'Draft': 'text-amber-400 border-amber-500/40',
  'Not raised': 'text-orange-400 border-orange-500/40',
  'No project id': 'text-mav-muted border-mav-line',
  'Sent': 'text-blue-400 border-blue-500/40',
  'Partially Paid': 'text-yellow-400 border-yellow-500/40',
  'Paid': 'text-green-400 border-green-500/40',
  'Void': 'text-mav-muted border-mav-line',
}
function Pill({ s }: { s?: string | null }) {
  const k = (s || '').trim()
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_TONE[k] || 'text-mav-muted border-mav-line'}`}>
      {k || '—'}
    </span>
  )
}

const monthOf = (d?: string | null) => (d || '').slice(0, 7)
const daysLate = (due?: string | null) => {
  if (!due) return null
  const d = Math.floor((Date.now() - new Date(due + 'T00:00:00Z').getTime()) / 86400000)
  return d > 0 ? d : null
}

type Tab = 'money' | 'recon' | 'mapping'
type Who = 'all' | 'contractor' | 'inhouse'

// Twelve columns is wider than a laptop, so the two answering the fewest questions start
// hidden: 'Delivered by' is redundant the moment you filter to Contractor, and 'Due date'
// repeats what 'Days late' already says. Locked columns are the row's identity.
const MONEY_COLS: ColumnDef[] = [
  { key: 'status', label: 'Invoice status', locked: true },
  { key: 'company_name', label: 'Client', locked: true },
  { key: 'project_name', label: 'Project', default: true },
  { key: 'project_key', label: 'Project ID', default: true },
  { key: 'who', label: 'Delivered by' },
  { key: 'booking_month', label: 'Booked month', default: true },
  { key: 'ledger_usd', label: 'Sheet value USD', default: true },
  { key: 'outsource_usd', label: 'Contractor cost USD', default: true },
  { key: 'invoiced_usd', label: 'Invoiced USD', default: true },
  { key: 'paid_usd', label: 'Paid USD', default: true },
  { key: 'earliest_due_at', label: 'Due date' },
  { key: 'late', label: 'Days late', default: true },
]

const RECON_COLS: ColumnDef[] = [
  { key: 'invoice_no', label: 'Invoice no (app)', locked: true },
  { key: 'project_id', label: 'Project ID (app)', locked: true },
  { key: 'booking_date', label: 'Booked', default: true },
  { key: 'invoice_date', label: 'Invoice date', default: true },
  { key: 'client', label: 'Client (app)', default: true },
  { key: 'project_names', label: 'Project', default: true },
  { key: 'services', label: 'Service' },
  { key: 'our_usd', label: 'Invoiced USD', default: true },
  { key: 'status', label: 'Invoice status', default: true },
]

/**
 * A sortable table head.
 *
 * `num` right-aligns and sorts numerically. Every column states its unit in the header —
 * "Sheet USD" and "Cost" and "Invoiced" sitting side by side told you nothing about which
 * system each came from or what currency it was in (Pratik's note, 29 Sep 2026).
 */
type SortDir = 'asc' | 'desc'
function Th<K extends string>({ id, label, hint, num, sort, dir, onSort }: {
  id: K; label: string; hint?: string; num?: boolean
  sort: K | null; dir: SortDir; onSort: (k: K) => void
}) {
  const on = sort === id
  return (
    <th className={`sticky top-0 z-10 bg-mav-panel px-4 py-3 font-medium whitespace-nowrap
      border-b border-mav-line ${num ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(id)} title={hint}
        className={`inline-flex items-center gap-1 hover:text-mav-fg ${on ? 'text-mav-fg' : ''}`}>
        {label}
        <span className={`text-[9px] ${on ? 'opacity-100' : 'opacity-25'}`}>
          {on && dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

/** Sort by a key, nulls always last whichever direction — a blank is not a small number. */
function sortRows<T>(rows: T[], get: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  return rows.slice().sort((a, b) => {
    const x = get(a), y = get(b)
    const ax = x === null || x === undefined || x === '', ay = y === null || y === undefined || y === ''
    if (ax && ay) return 0
    if (ax) return 1
    if (ay) return -1
    const c = typeof x === 'number' && typeof y === 'number'
      ? x - y : String(x).localeCompare(String(y))
    return dir === 'asc' ? c : -c
  })
}

// The invoice app only became the reference in April 2026. Everything before that is
// present in the tables but is not shown, because the sheet and the app were maintained
// independently until then and every earlier month reconciles badly for reasons nobody is
// going to chase now. Kept as a constant so it is one line to move, not a rewrite.
const FLOOR = '2026-04-01'

export default function Invoices() {
  const [recon, setRecon] = useState<InvoiceRecon[]>([])
  const [status, setStatus] = useState<ProjectInvoiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('money')

  useEffect(() => {
    Promise.all([getInvoiceRecon(), getProjectInvoiceStatus()])
      .then(([r, m]) => { setRecon(r); setStatus([...m.values()]) })
      // A failed read has to say so. Rendering an empty table would read as "nothing
      // is overdue", which is the most expensive possible lie on this page.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])

  // ── filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState<string[]>([])
  const [fPc, setFPc] = useState<string[]>([])
  const [fPm, setFPm] = useState<string[]>([])
  const [fGeo, setFGeo] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  // Keyed per table, not per page: the two tabs share column NAMES but not meanings, so
  // hiding 'Invoice status' on one must not hide it on the other.
  const mCols = useColumns('invoices-money', MONEY_COLS)
  const gCols = useColumns('invoices-recon', RECON_COLS)
  const [from, setFrom] = useState(FLOOR)
  const [to, setTo] = useState('')
  const [who, setWho] = useState<Who>('all')
  const [mSort, setMSort] = useState<string | null>('ledger_usd')
  const [mDir, setMDir] = useState<SortDir>('desc')
  const [gSort, setGSort] = useState<string | null>('our_usd')
  const [gDir, setGDir] = useState<SortDir>('desc')
  // Clicking the active column flips direction; a new column starts descending, which is
  // what you want on every money column and harmless on the rest.
  const clickM = (k: string) => { if (k === mSort) setMDir(d => d === 'asc' ? 'desc' : 'asc'); else { setMSort(k); setMDir('desc') } }
  const clickG = (k: string) => { if (k === gSort) setGDir(d => d === 'asc' ? 'desc' : 'asc'); else { setGSort(k); setGDir('desc') } }
  const reset = () => {
    setSearch(''); setFStatus([]); setFPc([]); setFPm([]); setFGeo([])
    setFrom(FLOOR); setTo(''); setWho('all')
  }
  // 'Clear all' only appears once there is something to clear, the way the Project sheet
  // does it — a permanently visible Clear reads as a control with no object.
  const anyFilter = !!search || fStatus.length > 0 || fPc.length > 0 || fPm.length > 0
    || fGeo.length > 0 || from !== FLOOR || !!to || who !== 'all'

  // The FLOOR is applied on top of the date box, so clearing the box cannot drag
  // pre-April rows back in — the page would otherwise silently start reporting months
  // that were never reconciled.
  const inRange = (d?: string | null) => {
    if (!d) return false
    if (d < FLOOR) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }
  const keepsWho = (x: { is_contractor?: boolean | null }) =>
    who === 'all' ? true : who === 'contractor' ? !!x.is_contractor : !x.is_contractor

  // ── money side: per project, from the ledger outwards ───────────────────────
  const money = useMemo(() => status
    .filter(x => hit(search, x.company_name, x.project_name, x.project_id, x.project_key,
                     x.expert, x.contractor_name, x.pm_owner, x.invoice_nos))
    .filter(x => keeps(fStatus, x.status))
    .filter(x => keeps(fPm, x.pm_owner))
    .filter(x => inRange(x.booking_month))
    .filter(keepsWho),
    [status, search, fStatus, fPm, from, to, who])

  const moneySorted = useMemo(() => sortRows(money, r => {
    switch (mSort) {
      case 'status': return r.status
      case 'company_name': return r.company_name
      case 'project_name': return r.project_name
      case 'project_key': return r.project_key || r.project_id
      case 'who': return r.is_contractor ? 'Contractor' : (r.expert || '')
      case 'booking_month': return r.booking_month
      case 'outsource_usd': return r.outsource_usd ?? null
      case 'invoiced_usd': return r.invoice_count ? (r.invoiced_usd ?? 0) : null
      case 'paid_usd': return r.paid_usd ?? null
      case 'earliest_due_at': return r.earliest_due_at
      default: return r.ledger_usd ?? null
    }
  }, mDir), [money, mSort, mDir])

  const tot = (rows: ProjectInvoiceStatus[], s: string) =>
    rows.filter(x => x.status === s).reduce((n, x) => n + (x.ledger_usd || 0), 0)
  const cnt = (rows: ProjectInvoiceStatus[], s: string) => rows.filter(x => x.status === s).length

  // ── reconciliation side: per invoice, from the app inwards ──────────────────
  // Two kinds of invoice are excluded from the gap because their absence from the sheet is
  // CORRECT, not a discrepancy:
  //
  //   future-dated — scheduled instalments of live contracts; the sheet books a month when
  //                  it happens. Counting these was the largest error in the first version.
  //   Void         — the invoice was cancelled, so there is no revenue to book. Irixs
  //                  showed why this matters: PRJ310326221639 was voided in March and
  //                  re-raised as PRJ220726200047 in July. Once the sheet was repointed at
  //                  the live one, the voided one fell into the gap and looked like a new
  //                  problem. It is the opposite of one.
  const gap = useMemo(() => recon
    .filter(x => !x.in_sheet && !x.is_future && x.status !== 'Void')
    .filter(x => hit(search, x.client, x.project_names, x.invoice_no, x.project_id,
                     x.services, x.pc, x.sales_person))
    .filter(x => keeps(fStatus, x.status))
    .filter(x => keeps(fPc, x.pc))
    .filter(x => keeps(fGeo, x.geo))
    .filter(x => inRange(x.booking_date || x.invoice_date))
    .sort((a, b) => (b.our_usd || 0) - (a.our_usd || 0)),
    [recon, search, fStatus, fPc, fGeo, from, to])

  const gapSorted = useMemo(() => sortRows(gap, r => {
    switch (gSort) {
      case 'invoice_no': return r.invoice_no
      case 'project_id': return r.project_id
      case 'booking_date': return r.booking_date
      case 'invoice_date': return r.invoice_date
      case 'client': return r.client
      case 'project_names': return r.project_names
      case 'services': return r.services
      case 'status': return r.status
      default: return r.our_usd ?? null
    }
  }, gDir), [gap, gSort, gDir])

  const gapUsd = gap.reduce((n, x) => n + (x.our_usd || 0), 0)
  const gapInstal = gap.filter(x => x.is_instalment)
  const inScope = recon.filter(x => inRange(x.booking_date || x.invoice_date))
  const future = inScope.filter(x => x.is_future && !x.in_sheet)
  const futureUsd = future.reduce((n, x) => n + (x.our_usd || 0), 0)
  const voided = inScope.filter(x => !x.in_sheet && !x.is_future && x.status === 'Void')
  const inScopeUsd = inScope.reduce((n, x) => n + (x.our_usd || 0), 0)

  // Per month, both directions at once — this is the table that explains a variance.
  const byMonth = useMemo(() => {
    const m = new Map<string, { app: number; gap: number; n: number; gapN: number }>()
    for (const r of inScope) {
      const k = monthOf(r.booking_date || r.invoice_date); if (!k) continue
      const e = m.get(k) || { app: 0, gap: 0, n: 0, gapN: 0 }
      e.app += r.our_usd || 0; e.n++
      if (!r.in_sheet) { e.gap += r.our_usd || 0; e.gapN++ }
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [inScope])

  if (failed) return (
    <div>
      <Header title="Invoices & Reconciliation" />
      <p className="text-sm text-red-400">Could not load the invoice data. Nothing is shown rather than an
        empty table, because an empty table here would read as "nothing is overdue".</p>
    </div>
  )

  const tabs = (
    <Segments<Tab> value={tab} onChange={setTab} items={[
      { id: 'money', label: 'Money', count: money.length, title: 'Per project: invoiced, paid, overdue, never raised' },
      { id: 'recon', label: 'Reconciliation', count: gap.length, title: 'Invoices the revenue sheet does not have' },
      { id: 'mapping', label: 'Invoice mapping', title: "A month's sheet rows against the invoices raised for them — what is still to raise" },
    ]} />
  )

  // Invoice mapping is its own view (app/invoices/InvoiceMapping.tsx) with its own month,
  // filters and refresh, and it DOES follow the department switch — so it skips the
  // "not split" note and the Money/Reconciliation filter bar below.
  if (tab === 'mapping') return (
    <div>
      <Header title="Invoices & Reconciliation"
        subtitle="Invoice mapping: a month's revenue-sheet rows against the invoices raised for them, so the ones still to raise can go to the AM. Raised or not — payment is on the Money tab." />
      {tabs}
      <InvoiceMapping />
    </div>
  )

  return (
    <div>
      <Header title="Invoices & Reconciliation"
        subtitle="What has been invoiced, what has been paid, and what the revenue sheet does not know about — from April 2026" />
      {/* The invoice app has no department column we can trust — scope is defined by
          Service, which is already applied server-side to our four Web services. */}
      <NotSplitNote what="Invoices" reason="are already scoped to the Web services" className="-mt-3 mb-4" />

      {tabs}
      <FilterBar right={<>
        {/* Row count first, the way the Project sheet does it: the number of things you
            are looking at is the single most useful thing a filter bar can tell you. */}
        <span className={lbl}>
          {loading ? 'Loading…' : `${(tab === 'money' ? money.length : gap.length).toLocaleString()} shown`}
        </span>
        {/* The picker belongs to whichever table is on screen. */}
        <ColumnPicker cols={tab === 'money' ? mCols : gCols} />
        {anyFilter && <button onClick={reset} className={secBtn}>Clear all</button>}
      </>}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Client, project, project ID or invoice no…" className={`${selCls} w-64`} />
        {/* Contractor spend is INR in the sheet and converted here, so 'Contractor' shows
            both what we billed and what the work cost us. */}
        <div className="inline-flex rounded-md border border-mav-line overflow-hidden">
          {([['all', 'All'], ['contractor', 'Contractor'], ['inhouse', 'In-house']] as [Who, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setWho(k)} title={
              k === 'contractor' ? "Rows the sheet marks as outsourced — Expert = 'Contractor', or a non-zero outsource price"
              : k === 'inhouse' ? 'Everything delivered by the team' : 'Both'}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                who === k ? 'bg-mav-fill text-black' : 'text-mav-muted hover:text-mav-fg'}`}>
              {label}
            </button>
          ))}
        </div>
        <MultiSelect label="All statuses"
          options={tab === 'money' ? uniq(status.map(x => x.status)) : uniq(recon.map(x => x.status))}
          selected={fStatus} onChange={setFStatus} className="w-44" />
        {tab === 'money'
          ? <MultiSelect label="All PMs" options={uniq(status.map(x => x.pm_owner))} selected={fPm} onChange={setFPm} className="w-40" />
          : <MultiSelect label="All PCs" options={uniq(recon.map(x => x.pc))} selected={fPc} onChange={setFPc} className="w-40" />}
        <button onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen} className={toggleBtn}>
          More filters{(fGeo.length || from !== FLOOR || to) ? ` · ${[fGeo.length && 'geo', from !== FLOOR && 'from', to && 'to'].filter(Boolean).length}` : ''}
        </button>
        {moreOpen && <>
          <div className="basis-full h-0" />
          {tab === 'recon' && (
            <MultiSelect label="All GEOs" options={uniq(recon.map(x => x.geo))} selected={fGeo} onChange={setFGeo} className="w-40" />
          )}
          <span className={`${lbl} ml-2`} title={`Never earlier than ${FLOOR} — the invoice app only became the reference then`}>Range</span>
          <input type="date" value={from} min={FLOOR} onChange={e => setFrom(e.target.value)} className={selCls} aria-label="From date" />
          <span className="text-xs text-mav-muted">&rarr;</span>
          <input type="date" value={to} min={FLOOR} onChange={e => setTo(e.target.value)} className={selCls} aria-label="To date" />
          <span className={`${lbl} ml-2`}>Quick views</span>
          <button onClick={() => { setFStatus(['Overdue']); setWho('all') }}
            className="text-xs px-3 py-1.5 rounded-full border border-rose-500/50 text-rose-400 hover:bg-rose-500/15 transition-colors">
            Overdue only
          </button>
          <button onClick={() => { setFStatus(['Not raised', 'Draft']); setWho('all') }}
            className="text-xs px-3 py-1.5 rounded-full border border-amber-500/50 text-amber-400 hover:bg-amber-500/15 transition-colors">
            Never billed or unsent
          </button>
        </>}
      </FilterBar>

      {loading && <p className="text-sm text-mav-muted">Loading…</p>}

      {!loading && tab === 'money' && (
        <>
          {/* The four that cost money, in the order they cost it. Paid is deliberately
              last and quiet: it is the 90% that needs no attention. */}
          {/* A status strip: tone carries the meaning so the row reads before any figure
              does. Paid is green and last — it is the 90% that needs no attention. */}
          <KPIRow cols={5}>
            <KPICard label="Overdue" tone="red" value={usd(tot(money, 'Overdue'))}
              sub={`${cnt(money, 'Overdue')} projects`}
              info="Past the due date the invoice app itself records. Overdue is a stored status, not something this dashboard derives." />
            <KPICard label="Draft" tone="amber" value={usd(tot(money, 'Draft'))}
              sub={`${cnt(money, 'Draft')} projects`}
              info="An invoice exists but has never been sent. The quietest leak on this page: nobody is chasing it because it looks raised." />
            <KPICard label="Not raised" tone="amber" value={usd(tot(money, 'Not raised'))}
              sub={`${cnt(money, 'Not raised')} projects`}
              info="Work booked in the sheet with no invoice against its project id. The invoice app knows nothing about it." />
            <KPICard label="No project id" tone="default" value={usd(tot(money, 'No project id'))}
              sub={`${cnt(money, 'No project id')} rows`}
              info="The sheet row carries no usable project id, so it can never be matched either way. A gap in data entry, not in billing — kept separate from 'Not raised' for exactly that reason." />
            <KPICard label="Paid" tone="green" value={usd(tot(money, 'Paid'))}
              sub={`${cnt(money, 'Paid')} projects`} />
          </KPIRow>
          {/* Only when the filter is on contractors: billed against cost, which is the
              question "we outsourced this — did we invoice it, and did it pay for itself". */}
          {who === 'contractor' && (
            <KPIRow cols={3}>
              <KPICard label="Contractor projects" value={String(money.length)}
                sub={`${money.filter(x => x.invoice_count).length} invoiced`} />
              <KPICard label="Billed" value={usd(money.reduce((n, x) => n + (x.ledger_usd || 0), 0))} />
              <KPICard label="Outsource cost" tone="amber"
                value={usd(money.reduce((n, x) => n + (x.outsource_usd || 0), 0))}
                info="The sheet records this in INR; converted here at the project's stored rate. Rows with no figure are contractor work whose cost was never entered." />
            </KPIRow>
          )}
          <Panel flush>
            {/* No box of its own to scroll: the rows scroll with the page and the sticky
                header holds at the top of it. Only below xl, where the table is wider than
                the screen, does it scroll sideways (and the header then scrolls with it). */}
            <div className="max-xl:overflow-x-auto"><table className="w-full text-sm max-xl:min-w-[1040px]">
              {/* Every header names its SOURCE and its unit. 'Sheet USD / Cost / Invoiced
                  / Paid' side by side said nothing about which system each came from. */}
              <thead className="text-mav-muted"><tr>
                {mCols.on('status') && (
<Th id="status" label="Invoice status" hint="The status the invoice app holds, or 'Not raised' / 'No project id' where this dashboard cannot find one" sort={mSort} dir={mDir} onSort={clickM} />
)}
                {mCols.on('company_name') && (
                <Th id="company_name" label="Client" sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('project_name') && (
                <Th id="project_name" label="Project" sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('project_key') && (
                <Th id="project_key" label="Project ID" hint="As entered in the revenue sheet, normalised to a bare PRJ id" sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('who') && (
                <Th id="who" label="Delivered by" hint="The sheet's Expert column. 'Contractor' means outsourced." sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('booking_month') && (
                <Th id="booking_month" label="Booked month" hint="The month the revenue sheet books this row against" sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('ledger_usd') && (
                <Th id="ledger_usd" label="Sheet value USD" hint="Revenue as the sheet records it, in USD" num sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('outsource_usd') && (
                <Th id="outsource_usd" label="Contractor cost USD" hint="Outsource spend. Held in INR in the sheet and converted at the stored FX rate; hover a figure for the rupee amount." num sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('invoiced_usd') && (
                <Th id="invoiced_usd" label="Invoiced USD" hint="Total the invoice app has raised against this project id" num sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('paid_usd') && (
                <Th id="paid_usd" label="Paid USD" hint="Of that, the part the app records as Paid" num sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('earliest_due_at') && (
                <Th id="earliest_due_at" label="Due date" hint="Earliest due date across this project's invoices" sort={mSort} dir={mDir} onSort={clickM} />
                )}
                {mCols.on('late') && (
                <Th id="late" label="Days late" num sort={mSort} dir={mDir} onSort={clickM} />
                )}
              </tr></thead>
              <tbody>{moneySorted.slice(0, 500).map(x => {
                const late = x.status === 'Overdue' ? daysLate(x.earliest_due_at?.slice(0, 10)) : null
                return (
                  <tr key={x.row_key} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    {mCols.on('status') && (
                    <td className="px-4 py-3"><Pill s={x.status} /></td>
                    )}
                    {mCols.on('company_name') && (
                    <td className="px-4 py-3">{x.company_name || '—'}</td>
                    )}
                    {mCols.on('project_name') && (
                    <td className="px-4 py-3 text-mav-muted max-w-[220px] truncate" title={x.project_name || ''}>{x.project_name || '—'}</td>
                    )}
                    {mCols.on('project_key') && (
                    <td className="px-4 py-3 font-mono text-[11px] text-mav-muted whitespace-nowrap">{x.project_key || x.project_id || '—'}</td>
                    )}
                    {mCols.on('who') && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      {x.is_contractor
                        ? <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-400"
                            title={x.contractor_name || x.expert || 'Contractor'}>Contractor</span>
                        : <span className="text-mav-muted text-xs">{x.expert || '—'}</span>}
                    </td>
                    )}
                    {mCols.on('booking_month') && (
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.booking_month || '').slice(0, 7) || '—'}</td>
                    )}
                    {mCols.on('ledger_usd') && (
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{usd(x.ledger_usd)}</td>
                    )}
                    {/* Outsource spend. INR in the sheet, converted here; the rupee figure
                        is in the tooltip for anyone reconciling against the sheet itself. */}
                    {mCols.on('outsource_usd') && (
                    <td className="px-4 py-3 text-mav-muted text-right tabular-nums whitespace-nowrap"
                        title={x.outsource_local ? `${Math.round(x.outsource_local).toLocaleString()} ${x.outsource_currency || 'INR'}` : ''}>
                      {x.outsource_usd ? usd(x.outsource_usd) : '—'}
                    </td>
                    )}
                    {mCols.on('invoiced_usd') && (
                    <td className="px-4 py-3 text-mav-muted text-right tabular-nums whitespace-nowrap">{x.invoice_count ? usd(x.invoiced_usd) : '—'}</td>
                    )}
                    {mCols.on('paid_usd') && (
                    <td className="px-4 py-3 text-mav-muted text-right tabular-nums whitespace-nowrap">{x.paid_usd ? usd(x.paid_usd) : '—'}</td>
                    )}
                    {mCols.on('earliest_due_at') && (
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.earliest_due_at?.slice(0, 10) || '—'}</td>
                    )}
                    {mCols.on('late') && (
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{late ? <span className="text-red-400">{late}</span> : '—'}</td>
                    )}
                  </tr>
                )
              })}</tbody>
            </table></div>
            {money.length > 500 && (
              <p className="px-4 py-3 text-xs text-mav-muted border-t border-mav-line">
                Showing the 500 largest of {money.length.toLocaleString()} — narrow the filters to see the rest.
              </p>
            )}
          </Panel>
        </>
      )}

      {!loading && tab === 'recon' && (
        <>
          <KPIRow cols={4}>
            <KPICard label="Invoiced (app)" value={usd(inScopeUsd)} sub={`${inScope.length.toLocaleString()} invoices`} />
            <KPICard label="Not in the revenue sheet" tone="red" value={usd(gapUsd)}
              sub={`${gap.length.toLocaleString()} invoices`} />
            <KPICard label="Scheduled, not due yet" value={usd(futureUsd)}
              sub={`${future.length} invoices`}
              info="Invoices the app has already raised with a date in the future — instalments of live recurring contracts. The sheet books a month when it happens, so these are not missing rows and are excluded from the gap." />
            <KPICard label="Gap as % of invoiced"
              value={inScopeUsd ? `${(100 * gapUsd / inScopeUsd).toFixed(1)}%` : '—'}
              sub={voided.length
                ? `${gapInstal.length} recurring · ${voided.length} void excluded`
                : `${gapInstal.length} of the ${gap.length} are recurring`} />
          </KPIRow>
          {/* Why the two systems disagree, stated once rather than left to be rediscovered. */}
          <p className="text-[11px] text-mav-muted/80 mb-4 max-w-3xl">
            A sheet row is matched to an invoice three ways, in order: the normalised project id, the
            sheet&rsquo;s own invoice number, then client&nbsp;+&nbsp;month&nbsp;+&nbsp;value. All
            three are needed because the project id is <em>re-issued</em> when a recurring contract
            renews, so the sheet and the app legitimately hold different ids for the same engagement.
            Matching on the id alone reported a gap four times larger than the real one.
          </p>
          {/* The three rules that make this agree with the invoice app's own report,
              settled against its September export on 1 Oct 2026. Stated on the page so
              nobody has to ask why a figure here differs from a figure there. */}
          <p className="text-[11px] text-mav-muted/80 mb-4 max-w-3xl">
            Months here are <strong>booking months</strong>, not invoice dates — the app books an
            invoice when the work is booked, so one dated 13 March can belong to September. Draft
            invoices are excluded because a draft has not been raised, and a voided invoice books a
            credit in the month it was voided rather than disappearing from the month it was raised.
          </p>

          <div className="grid lg:grid-cols-[320px_1fr] gap-4">
            <Panel title="By booking month" flush>
              <div className="max-xl:overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-mav-muted"><tr>
                  {['Month', 'App', 'Gap'].map(h =>
                    <th key={h} className="sticky top-0 z-10 bg-mav-panel px-4 py-2 font-medium border-b border-mav-line">{h}</th>)}
                </tr></thead>
                <tbody>{byMonth.map(([k, v]) => (
                  <tr key={k} className="border-b border-mav-line/60">
                    <td className="px-4 py-2 whitespace-nowrap">{k}</td>
                    <td className="px-4 py-2 text-mav-muted whitespace-nowrap">{usd(v.app)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {v.gap ? <span className="text-amber-400">{usd(v.gap)}</span> : '—'}
                      {v.gapN ? <span className="text-mav-muted/70 text-[11px]"> ({v.gapN})</span> : null}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Panel>

            <Panel title={`Invoices the revenue sheet does not have (${gap.length})`} flush>
              <div className="max-xl:overflow-x-auto"><table className="w-full text-sm max-xl:min-w-[900px]">
                <thead className="text-mav-muted"><tr>
                  {gCols.on('invoice_no') && (
<Th id="invoice_no" label="Invoice no (app)" sort={gSort} dir={gDir} onSort={clickG} />
)}
                  {gCols.on('project_id') && (
                  <Th id="project_id" label="Project ID (app)" hint="The id the invoice app raised this against. Paste it into the sheet to close the row." sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('booking_date') && (
                  <Th id="booking_date" label="Booked" hint="The month the invoice app reports this in. It is not always the invoice date — an invoice dated 13 March can book in September." sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('invoice_date') && (
                  <Th id="invoice_date" label="Invoice date" sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('client') && (
                  <Th id="client" label="Client (app)" sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('project_names') && (
                  <Th id="project_names" label="Project" sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('services') && (
                  <Th id="services" label="Service" sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('our_usd') && (
                  <Th id="our_usd" label="Invoiced USD" hint="Our Web-service lines on this invoice, not the invoice total" num sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                  {gCols.on('status') && (
                  <Th id="status" label="Invoice status" sort={gSort} dir={gDir} onSort={clickG} />
                  )}
                </tr></thead>
                <tbody>{gapSorted.slice(0, 500).map(x => (
                  <tr key={x.invoice_no} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[12px]">
                      {x.invoice_no}
                      {x.is_instalment && (
                        <span className="ml-1 text-[10px] text-mav-muted/70" title="Recurring instalment — the sheet books the contract once">rec</span>
                      )}
                    </td>
                    {/* The project id is the reason this row is here: the invoice app raised
                        it against this id and no sheet row carries it. Shown, not hidden in
                        a tooltip, so it can be pasted straight into the sheet. */}
                    {gCols.on('project_id') && (
                    <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">{x.project_id || '—'}</td>
                    )}
                    {gCols.on('booking_date') && (
                    <td className="px-4 py-3 whitespace-nowrap">{x.booking_date || '—'}</td>
                    )}
                    {gCols.on('invoice_date') && (
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.invoice_date || '—'}</td>
                    )}
                    {gCols.on('client') && (
                    <td className="px-4 py-3">{x.client || '—'}</td>
                    )}
                    {gCols.on('project_names') && (
                    <td className="px-4 py-3 text-mav-muted max-w-[200px] truncate" title={x.project_names || ''}>{x.project_names || '—'}</td>
                    )}
                    {gCols.on('services') && (
                    <td className="px-4 py-3 text-mav-muted max-w-[150px] truncate" title={x.services || ''}>{x.services || '—'}</td>
                    )}
                    {gCols.on('our_usd') && (
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{usd(x.our_usd)}</td>
                    )}
                    {gCols.on('status') && (
                    <td className="px-4 py-3"><Pill s={x.status} /></td>
                    )}
                  </tr>
                ))}</tbody>
              </table></div>
              {gap.length > 500 && (
                <p className="px-4 py-3 text-xs text-mav-muted border-t border-mav-line">
                  Showing the 500 largest of {gap.length.toLocaleString()} — narrow the filters to see the rest.
                </p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
