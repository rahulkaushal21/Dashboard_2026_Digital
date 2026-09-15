'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/Header'
import { getBookingsFull, getOpportunities, getQuotes, getPmFeedback, type BookingRow, type Opportunity, type Quote, type PmFeedbackRow } from '@/lib/supabase'
import { buildPmStats, growthPct, pendingOpps, oppDate, isNewDevQuote } from '@/lib/pm-metrics'
import { pmBySlug, fqOf, qLabel, totalPct, attainment, TARGETS, WEIGHTS, type FQ } from '@/lib/pm-team'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mLabel = (k: string) => { const [y, m] = k.split('-'); return `${SHORT[Number(m)]} '${y.slice(2)}` }
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)
const QUARTERS: FQ[] = Array.from({ length: CUR_FQ.q }, (_, i) => ({ fy: CUR_FQ.fy, q: i + 1 }))

export default function PmDetail({ slug }: { slug: string }) {
  const pm = pmBySlug(slug)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [fb, setFb] = useState<PmFeedbackRow[]>([])
  const [qi, setQi] = useState(QUARTERS.length - 1)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback()])
      .then(([b, o, qs, f]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f) })
  }, [])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb), [bookings, opps, quotes, fb])
  const s = pm ? stats.get(pm.slug) : undefined
  const fq = QUARTERS[qi]

  // Month-over-month bookings from the first month with data to now, so a zero
  // month shows as a gap rather than silently closing up.
  const months = useMemo(() => {
    if (!s) return [] as { k: string; v: number }[]
    const keys = [...s.byMonth.keys()].sort()
    if (!keys.length) return []
    const out: { k: string; v: number }[] = []
    let [y, m] = keys[0].split('-').map(Number)
    const end = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
    for (let i = 0; i < 48; i++) {
      const k = `${y}-${String(m).padStart(2, '0')}`
      out.push({ k, v: s.byMonth.get(k) || 0 })
      if (k >= end) break
      m++; if (m > 12) { m = 1; y++ }
    }
    return out
  }, [s])

  const pending = useMemo(() => (s ? pendingOpps(s.opps, NOW) : { rows: [], toppedUp: 0 }), [s])

  if (!pm) return <div><Header title="PM not found" /><Link href="/pm-team" className="text-mav-yellow text-sm">← PM Team</Link></div>

  const q = s?.quarter(fq)
  const base = s ? s.baseline(fq) : pm.lastYearAvg
  const raised = base > pm.lastYearAvg
  const growth = q ? growthPct(q.avg, base) : null
  const total = q ? totalPct(growth, q.q2c, q.feedback) : 0
  const peak = Math.max(1, ...months.map(x => x.v))
  const decided = (q?.won || 0) + (q?.lost || 0)

  // Quotes behind the Q2C figure, so the number can be checked rather than trusted.
  const qQuotes = (s?.quotes || [])
    .filter(x => isNewDevQuote(x) && (x.added_date || '').slice(0, 7) >= qKey(fq)[0] && (x.added_date || '').slice(0, 7) <= qKey(fq)[1])
    .sort((a, b) => (b.added_date || '').localeCompare(a.added_date || ''))

  return (
    <div>
      <Link href="/pm-team" className="inline-flex items-center gap-1 text-sm text-mav-muted hover:text-white mb-3"><ArrowLeft size={14} /> PM Team</Link>
      <Header title={pm.name} subtitle="Project manager — quarterly KPI, bookings and open quotes" />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-xs text-mav-muted">Quarter</span>
        <select value={qi} onChange={e => setQi(Number(e.target.value))} className={selCls}>
          {QUARTERS.map((f, i) => <option key={i} value={i}>{qLabel(f)}</option>)}
        </select>
        {fq.q === CUR_FQ.q && <span className="text-xs text-amber-400">in progress — {q?.monthsElapsed ?? 0} of 3 months</span>}
      </div>

      {/* ---- The score, and exactly how it was reached ------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-mav-line">
          <div>
            <h2 className="font-medium">{qLabel(fq)} scorecard</h2>
            <p className="text-xs text-mav-muted mt-0.5">Each measure scored on how far it got towards full marks, then weighted.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">{total.toFixed(0)}%</div>
            <div className="text-xs text-mav-muted">Total</div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-5 py-2 font-medium">Measure</th>
              <th className="px-5 py-2 font-medium">Result</th>
              <th className="px-5 py-2 font-medium">Full marks</th>
              <th className="px-5 py-2 font-medium text-right">Attained</th>
              <th className="px-5 py-2 font-medium text-right">Weight</th>
              <th className="px-5 py-2 font-medium text-right">Contributes</th>
            </tr>
          </thead>
          <tbody>
            <KpiRow measure="Growth" result={growth == null ? '—' : `${growth.toFixed(1)}%`}
              note={`${money(q?.avg || 0)}/mo vs ${money(base)} base`}
              raw={growth} target={TARGETS.growth} targetLabel={`${TARGETS.growth}%`} weight={WEIGHTS.growth} />
            <KpiRow measure="Q2C" result={q?.q2c == null ? '—' : `${q.q2c.toFixed(0)}%`}
              note={`${q?.won ?? 0} confirmed of ${decided} decided`}
              raw={q?.q2c ?? null} target={TARGETS.q2c} targetLabel={`${TARGETS.q2c}%`} weight={WEIGHTS.q2c} />
            <KpiRow measure="Feedback" result={String(q?.feedback ?? 0)} note="recorded this quarter"
              raw={q?.feedback ?? 0} target={TARGETS.feedback} targetLabel={String(TARGETS.feedback)} weight={WEIGHTS.feedback} />
          </tbody>
          <tfoot>
            <tr className="border-t border-mav-line bg-mav-dark/40">
              <td className="px-5 py-3 font-medium" colSpan={5}>Total</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold">{total.toFixed(1)}%</td>
            </tr>
          </tfoot>
        </table>

        <div className="px-5 py-3 border-t border-mav-line text-xs text-mav-muted space-y-1">
          <p>
            <span className="text-white">Base {money(base)} a month.</span>{' '}
            {raised
              ? `Raised from a last-year average of ${money(pm.lastYearAvg)} — that bar was cleared earlier this year, so the higher figure stands from here.`
              : `This is the last-year monthly average, still the bar because it has not been beaten this year yet.`}
          </p>
          {growth != null && growth < 0 && <p>Growth is below the base, so it contributes nothing to the Total rather than pulling it negative.</p>}
          {decided === 0 && <p className="text-amber-400">No New-development quote has been decided this quarter, so Q2C has nothing to measure and contributes nothing.</p>}
        </div>
      </section>

      {/* ---- Month over month bookings ---------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
        <h2 className="font-medium mb-1">Month-over-month bookings</h2>
        <p className="text-xs text-mav-muted mb-4">USD booked each month. Apr–Jun 2026 is fixed to the revenue sheet&rsquo;s pivot, the agreed final figure for that quarter.</p>
        {months.length === 0 ? <p className="text-sm text-mav-muted">No bookings recorded.</p> : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-[640px] h-44">
              {months.map(({ k, v }, i) => {
                const prev = i > 0 ? months[i - 1].v : null
                const up = prev != null && v >= prev
                return (
                  <div key={k} className="flex-1 flex flex-col items-center justify-end gap-1 group">
                    <span className="text-[10px] tabular-nums text-mav-muted opacity-0 group-hover:opacity-100 whitespace-nowrap">{money(v)}</span>
                    <div className={`w-full rounded-t ${v === 0 ? 'bg-mav-line' : up ? 'bg-mav-yellow' : 'bg-mav-yellow/45'}`}
                      style={{ height: `${Math.max(2, (v / peak) * 100)}%` }} title={`${mLabel(k)} — ${money(v)}`} />
                    <span className="text-[10px] text-mav-muted whitespace-nowrap">{mLabel(k)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-mav-muted mt-3">Solid bars are up on the month before; faded bars are down.</p>
      </section>

      {/* ---- The quotes behind Q2C -------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4">
          <h2 className="font-medium">New-development quotes · {qLabel(fq)}</h2>
          <p className="text-xs text-mav-muted mt-1">
            Every Quotes-tab row behind the Q2C figure — Project Type “New Development”, owned by this PC/SME.
            {' '}{q?.shared ?? 0} raised · {q?.won ?? 0} confirmed · {q?.lost ?? 0} cancelled · {q?.open ?? 0} still open.
          </p>
        </div>
        {qQuotes.length === 0 ? <p className="px-5 pb-5 text-sm text-mav-muted">No New-development quotes raised this quarter.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="text-left text-mav-muted border-y border-mav-line">
                <tr>{['Added', 'Client', 'Project', 'Value', 'Status'].map(h => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {qQuotes.map(x => (
                  <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-2.5 text-mav-muted whitespace-nowrap">{(x.added_date || '').slice(0, 10)}</td>
                    <td className="px-5 py-2.5">{x.agency}</td>
                    <td className="px-5 py-2.5 text-mav-muted max-w-[260px] truncate" title={x.subject_project}>{x.subject_project}</td>
                    <td className="px-5 py-2.5 tabular-nums">{x.usd_value ? money(x.usd_value) : <span className="text-mav-muted">—</span>}</td>
                    <td className="px-5 py-2.5"><StatusPill s={x.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Open opportunities ----------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-medium">Open opportunities</h2>
          <p className="text-xs text-mav-muted mt-1">
            Raised this month and still open, sheet and email.
            {pending.toppedUp > 0 && ` It is early in the month, so the ${pending.toppedUp} most recent open deals from previous months are included.`}
          </p>
        </div>
        {pending.rows.length === 0 ? <p className="px-5 pb-5 text-sm text-mav-muted">Nothing open.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left text-mav-muted border-y border-mav-line">
                <tr>{['Date', 'Client', 'Subject', 'Value', 'Source', 'Status'].map(h => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {pending.rows.map(o => (
                  <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-2.5 text-mav-muted whitespace-nowrap">{oppDate(o).slice(0, 10)}</td>
                    <td className="px-5 py-2.5">{o.company_name}</td>
                    <td className="px-5 py-2.5 text-mav-muted max-w-[260px] truncate" title={o.source_subject}>{o.source_subject}</td>
                    <td className="px-5 py-2.5 tabular-nums">{o.est_value ? money(o.est_value) : <span className="text-mav-muted">—</span>}</td>
                    <td className="px-5 py-2.5 text-mav-muted text-xs">{o.origin}</td>
                    <td className="px-5 py-2.5 text-mav-muted">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const qKey = (f: FQ): [string, string] => {
  const sm = f.q === 1 ? 4 : f.q === 2 ? 7 : f.q === 3 ? 10 : 1
  const y = f.q === 4 ? f.fy + 1 : f.fy
  const p = (n: number) => String(n).padStart(2, '0')
  return [`${y}-${p(sm)}`, `${y}-${p(sm + 2)}`]
}

function StatusPill({ s }: { s?: string }) {
  const v = (s || '').toLowerCase()
  const cls = v === 'confirmed' ? 'bg-green-500/15 text-green-400'
    : v.includes('cancel') ? 'bg-red-500/15 text-red-400'
    : 'bg-mav-line text-mav-muted'
  return <span className={`text-[11px] px-2 py-0.5 rounded ${cls}`}>{s || '—'}</span>
}

/** One measure, shown as result → attainment → weighted contribution. */
function KpiRow({ measure, result, note, raw, target, targetLabel, weight }: {
  measure: string; result: string; note: string
  raw: number | null; target: number; targetLabel: string; weight: number
}) {
  const a = attainment(raw, target)
  return (
    <tr className="border-b border-mav-line/40">
      <td className="px-5 py-3">
        {measure}
        <span className="block text-[11px] text-mav-muted">{note}</span>
      </td>
      <td className="px-5 py-3 tabular-nums">{result}</td>
      <td className="px-5 py-3 text-mav-muted tabular-nums">{targetLabel}</td>
      <td className="px-5 py-3 text-right tabular-nums">
        <span className="inline-flex items-center gap-2">
          <span className="w-16 h-1.5 rounded-full bg-mav-line overflow-hidden">
            <span className="block h-full bg-mav-yellow" style={{ width: `${a * 100}%` }} />
          </span>
          {(a * 100).toFixed(0)}%
        </span>
      </td>
      <td className="px-5 py-3 text-right text-mav-muted tabular-nums">{Math.round(weight * 100)}%</td>
      <td className="px-5 py-3 text-right tabular-nums">{(a * weight * 100).toFixed(1)}%</td>
    </tr>
  )
}
