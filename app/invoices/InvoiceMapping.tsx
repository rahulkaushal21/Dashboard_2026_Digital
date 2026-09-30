'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Copy, Check } from 'lucide-react'
import KPICard from '@/components/KPICard'
import MultiSelect from '@/components/MultiSelect'
import DateCell from '@/components/DateCell'
import { fmtDay } from '@/components/CardDetail'
import { useUnit } from '@/components/BusinessUnitProvider'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
import { inUnit, unitOf } from '@/lib/business-unit'
import { getInvoiceMapping, refreshInvoiceData, type InvoiceMappingRow, type MappingState, getBookingMonths, type BookingMonth} from '@/lib/supabase'

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

const SEG_TITLE: Record<Seg, string> = {
  raise: 'Invoices to raise', check: 'Invoiced, not for the sheet amount', done: 'Invoiced',
  orphan: 'Invoices with no sheet row this month', all: 'Sheet vs invoices',
}

// What is still owed an invoice on this row: the sheet amount less its share of the invoice.
// An invoice with no sheet row counts the other way (negative) — raised, but not booked.
const gapOf = (r: InvoiceMappingRow) =>
  r.row_type === 'invoice' ? -(r.invoice_usd || 0) : (r.sheet_usd || 0) - invoicedShare(r)

// The detail that used to be columns, on hover instead.
const rowHover = (r: InvoiceMappingRow) => [
  r.pm_owner && `PC/SME: ${r.pm_owner}`,
  `Project ID: ${r.project_id || 'none in the sheet'}`,
  r.sheet_invoice_no && `Invoice no in sheet: ${r.sheet_invoice_no}`,
  r.matched_by && `Matched on: ${r.matched_by}`,
  r.invoice_services && `Invoice service: ${r.invoice_services}`,
  r.service_dept && `Department: ${r.service_dept}`,
  r.delivery_status && `Delivery: ${r.delivery_status}`,
  r.note && `Note: ${r.note}`,
].filter(Boolean).join('\n')

export default function InvoiceMapping() {
  const { unit } = useUnit()
  const months = useMemo(() => monthsBack(12), [])
  const [month, setMonth] = useState(months[0].v)
  const [rows, setRows] = useState<InvoiceMappingRow[] | null>(null)
  const [appBooked, setAppBooked] = useState<BookingMonth[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [step, setStep] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const [seg, setSeg] = useState<Seg>('raise')
  const [search, setSearch] = useState('')
  const [fAm, setFAm] = useState<string[]>([])
  const [fPc, setFPc] = useState<string[]>([])
  const [copied, setCopied] = useState('')

  const load = useCallback(async (m: string) => {
    setRows(null); setError('')
    const r = await getInvoiceMapping(m)
    if (r.error) setError(r.error)
    setRows(r.rows)
    setUpdatedAt(new Date())
  }, [])
  useEffect(() => { load(month) }, [month, load])
  // The invoice app's own booking figure. Fetched once and kept: it is small, and it is
  // the number people compare this page against.
  useEffect(() => { getBookingMonths().then(setAppBooked).catch(() => {}) }, [])

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

  const amOptions = uniq(inDept.flatMap(r => splitNames(r.sales_person)))

  const monthLabel = months.find(m => m.v === month)?.label || month
  const bookedThisMonth = useMemo(
    () => appBooked.find(b => (b.booking_month || '').slice(0, 7) === month),
    [appBooked, month])
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
  // A drill-down has to add up to the card it opens from. It did not: every card's
  // breakdown totalled the SHEET amount, so "Invoiced against it — $182,817" opened on
  // $176,857, the sheet value of the same rows. Two different measures under one heading
  // is exactly the kind of thing that costs confidence in the whole page, so each card
  // now says which amount it is counting and totals THAT.
  //   measure 'sheet'    — booked in the sheet
  //   measure 'invoiced' — the invoice's share of this row (the card's own figure)
  //   measure 'gap'      — sheet less invoiced: what is still to raise
  const AMOUNT: Record<'sheet' | 'invoiced' | 'gap', { label: string; of: (r: InvoiceMappingRow) => number }> = {
    sheet:    { label: 'Sheet $',    of: r => r.sheet_usd || r.invoice_usd || 0 },
    invoiced: { label: 'Invoiced $', of: invoicedShare },
    gap:      { label: 'Still to raise', of: gapOf },
  }
  const rowDetails = (list: InvoiceMappingRow[], sub: string, measure: 'sheet' | 'invoiced' | 'gap' = 'sheet') => {
    const a = AMOUNT[measure]
    const sum = (rs: InvoiceMappingRow[]) => rs.reduce((s, r) => s + a.of(r), 0)
    return {
      subtitle: sub, rows: list, rowKey: (r: InvoiceMappingRow) => r.row_key,
      groupBy: (r: InvoiceMappingRow) => splitNames(r.sales_person)[0] || 'No AM',
      groupTotal: (rs: InvoiceMappingRow[]) => usd(sum(rs)),
      columns: [
        { key: 'd', label: 'Date', value: (r: InvoiceMappingRow) => fmtDay(r.start_date || r.invoice_date), sort: (r: InvoiceMappingRow) => r.start_date || r.invoice_date || '' },
        { key: 'c', label: 'Client', value: (r: InvoiceMappingRow) => r.company_name || '—', wide: true },
        { key: 'p', label: 'Project', value: (r: InvoiceMappingRow) => r.project_name || r.invoice_no || '—', wide: true },
        // The sheet amount stays visible on every breakdown — it is the number people
        // recognise — but it is only the TOTAL where the card is about the sheet.
        ...(measure === 'sheet' ? [] : [{ key: 's', label: 'Sheet $', align: 'right' as const,
          value: (r: InvoiceMappingRow) => usd(r.sheet_usd), sort: (r: InvoiceMappingRow) => r.sheet_usd || 0 }]),
        { key: 'a', label: a.label, align: 'right' as const, value: (r: InvoiceMappingRow) => usd(a.of(r)),
          sort: (r: InvoiceMappingRow) => a.of(r), total: (rs: InvoiceMappingRow[]) => usd(sum(rs)) },
        { key: 'i', label: 'Invoice', value: (r: InvoiceMappingRow) => r.invoice_no || '—' },
      ],
    }
  }

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
          {step || (updatedAt ? `Shown as of ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · the sync also runs every 15 minutes` : '')}
        </span>
      </div>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {unplaced > 0 && <p className="text-[11px] text-mav-muted -mt-2 mb-3">{unplaced} row{unplaced === 1 ? '' : 's'} with no department are shown under All.</p>}

      <KPIRow cols={4}>
        <KPICard tone="accent" label={`Sheet · ${monthLabel}`} value={loading ? '…' : usd(sheetUsd)}
          sub={`${sheet.length} sheet rows`}
          info="Every line booked in the revenue sheet for this month (Month-Year), in this department. Cancelled, On Hold and Awaiting Information lines are left out — there is no invoice to raise against work that is stopped or not yet agreed."
          details={loading ? undefined : rowDetails(sheet, 'All sheet rows this month, by AM')} />
        <KPICard tone="green" label="Invoiced against it" value={loading ? '…' : usd(invoicedUsd)}
          sub={`${done.length + check.length} rows have an invoice · ${monthInvoiced.size} invoices`}
          info="The invoiced value of the sheet rows above. Where one invoice covers several sheet lines it is shared between them in proportion, so nothing is counted twice."
          details={loading ? undefined : rowDetails([...done, ...check], 'Sheet rows with an invoice — the invoice\u2019s share of each', 'invoiced')} />
        <KPICard tone="red" label="Difference" value={loading ? '…' : usd(sheetUsd - invoicedUsd)}
          sub={`${usd(raiseUsd)} not raised · ${usd(checkGap)} part/different`}
          info="Sheet total minus what has been invoiced against it: the invoices still to raise, plus the shortfall on part-invoiced lines."
          details={loading ? undefined : rowDetails([...toRaise, ...check], 'Rows behind the difference \u2014 sheet less what was invoiced', 'gap')} />
        <KPICard tone="yellow" label="To raise" value={loading ? '…' : String(toRaise.length)}
          sub={`${usd(raiseUsd)} across ${byAm.length} AM${byAm.length === 1 ? '' : 's'}`}
          info="Sheet rows with no invoice found by invoice number, project ID, or client and value. Take these to the AM."
          details={loading ? undefined : rowDetails(toRaise, 'Invoices to raise, by AM')} />
      </KPIRow>

      {/* Two different questions were being read as one number. Said here so nobody has
          to reconcile them by hand again. */}
      {bookedThisMonth && (
        <p className="text-[11px] text-mav-muted/80 -mt-2 mb-4 max-w-3xl">
          The invoice app booked <strong className="text-mav-fg">{usd(bookedThisMonth.booked_usd)}</strong> in {monthLabel}.
          That answers a different question from the cards above: it counts invoices <em>booked</em> in the
          month, whichever month&rsquo;s work they bill, while &ldquo;Invoiced against it&rdquo; counts what was
          invoiced against {monthLabel}&rsquo;s <em>sheet rows</em>, whenever the invoice was raised.
          {bookedThisMonth.adjustments_usd
            ? <> Includes {usd(bookedThisMonth.adjustments_usd)} of recorded amendments.</>
            : null}
        </p>
      )}

      <Segments<Seg> value={seg} onChange={setSeg} items={[
        { id: 'raise', label: 'To raise', count: toRaise.length, title: 'Booked in the sheet, no invoice found' },
        { id: 'check', label: 'Part / value differs', count: check.length, title: 'Invoiced, but not for the sheet amount' },
        { id: 'done', label: 'Invoiced', count: done.length },
        { id: 'orphan', label: 'Invoice, no sheet row', count: orphans.length, title: `Invoices dated ${monthLabel} that no sheet row this month maps to — ${usd(orphanUsd)}` },
        { id: 'all', label: 'All', count: inDept.length },
      ]} />

      <FilterBar right={<>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{shown.length} shown</span>
        {seg === 'raise' && shown.length > 0 &&
          <button onClick={() => copyFor(fAm.length === 1 ? fAm[0] : '', shown)} className={secondary}
            title="Copies the rows shown (client, project, amount, project ID, PC) ready to paste to the AM">
            {copied === (fAm.length === 1 ? fAm[0] : '') ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy list for AM</>}
          </button>}
        {(search || fAm.length > 0 || fPc.length > 0) &&
          <button onClick={() => { setSearch(''); setFAm([]); setFPc([]) }} className={secondary}>Clear all</button>}
      </>}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, project, invoice…" className={`${selCls} w-60`} />
        <MultiSelect label={seg === 'raise' && byAm.length ? `AM (${byAm.length})` : 'AM'} className="w-44" options={amOptions} selected={fAm} onChange={setFAm} />
        <MultiSelect label="PC/SME" className="w-40" options={uniq(inDept.flatMap(r => splitNames(r.pm_owner)))} selected={fPc} onChange={setFPc} />
      </FilterBar>

      {/* One table, no sideways scroll: the sheet's side on the left, the invoice app's on the
          right, and the gap between them. Everything else (PC, project ID, how it matched,
          the note) is one hover away on the row, not another column. */}
      <Panel flush title={<>{SEG_TITLE[seg]} · {monthLabel}</>}
        info={seg === 'orphan'
          ? 'Invoices dated this month that no sheet row of this month maps to — usually work booked in another month, or a line the sheet is missing (the Reconciliation tab follows those up).'
          : 'Each sheet row is matched to an invoice by the invoice number in the sheet, then the project ID (for monthly retainers, the instalment within a month of the booking), then client and value within 2%. Values are checked per invoice, so an invoice covering several lines is compared with their sum. Hover a row for its PC, project ID and how it matched.'}>
        {/* Phones only: a desk-width screen fits it whole. */}
        <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-sm max-md:min-w-[900px]">
          <colgroup>
            <col className="w-[124px]" /><col /><col className="w-[130px]" /><col className="w-[96px]" />
            <col className="w-[132px]" /><col className="w-[96px]" />
            <col className="w-[90px]" /><col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="text-[10px]">
              <th colSpan={4} className="!py-1.5 text-mav-muted">Central sheet</th>
              <th colSpan={2} className="!py-1.5 border-l border-mav-line bg-sky-500/[0.06] text-sky-400">Invoice app</th>
              <th colSpan={2} className="!py-1.5 border-l border-mav-line text-mav-muted">Match</th>
            </tr>
            <tr className="text-left">
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Client · project</th>
              <th className="px-3 py-2.5">AM</th>
              <th className="px-3 py-2.5 text-right">Sheet $</th>
              <th className="px-3 py-2.5 border-l border-mav-line bg-sky-500/[0.06]">Invoice</th>
              <th className="px-3 py-2.5 text-right bg-sky-500/[0.06]">Invoice $</th>
              <th className="px-3 py-2.5 border-l border-mav-line text-right">Gap</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-mav-muted">Loading…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-mav-muted">Nothing here for {monthLabel}.</td></tr>}
            {shown.map(r => {
              const g = gapOf(r)
              return (
                <tr key={r.row_type + r.row_key} className="border-b border-mav-line/60 hover:bg-mav-fg/[0.03]" title={rowHover(r)}>
                  <td className="px-3 py-2 whitespace-nowrap"><DateCell d={r.start_date || r.invoice_date} /></td>
                  <td className="px-3 py-2 min-w-0">
                    <div className="truncate font-medium">{r.company_name || '—'}</div>
                    <div className="truncate text-xs text-mav-muted">{r.project_name || (r.row_type === 'invoice' ? 'No sheet row this month' : '—')}</div>
                  </td>
                  <td className="px-3 py-2 truncate">{r.sales_person || <span className="text-mav-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.row_type === 'sheet' ? usd(r.sheet_usd) : <span className="text-mav-muted">—</span>}</td>
                  <td className="px-3 py-2 border-l border-mav-line bg-sky-500/[0.04] whitespace-nowrap">
                    {r.invoice_no ? <>
                      <div className="truncate tabular-nums">{r.invoice_no}</div>
                      <div className="text-[11px] text-mav-muted">{fmtDay(r.invoice_date)}</div>
                    </> : <span className="text-mav-muted">Not raised</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-sky-500/[0.04]">
                    {r.invoice_no ? usd(r.invoice_usd) : <span className="text-mav-muted">—</span>}
                    {r.group_sheet_usd != null && r.sheet_usd != null && Math.abs(r.group_sheet_usd - r.sheet_usd) > 1 &&
                      <div className="text-[11px] text-mav-muted" title={`This invoice covers ${usd(r.group_sheet_usd)} of sheet lines this month`}>shared</div>}
                  </td>
                  <td className={`px-3 py-2 border-l border-mav-line text-right tabular-nums font-semibold ${g > 1 ? 'text-red-400' : g < -1 ? 'text-sky-400' : 'text-mav-muted font-normal'}`}>
                    {Math.abs(g) <= 1 ? '—' : `${g < 0 ? '+' : ''}${usd(Math.abs(g))}`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5"><Badge s={r.state} />{r.note && <span className="text-mav-yellow text-xs" aria-label={r.note}>•</span>}</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {!loading && shown.length > 1 && (
            <tfoot>
              <tr className="font-semibold">
                <td className="px-3 py-2.5 text-mav-muted text-xs uppercase tracking-wide" colSpan={2}>Total · {shown.length} rows</td>
                <td />
                <td className="px-3 py-2.5 text-right tabular-nums">{usd(shown.reduce((s, r) => s + (r.row_type === 'sheet' ? r.sheet_usd || 0 : 0), 0))}</td>
                <td className="px-3 py-2.5 border-l border-mav-line bg-sky-500/[0.06] text-xs text-mav-muted">invoiced</td>
                <td className="px-3 py-2.5 text-right tabular-nums bg-sky-500/[0.06]">{usd(shown.reduce((s, r) => s + (r.row_type === 'sheet' ? invoicedShare(r) : r.invoice_usd || 0), 0))}</td>
                <td className="px-3 py-2.5 border-l border-mav-line text-right tabular-nums text-red-400">{usd(Math.max(0, shown.reduce((s, r) => s + gapOf(r), 0)))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </Panel>
    </div>
  )
}
