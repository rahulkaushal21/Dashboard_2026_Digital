'use client'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from './AuthProvider'
import {
  getStaleOpportunities, setOpportunityConfirmed, setOpportunityLost,
  type OpenOppEvidence,
} from '@/lib/supabase'

/**
 * Open deals the invoice app has already closed.
 *
 * The pipeline only means something if what is on it is still open. Terrace Boating was
 * confirmed and still sitting in Opportunities; NoLie Communications was Lost on 13 July
 * and still counted as $8,820 of live pipeline eleven weeks later.
 *
 * ONLY THE HARD TIERS APPEAR HERE. web_open_opportunity_evidence also carries a soft
 * 'client booked' tier, which 90 of 196 open opportunities trip simply because an agency
 * with one live deal usually has other work running. That is evidence for a person
 * reading one row; a banner urging someone to clear ninety of them would be read once and
 * then ignored forever, taking the fourteen real ones with it.
 *
 * Everything here is REVERSIBLE and every write records why it happened, so a wrong clear
 * costs a click rather than a deal.
 */
export default function StaleOpportunitiesBanner({ onChanged }: { onChanged?: () => void }) {
  const { email } = useAuth()
  const [rows, setRows] = useState<OpenOppEvidence[]>([])
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = () => {
    getStaleOpportunities()
      .then(r => { setRows(r); setPicked(new Set(r.map(x => x.id))) })
      // Silent on failure: this is a prompt, not a number anyone reconciles against. A
      // red error bar above the pipeline for a failed side-query would be worse than not
      // showing the prompt at all.
      .catch(() => setFailed(true))
  }
  useEffect(load, [])

  const won = useMemo(() => rows.filter(r => r.evidence === 'app won'), [rows])
  const lost = useMemo(() => rows.filter(r => r.evidence === 'app lost'), [rows])
  if (failed || rows.length === 0) return null

  const toggle = (id: number) => setPicked(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const apply = async () => {
    setBusy(true)
    let ok = 0
    for (const r of rows) {
      if (!picked.has(r.id)) continue
      const why = `Invoice app records ${r.app_opportunity_no} as ${r.app_final_stage}`
        + (r.app_usd != null ? ` ($${Math.round(r.app_usd).toLocaleString()}` : '')
        + (r.app_created ? `, ${r.app_created})` : r.app_usd != null ? ')' : '')
      const fn = r.evidence === 'app won' ? setOpportunityConfirmed : setOpportunityLost
      if (await fn(r.id, true, { actor: email || undefined, reason: why })) ok++
    }
    setBusy(false)
    setDone(`${ok} cleared`)
    load()
    onChanged?.()
  }

  const usd = (n?: number | null) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`

  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <AlertCircle size={16} className="text-amber-400 shrink-0" />
        <span className="text-sm">
          <span className="font-medium">{rows.length} open deal{rows.length === 1 ? '' : 's'}</span>
          {' '}the invoice app has already closed
          <span className="text-mav-muted">
            {' '}— {won.length} won, {lost.length} lost, {usd(rows.reduce((n, r) => n + (r.est_value || 0), 0))} of pipeline
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-mav-muted shrink-0">
          Review {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-500/30">
          <div className="overflow-auto max-h-[50vh]">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-left text-mav-muted">
                <tr>
                  {['', 'Company', 'Pipeline USD', 'Opened', 'App record', 'App says', 'App USD'].map((h, i) => (
                    <th key={i} className="sticky top-0 z-10 bg-mav-panel px-3 py-2 font-medium border-b border-mav-line whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows.map(r => (
                <tr key={r.id} className="border-b border-mav-line/50">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                      aria-label={`Clear ${r.company_name || 'opportunity'}`} />
                  </td>
                  <td className="px-3 py-2">{r.company_name || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{usd(r.est_value)}</td>
                  <td className="px-3 py-2 text-mav-muted whitespace-nowrap">{r.opened || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-mav-muted whitespace-nowrap">{r.app_opportunity_no || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      r.evidence === 'app won'
                        ? 'text-green-400 border-green-500/40'
                        : 'text-rose-400 border-rose-500/40'}`}>
                      {r.app_final_stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-mav-muted">{usd(r.app_usd)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-amber-500/30">
            <button onClick={apply} disabled={busy || picked.size === 0}
              className="text-sm px-3 py-1.5 rounded-md bg-mav-yellow text-black font-medium disabled:opacity-40">
              {busy ? 'Clearing…' : `Clear ${picked.size} selected`}
            </button>
            <button onClick={() => setPicked(new Set())} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">
              Select none
            </button>
            {done && <span className="text-xs text-green-400">{done}</span>}
            {/* Said plainly, because a bulk write on someone else's pipeline should never
                feel one-way. */}
            <span className="text-[11px] text-mav-muted/80 ml-auto">
              Won deals are confirmed, lost ones marked Lost. Both are reversible and record why.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
