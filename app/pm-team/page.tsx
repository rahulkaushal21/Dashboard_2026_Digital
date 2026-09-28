'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { KPIRow, Segments, Panel } from '@/components/PageParts'
import { UnplacedNote } from '@/components/UnitToggle'
import { useAuth } from '@/components/AuthProvider'
import { OWNER_EMAIL } from '@/lib/access'
import { growthPct, type PmQuarter } from '@/lib/pm-metrics'
import { PM_TEAM, pmByEmail, fqOf, qLabel, totalPct, TARGETS, WEIGHTS, type FQ, type PmMember } from '@/lib/pm-team'
import { usePmData } from './usePmData'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)

// Every quarter of the current financial year up to the one we are in, oldest
// first — the KPI sheet stacks them the same way as the year fills out.
const QUARTERS: FQ[] = Array.from({ length: CUR_FQ.q }, (_, i) => ({ fy: CUR_FQ.fy, q: i + 1 }))
const fqId = (f: FQ) => `${f.fy}-${f.q}`

const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const qMonths = (f: FQ) => {
  const sm = f.q === 1 ? 4 : f.q === 2 ? 7 : f.q === 3 ? 10 : 1
  const y = f.q === 4 ? f.fy + 1 : f.fy
  return `${SHORT[sm]}–${SHORT[sm + 2]} ${y}`
}

const totalColour = (t: number) => (t >= 70 ? 'text-green-400' : t >= 45 ? 'text-mav-yellow' : 'text-red-400')

// What the numbers mean, stated once, in plain terms — behind the ⓘ on each rule card.
const HOW = {
  growth: 'The quarter’s average monthly booking against the PM’s base. The base is their last-year monthly average and it only moves up: beat it in a quarter and that quarter’s average becomes the new base. Miss it and the old base stands. The last-year average is a single hand-typed figure per PM, so it is not split by department.',
  q2c: 'Confirmations land in the quarter they were WON in, not the quarter the quote was raised — a Q1 quote signed in Q2 is Q2’s win. The denominator is everything raised in the quarter plus anything older confirmed in it, sheet and email together. Quotes still open count against the quarter, so an unclosed quote weighs on the number rather than vanishing from it, and a closed quarter never moves afterwards.',
  feedback: 'Client feedbacks recorded against the PM in the quarter — from the feedback sheet and from email.',
  total: 'How far each measure got towards full marks — 16% growth, 85% Q2C, 8 feedbacks — weighted 40/40/20 and capped at 100%. Negative growth counts as zero rather than pulling the total below it.',
}

interface Cell {
  pm: PmMember
  q: PmQuarter
  base: number
  raised: boolean
  growth: number | null
  total: number
}

export default function PmTeam() {
  const { email, profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const me = pmByEmail(email)
  // Admins see the whole team; a PM sees only themselves; anyone who is neither
  // sees nothing here. Memoised — a fresh array each render would re-run the
  // whole grid computation.
  const roster = useMemo(() => (isAdmin ? PM_TEAM : me ? [me] : []), [isAdmin, me])

  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source (see usePmData), so every scorecard figure follows the switch.
  const { stats, loading, unplaced } = usePmData()

  // One quarter at a time by default — the one in progress — with every quarter of the
  // year still one tap away, or all of them stacked the way the KPI sheet does.
  const [pick, setPick] = useState<string>(fqId(CUR_FQ))

  // One cell per PM per quarter, computed once so the table only has to read it.
  const grid = useMemo(() => QUARTERS.map(fq => ({
    fq,
    cells: roster.map<Cell>(pm => {
      const s = stats.get(pm.slug)!
      const q = s.quarter(fq)
      const base = s.baseline(fq)
      const growth = growthPct(q.avg, base)
      return { pm, q, base, raised: base > pm.lastYearAvg, growth, total: totalPct(growth, q.q2c, q.feedback) }
    }),
  })), [stats, roster])

  const shownGrid = pick === 'all' ? grid : grid.filter(g => fqId(g.fq) === pick)
  const segs = [
    ...QUARTERS.map(f => ({ id: fqId(f), label: qLabel(f), count: f.q === CUR_FQ.q ? 'now' : undefined, title: qMonths(f) })),
    { id: 'all', label: 'All quarters', count: QUARTERS.length },
  ]

  return (
    <div>
      <Header
        title={isAdmin ? 'PM Team' : 'My scorecard'}
        chip={`${qLabel(CUR_FQ)} · ${qMonths(CUR_FQ)}`}
        subtitle={isAdmin
          ? 'Quarterly KPI scorecard — growth, quote conversion and client feedback'
          : 'Your quarterly KPI — growth, quote conversion and client feedback'} />

      {roster.length === 0 ? (
        <div className="max-w-lg mt-10">
          <h2 className="text-lg font-semibold mb-2">Nothing to show here</h2>
          <p className="text-sm text-mav-muted">
            This section holds individual PM scorecards. You&rsquo;re signed in as{' '}
            <span className="text-mav-fg">{email}</span>, which isn&rsquo;t on the PM roster, so there is no
            scorecard of your own to show. Ask {OWNER_EMAIL} for admin access if you need to see the team&rsquo;s.
          </p>
        </div>
      ) : (
      <>
      {/* The scoring rules, as cards: what full marks is for each measure and how much it
          weighs. The long explanation of each sits behind its ⓘ. */}
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Growth" value={`${TARGETS.growth}%`} sub={`full marks · ${Math.round(WEIGHTS.growth * 100)}% weight`} info={HOW.growth} />
        <KPICard label="Q2C" value={`${TARGETS.q2c}%`} sub={`full marks · ${Math.round(WEIGHTS.q2c * 100)}% weight`} info={HOW.q2c} />
        <KPICard label="Feedback" value={String(TARGETS.feedback)} sub={`full marks · ${Math.round(WEIGHTS.feedback * 100)}% weight`} info={HOW.feedback} />
        <KPICard label="Total" value={[WEIGHTS.growth, WEIGHTS.q2c, WEIGHTS.feedback].map(w => Math.round(w * 100)).join(' / ')} sub="weighted attainment, capped at 100%" info={HOW.total} />
      </KPIRow>

      <UnplacedNote n={unplaced} noun="quote and feedback rows" className="-mt-3 mb-4" />

      <Segments items={segs} value={pick} onChange={setPick} />

      {loading && <p className="text-sm text-mav-muted mb-4">Loading…</p>}

      {shownGrid.map(({ fq, cells }) => (
        <Panel key={fqId(fq)} flush className="mb-6"
          title={<>{qLabel(fq)} <span className="normal-case tracking-normal">· {qMonths(fq)}</span></>}
          right={fq.q === CUR_FQ.q ? <span className="text-xs text-amber-400">in progress</span> : undefined}>
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse min-w-max">
              <thead>
                <tr className="bg-mav-panel">
                  <th className="sticky left-0 z-20 bg-mav-panel text-left font-medium px-4 py-3 border-b border-r border-mav-line min-w-[160px]">KPI</th>
                  {cells.map(c => (
                    <th key={c.pm.slug} className="px-4 py-3 border-b border-mav-line text-center font-medium min-w-[132px]">
                      <Link href={`/pm-team/${c.pm.slug}`} className="text-mav-yellow hover:underline underline-offset-2">{c.pm.name}</Link>
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
                        <span className="text-mav-muted font-normal ml-1.5 text-xs">{c.q.won}/{c.q.shared}</span>
                      </span>
                    )} />

                <Row label="Feedback" kpi weight={WEIGHTS.feedback} target={String(TARGETS.feedback)} cells={cells}
                  render={c => <span className="tabular-nums font-medium">{c.q.feedback}</span>} />

                <tr className="bg-mav-panel/70">
                  <th className="sticky left-0 z-20 bg-mav-panel text-left font-semibold px-4 py-3 border-t-2 border-r border-mav-line">
                    Total
                    <span className="block text-[11px] text-mav-muted font-normal normal-case tracking-normal">weighted attainment</span>
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
        </Panel>
      ))}
      </>
      )}
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
      <th className={`sticky left-0 z-20 bg-mav-panel text-left px-4 py-2.5 border-r border-mav-line font-normal ${kpi ? 'text-mav-fg' : 'text-mav-muted'}`}>
        {label}
        <span className="block text-[11px] text-mav-muted">
          {kpi ? `${Math.round((weight || 0) * 100)}% weight · full marks at ${target}` : hint}
        </span>
      </th>
      {cells.map(c => <td key={c.pm.slug} className="px-4 py-2.5 text-center">{render(c)}</td>)}
    </tr>
  )
}
