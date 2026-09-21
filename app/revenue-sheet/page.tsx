'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getBookingsFull, duplicateBookingToMonth, type BookingRow } from '@/lib/supabase'
import { getStoredProfile } from '@/lib/access'

// The revenue sheet, whole, in the dashboard.
//
// Every booked line — WEB-US/AU/UK, HUB, LP and AI & Automation — with the sheet's own
// columns and its own vocabulary. Nothing is reinterpreted here: GEO reads US/Canada
// rather than US, the department reads WEB-US rather than Web, because the point of this
// page is to be the sheet, not a view of it. The analysis lives on Revenue History.
//
// DUPLICATING DOES NOT WRITE BACK TO THE SHEET. web_revenue is full-replaced on every
// sync, so anything inserted there would disappear within half an hour and nobody would
// know why. A duplicate becomes a confirmed entry in our own record and shows up on the
// Project sheet, which is the direction of travel anyway: from 1 Oct the sheet becomes a
// dump of this rather than the source of it.

const money = (n?: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const ym = (s?: string) => (s || '').slice(0, 7)
const uniq = (xs: (string | undefined)[]) => Array.from(new Set(xs.map(x => (x || '').trim()).filter(Boolean))).sort()

const PAGE = 100

export default function RevenueSheet() {
  const [rows, setRows] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const [search, setSearch] = useState('')
  const [fDept, setFDept] = useState('')
  const [fModel, setFModel] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [fPm, setFPm] = useState('')
  const [fAm, setFAm] = useState('')
  const [fTech, setFTech] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [page, setPage] = useState(0)

  const [target, setTarget] = useState(() => monthKey(new Date()))
  const [busy, setBusy] = useState<number | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setIsAdmin(!!getStoredProfile()?.is_admin)
    getBookingsFull().then(setRows).finally(() => setLoading(false))
  }, [])

  const opts = useMemo(() => ({
    dept: uniq(rows.map(r => r.service_name)),
    model: uniq(rows.map(r => r.engagement_model)),
    geo: uniq(rows.map(r => r.geo)),
    pm: uniq(rows.map(r => r.sme)),
    am: uniq(rows.map(r => r.sales_person)),
    tech: uniq(rows.map(r => r.technology)),
  }), [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter(r => !q || (r.company_name || '').toLowerCase().includes(q) || (r.contact_email || '').toLowerCase().includes(q))
      .filter(r => !fDept || r.service_name === fDept)
      .filter(r => !fModel || r.engagement_model === fModel)
      .filter(r => !fGeo || r.geo === fGeo)
      .filter(r => !fPm || r.sme === fPm)
      .filter(r => !fAm || r.sales_person === fAm)
      .filter(r => !fTech || r.technology === fTech)
      .filter(r => !fFrom || ym(r.booking_month) >= fFrom)
      .filter(r => !fTo || ym(r.booking_month) <= fTo)
      .sort((a, b) => (b.booking_month || '').localeCompare(a.booking_month || ''))
  }, [rows, search, fDept, fModel, fGeo, fPm, fAm, fTech, fFrom, fTo])

  useEffect(() => { setPage(0) }, [search, fDept, fModel, fGeo, fPm, fAm, fTech, fFrom, fTo])

  const total = shown.reduce((s, r) => s + (r.booking_amount || 0), 0)
  const clients = new Set(shown.map(r => (r.company_name || '').toLowerCase())).size
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(shown.length / PAGE)

  const clearAll = () => { setSearch(''); setFDept(''); setFModel(''); setFGeo(''); setFPm(''); setFAm(''); setFTech(''); setFFrom(''); setFTo('') }
  const anyFilter = search || fDept || fModel || fGeo || fPm || fAm || fTech || fFrom || fTo

  const dup = async (r: BookingRow) => {
    if (!r.id) return
    setBusy(r.id); setStatus('')
    const res = await duplicateBookingToMonth(r.id, target)
    setBusy(null)
    setStatus(res.error ? `${r.company_name}: ${res.error}` : `${r.company_name} copied into ${new Date(target + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`)
  }

  const months = useMemo(() => {
    const out: string[] = []
    const d = new Date()
    for (let i = 0; i < 4; i++) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)))
    return out
  }, [])

  const sel = 'bg-mav-panel border border-mav-line rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
  const th = 'px-3 py-2 font-medium whitespace-nowrap'
  const td = 'px-3 py-2 whitespace-nowrap'

  return (
    <div>
      <Header title="Revenue sheet" subtitle="Every booked line — Web, HUB and LP — in the sheet's own columns. Copy any line into a month in one click." />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client or contact…" className={`${sel} w-56`} />
        <select value={fDept} onChange={e => setFDept(e.target.value)} className={sel}><option value="">All depts</option>{opts.dept.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fModel} onChange={e => setFModel(e.target.value)} className={sel}><option value="">All models</option>{opts.model.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={sel}><option value="">All GEOs</option>{opts.geo.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fPm} onChange={e => setFPm(e.target.value)} className={sel}><option value="">All PMs</option>{opts.pm.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fAm} onChange={e => setFAm(e.target.value)} className={sel}><option value="">All AMs</option>{opts.am.map(x => <option key={x}>{x}</option>)}</select>
        <select value={fTech} onChange={e => setFTech(e.target.value)} className={sel}><option value="">All tech</option>{opts.tech.map(x => <option key={x}>{x}</option>)}</select>
        <input type="month" value={fFrom} onChange={e => setFFrom(e.target.value)} className={sel} title="From month" />
        <input type="month" value={fTo} onChange={e => setFTo(e.target.value)} className={sel} title="To month" />
        {anyFilter && <button onClick={clearAll} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">Clear</button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-mav-muted">
          {loading ? 'Loading…' : <>{shown.length.toLocaleString()} line{shown.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'} · <span className="text-white">{money(total)}</span></>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-mav-muted text-xs">Copy into</span>
          <select value={target} onChange={e => setTarget(e.target.value)} className={sel}>
            {months.map(m => <option key={m} value={m}>{new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>)}
          </select>
        </div>
      </div>

      {status && <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${/:/.test(status) && !/copied/.test(status) ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-green-500/40 bg-green-500/10 text-green-300'}`}>{status}</div>}

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className={th}>Month</th><th className={th}>Company</th><th className={th}>Contact</th>
              <th className={th}>Dept</th><th className={th}>Engagement</th><th className={th}>Technology</th>
              <th className={th}>GEO</th><th className={th}>PM</th><th className={th}>AM</th>
              <th className={`${th} text-right`}>Amount</th><th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.id} className="border-b border-mav-line/60">
                <td className={td}>{ym(r.booking_month)}</td>
                <td className={td}>{r.company_name || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.contact_email || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.service_name || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.engagement_model || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.technology || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.geo || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.sme || '—'}</td>
                <td className={`${td} text-mav-muted`}>{r.sales_person || '—'}</td>
                <td className={`${td} text-right`}>{money(r.booking_amount)}</td>
                <td className={`${td} text-right`}>
                  <button onClick={() => dup(r)} disabled={busy === r.id}
                    className="text-xs px-2.5 py-1 rounded-md border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/15 disabled:opacity-40 transition-colors">
                    {busy === r.id ? '…' : 'Duplicate'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-mav-muted">Nothing matches those filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-mav-muted text-xs">Page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white disabled:opacity-30 transition-colors">Previous</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white disabled:opacity-30 transition-colors">Next</button>
          </div>
        </div>
      )}

      <p className="text-xs text-mav-muted mt-4 max-w-3xl">
        Duplicating copies a line into the month chosen above as a confirmed entry, where it appears on the Project sheet.
        It does not write back to the Google Sheet — that feed is replaced wholesale on every sync, so anything added there
        would disappear within the half hour. You can only duplicate a client whose PM is you{isAdmin ? ', and as an admin, anyone else' : ''}.
      </p>
    </div>
  )
}
