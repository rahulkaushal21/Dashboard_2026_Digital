'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getProjectLedger, copyRowToMonth, type LedgerRow } from '@/lib/supabase'
import { getStoredProfile } from '@/lib/access'

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

const PAGE = 100

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
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [page, setPage] = useState(0)

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState(nextMonth)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const load = () => getProjectLedger().then(setRows).finally(() => setLoading(false))
  useEffect(() => { setIsAdmin(!!getStoredProfile()?.is_admin); load() }, [])

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
      .filter(r => !fFrom || ym(r.booking_month) >= fFrom)
      .filter(r => !fTo || ym(r.booking_month) <= fTo)
      .sort((a, b) => (b.booking_month || '').localeCompare(a.booking_month || '') || (a.company_name || '').localeCompare(b.company_name || ''))
  }, [rows, search, fDept, fModel, fGeo, fPm, fAm, fSource, fFrom, fTo])

  useEffect(() => { setPage(0) }, [search, fDept, fModel, fGeo, fPm, fAm, fSource, fFrom, fTo])

  const total = shown.reduce((s, r) => s + (r.amount_usd || 0), 0)
  const clients = new Set(shown.map(r => (r.company_name || '').toLowerCase())).size
  const notInSheet = shown.filter(r => !r.in_sheet)
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(shown.length / PAGE)

  const clearAll = () => { setSearch(''); setFDept(''); setFModel(''); setFGeo(''); setFPm(''); setFAm(''); setFSource(''); setFFrom(''); setFTo('') }
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
      const res = await copyRowToMonth(r.source, r.source_id, target, r.local_value ?? r.amount_usd)
      if (res.error) errs.push(`${r.company_name}: ${res.error}`)
      else ok++
    }
    setBusy(false)
    setPicked(new Set())
    setStatus(`${ok} moved into ${monLabel(target)}${errs.length ? `, ${errs.length} could not be.` : '.'}`)
    setErrors(errs)
    load()
  }

  const exportCsv = () => {
    const head = ['Month', 'Company', 'Project', 'Contact', 'Dept', 'Engagement', 'Technology', 'GEO', 'PM', 'AM', 'Amount USD', 'In sheet']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = shown.map(r => [ym(r.booking_month), r.company_name, r.project_name, r.contact_email, r.service_dept,
      r.engagement_model, r.technology, r.geo, r.pm_owner, r.sales_person, r.amount_usd, r.in_sheet ? 'yes' : 'no'].map(esc).join(','))
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
        <select value={fPm} onChange={e => setFPm(e.target.value)} className={sel}><option value="">All PMs</option>{opts.pm.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fAm} onChange={e => setFAm(e.target.value)} className={sel}><option value="">All AMs</option>{opts.am.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fSource} onChange={e => setFSource(e.target.value)} className={sel}>
          <option value="">Sheet + dashboard</option><option value="sheet">In the sheet</option><option value="dashboard">Confirmed here only</option>
        </select>
        <input type="month" value={fFrom} onChange={e => setFFrom(e.target.value)} className={sel} title="From month" />
        <input type="month" value={fTo} onChange={e => setFTo(e.target.value)} className={sel} title="To month" />
        {anyFilter && <button onClick={clearAll} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">Clear</button>}
        <button onClick={() => { setFModel('Dedicated'); setFFrom(monthKey(new Date())); setFTo(monthKey(new Date())) }}
          className="text-xs px-3 py-1.5 rounded-md border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/15 transition-colors">
          This month&rsquo;s Dedicated
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-mav-muted">
          {loading ? 'Loading…' : <>{shown.length.toLocaleString()} line{shown.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'} · <span className="text-white">{money(total)}</span>
            {notInSheet.length > 0 && <span className="ml-2 text-amber-300">· {notInSheet.length} not in the sheet yet</span>}</>}
        </div>
        <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">Export CSV</button>
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
          <button onClick={() => setPicked(new Set())} className="text-xs text-mav-muted hover:text-white">Clear selection</button>
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
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all filtered" /></th>
              <th className={th}>Month</th><th className={th}>Company</th><th className={th}>Project</th>
              <th className={th}>Dept</th><th className={th}>Engagement</th><th className={th}>Technology</th>
              <th className={th}>GEO</th><th className={th}>PM</th><th className={th}>AM</th>
              <th className={`${th} text-right`}>Amount</th><th className={th}>In sheet</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.row_key} className={`border-b border-mav-line/60 ${picked.has(r.row_key) ? 'bg-mav-yellow/5' : ''}`}>
                <td className="px-3 py-2"><input type="checkbox" checked={picked.has(r.row_key)} onChange={() => toggle(r.row_key)} aria-label={`Select ${r.company_name}`} /></td>
                <td className={td}>{ym(r.booking_month)}</td>
                <td className={td}>{r.company_name || '—'}</td>
                <td className={`${td} text-mav-muted max-w-[14rem] truncate`} title={r.project_name || ''}>{r.project_name || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.service_dept || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.engagement_model || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.technology || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.geo || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.pm_owner || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.sales_person || '—'}</td>
                <td className={`${td} text-right`}>
                  {money(r.amount_usd)}
                  {r.currency && r.currency !== 'USD' && r.local_value != null && (
                    <div className="text-[11px] text-mav-muted">{Number(r.local_value).toLocaleString('en-US')} {r.currency}</div>
                  )}
                </td>
                <td className={td}>
                  {r.in_sheet
                    ? <span className="text-xs text-mav-muted">yes</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/50 text-amber-300">pending</span>}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-mav-muted">Nothing matches those filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-mav-muted text-xs">Page {page + 1} of {pages} · ticking the header selects all {shown.length.toLocaleString()} filtered lines, not just this page</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white disabled:opacity-30 transition-colors">Previous</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white disabled:opacity-30 transition-colors">Next</button>
          </div>
        </div>
      )}

      <p className="text-xs text-mav-muted mt-4 max-w-3xl">
        <span className="text-amber-300">Pending</span> means confirmed here and not yet in the Google Sheet. Moving a line creates a
        confirmed entry in the chosen month; it does not write to the sheet, because that feed is replaced wholesale on every sync
        and anything added there would disappear within the half hour. Until the writer is built, Export CSV is the handover.
        You can move a client whose PM is you{isAdmin ? ', and as an admin, anyone else' : ''}.
      </p>
    </div>
  )
}
