'use client'
import { useMemo, useState } from 'react'
import type { Opportunity } from '@/lib/supabase'

// Several ad-hoc jobs, one invoice.
//
// On an ad-hoc account a month is a dozen small jobs and ONE bill. Confirming them one at
// a time wrote a dozen revenue lines for an invoice that exists once, and somebody
// reconciled the difference by hand afterwards.
//
// This step only asks WHICH deal carries the invoice. The confirmation itself then goes
// through the ordinary dialog — same required fields, same checks, same event log — with
// the group's total already filled in. One confirmation path, so nothing about what makes
// a deal bookable is described in two places and free to drift.
//
// Nothing is deleted and nobody loses their line: each job stays won, keeps its own
// record, its own PM and its own history, and only stops booking money of its own.

const money = (n: number, cur = 'USD') =>
  `${cur === 'USD' ? '$' : ''}${Math.round(n).toLocaleString('en-US')}${cur === 'USD' ? '' : ' ' + cur}`

export default function BillTogetherDialog({ deals, onClose, onChosen }: {
  deals: Opportunity[]
  onClose: () => void
  /** The deal that books, and the total to put on it. */
  onChosen: (primary: Opportunity, total: number) => void
}) {
  const currency = deals[0]?.currency || 'USD'
  const sum = useMemo(() => deals.reduce((s, d) => s + (d.local_value ?? d.value ?? 0), 0), [deals])
  // The biggest job leads by default: its dates, technology and PM are the likeliest to
  // describe what was actually billed.
  const biggest = useMemo(() => [...deals].sort((a, b) => (b.value || 0) - (a.value || 0))[0], [deals])

  const [primaryId, setPrimaryId] = useState<number | undefined>(biggest?.id)
  const [amount, setAmount] = useState(String(Math.round(sum)))

  const typed = amount === '' ? null : Number(amount)
  const differs = typed != null && Math.abs(typed - sum) >= 1
  const primary = deals.find(d => d.id === primaryId)

  const ctl = 'mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg ' +
    'focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Bill {deals.length} jobs as one</h2>
            <p className="text-xs text-mav-fg/60 mt-0.5">
              {deals[0]?.company_name || 'This client'} — one revenue entry for the lot, the way it is invoiced.
            </p>
          </div>
          <button onClick={onClose} className="text-mav-fg/60 hover:text-mav-fg text-xl leading-none">&times;</button>
        </div>

        {/* Which one carries it. A radio list rather than a dropdown: the choice IS the
            list, and the amounts beside each name are how anyone decides. */}
        <div className="border border-mav-line rounded-lg divide-y divide-mav-line/70 mb-4 max-h-64 overflow-y-auto">
          {deals.map(d => (
            <label key={d.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-mav-dark/40">
              <input type="radio" name="primary" checked={primaryId === d.id} onChange={() => setPrimaryId(d.id)}
                className="mt-1 accent-mav-yellow" />
              <span className="min-w-0 flex-1">
                <span className="text-sm block truncate">{d.source_subject || `Deal #${d.id}`}</span>
                <span className="text-[11px] text-mav-fg/55">
                  {money(d.local_value ?? d.value ?? 0, currency)}
                  {d.pm_owner ? ` · ${d.pm_owner}` : ''}
                  {primaryId === d.id ? ' · carries the invoice' : ''}
                </span>
              </span>
            </label>
          ))}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-mav-fg/85">Invoice amount ({currency})</span>
          <input type="number" className={ctl} value={amount} onChange={e => setAmount(e.target.value)} />
          <span className="block text-[11px] text-mav-fg/50 mt-0.5">
            {differs
              ? `The jobs add up to ${money(sum, currency)} — this books ${money(typed as number, currency)}. The invoice is the fact; a rounded total or a goodwill discount is normal.`
              : `The ${deals.length} jobs added up. Change it to whatever was actually invoiced.`}
          </span>
        </label>

        <p className="mt-4 text-[11px] text-mav-fg/55">
          Next you will fill in the details for the deal that books, as you would for any confirmation.
          All {deals.length} end up won and keep their own record; only that one books revenue, so the month
          shows {money(typed ?? sum, currency)} once rather than {deals.length} times. It can be split again later.
        </p>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">Cancel</button>
          <button onClick={() => primary && onChosen(primary, typed ?? sum)} disabled={!primary}
            className="text-sm px-4 py-2 rounded-md bg-mav-yellow text-black font-medium hover:bg-mav-yellow/90 disabled:opacity-40">
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
