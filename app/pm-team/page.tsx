'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import { getBookingsFull, getOpportunities, getQuotes, getPmFeedback, getEmailSignals, type BookingRow, type Opportunity, type Quote, type PmFeedbackRow, type EmailSignal } from '@/lib/supabase'
import { buildPmStats, growthPct, type PmQuarter } from '@/lib/pm-metrics'
import { PM_TEAM, fqOf, qLabel, totalPct, TARGETS, WEIGHTS, type FQ, type PmMember } from '@/lib/pm-team'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)

// Every quarter of the current financial year up to the one we are in, oldest
// first — the KPI sheet stacks them the same way as the year fills out.
const QUARTERS: FQ[] = Array.from({ length: CUR_FQ.q }, (_, i) => ({ fy: CUR_FQ.fy, q: i + 1 }))

const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const qMonths = (f: FQ) => {
  const sm = f.q === 1 ? 4 : f.q === 2 ? 7 : f.q === 3 ? 10 : 1
  const y = f.q === 4 ? f.fy + 1 : f.fy
  return `${SHORT[sm]}–${SHORT[sm + 2]} ${y}`
}

const totalColour = (t: number) => (t >= 70 ? 'text-green-400' : t >= 45 ? 'text-mav-yellow' : 'text-red-400')

interface Cell {
  pm: PmMember
  q: PmQuarter
  base: number
  raised: boolean
  growth: number | null
  total: number
}

export default function PmTeam() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [fb, setFb] = useState<PmFeedbackRow[]>([])
  const [sigs, setSigs] = useState<EmailSignal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback(), getEmailSignals()])
      .then(([b, o, qs, f, sg]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f); setSigs(sg) })
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb, sigs), [bookings, opps, quotes, fb, sigs])

  // One cell per PM per quarter, computed once so the table only has to read it.
  const grid = useMemo(() => QUARTERS.map(fq => ({
    fq,
    cells: PM_TEAM.map<Cell>(pm => {
      const s = stats.get(pm.slug)!
      const q = s.quarter(fq)
      const base = s.baseline(fq)
      const growth = growthPct(q.avg, base)
      return { pm, q, base, raised: base > pm.lastYearAvg, growth, total: totalPct(growth, q.q2c, q.feedback) }
    }),
  })), [stats])

  return (
    <div>
      <Header title="PM Team" subtitle="Quarterly KPI scorecard — growth, quote conversion and client feedback" />

      <HowItWorks />

      {loading && <p className="text-sm text-mav-muted mb-4">Loading…</p>}

      {grid.map(({ fq, cells }) => (
        <section key={`${fq.fy}-${fq.q}`} className="mb-8">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-lg font-semibold">{qLabel(fq)}</h2>
            <span className="text-xs text-mav-muted">{qMonths(fq)}</span>
            {fq.q === CUR_FQ.q && <span className="text-xs text-amber-400">in progress</span>}
          </div>

          <div className="border border-mav-line rounded-xl overflow-x-auto">
            <table className="text-sm border-collapse min-w-max">
              <thead>
                <tr className="bg-mav-panel">
                  <th className="sticky left-0 z-20 bg-mav-panel text-left font-medium px-4 py-3 border-b border-r border-mav-line min-w-[160px]">KPI</th>
                  {cells.map(c => (
                    <th key={c.pm.slug} className="px-4 py-3 border-b border-mav-line text-center font-medium min-w-[132px]">
                      <Link href={`/pm-team/${c.pm.slug}`} className="text-mav-yellow hover:underline">{c.pm.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Booked" hint="quarter total" cells={cells}
                  render={c => <span className="tabular-nums">{money(c.q.booked)}</span>} />

                <Row label="Avg / month" hint={`over ${cells[0]?.q.monthsElapsed ?? 0} month(s)`} cells={cells}
                  render={c => <span className="tabular-nums">{money(c.q.avg)}</span>} />

                <Row label="Base / month" hint="the bar to beat" cells={cells}
                  render={c => (
                    <span className="tabular-nums">
                      {money(c.base)}
                      {c.raised && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-mav-yellow/15 text-mav-yellow align-middle">raised</span>}
                    </span>
                  )} />

                <Row label="Growth" kpi weight={WEIGHTS.growth} target={`${TARGETS.growth}%`} cells={cells}
                  render={c => c.growth == null
                    ? <span className="text-mav-muted">—</span>
                    : <span className={`tabular-nums font-medium ${c.growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>{c.growth.toFixed(0)}%</span>} />

                <Row label="Q2C" kpi weight={WEIGHTS.q2c} target={`${TARGETS.q2c}%`} cells={cells}
                  render={c => c.q.q2c == null
                    ? <span className="text-mav-muted">—</span>
                    : (
                      <span className="tabular-nums font-medium">
                        {c.q.q2c.toFixed(0)}%
                        <span className="text-mav-muted font-normal ml-1.5 text-xs">{c.q.won}/{c.q.won + c.q.lost}</span>
                      </span>
                    )} />

                <Row label="Feedback" kpi weight={WEIGHTS.feedback} target={String(TARGETS.feedback)} cells={cells}
                  render={c => <span className="tabular-nums font-medium">{c.q.feedback}</span>} />

                <tr className="bg-mav-panel/70">
                  <th className="sticky left-0 z-20 bg-mav-panel text-left font-semibold px-4 py-3 border-t-2 border-r border-mav-line">
                    Total
                    <span className="block text-[11px] text-mav-muted font-normal">weighted attainment</span>
                  </th>
                  {cells.map(c => (
                    <td key={c.pm.slug} className={`px-4 py-3 border-t-2 border-mav-line text-center tabular-nums text-base font-semibold ${totalColour(c.total)}`}>
                      {c.total.toFixed(0)}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

/** One KPI row across every PM. `kpi` rows carry their weight and target. */
function Row({ label, hint, kpi, weight, target, cells, render }: {
  label: string; hint?: string; kpi?: boolean; weight?: number; target?: string
  cells: Cell[]; render: (c: Cell) => React.ReactNode
}) {
  return (
    <tr className={kpi ? 'border-t border-mav-line/60' : ''}>
      <th className={`sticky left-0 z-20 bg-mav-dark text-left px-4 py-2.5 border-r border-mav-line font-normal ${kpi ? 'text-white' : 'text-mav-muted'}`}>
        {label}
        <span className="block text-[11px] text-mav-muted">
          {kpi ? `${Math.round((weight || 0) * 100)}% weight · full marks at ${target}` : hint}
        </span>
      </th>
      {cells.map(c => <td key={c.pm.slug} className="px-4 py-2.5 text-center">{render(c)}</td>)}
    </tr>
  )
}

/** What the numbers mean, stated once, in plain terms. */
function HowItWorks() {
  const item = (title: string, body: string) => (
    <div className="bg-mav-panel border border-mav-line rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-mav-yellow mb-1">{title}</div>
      <p className="text-xs text-mav-muted leading-relaxed">{body}</p>
    </div>
  )
  return (
    <div className="grid gap-3 md:grid-cols-4 mb-6">
      {item('Growth', 'The quarter’s average monthly booking against the PM’s base. The base is their last-year monthly average and it only moves up: beat it in a quarter and that quarter’s average becomes the new base. Miss it and the old base stands.')}
      {item('Q2C', 'Confirmed ÷ decided, counting only Quotes-tab rows whose Project Type is New Development. Ad-hoc, Maintenance, Additional Pages, Ballpark and Dedicated are excluded, and still-open quotes are left out of the denominator.')}
      {item('Feedback', 'Client feedbacks recorded against the PM in the quarter — from the feedback sheet and from email.')}
      {item('Total', 'How far each measure got towards full marks — 16% growth, 85% Q2C, 8 feedbacks — weighted 40/40/20 and capped at 100%. Negative growth counts as zero rather than pulling the total below it.')}
    </div>
  )
}
