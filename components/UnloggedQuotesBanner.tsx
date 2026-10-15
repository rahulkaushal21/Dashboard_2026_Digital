'use client'
import { useEffect, useMemo, useState } from 'react'
import { Receipt, ChevronDown, ChevronRight, Paperclip, ExternalLink } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { currentEmail, getStoredProfile } from '@/lib/access'
import {
  getDealSignals, dismissDealSignal, getDirectoryMember, ownerMatches,
  type DealSignal, type DirectoryMember,
} from '@/lib/supabase'

/**
 * Money discussed in email that never became a deal.
 *
 * WHY THIS EXISTS. The scan triages around 290 threads a day on sender and subject and
 * deep-reads about thirty. That is the right trade for cold mail and the wrong one for
 * an existing account, because an account's thread keeps its original subject for ever.
 * Gagandeep quoted $300 under "Routine site health check" and $150 under "Re: check-In";
 * both were missed, and the reason was the same both times — the subject described
 * routine work and the money was in the body.
 *
 * A PRICE IS NOT REQUIRED. Rahul, 15 Oct 2026: "if no price thats ok, but an opportunity
 * should be there". A proposal attachment or a written go-ahead is a deal whether or not
 * anyone has named a figure yet, so those rows appear with no value and the opportunity
 * gets raised without one.
 *
 * EACH PM SEES THEIR OWN, by the client's owner rather than by anything on the thread —
 * same rule as the stale-deals banner next door, and for the same reason: a prompt to
 * act is only honest when the row is yours to act on.
 *
 * THE DISMISS MATTERS MORE THAN THE DETECTION. An age-based "Review" flag used to live
 * on this page and fired on 83% of open deals, so it was read once and ignored for ever.
 * "Not a quote" is recorded against the thread and never comes back.
 */
export default function UnloggedQuotesBanner({ onAdd }: { onAdd?: (s: DealSignal) => void }) {
  const { email } = useAuth()
  const [all, setAll] = useState<DealSignal[]>([])
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [iAmAdmin, setIAmAdmin] = useState(false)
  const [scoped, setScoped] = useState(false)
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getDealSignals().then(setAll).catch(() => setFailed(true))
  }, [])
  useEffect(() => {
    setIAmAdmin(!!getStoredProfile()?.is_admin)
    getDirectoryMember(currentEmail()).then(m => { setMe(m); setScoped(true) })
  }, [])

  const rows = useMemo(() => {
    const live = all.filter(r => !gone.has(r.thread_id))
    if (iAmAdmin) return live
    if (!scoped || !me) return []
    return live.filter(r => ownerMatches(r.pm_owner || undefined, me.aliases))
  }, [all, gone, me, iAmAdmin, scoped])

  if (failed || !rows.length) return null

  const drop = async (r: DealSignal) => {
    setGone(p => new Set(p).add(r.thread_id))
    const ok = await dismissDealSignal(r.thread_id, email || undefined, 'Not a quote')
    if (!ok) setGone(p => { const n = new Set(p); n.delete(r.thread_id); return n })
  }

  const usd = (n?: number | null) => n == null ? 'no figure' : `$${Math.round(n).toLocaleString('en-US')}`
  const day = (s: string) => (s || '').slice(0, 10)
  const total = rows.reduce((n, r) => n + (r.amt || 0), 0)
  const priced = rows.filter(r => r.amt != null).length

  // The attachment that triggered the row, so the reason is visible at a glance.
  const dealFile = (r: DealSignal) =>
    (r.attachments || []).find(a => /proposal|quote|quotation|estimate|sow|scope.?of.?work|costing|pricing|budget/i.test(a))

  return (
    <div className="mb-4 rounded-xl border border-sky-500/40 bg-sky-500/10 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Receipt size={16} className="text-sky-400 shrink-0" />
        <span className="text-sm">
          <span className="font-medium">{rows.length} thread{rows.length === 1 ? '' : 's'}</span>
          {' '}with a quote that is not on the board
          <span className="text-mav-muted">
            {' '}— {priced ? `${usd(total)} across ${priced}` : 'none'} priced
            {rows.length - priced > 0 ? `, ${rows.length - priced} with no figure yet` : ''}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-mav-muted shrink-0">
          Review {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-sky-500/30">
          <div className="overflow-auto max-h-[60vh] divide-y divide-mav-line/50">
            {rows.map(r => (
              <div key={r.thread_id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-sm">{r.company_name || r.client_key}</span>
                  <span className={`text-sm tabular-nums ${r.amt == null ? 'text-mav-fg/40' : 'text-mav-yellow font-semibold'}`}>
                    {usd(r.amt)}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-300">
                    {r.signal}
                  </span>
                  <span className="text-[11px] text-mav-muted">
                    {day(r.last_mail)}{r.hits > 1 ? ` · ${r.hits} messages` : ''}
                    {r.pm_owner ? ` · ${r.pm_owner}` : ''}
                  </span>
                </div>
                <div className="text-xs text-mav-fg/70 mt-1">{r.subject || '(no subject)'}</div>
                {dealFile(r) && (
                  <div className="flex items-center gap-1 text-[11px] text-sky-300 mt-1">
                    <Paperclip size={11} />{dealFile(r)}
                  </div>
                )}
                {/* The sentence the figure sits in. Enough to judge without opening Gmail,
                    which is the difference between a list that gets worked and one that
                    gets skipped. */}
                {r.evidence && (
                  <div className="text-[11px] text-mav-muted mt-1 line-clamp-2 italic">…{r.evidence}…</div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => onAdd?.(r)}
                    className="text-xs px-3 py-1.5 rounded-md bg-mav-yellow text-black font-medium">
                    Add as opportunity
                  </button>
                  <button onClick={() => drop(r)}
                    className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">
                    Not a quote
                  </button>
                  <a href={`https://mail.google.com/mail/u/0/#all/${r.thread_id}`} target="_blank" rel="noreferrer"
                    className="text-xs px-2 py-1.5 rounded-md text-mav-muted hover:text-mav-fg inline-flex items-center gap-1">
                    <ExternalLink size={12} />Open thread
                  </a>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-sky-500/30 text-[11px] text-mav-muted/80">
            Found by reading the body and the attachment names, not the subject line — which
            is where both of September’s missed quotes were hiding. “Not a quote” is remembered.
          </div>
        </div>
      )}
    </div>
  )
}
