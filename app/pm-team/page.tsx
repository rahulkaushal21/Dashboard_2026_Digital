'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, getOpportunities, getQuotes, getPmFeedback, type BookingRow, type Opportunity, type Quote, type PmFeedbackRow } from '@/lib/supabase'
import { buildPmStats, growthPct } from '@/lib/pm-metrics'
import {
  PM_TEAM, fqOf, qLabel, decQ, overallScore, scoreOf,
  GROWTH_BANDS, Q2C_BANDS, FEEDBACK_BANDS, WEIGHTS, THIN_Q2C, type FQ,
} from '@/lib/pm-team'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(1)}%`)
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

// Quarters offered in the picker: from the first with revenue data (Q1 FY2025) to
// the one we are in now.
const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)
const QUARTERS: FQ[] = (() => {
  const out: FQ[] = [CUR_FQ]
  for (let i = 0; i < 6; i++) out.unshift(decQ(out[0]))
  return out
})()
// Default to Q1 of the current fiscal year — the only quarter with a declared
// baseline, and therefore the only one that can score Growth.
const DEFAULT_I = Math.max(0, QUARTERS.findIndex(f => f.fy === CUR_FQ.fy && f.q === 1))

const scoreColour = (s: number | null) =>
  s == null ? 'text-mav-muted' : s >= 8 ? 'text-green-400' : s >= 6 ? 'text-mav-yellow' : 'text-red-400'

export default function PmTeam() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [fb, setFb] = useState<PmFeedbackRow[]>([])
  const [qi, setQi] = useState(DEFAULT_I)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback()])
      .then(([b, o, qs, f]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f) })
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb), [bookings, opps, quotes, fb])
  const fq = QUARTERS[qi]

  const rows = useMemo(() => PM_TEAM.map(pm => {
    const s = stats.get(pm.slug)!
    const q = s.quarter(fq)
    const base = s.baseline(fq)
    // Ratcheted: a PM who beat their bar in an earlier quarter of this FY is now
    // measured against what they actually achieved, not the old figure.
    const raised = base > pm.lastYearAvg
    const growth = growthPct(q.avg, base)
    return { pm, q, base, raised, growth, score: overallScore(growth, q.q2c, q.feedback) }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.q.booked - a.q.booked), [stats, fq])

  const totBooked = rows.reduce((s, r) => s + r.q.booked, 0)
  const totBase = rows.reduce((s, r) => s + r.base, 0)
  const totShared = rows.reduce((s, r) => s + r.q.shared, 0)
  const scored = rows.filter(r => r.score != null)
  const avgScore = scored.length ? scored.reduce((s, r) => s + r.score!, 0) / scored.length : null

  return (
    <div>
      <Header title="PM Team" subtitle="Project-manager scorecard — bookings, quote conversion and feedback against the quarterly KPI" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">Quarter</span>
        <select value={qi} onChange={e => setQi(Number(e.target.value))} className={selCls}>
          {QUARTERS.map((f, i) => <option key={i} value={i}>{qLabel(f)}</option>)}
        </select>
        {fq.fy === CUR_FQ.fy && fq.q === CUR_FQ.q &&
          <span className="text-xs text-amber-400">in progress — averaged over {rows[0]?.q.monthsElapsed || 0} month(s) so far</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label={`Booked \u00b7 ${qLabel(fq)}`} value={money(totBooked)} />
        <KPICard label="Team baseline / month" value={money(totBase)} />
        <KPICard label="New-dev quotes raised" value={String(totShared)} />
        <KPICard label="Avg KPI score" value={avgScore == null ? '\u2014' : `${avgScore.toFixed(1)} / 10`} />
      </div>

      <p className="text-xs text-mav-muted bg-mav-panel border border-mav-line rounded-lg px-3 py-2 mb-4">
        Growth is <span className="text-white">average against average</span>: the quarter\u2019s per-month booking average
        against the baseline monthly figure, matching the Growth column on the <span className="font-medium">Report&nbsp;-&nbsp;PM</span> tab.
        The bar ratchets \u2014 beat it in a quarter and the next quarter is measured against what you achieved; miss it and the
        old figure stands. A <span className="text-mav-yellow">raised</span> tag marks a bar that has moved up.
        Apr&ndash;Jun 2026 is locked to the revenue sheet&rsquo;s pivot rather than read from the live feed, so the closed quarter
        cannot move. Q2C counts Quotes-tab rows whose Project Type is New Development &mdash; Ad-hoc, Maintenance, Additional
        Pages, Ballpark and Dedicated are all excluded.
      </p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              {['PM', 'Booked', 'Baseline', 'Growth', 'Q2C (new dev)', 'Feedbacks', 'Score'].map(h =>
                <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pm, q, base, raised, growth, score }) => {
              const decided = q.won + q.lost
              const thin = decided > 0 && decided < THIN_Q2C
              return (
                <tr key={pm.slug} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                  <td className="px-4 py-3">
                    <Link href={`/pm-team/${pm.slug}`} className="text-mav-yellow hover:underline">{pm.name}</Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{money(q.booked)}<span className="text-mav-muted ml-2 text-xs">{money(q.avg)}/mo</span></td>
                  <td className="px-4 py-3 tabular-nums text-mav-muted">
                    {money(base)}
                    {raised && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-mav-yellow/15 text-mav-yellow">raised</span>}
                  </td>
                  <td className={`px-4 py-3 tabular-nums ${growth == null ? 'text-mav-muted' : growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pct(growth)}
                    {growth != null && <span className="text-mav-muted ml-2">{scoreOf(GROWTH_BANDS, growth)}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {q.q2c == null ? <span className="text-mav-muted">no decided quotes</span> : (
                      <>
                        {q.q2c.toFixed(0)}%
                        <span className="text-mav-muted ml-2">{q.won}/{decided}</span>
                        {thin && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">thin</span>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{q.feedback || <span className="text-mav-muted">0</span>}</td>
                  <td className={`px-4 py-3 tabular-nums font-medium ${scoreColour(score)}`}>
                    {score == null ? '—' : score.toFixed(1)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-sm text-mav-muted mb-6">Loading…</p>}

      <BandReference />
    </div>
  )
}

// The scorecard itself, on the page, so nobody has to go and find the spreadsheet
// to know why a number scored what it scored.
// Not exported: a Next page module may only export the framework's own names.
function BandReference() {
  const card = (title: string, weight: number, bands: typeof GROWTH_BANDS, unit: string) => (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-mav-muted">{Math.round(weight * 100)}% weight</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {bands.map(b => (
            <tr key={b.label} className="border-b border-mav-line/40 last:border-0">
              <td className="py-1.5 text-mav-muted">{b.label}</td>
              <td className="py-1.5 text-right tabular-nums">{b.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-mav-muted mt-2">{unit}</p>
    </div>
  )
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-mav-muted mb-3">Quarterly KPI</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {card('Growth', WEIGHTS.growth, GROWTH_BANDS, 'Quarter bookings vs the same quarter last year.')}
        {card('Q2C (new development)', WEIGHTS.q2c, Q2C_BANDS, 'Confirmed ÷ decided, New-development quotes only, sheet and email combined.')}
        {card('Feedback', WEIGHTS.feedback, FEEDBACK_BANDS, 'Client feedbacks recorded in the quarter, from the sheet and from email.')}
      </div>
      <p className="text-xs text-mav-muted mt-3">
        Score = Growth×0.4 + Q2C×0.4 + Feedback×0.2, out of 10. Growth with no baseline, or Q2C with nothing yet decided,
        leaves the overall blank rather than scoring the bottom band — a quarter that has not been measured is not a bad
        quarter. Zero feedbacks is a real count and does score 3, per the “2 or below” band. The published Growth table
        jumps from “less than 15%” to “16% or more”; 15–16% is read here as the 8 band so the scale has no hole in it.
      </p>
    </section>
  )
}
