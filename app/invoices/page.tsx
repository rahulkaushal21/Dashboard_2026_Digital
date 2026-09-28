'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import MultiSelect from '@/components/MultiSelect'
import { NotSplitNote } from '@/components/UnitToggle'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
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

type Tab = 'money' | 'recon'
type Who = 'all' | 'contractor' | 'inhouse'

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
  const [from, setFrom] = useState(FLOOR)
  const [to, setTo] = useState('')
  const [who, setWho] = useState<Who>('all')
  const reset = () => { setSearch(''); setFStatus([]); setFPc([]); setFrom(FLOOR); setTo(''); setWho('all') }

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
    .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase())
              || (x.project_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => keeps(fStatus, x.status))
    .filter(x => inRange(x.booking_month))
    .filter(keepsWho)
    .sort((a, b) => (b.ledger_usd || 0) - (a.ledger_usd || 0)),
    [status, search, fStatus, from, to, who])

  const tot = (rows: ProjectInvoiceStatus[], s: string) =>
    rows.filter(x => x.status === s).reduce((n, x) => n + (x.ledger_usd || 0), 0)
  const cnt = (rows: ProjectInvoiceStatus[], s: string) => rows.filter(x => x.status === s).length

  // ── reconciliation side: per invoice, from the app inwards ──────────────────
  const gap = useMemo(() => recon
    .filter(x => !x.in_sheet)
    .filter(x => (x.client || '').toLowerCase().includes(search.toLowerCase())
              || (x.project_names || '').toLowerCase().includes(search.toLowerCase())
              || x.invoice_no.toLowerCase().includes(search.toLowerCase()))
    .filter(x => keeps(fStatus, x.status))
    .filter(x => keeps(fPc, x.pc))
    .filter(x => inRange(x.invoice_date))
    .sort((a, b) => (b.our_usd || 0) - (a.our_usd || 0)),
    [recon, search, fStatus, fPc, from, to])

  const gapUsd = gap.reduce((n, x) => n + (x.our_usd || 0), 0)
  const gapInstal = gap.filter(x => x.is_instalment)
  const inScope = recon.filter(x => inRange(x.invoice_date))
  const inScopeUsd = inScope.reduce((n, x) => n + (x.our_usd || 0), 0)

  // Per month, both directions at once — this is the table that explains a variance.
  const byMonth = useMemo(() => {
    const m = new Map<string, { app: number; gap: number; n: number; gapN: number }>()
    for (const r of inScope) {
      const k = monthOf(r.invoice_date); if (!k) continue
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

  return (
    <div>
      <Header title="Invoices & Reconciliation"
        subtitle="What has been invoiced, what has been paid, and what the revenue sheet does not know about — from April 2026" />
      {/* The invoice app has no department column we can trust — scope is defined by
          Service, which is already applied server-side to our four Web services. */}
      <NotSplitNote what="Invoices" reason="are already scoped to the Web services" className="-mt-3 mb-4" />

      <Segments<Tab> value={tab} onChange={setTab} items={[
        { id: 'money', label: 'Money', count: money.length, title: 'Per project: invoiced, paid, overdue, never raised' },
        { id: 'recon', label: 'Reconciliation', count: gap.length, title: 'Invoices the revenue sheet does not have' },
      ]} />
      <FilterBar right={<>
          {/* Contractor spend is INR in the sheet and converted here, so 'Contractor'
              shows both what we billed and what the work cost us. */}
          <div className="inline-flex rounded-md border border-mav-line overflow-hidden">
            {([['all', 'All'], ['contractor', 'Contractor'], ['inhouse', 'In-house']] as [Who, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setWho(k)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  who === k ? 'bg-mav-fill text-black' : 'text-mav-muted hover:text-mav-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={reset} className="text-sm px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">Clear all</button>
        </>}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, project, invoice…" className={`${selCls} w-56`} />
        <MultiSelect label="All statuses"
          options={tab === 'money' ? uniq(status.map(x => x.status)) : uniq(recon.map(x => x.status))}
          selected={fStatus} onChange={setFStatus} className="w-44" />
        {tab === 'recon' && (
          <MultiSelect label="All PCs" options={uniq(recon.map(x => x.pc))} selected={fPc} onChange={setFPc} className="w-40" />
        )}
        <span className="text-xs text-mav-muted ml-1">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
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
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[1040px]">
              <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
                {['Status', 'Client', 'Project', 'Project id', 'By', 'Booked', 'Sheet USD', 'Cost', 'Invoiced', 'Paid', 'Due', 'Late'].map(h =>
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>{money.slice(0, 500).map(x => {
                const late = x.status === 'Overdue' ? daysLate(x.earliest_due_at?.slice(0, 10)) : null
                return (
                  <tr key={x.row_key} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-3"><Pill s={x.status} /></td>
                    <td className="px-4 py-3">{x.company_name || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted max-w-[220px] truncate" title={x.project_name || ''}>{x.project_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-mav-muted whitespace-nowrap">{x.project_key || x.project_id || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {x.is_contractor
                        ? <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-400"
                            title={x.contractor_name || x.expert || 'Contractor'}>Contractor</span>
                        : <span className="text-mav-muted text-xs">{x.expert || '—'}</span>}
                    </td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.booking_month || '').slice(0, 7) || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{usd(x.ledger_usd)}</td>
                    {/* Outsource spend. INR in the sheet, converted here; the rupee figure
                        is in the tooltip for anyone reconciling against the sheet itself. */}
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap"
                        title={x.outsource_local ? `${Math.round(x.outsource_local).toLocaleString()} ${x.outsource_currency || 'INR'}` : ''}>
                      {x.outsource_usd ? usd(x.outsource_usd) : '—'}
                    </td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.invoice_count ? usd(x.invoiced_usd) : '—'}</td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.paid_usd ? usd(x.paid_usd) : '—'}</td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.earliest_due_at?.slice(0, 10) || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{late ? <span className="text-red-400">{late}d</span> : '—'}</td>
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
            <KPICard label="Of which recurring" tone="amber"
              value={usd(gapInstal.reduce((n, x) => n + (x.our_usd || 0), 0))}
              sub={`${gapInstal.length} invoices`}
              info="The sheet books a dedicated or retainer engagement once, at contract. The invoice app raises one invoice per month against it. So each month the app holds revenue the sheet has never seen." />
            <KPICard label="Gap as % of invoiced"
              value={inScopeUsd ? `${(100 * gapUsd / inScopeUsd).toFixed(1)}%` : '—'} />
          </KPIRow>
          {/* Why the two systems disagree, stated once rather than left to be rediscovered. */}
          <p className="text-[11px] text-mav-muted/80 mb-4 max-w-3xl">
            The revenue sheet is not a superset of the invoice app. Roughly half of this gap is
            recurring engagements: the sheet books a dedicated contract <em>once</em>, the app raises
            one invoice per month against it, so each month the app holds revenue the sheet has never
            seen. The rest are invoices whose project id never reached the sheet.
          </p>

          <div className="grid lg:grid-cols-[320px_1fr] gap-4">
            <Panel title="By month" flush>
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
                  {['Month', 'App', 'Gap'].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
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
              </table>
            </Panel>

            <Panel title="Invoices the revenue sheet does not have" flush>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[900px]">
                <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
                  {['Invoice', 'Project id', 'Date', 'Client', 'Project', 'Service', 'USD', 'Status'].map(h =>
                    <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>{gap.slice(0, 500).map(x => (
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
                    <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">{x.project_id || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.invoice_date || '—'}</td>
                    <td className="px-4 py-3">{x.client || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted max-w-[200px] truncate" title={x.project_names || ''}>{x.project_names || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted max-w-[150px] truncate" title={x.services || ''}>{x.services || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{usd(x.our_usd)}</td>
                    <td className="px-4 py-3"><Pill s={x.status} /></td>
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
