'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import {
  getRecurringMonth, addRecurringMonth, getProjectSheet,
  type RecurringMonthRow, type ProjectSheetRow,
} from '@/lib/supabase'
import { getStoredProfile } from '@/lib/access'

// The Project sheet — the month's bookings, in the revenue sheet's own shape.
//
// Same columns, same order, so while both exist the two can be read side by side and
// compared line for line. From 1 Oct the sheet becomes a dump of this rather than the
// other way round.
//
// The half that saves the most work is the retainer list underneath. Nineteen dedicated
// clients bill the same thing every month; each is one click, carrying last month's
// figure forward and letting you change it before it goes in. It is never automatic —
// one dedicated client in this data billed steadily for nine months and then stopped, and
// a system that books retainers by itself would have invented nine months of revenue
// that looked exactly like the real thing.

const money = (n?: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default function ProjectSheet() {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [rows, setRows] = useState<ProjectSheetRow[]>([])
  const [recurring, setRecurring] = useState<RecurringMonthRow[]>([])
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const load = () => Promise.all([getProjectSheet(month), getRecurringMonth()])
    .then(([r, rec]) => {
      setRows(r); setRecurring(rec)
      setAmounts(Object.fromEntries(rec.map(x => [x.recurring_id, String(x.suggested_amount ?? x.monthly_value ?? '')])))
    })
    .finally(() => setLoading(false))

  useEffect(() => { setIsAdmin(!!getStoredProfile()?.is_admin) }, [])
  useEffect(() => { setLoading(true); load() }, [month])

  const isThisMonth = month === monthKey(new Date())
  const pending = useMemo(() => recurring.filter(r => r.active && r.state !== 'confirmed'), [recurring])
  const done = useMemo(() => recurring.filter(r => r.state === 'confirmed'), [recurring])
  const paused = useMemo(() => recurring.filter(r => !r.active), [recurring])
  const total = rows.reduce((s, r) => s + (r.est_value || 0), 0)
  const pendingTotal = pending.reduce((s, r) => s + Number(amounts[r.recurring_id] || r.suggested_amount || 0), 0)

  const addOne = async (r: RecurringMonthRow) => {
    setBusy(r.recurring_id); setStatus('')
    const amt = Number(amounts[r.recurring_id])
    const res = await addRecurringMonth(r.recurring_id, `${month}-01`, Number.isFinite(amt) ? amt : null)
    setBusy(null)
    if (res.error) { setStatus(`${r.company_name}: ${res.error}`); return }
    setStatus(`${r.company_name} added.`)
    load()
  }

  const months = useMemo(() => {
    const out: string[] = []
    const d = new Date()
    for (let i = 0; i < 6; i++) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)))
    return out
  }, [])

  const th = 'px-3 py-2 font-medium whitespace-nowrap'
  const td = 'px-3 py-2.5 whitespace-nowrap'

  return (
    <div>
      <Header title="Project sheet" subtitle="The month's bookings, in the revenue sheet's own columns — plus one-click entry for every retainer." />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="bg-mav-panel border border-mav-line rounded-md px-3 py-1.5 text-sm outline-none focus:border-mav-yellow">
          {months.map(m => <option key={m} value={m}>{new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>)}
        </select>
        <span className="text-sm text-mav-muted">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · <span className="text-white">{money(total)}</span></span>
        {status && <span className="text-xs text-mav-muted ml-2">{status}</span>}
      </div>

      {/* ── Retainers still to add ──────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="mb-8">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 className="text-base font-semibold">Retainers not yet in this month <span className="text-mav-muted font-normal text-sm">· {pending.length} · {money(pendingTotal)}</span></h2>
            {!isThisMonth && <span className="text-xs text-amber-300">You are looking at {new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} — adding here books into that month.</span>}
          </div>
          <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className={th}>Company</th><th className={th}>Dept</th><th className={th}>Engagement</th>
                  <th className={th}>GEO</th><th className={th}>PM</th>
                  <th className={th}>Amount</th><th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(r => (
                  <tr key={r.recurring_id} className="border-b border-mav-line/60">
                    <td className={td}>{r.company_name}</td>
                    <td className={`${td} text-mav-muted`}>{r.service_dept || '—'}</td>
                    <td className={`${td} text-mav-muted`}>{r.engagement_model || '—'}</td>
                    <td className={`${td} text-mav-muted`}>{r.geo || '—'}</td>
                    <td className={`${td} text-mav-muted`}>
                      {r.pm_owner || '—'}
                      {/* A retainer whose PM is not in the directory can only be added by
                          an admin, and finding that out at the moment of clicking is worse
                          than being told now. */}
                      {r.pm_owner && !r.owner_email && <span className="ml-2 text-xs text-amber-300" title="This PM is not in the directory, so only an admin can add this">⚠</span>}
                    </td>
                    <td className={td}>
                      <input value={amounts[r.recurring_id] ?? ''} onChange={e => setAmounts({ ...amounts, [r.recurring_id]: e.target.value })}
                        className="bg-mav-dark border border-mav-line rounded-md px-2 py-1 text-sm w-28 outline-none focus:border-mav-yellow" />
                    </td>
                    <td className={`${td} text-right`}>
                      <button onClick={() => addOne(r)} disabled={busy === r.recurring_id}
                        className="text-xs px-3 py-1.5 rounded-md bg-green-500 text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
                        {busy === r.recurring_id ? 'Adding…' : 'Add to month'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {done.length > 0 && <p className="text-xs text-mav-muted mt-2">{done.length} retainer{done.length === 1 ? '' : 's'} already added this month.</p>}
        </div>
      )}

      {pending.length === 0 && recurring.length > 0 && (
        <div className="mb-8 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-300">
          Every active retainer is in this month.
        </div>
      )}

      {/* ── The sheet itself ────────────────────────────────────────────────── */}
      <h2 className="text-base font-semibold mb-2">This month&rsquo;s entries</h2>
      {loading ? <div className="text-sm text-mav-muted">Loading…</div> : rows.length === 0 ? (
        <div className="rounded-xl border border-mav-line bg-mav-panel px-5 py-8 text-center text-sm text-mav-muted">
          Nothing booked in this month yet.
        </div>
      ) : (
        <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className={th}>Company</th><th className={th}>Project</th><th className={th}>Contact</th>
                <th className={th}>Dept</th><th className={th}>Engagement</th><th className={th}>Technology</th>
                <th className={th}>GEO</th><th className={th}>PM</th><th className={th}>AM</th>
                <th className={th}>Booked</th><th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-mav-line/60">
                  <td className={td}>{r.company_name || '—'}</td>
                  <td className={`${td} text-mav-muted max-w-[16rem] truncate`} title={r.source_subject || ''}>{r.source_subject || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.contact_email || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.service_dept || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.project_type || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.technology || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.geo || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.pm_owner || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.sales_person || '—'}</td>
                  <td className={`${td} text-mav-muted`}>{r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString() : '—'}</td>
                  <td className={`${td} text-right`}>
                    {money(r.est_value)}
                    {/* Both figures where they differ: the sheet records USD, and somebody
                        checking a line against the client's invoice needs the quoted one. */}
                    {r.currency && r.currency.toUpperCase() !== 'USD' && r.local_value != null && (
                      <div className="text-[11px] text-mav-muted">{Number(r.local_value).toLocaleString('en-US')} {r.currency}</div>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-mav-dark/40">
                <td className={`${td} font-medium`} colSpan={10}>Total</td>
                <td className={`${td} text-right font-medium`}>{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {paused.length > 0 && isAdmin && (
        <div className="mt-6 rounded-lg border border-mav-line bg-mav-panel px-4 py-3">
          <div className="text-sm font-medium mb-1">{paused.length} retainer{paused.length === 1 ? '' : 's'} paused</div>
          <div className="text-xs text-mav-muted">
            {paused.map(p => p.company_name).join(', ')} — three months of entries went unadded, so they stopped generating. Nothing is deleted; they can be resumed.
          </div>
        </div>
      )}
    </div>
  )
}
