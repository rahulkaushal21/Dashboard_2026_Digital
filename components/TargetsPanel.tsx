'use client'
import { useEffect, useMemo, useState } from 'react'
import { getBookingTargets, saveBookingTarget, TARGET_DEPTS, type BookingTarget, type TargetDept } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'
import { Panel } from './PageParts'

// Monthly booking targets — the H column of the old Business Overview sheet.
//
// The sheet had a cell beside each service where a lead typed the month's booking target
// and KB tracked the month against it. The dashboard replaced the sheet and had nowhere
// to type that number. This is the cell, one per service per month, with a total that
// adds itself up and a note of who set it and when.
//
// Admins only, like currency rates: a target is what the business is measured against.
// Everyone else sees the figures; Business Numbers reads them for the month on screen.

const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MON[+m - 1]} ${y}` }
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const fmtDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
// "30,000" in the box, 30000 in the database. Commas and a leading $ are forgiven on the
// way in, because that is how the sheet showed them.
const parse = (v: string): number | null => {
  const s = v.replace(/[$,\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function TargetsPanel({ canEdit, actor }: { canEdit: boolean; actor: string }) {
  const [month, setMonth] = useState(thisMonth())
  const [rows, setRows] = useState<BookingTarget[]>([])
  const [prev, setPrev] = useState<BookingTarget[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const first = `${month}-01`
  const prevFirst = `${shiftMonth(month, -1)}-01`

  const refresh = () => Promise.all([getBookingTargets(first, first), getBookingTargets(prevFirst, prevFirst)])
    .then(([r, p]) => {
      setRows(r); setPrev(p)
      setDraft(Object.fromEntries(r.map(x => [x.dept, String(x.target_usd)])))
    })
    .catch(() => { setRows([]); setPrev([]) })
  useEffect(() => { refresh() }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDept = useMemo(() => new Map(rows.map(r => [r.dept, r])), [rows])
  const total = useMemo(() => TARGET_DEPTS.reduce((n, d) => n + (parse(draft[d] ?? '') ?? byDept.get(d)?.target_usd ?? 0), 0), [draft, byDept])
  const savedTotal = useMemo(() => rows.reduce((n, r) => n + r.target_usd, 0), [rows])
  const changed = (d: TargetDept) => {
    const v = parse(draft[d] ?? '')
    const was = byDept.get(d)?.target_usd
    return v !== null && v !== (was ?? null)
  }
  const dirty = TARGET_DEPTS.filter(changed)

  const saveAll = async () => {
    if (dirty.length === 0) return
    setBusy(true); setStatus('')
    const errs: string[] = []
    for (const d of dirty) {
      const res = await saveBookingTarget(first, d, parse(draft[d])!, actor)
      if (res.error) errs.push(`${d}: ${res.error}`)
    }
    setBusy(false)
    setStatus(errs.length ? errs.join(' · ') : `${monLabel(month)} saved — ${dirty.length} ${dirty.length === 1 ? 'target' : 'targets'}.`)
    refresh()
  }

  // Last month's figures, typed into the boxes but not saved until Save is pressed.
  const copyPrev = () => {
    if (prev.length === 0) { setStatus(`Nothing set for ${monLabel(shiftMonth(month, -1))}.`); return }
    setDraft(Object.fromEntries(prev.map(x => [x.dept, String(x.target_usd)])))
    setStatus(`Copied from ${monLabel(shiftMonth(month, -1))} — press Save to keep it.`)
  }

  const inp = 'bg-mav-dark border border-mav-line rounded-md px-3 py-2 text-sm text-mav-fg placeholder:text-mav-fg/35 outline-none focus:border-mav-yellow text-right tabular-nums'
  const btn = 'rounded-full border border-mav-line px-3 py-1.5 text-xs text-mav-fg hover:border-mav-yellow disabled:opacity-50'

  return (
    <Panel title="Monthly booking targets"
      info="What each service is aiming to book in the month, in USD — the figure the old Business Overview sheet carried in its H column. Business Numbers shows the month's revenue against it, by service and in total."
      right={
        <span className="text-xs">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">Admins only</span>
          <span className="text-mav-muted ml-2">{canEdit ? 'You can change these.' : 'You can see these but not change them.'}</span>
        </span>
      }>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} className={btn} aria-label="Previous month">‹</button>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
          className="bg-mav-dark border border-mav-line rounded-md px-2 py-1.5 text-sm text-mav-fg [color-scheme:dark]" aria-label="Month" />
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} className={btn} aria-label="Next month">›</button>
        {canEdit && <button onClick={copyPrev} disabled={busy} className={`${btn} ml-2`}>Copy from {monLabel(shiftMonth(month, -1))}</button>}
      </div>

      <div className="border border-mav-line rounded-lg overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-4 py-2 font-medium">Service</th>
              <th className="px-4 py-2 font-medium text-right">Target for {monLabel(month)}</th>
              <th className="px-4 py-2 font-medium text-right">{monLabel(shiftMonth(month, -1))}</th>
              <th className="px-4 py-2 font-medium">Set by</th>
            </tr>
          </thead>
          <tbody>
            {TARGET_DEPTS.map(d => {
              const r = byDept.get(d)
              const p = prev.find(x => x.dept === d)
              return (
                <tr key={d} className="border-b border-mav-line/60">
                  <td className="px-4 py-3 font-medium">{d}</td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <input value={draft[d] ?? ''} onChange={e => setDraft({ ...draft, [d]: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && saveAll()} placeholder="not set" inputMode="numeric"
                        className={`${inp} w-36 ${changed(d) ? 'border-mav-yellow' : ''}`} aria-label={`${d} target`} />
                    ) : <span className={r ? 'tabular-nums' : 'text-mav-fg/35'}>{r ? fmtUsd(r.target_usd) : 'not set'}</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-mav-muted tabular-nums">{p ? fmtUsd(p.target_usd) : <span className="text-mav-fg/35">—</span>}</td>
                  <td className="px-4 py-3 text-[11px] text-mav-muted whitespace-nowrap">
                    {r?.updated_by ? <>{r.updated_by}{r.updated_at ? ` · ${fmtDate(r.updated_at)}` : ''}</> : <span className="text-mav-fg/35">—</span>}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-mav-dark/40">
              <td className="px-4 py-3 font-semibold">Total</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {fmtUsd(total)}
                {dirty.length > 0 && savedTotal !== total && <div className="text-[11px] text-mav-muted font-normal">saved: {fmtUsd(savedTotal)}</div>}
              </td>
              <td className="px-4 py-3 text-right text-mav-muted tabular-nums">{prev.length ? fmtUsd(prev.reduce((n, r) => n + r.target_usd, 0)) : '—'}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={saveAll} disabled={busy || dirty.length === 0}
            className="rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm disabled:opacity-60">
            {busy ? 'Saving…' : dirty.length ? `Save ${dirty.length === 1 ? dirty[0] : `${dirty.length} targets`}` : 'Nothing to save'}
          </button>
          {status && <span className="text-sm text-mav-muted">{status}</span>}
        </div>
      )}
      {!canEdit && status && <p className="text-sm text-mav-muted">{status}</p>}
      <p className="text-xs text-mav-muted mt-3">
        A service left blank has no target for the month and Business Numbers says so. A target of 0 is a target of 0.
      </p>
    </Panel>
  )
}
