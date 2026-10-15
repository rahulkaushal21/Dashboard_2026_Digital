'use client'
import { useEffect, useMemo, useState } from 'react'
import { lookupProject, type Opportunity, type ProjectLookup } from '@/lib/supabase'

// The same work, recorded twice.
//
// Two ways it happens, and the team was handling both by marking one Cancelled:
//
//   * A PM raises a deal by hand, then the Quotes sync brings the same deal in from the
//     sheet. Two rows, one piece of work.
//   * The work is already running under a project on the sheet and the quote was never a
//     separate deal at all.
//
// CANCELLING IS THE WRONG WORD FOR IT, and it is not free. Quote-to-conversion counts
// every quote raised in the quarter, so a duplicate marked Cancelled puts the same piece
// of work in the denominator twice and in the numerator once — the PM is marked down for
// losing a quote that only ever existed in one copy. Rahul, 15 Oct 2026: "cancelling
// opportunities cost team over quote to conversion".
//
// A merge takes the duplicate out of the cohort altogether. Not won, not lost, not open:
// not a deal. Nothing is deleted, the row keeps its history, and the merge undoes.

const money = (n?: number | null, cur = 'USD') =>
  n == null ? '—' : `${cur === 'USD' ? '$' : ''}${Math.round(n).toLocaleString('en-US')}${cur === 'USD' ? '' : ' ' + cur}`
const day = (s?: string | null) => (s || '').slice(0, 10) || '—'

type Kind = 'deal' | 'project'

export default function MergeDealDialog({ deal, siblings, onClose, onMerge }: {
  deal: Opportunity
  /** Other deals for the same client, for the duplicate case. */
  siblings: Opportunity[]
  onClose: () => void
  onMerge: (target: { into?: number; project?: string }, reason: string) => Promise<string | null>
}) {
  const [kind, setKind] = useState<Kind>(siblings.length ? 'deal' : 'project')
  const [into, setInto] = useState<number | undefined>()
  const [projectId, setProjectId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // What that project ID actually is, shown back before anything is saved — a mistyped
  // ID should be caught by the person looking at it, not by the month-end figures.
  const [found, setFound] = useState<ProjectLookup | null>(null)
  const [looking, setLooking] = useState(false)
  useEffect(() => {
    const id = projectId.trim()
    if (kind !== 'project' || !id) { setFound(null); setLooking(false); return }
    setLooking(true)
    const t = setTimeout(() => {
      lookupProject(id).then(r => { setFound(r); setLooking(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [projectId, kind])

  // Nearest first: the same client's other deals, newest at the top, and never this one.
  const options = useMemo(
    () => siblings.filter(s => s.id !== deal.id && !s.merged)
      .sort((a, b) => String(b.first_date || '').localeCompare(String(a.first_date || ''))),
    [siblings, deal.id])

  const ready = kind === 'deal' ? into != null : !!found
  const save = async () => {
    setBusy(true); setErr(null)
    const e = await onMerge(kind === 'deal' ? { into } : { project: projectId.trim() }, reason)
    setBusy(false)
    if (e) setErr(e); else onClose()
  }

  const ctl = 'mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg ' +
    'focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-lg font-semibold">Merge this deal</h2>
          <button onClick={onClose} className="text-mav-fg/60 hover:text-mav-fg text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-mav-fg/60 mb-4">
          {deal.company_name || 'This deal'} · {money(deal.local_value ?? deal.value, deal.currency)} · raised {day(deal.first_date)}
        </p>

        {/* Said before the choice, not after it: this is the reason the feature exists. */}
        <p className="text-xs text-mav-fg/70 bg-mav-dark border border-mav-line rounded-lg px-3 py-2 mb-4">
          A merged deal leaves the pipeline <b>without counting as lost</b>. It is the same
          work as something already recorded, so it drops out of quote-to-conversion
          entirely rather than being marked down as a quote that failed. Nothing is
          deleted and the merge can be undone.
        </p>

        <div className="flex gap-2 mb-4">
          {([['deal', 'Duplicate of another deal'], ['project', 'Part of an existing project']] as [Kind, string][]).map(([k, text]) => (
            <button key={k} type="button" onClick={() => { setKind(k); setErr(null) }}
              disabled={k === 'deal' && !options.length}
              title={k === 'deal' && !options.length ? 'No other deals on record for this client' : undefined}
              className={`flex-1 px-3 py-2 rounded-lg text-sm border transition disabled:opacity-40 ${
                kind === k ? 'bg-mav-yellow text-black border-mav-yellow font-medium'
                           : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
              {text}
            </button>
          ))}
        </div>

        {kind === 'deal' ? (
          <div>
            <div className="text-xs text-mav-fg/60 mb-1">
              Which deal is the real one? The other {deal.company_name || 'client'} deals on record:
            </div>
            <div className="border border-mav-line rounded-lg divide-y divide-mav-line/70 max-h-60 overflow-y-auto">
              {options.map(s => (
                <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-mav-fg/[0.03]">
                  <input type="radio" name="into" checked={into === s.id} onChange={() => setInto(s.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">{s.source_subject || s.company_name || `Deal #${s.id}`}</span>
                    <span className="block text-[11px] text-mav-muted">
                      {money(s.local_value ?? s.value, s.currency)} · {day(s.first_date)} · {s.status || 'Open'}
                      {s.origin ? ` · ${s.origin}` : ''}
                    </span>
                  </span>
                </label>
              ))}
              {!options.length && <p className="px-3 py-3 text-sm text-mav-muted">No other deals on record for this client.</p>}
            </div>
          </div>
        ) : (
          <div>
            <label className="block">
              <span className="text-xs text-mav-fg/60">Project ID on the sheet</span>
              <input value={projectId} onChange={e => { setProjectId(e.target.value); setErr(null) }}
                placeholder="PRJ250926055002_1" className={`${ctl} font-mono`} />
            </label>
            {/* Three states, all of them said plainly. An unknown ID must never look the
                same as one that has not been checked yet. */}
            <div className="mt-2 text-xs min-h-[3rem]">
              {looking ? <span className="text-mav-muted">Looking…</span>
               : found ? (
                 <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2">
                   <div className="text-green-400 font-medium">{found.company_name || 'Project found'}</div>
                   <div className="text-mav-fg/70 mt-0.5">
                     {money(found.amount_usd)} · {(found.booking_month || '').slice(0, 7) || 'no month'}
                     {found.pm_owner ? ` · ${found.pm_owner}` : ''}{found.service_name ? ` · ${found.service_name}` : ''}
                   </div>
                 </div>
               ) : projectId.trim() ? (
                 <span className="text-red-400">No project on the sheet has that ID.</span>
               ) : (
                 <span className="text-mav-muted">The work is already booked under a project — the quote was never separate.</span>
               )}
            </div>
          </div>
        )}

        <label className="block mt-4">
          <span className="text-xs text-mav-fg/60">Why (optional, but it is what the next person reads)</span>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Raised by hand, then synced from the sheet" className={ctl} />
        </label>

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

        <div className="flex items-center gap-2 mt-5">
          <button onClick={save} disabled={!ready || busy}
            className="px-4 py-2 rounded-md bg-mav-yellow text-black text-sm font-semibold disabled:opacity-40">
            {busy ? 'Merging…' : 'Merge'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-mav-line text-sm text-mav-muted hover:text-mav-fg">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
