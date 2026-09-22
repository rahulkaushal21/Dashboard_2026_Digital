'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getNeedsInput, getOpportunities, canConfirmLocally, getDirectoryMember, type DirectoryMember, type NeedsInputRow, type NeedsReason, type Opportunity } from '@/lib/supabase'
import { currentEmail, getStoredProfile } from '@/lib/access'
import ConfirmDealDialog from '@/components/ConfirmDealDialog'

// The work list. If this page is empty there is nothing for you to do, and that is the
// intended resting state rather than a sign something is broken.
//
// It deliberately carries ONLY the two things a human has to supply — a value nobody has
// written down, and a decision nobody has made — plus deals somebody began confirming and
// left half-done. Everything else the system works out for itself. An earlier version of
// the alerting on Opportunities fired on 83% of open deals and buried the handful that
// mattered; a queue nobody can clear teaches people to ignore it, so the bar for adding a
// fourth reason here should be high.

const REASONS: { key: NeedsReason; label: string; tone: string }[] = [
  { key: 'confirm_started',       label: 'Half-confirmed',       tone: 'border-amber-500/50 text-amber-300' },
  { key: 'awaiting_confirmation', label: 'Client has committed', tone: 'border-green-500/50 text-green-300' },
  { key: 'missing_value',         label: 'No value',             tone: 'border-blue-400/50 text-blue-300' },
]

const money = (n?: number) => n == null || n === 0 ? '—' : `$${Math.round(n).toLocaleString('en-US')}`

export default function NeedsInput() {
  const [rows, setRows] = useState<NeedsInputRow[]>([])
  const [deals, setDeals] = useState<Opportunity[]>([])
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [iAmAdmin, setIAmAdmin] = useState(false)
  const [mineOnly, setMineOnly] = useState(true)
  const [reason, setReason] = useState<NeedsReason | ''>('')
  const [confirming, setConfirming] = useState<Opportunity | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => Promise.all([getNeedsInput(), getOpportunities()])
    .then(([n, d]) => { setRows(n); setDeals(d) })
    .finally(() => setLoading(false))

  useEffect(() => {
    setIAmAdmin(!!getStoredProfile()?.is_admin)
    getDirectoryMember(currentEmail()).then(m => {
      setMe(m)
      // An admin who is not on the directory owns nothing, so "mine" would read as empty
      // and look broken. Show them everything by default instead.
      if (!m) setMineOnly(false)
    })
    load()
  }, [])

  const myEmail = (currentEmail() || '').toLowerCase()
  const shown = useMemo(() => rows
    .filter(r => !mineOnly || (r.owner_email || '').toLowerCase() === myEmail)
    .filter(r => !reason || r.reason === reason), [rows, mineOnly, reason, myEmail])

  const mineCount = rows.filter(r => (r.owner_email || '').toLowerCase() === myEmail).length
  const unassigned = rows.filter(r => !r.owner_email).length
  const dealOf = (id: number) => deals.find(d => d.id === id)

  return (
    <div>
      <Header title="Needs input" subtitle="The only two things the system cannot work out for itself — a value nobody has written down, and a decision nobody has made." />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button onClick={() => setMineOnly(true)}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${mineOnly ? 'border-mav-yellow/50 text-mav-yellow bg-mav-yellow/10' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
          Mine ({mineCount})
        </button>
        <button onClick={() => setMineOnly(false)}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${!mineOnly ? 'border-mav-yellow/50 text-mav-yellow bg-mav-yellow/10' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
          Everyone ({rows.length})
        </button>
        <span className="w-px h-5 bg-mav-line mx-1" />
        {REASONS.map(r => {
          const n = rows.filter(x => x.reason === r.key).length
          return (
            <button key={r.key} onClick={() => setReason(reason === r.key ? '' : r.key)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${reason === r.key ? r.tone + ' bg-mav-fg/5' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
              {r.label} ({n})
            </button>
          )
        })}
      </div>

      {/* An unowned deal cannot be confirmed by any PM — only an admin — so it is called
          out rather than left to sit in a list nobody feels responsible for. */}
      {unassigned > 0 && !mineOnly && (
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs">
          <span className="text-amber-300 font-medium">{unassigned} of these have no owner the system recognises.</span>
          <span className="text-mav-muted"> Nobody but an admin can confirm them. Either put a known owner on the deal, or add that person in Settings &rarr; PM directory.</span>
        </div>
      )}

      {loading ? <div className="text-sm text-mav-muted">Loading…</div> : shown.length === 0 ? (
        <div className="rounded-xl border border-mav-line bg-mav-panel px-5 py-8 text-center">
          <div className="text-sm font-medium">Nothing waiting on you.</div>
          <div className="text-xs text-mav-muted mt-1">That is the normal state — everything else the system works out for itself.</div>
        </div>
      ) : (
        <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">What it needs</th>
                <th className="px-4 py-2 font-medium text-right">Value</th>
                <th className="px-4 py-2 font-medium text-right">Waiting</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const tone = REASONS.find(x => x.key === r.reason)
                const deal = dealOf(r.id)
                const mayConfirm = deal ? canConfirmLocally(deal, me, iAmAdmin) : false
                return (
                  <tr key={r.id} className="border-b border-mav-line/60">
                    <td className="px-4 py-3">
                      <div className="truncate max-w-[16rem]">{r.company_name || '—'}</div>
                      <div className="text-xs text-mav-muted">{r.status || 'Open'} · {r.origin}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${tone?.tone || 'border-mav-line text-mav-muted'}`}>{tone?.label || r.reason}</span>
                      <div className="text-xs text-mav-muted mt-1 max-w-[22rem]">{r.detail}</div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(r.est_value)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-mav-muted">{r.days_waiting}d</td>
                    <td className="px-4 py-3 text-xs text-mav-muted">{r.pm_owner || r.sales_person || <span className="text-amber-300">unassigned</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {deal && mayConfirm && (
                        <button onClick={() => setConfirming(deal)}
                          className="text-xs px-3 py-1.5 rounded-md bg-green-500 text-black font-medium hover:brightness-110 transition">
                          {r.reason === 'missing_value' ? 'Add value & confirm' : 'Confirm'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && <ConfirmDealDialog deal={confirming} onClose={() => setConfirming(null)} onConfirmed={() => { setConfirming(null); load() }} />}
    </div>
  )
}
