'use client'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { getFxRates, saveFxRate, deleteFxRate, type FxRate } from '@/lib/supabase'

// Conversion rates to USD.
//
// est_value is USD everywhere in the dashboard — every total, forecast and scorecard
// adds it up without asking what currency the quote was raised in. So a rate here is not
// cosmetic: change one and every deal confirmed afterwards books at the new figure.
//
// Rates live in the database rather than in the code for the obvious reason that they
// move, and a rate nobody can change without a deploy is a rate that quietly goes stale.
// Deals already confirmed keep the figure they were booked at; nothing is restated.

// 21 Sep 2026 rather than a locale-shuffled 09/21/2026 — this sits beside an email
// address in small text, and a date whose day and month can be read either way round is
// worse than no date.
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function FxRatesPanel({ canEdit, actor }: { canEdit: boolean; actor: string }) {
  const [rows, setRows] = useState<FxRate[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [newCur, setNewCur] = useState('')
  const [newRate, setNewRate] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => getFxRates().then(r => {
    setRows(r)
    setDraft(Object.fromEntries(r.map(x => [x.currency, String(x.rate_to_usd)])))
  }).catch(() => setRows([]))
  useEffect(() => { refresh() }, [])

  const save = async (cur: string) => {
    const v = Number(draft[cur])
    if (!(v > 0)) { setStatus(`${cur}: a rate has to be greater than zero.`); return }
    setBusy(true); setStatus('')
    const res = await saveFxRate(cur, v, actor)
    setBusy(false)
    setStatus(res.error || `${cur} saved.`)
    if (!res.error) refresh()
  }

  const add = async () => {
    const v = Number(newRate)
    if (!newCur.trim() || !(v > 0)) { setStatus('Both a currency code and a rate above zero are needed.'); return }
    setBusy(true); setStatus('')
    const res = await saveFxRate(newCur, v, actor)
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setNewCur(''); setNewRate(''); setStatus('Added.'); refresh()
  }

  const drop = async (cur: string) => {
    if (cur.toUpperCase() === 'USD') { setStatus('USD is the base and cannot be removed.'); return }
    if (!window.confirm(`Remove ${cur}?\n\nDeals already confirmed keep the figure they booked at. New deals in ${cur} would convert at 1:1, which would overstate them — remove it only if nothing is quoted in ${cur} any more.`)) return
    setBusy(true); setStatus('')
    const res = await deleteFxRate(cur)
    setBusy(false)
    setStatus(res.error || 'Removed.')
    if (!res.error) refresh()
  }

  const inp = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow'

  return (
    <div>
      <h2 className="text-base font-semibold mb-1">Currency conversion</h2>
      <p className="text-sm text-mav-muted mb-4">
        How a quote in another currency becomes USD — the value is multiplied by the rate.
        Every figure in the dashboard is USD, so these decide what a non-USD deal books at.
        Changing a rate affects deals confirmed <span className="text-mav-fg">from now on</span>; anything
        already booked keeps the figure it was booked at.
      </p>
      {/* Unlike the contractor list, this stays admin-only: a rate is not local knowledge
          somebody fills in as they go, it silently reprices every non-USD deal confirmed
          after it changes. The database enforces the same rule. */}
      <p className="text-xs mb-4">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-mav-line text-mav-muted">
          Admins only
        </span>
        <span className="text-mav-muted ml-2">
          {canEdit ? 'You can change these.' : 'You can see these but not change them.'}
        </span>
      </p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-4 py-2 font-medium">Currency</th>
              <th className="px-4 py-2 font-medium">Rate to USD</th>
              <th className="px-4 py-2 font-medium">What it means</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const v = Number(draft[r.currency] ?? r.rate_to_usd)
              const changed = String(v) !== String(r.rate_to_usd)
              return (
                <tr key={r.currency} className="border-b border-mav-line/60">
                  {/* Who last touched this, under the name rather than in a column of
                      its own. A rate is a claim about money somebody made on a date, and
                      reading it three columns away from the figure it explains meant
                      nobody read it at all. */}
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">{r.currency}</div>
                    <div className="text-[11px] text-mav-muted mt-0.5">
                      {r.updated_by
                        ? <>{r.updated_by}{r.updated_at ? ` · ${fmtDate(r.updated_at)}` : ''}</>
                        : <span className="text-mav-fg/35">never changed here</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && r.currency.toUpperCase() !== 'USD' ? (
                      <input value={draft[r.currency] ?? ''} onChange={e => setDraft({ ...draft, [r.currency]: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && save(r.currency)} className={`${inp} w-32`} />
                    ) : <span className="text-mav-muted">{r.rate_to_usd}</span>}
                  </td>
                  {/* Spelled as a single unit. An earlier version showed "1,000 becomes
                      $1,000.00" for USD, which reads as "1 USD = 1000" at a glance — the
                      arithmetic was right and the sentence was wrong. */}
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">
                    1 {r.currency} = ${(Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USD
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && changed && <button onClick={() => save(r.currency)} disabled={busy} className="text-xs text-mav-yellow hover:underline mr-3">Save</button>}
                    {canEdit && r.currency.toUpperCase() !== 'USD' && (
                      <button onClick={() => drop(r.currency)} disabled={busy} className="text-mav-muted hover:text-red-400 disabled:opacity-50 align-middle" aria-label={`Remove ${r.currency}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-3 text-mav-muted">No rates set.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={newCur} onChange={e => setNewCur(e.target.value.toUpperCase())} placeholder="Code, e.g. ZAR" className={`${inp} w-32`} maxLength={5} />
          <input value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="Rate to USD" className={`${inp} w-40`} />
          <button onClick={add} disabled={busy} className="bg-mav-fill text-black font-medium rounded-md px-4 py-2 text-sm disabled:opacity-60">
            {busy ? 'Saving…' : 'Add currency'}
          </button>
          {status && <span className="text-sm text-mav-muted">{status}</span>}
        </div>
      )}
      {!canEdit && status && <p className="text-sm text-mav-muted">{status}</p>}
    </div>
  )
}
