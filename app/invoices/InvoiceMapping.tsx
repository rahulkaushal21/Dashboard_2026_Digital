'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Copy, Check } from 'lucide-react'
import KPICard from '@/components/KPICard'
import MultiSelect from '@/components/MultiSelect'
import DateCell from '@/components/DateCell'
import { fmtDay } from '@/components/CardDetail'
import { useUnit } from '@/components/BusinessUnitProvider'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import { inUnit, unitOf } from '@/lib/business-unit'
import { getInvoiceMapping, refreshInvoiceData, type InvoiceMappingRow, type MappingState } from '@/lib/supabase'

// Invoice mapping
// ---------------
// One month of the revenue sheet against the invoices raised for it, so the gap can be
// taken to the AM who has to raise them. Raised or not — payment is the Money tab's
// question, not this one's.
//
// The matching itself is the database's (invoice_mapping(), migration 102): invoice no,
// then project id, then client + value, with the value checked per invoice. This file
// only splits the answer into what to do next.

const usd = (n?: number | null) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`
const uniq = (a: (string | null | undefined)[]) =>
  Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort((x, y) => x.localeCompare(y))
const splitNames = (s?: string | null) => (s || '').split(/[,/&]/).map(x => x.trim()).filter(Boolean)
const selCls = 'bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
const primary = 'inline-flex items-center gap-2 rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm hover:brightness-95 disabled:opacity-50'
const secondary = 'inline-flex items-center gap-1.5 rounded-full border border-mav-yellow/50 text-mav-yellow px-3 py-1 text-xs hover:bg-mav-yellow/10'

type Seg = 'raise' | 'check' | 'done' | 'orphan' | 'all'

const STATE_TONE: Record<MappingState, string> = {
  'Invoiced': 'bg-green-500/15 text-green-400',
  'Part invoiced': 'bg-amber-500/15 text-amber-400',
  'Value differs': 'bg-orange-500/15 text-orange-400',
  'To raise': 'bg-red-500/15 text-red-400',
  'Awaiting info': 'bg-mav-fg/10 text-mav-muted',
  'Not in sheet': 'bg-sky-500/15 text-sky-400',
}
const Badge = ({ s }: { s: MappingState }) =>
  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATE_TONE[s]}`}>{s}</span>

// The months on offer: this one and the eleven before it, newest first.
const monthsBack = (n: number) => {
  const d = new Date(); d.setDate(1)
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    const v = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
    return { v, label: x.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) }
  })
}

// How much of a row's invoice belongs to THIS row. One invoice often carries several sheet
// lines, so its value is shared out in proportion to each line's sheet amount — otherwise a
// $6,500 invoice for two $3,250 lines would be counted twice in "invoiced".
const invoicedShare = (r: InvoiceMappingRow) => {
  if (r.row_type !== 'sheet' || !r.invoice_no || r.invoice_usd == null) return 0
  const g = r.group_sheet_usd || 0
  return g > 0 ? (r.invoice_usd * (r.sheet_usd || 0)) / g : r.invoice_usd
}

const COLS: ColumnDef[] = [
  { key: 'date', label: 'Date', locked: true },
  { key: 'client', label: 'Client', locked: true },
  { key: 'project', label: 'Project', default: true },
  { key: 'pc', label: 'PC/SME', default: true },
  { key: 'am', label: 'AM', default: true },
  { key: 'sheet', label: 'Sheet $', default: true },
  { key: 'invoice', label: 'Invoice', default: true },
  { key: 'invusd', label: 'Invoice $', default: true },
  { key: 'state', label: 'State', locked: true },
  { key: 'how', label: 'Matched on' },
  { key: 'dept', label: 'Department' },
  { key: 'pid', label: 'Project ID' },
  { key: 'status', label: 'Delivery status' },
  { key: 'services', label: 'Invoice service' },
]

export default function InvoiceMapping() {
  const { unit } = useUnit()
  const months = useMemo(() => monthsBack(12), [])
  const [month, setMonth] = useState(months[0].v)
  const [rows, setRows] = useState<InvoiceMappingRow[] | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [step, setStep] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const [seg, setSeg] = useState<Seg>('raise')
  const [search, setSearch] = useState('')
  const [fAm, setFAm] = useState<string[]>([])
  const [fPc, setFPc] = useState<string[]>([])
  const [copied, setCopied] = useState('')
  const cols = useColumns('invoice-mapping', COLS)

  const load = useCallback(async (m: string) => {
    setRows(null); setError('')
    const r = await getInvoiceMapping(m)
    if (r.error) setError(r.error)
    setRows(r.rows)
    setUpdatedAt(new Date())
  }, [])
  useEffect(() => { load(month) }, [month, load])

  const refresh = async () => {
    setRefreshing(true); setError('')
    const r = await refreshInvoiceData(setStep)
    setStep('')
    if (!r.ok) setError(r.error || 'Refresh failed')
    await load(month)
    setRefreshing(false)
  }

  // ── Department ────────────────────────────────────────────────────────────────
  // A sheet row carries its own Service Department; an invoice with no sheet row is
  // placed by its lines' service (Development - LP/Hub → LP/HUB, the rest → Web).
  const inDept = useMemo(() => (rows || []).filter(r => inUnit(r.service_dept, unit)), [rows, unit])
  const unplaced = useMemo(() => unit === 'all' ? 0
    : (rows || []).filter(r => unitOf(r.service_dept) === null).length, [rows, unit])

  const sheet = inDept.filter(r => r.row_type === 'sheet')
  const orphans = inDept.filter(r => r.row_type === 'invoice')
  const toRaise = sheet.filter(r => r.state === 'To raise')
  const check = sheet.filter(r => r.state === 'Part invoiced' || r.state === 'Value differs')
  const done = sheet.filter(r => r.state === 'Invoiced')
  const sheetUsd = sheet.reduce((s, r) => s + (r.sheet_usd || 0), 0)
  const invoicedUsd = sheet.reduce((s, r) => s + invoicedShare(r), 0)
  const raiseUsd = toRaise.reduce((s, r) => s + (r.sheet_usd || 0), 0)
  const checkGap = check.reduce((s, r) => s + ((r.sheet_usd || 0) - invoicedShare(r)), 0)
  const orphanUsd = orphans.reduce((s, r) => s + (r.invoice_usd || 0), 0)
  const monthInvoiced = new Set(inDept.filter(r => r.invoice_no && (r.invoice_date || '').slice(0, 7) === month).map(r => r.invoice_no))

  // ── Filters ───────────────────────────────────────────────────────────────────
  const matchesFilters = (r: InvoiceMappingRow) => {
    const q = search.trim().toLowerCase()
    if (q && ![r.company_name, r.project_name, r.invoice_no, r.project_id, r.sheet_invoice_no, r.pm_owner, r.sales_person]
      .some(v => (v || '').toLowerCase().includes(q))) return false
    if (fAm.length && !splitNames(r.sales_person).some(n => fAm.includes(n))) return false
    if (fPc.length && !splitNames(r.pm_owner).some(n => fPc.includes(n))) return false
    return true
  }
  const bySeg: Record<Seg, InvoiceMappingRow[]> = { raise: toRaise, check, done, orphan: orphans, all: inDept }
  const shown = bySeg[seg].filter(matchesFilters)
    .sort((a, b) => (b.start_date || b.invoice_date || '').localeCompare(a.start_date || a.invoice_date || ''))

  // ── Who has to raise what ─────────────────────────────────────────────────────
  // The point of the page: a list per AM they can act on. Owner cells can name two
  // people ("A / B"), so each name gets the row.
  const byAm = useMemo(() => {
    const m = new Map<string, { n: number; usd: number; rows: InvoiceMappingRow[] }>()
    for (const r of toRaise) {
      const names = splitNames(r.sales_person)
      for (const a of (names.length ? names : ['No AM in the sheet'])) {
        const e = m.get(a) || { n: 0, usd: 0, rows: [] }
        e.n++; e.usd += r.sheet_usd || 0; e.rows.push(r)
        m.set(a, e)
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1].usd - a[1].usd)
  }, [toRaise])

  const monthLabel = months.find(m => m.v === month)?.label || month
  const copyFor = async (am: string, list: InvoiceMappingRow[]) => {
    const lines = [
      `Invoices to raise — ${monthLabel}${am ? ` — ${am}` : ''}`,
      ...list.map(r => `• ${r.company_name || '—'} — ${r.project_name || '—'} — ${usd(r.sheet_usd)}${r.project_id ? ` — ${r.project_id}` : ' — no project ID'} (PC: ${r.pm_owner || '—'})`),
      `Total: ${usd(list.reduce((s, r) => s + (r.sheet_usd || 0), 0))}`,
    ]
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(am); setTimeout(() => setCopied(''), 2000) }
    catch { setError('Could not copy — the browser blocked clipboard access') }
  }

  const loading = rows === null
  const rowDetails = (list: InvoiceMappingRow[], sub: string) => ({
    subtitle: sub, rows: list, rowKey: (r: InvoiceMappingRow) => r.row_key,
    groupBy: (r: InvoiceMappingRow) => splitNames(r.sales_person)[0] || 'No AM',
    groupTotal: (rs: InvoiceMappingRow[]) => usd(rs.reduce((s, r) => s + (r.sheet_usd || r.invoice_usd || 0), 0)),
    columns: [
      { key: 'd', label: 'Date', value: (r: InvoiceMappingRow) => fmtDay(r.start_date || r.invoice_date), sort: (r: InvoiceMappingRow) => r.start_date || r.invoice_date || '' },
      { key: 'c', label: 'Client', value: (r: InvoiceMappingRow) => r.company_name || '—', wide: true },
      { key: 'p', label: 'Project', value: (r: InvoiceMappingRow) => r.project_name || r.invoice_no || '—', wide: true },
      { key: 's', label: 'Sheet $', align: 'right' as const, value: (r: InvoiceMappingRow) => usd(r.sheet_usd), sort: (r: InvoiceMappingRow) => r.sheet_usd || 0,
        total: (rs: InvoiceMappingRow[]) => usd(rs.reduce((s, r) => s + (r.sheet_usd || 0), 0)) },
      { key: 'i', label: 'Invoice', value: (r: InvoiceMappingRow) => r.invoice_no || '—' },
    ],
  })

  return (
    <div>
      {/* Month and refresh first: every number below answers "for which month, as of when". */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={month} onChange={e => setMonth(e.target.value)} className={`${selCls} w-48`} aria-label="Month">
          {months.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
        <button onClick={refresh} disabled={refreshing} className={primary}
          title="Pull the invoice app and the revenue sheet now instead of waiting for the hourly sync (takes a minute or two)">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
        <span className="text-xs text-mav-muted">
          {step || (updatedAt ? `Shown as of ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · the sync also runs every hour` : '')}
        </span>
      </div>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {unplaced > 0 && <p className="text-[11px] text-mav-muted -mt-2 mb-3">{unplaced} row{unplaced === 1 ? '' : 's'} with no department are shown under All.</p>}

      <KPIRow cols={4}>
        <KPICard tone="accent" label={`Sheet · ${monthLabel}`} value={loading ? '…' : usd(sheetUsd)}
          sub={`${sheet.length} sheet rows`}
          info="Every line booked in the revenue sheet for this month (Month-Year), in this department. Cancelled lines are left out."
          details={loading ? undefined : rowDetails(sheet, 'All sheet rows this month, by AM')} />
        <KPICard tone="green" label="Invoiced against it" value={loading ? '…' : usd(invoicedUsd)}
          sub={`${done.length + check.length} rows have an invoice · ${monthInvoiced.size} invoices`}
          info="The invoiced value of the sheet rows above. Where one invoice covers several sheet lines it is shared between them in proportion, so nothing is counted twice."
          details={loading ? undefined : rowDetails([...done, ...check], 'Sheet rows with an invoice')} />
        <KPICard tone="red" label="Difference" value={loading ? '…' : usd(sheetUsd - invoicedUsd)}
          sub={`${usd(raiseUsd)} not raised · ${usd(checkGap)} part/different`}
          info="Sheet total minus what has been invoiced against it: the invoices still to raise, plus the shortfall on part-invoiced lines."
          details={loading ? undefined : rowDetails([...toRaise, ...check], 'Rows behind the difference')} />
        <KPICard tone="yellow" label="To raise" value={loading ? '…' : String(toRaise.length)}
          sub={`${usd(raiseUsd)} across ${byAm.length} AM${byAm.length === 1 ? '' : 's'}`}
          info="Sheet rows with no invoice found by invoice number, project ID, or client and value. Take these to the AM."
          details={loading ? undefined : rowDetails(toRaise, 'Invoices to raise, by AM')} />
      </KPIRow>

      <Segments<Seg> value={seg} onChange={setSeg} items={[
        { id: 'raise', label: 'To raise', count: toRaise.length, title: 'Booked in the sheet, no invoice found' },
        { id: 'check', label: 'Part / value differs', count: check.length, title: 'Invoiced, but not for the sheet amount' },
        { id: 'done', label: 'Invoiced', count: done.length },
        { id: 'orphan', label: 'Invoice, no sheet row', count: orphans.length, title: `Invoices dated ${monthLabel} that no sheet row this month maps to — ${usd(orphanUsd)}` },
        { id: 'all', label: 'All', count: inDept.length },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr] items-start">
        {/* Per AM: what they have to raise, and the list ready to paste into a message. */}
        <Panel flush title="To raise, by AM" info="Click a name to filter the table. Copy puts that AM's list on the clipboard, ready to paste into Slack or email.">
          {loading ? <p className="px-4 py-6 text-sm text-mav-muted">Loading…</p>
          : byAm.length === 0 ? <p className="px-4 py-6 text-sm text-green-400">Nothing to raise for {monthLabel}.</p>
          : (
            <ul className="divide-y divide-mav-line/60">
              {byAm.map(([am, e]) => {
                const on = fAm.length === 1 && fAm[0] === am
                return (
                  <li key={am} className={`flex items-center gap-2 px-4 py-2.5 ${on ? 'bg-mav-yellow/10' : ''}`}>
                    <button onClick={() => { setSeg('raise'); setFAm(on ? [] : [am]) }} className="min-w-0 flex-1 text-left">
                      <div className="text-sm font-medium truncate">{am}</div>
                      <div className="text-xs text-mav-muted">{e.n} to raise · {usd(e.usd)}</div>
                    </button>
                    <button onClick={() => copyFor(am, e.rows)} className={secondary} title={`Copy ${am}'s list`}>
                      {copied === am ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <div className="min-w-0">
          <FilterBar right={<>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{shown.length} shown</span>
            {seg === 'raise' && shown.length > 0 &&
              <button onClick={() => copyFor(fAm.length === 1 ? fAm[0] : '', shown)} className={secondary}>
                {copied === (fAm.length === 1 ? fAm[0] : '') ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy list</>}
              </button>}
            {(search || fAm.length > 0 || fPc.length > 0) &&
              <button onClick={() => { setSearch(''); setFAm([]); setFPc([]) }} className={secondary}>Clear all</button>}
          </>}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, project, invoice or project ID…" className={`${selCls} w-64`} />
            <MultiSelect label="AM" className="w-40" options={uniq(inDept.flatMap(r => splitNames(r.sales_person)))} selected={fAm} onChange={setFAm} />
            <MultiSelect label="PC/SME" className="w-40" options={uniq(inDept.flatMap(r => splitNames(r.pm_owner)))} selected={fPc} onChange={setFPc} />
          </FilterBar>

          <Panel flush title={<>{seg === 'raise' ? 'Invoices to raise' : seg === 'check' ? 'Invoiced, not for the sheet amount' : seg === 'done' ? 'Invoiced' : seg === 'orphan' ? 'Invoices with no sheet row this month' : 'Everything'} · {monthLabel}</>}
            info={seg === 'orphan'
              ? 'Invoices dated this month that no sheet row of this month maps to — usually work booked in another month, or a line the sheet is missing (the Reconciliation tab follows those up).'
              : 'Each sheet row is matched to an invoice by the invoice number in the sheet, then the project ID (for monthly retainers, the instalment within a month of the booking), then client and value within 2%. Values are checked per invoice, so an invoice covering several lines is compared with their sum.'}
            right={<ColumnPicker cols={cols} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Client</th>
                    {cols.on('project') && <th className="px-3 py-2.5">Project</th>}
                    {cols.on('pc') && <th className="px-3 py-2.5">PC/SME</th>}
                    {cols.on('am') && <th className="px-3 py-2.5">AM</th>}
                    {cols.on('sheet') && <th className="px-3 py-2.5 text-right">Sheet $</th>}
                    {cols.on('invoice') && <th className="px-3 py-2.5">Invoice</th>}
                    {cols.on('invusd') && <th className="px-3 py-2.5 text-right">Invoice $</th>}
                    {cols.on('how') && <th className="px-3 py-2.5">Matched on</th>}
                    {cols.on('dept') && <th className="px-3 py-2.5">Department</th>}
                    {cols.on('pid') && <th className="px-3 py-2.5">Project ID</th>}
                    {cols.on('status') && <th className="px-3 py-2.5">Delivery status</th>}
                    {cols.on('services') && <th className="px-3 py-2.5">Invoice service</th>}
                    <th className="px-3 py-2.5">State</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={14} className="px-3 py-8 text-center text-mav-muted">Loading…</td></tr>}
                  {!loading && shown.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-mav-muted">Nothing here for {monthLabel}.</td></tr>}
                  {shown.map(r => (
                    <tr key={r.row_type + r.row_key} className="border-b border-mav-line/60 align-top">
                      <td className="px-3 py-2.5"><DateCell d={r.start_date || r.invoice_date} /></td>
                      <td className="px-3 py-2.5 max-w-[12rem] truncate font-medium" title={r.company_name || ''}>{r.company_name || '—'}</td>
                      {cols.on('project') && <td className="px-3 py-2.5 max-w-[16rem] truncate" title={r.project_name || ''}>{r.project_name || <span className="text-mav-muted">—</span>}</td>}
                      {cols.on('pc') && <td className="px-3 py-2.5 whitespace-nowrap">{r.pm_owner || <span className="text-mav-muted">—</span>}</td>}
                      {cols.on('am') && <td className="px-3 py-2.5 whitespace-nowrap">{r.sales_person || <span className="text-mav-muted">—</span>}</td>}
                      {cols.on('sheet') && <td className="px-3 py-2.5 text-right tabular-nums">{usd(r.sheet_usd)}</td>}
                      {cols.on('invoice') && <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                        {r.invoice_no ? <>{r.invoice_no}<div className="text-[11px] text-mav-muted">{fmtDay(r.invoice_date)}{r.invoice_status ? ` · ${r.invoice_status}` : ''}</div></> : <span className="text-mav-muted">—</span>}
                      </td>}
                      {cols.on('invusd') && <td className="px-3 py-2.5 text-right tabular-nums">
                        {usd(r.invoice_usd)}
                        {r.group_sheet_usd != null && r.sheet_usd != null && Math.abs(r.group_sheet_usd - r.sheet_usd) > 1 &&
                          <div className="text-[11px] text-mav-muted" title="This invoice also covers other sheet lines this month">shared · lines {usd(r.group_sheet_usd)}</div>}
                      </td>}
                      {cols.on('how') && <td className="px-3 py-2.5 whitespace-nowrap text-mav-muted">{r.matched_by || '—'}</td>}
                      {cols.on('dept') && <td className="px-3 py-2.5 whitespace-nowrap">{r.service_dept || '—'}</td>}
                      {cols.on('pid') && <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{r.project_id || <span className="text-mav-muted">—</span>}</td>}
                      {cols.on('status') && <td className="px-3 py-2.5 whitespace-nowrap">{r.delivery_status || '—'}</td>}
                      {cols.on('services') && <td className="px-3 py-2.5 max-w-[12rem] truncate" title={r.invoice_services || ''}>{r.invoice_services || '—'}</td>}
                      <td className="px-3 py-2.5">
                        <Badge s={r.state} />
                        {r.note && <div className="text-[11px] text-mav-muted mt-1 max-w-[16rem]">{r.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
