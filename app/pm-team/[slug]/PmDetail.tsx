'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, getOpportunities, getQuotes, getPmFeedback, type BookingRow, type Opportunity, type Quote, type PmFeedbackRow } from '@/lib/supabase'
import { buildPmStats, growthPct, pendingOpps, oppDate, isNewDev } from '@/lib/pm-metrics'
import {
  pmBySlug, fqOf, qLabel, decQ, scoreOf, overallScore, bandOf,
  GROWTH_BANDS, Q2C_BANDS, FEEDBACK_BANDS, WEIGHTS, THIN_Q2C, type FQ,
} from '@/lib/pm-team'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mLabel = (k: string) => { const [y, m] = k.split('-'); return `${SHORT[Number(m)]} '${y.slice(2)}` }
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)
const QUARTERS: FQ[] = (() => { const out: FQ[] = [CUR_FQ]; for (let i = 0; i < 6; i++) out.unshift(decQ(out[0])); return out })()
const DEFAULT_I = Math.max(0, QUARTERS.findIndex(f => f.fy === CUR_FQ.fy && f.q === 1))

export default function PmDetail({ slug }: { slug: string }) {
  const pm = pmBySlug(slug)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [fb, setFb] = useState<PmFeedbackRow[]>([])
  const [qi, setQi] = useState(DEFAULT_I)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback()])
      .then(([b, o, qs, f]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f) })
  }, [])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb), [bookings, opps, quotes, fb])
  const s = pm ? stats.get(pm.slug) : undefined
  const fq = QUARTERS[qi]

  // Month-over-month bookings, every month from the first with data to now, so a
  // zero month shows as a gap rather than silently closing up.
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

  const q = s?.quarter(fq)
  const base = s ? s.baseline(fq) : 0
  const raised = !!pm && base > pm.lastYearAvg
  const growth = q ? growthPct(q.avg, base) : null
  const score = q ? overallScore(growth, q.q2c, q.feedback) : null
  const pending = useMemo(() => (s ? pendingOpps(s.opps, NOW) : { rows: [], toppedUp: 0 }), [s])

  if (!pm) return <div><Header title="PM not found" /><Link href="/pm-team" className="text-mav-yellow text-sm">← PM Team</Link></div>

  const peak = Math.max(1, ...months.map(x => x.v))
  const decided = (q?.won || 0) + (q?.lost || 0)

  return (
    <div>
      <Link href="/pm-team" className="inline-flex items-center gap-1 text-sm text-mav-muted hover:text-white mb-3"><ArrowLeft size={14} /> PM Team</Link>
      <Header title={pm.name} subtitle={`Project manager · ${qLabel(fq)} scorecard`} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">Quarter</span>
        <select value={qi} onChange={e => setQi(Number(e.target.value))} className={selCls}>
          {QUARTERS.map((f, i) => <option key={i} value={i}>{qLabel(f)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label={`Booked · ${qLabel(fq)}`} value={money(q?.booked || 0)} />
        <KPICard label="Avg / month" value={money(q?.avg || 0)} />
        <KPICard label="Growth vs base" value={growth == null ? '—' : `${growth >= 0 ? '+' : '−'}${Math.abs(growth).toFixed(1)}%`} />
        <KPICard label="KPI score" value={score == null ? '—' : `${score.toFixed(1)} / 10`} />
      </div>

      {/* ---- KPI breakdown ---------------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl p-4 mb-6">
        <h2 className="font-medium mb-3">Quarterly KPI breakdown</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>{['Measure', 'Value', 'Band', 'Score', 'Weight', 'Weighted'].map(h => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            <KpiRow label={`Growth (${money(q?.avg || 0)}/mo vs ${money(base)})`} value={growth == null ? '—' : `${growth.toFixed(1)}%`} raw={growth} bands={GROWTH_BANDS} weight={WEIGHTS.growth} />
            <KpiRow label="Q2C (new development)" value={q?.q2c == null ? '—' : `${q.q2c.toFixed(0)}% (${q?.won}/${decided})`} raw={q?.q2c ?? null} bands={Q2C_BANDS} weight={WEIGHTS.q2c} />
            <KpiRow label="Feedbacks" value={String(q?.feedback ?? 0)} raw={q?.feedback ?? null} bands={FEEDBACK_BANDS} weight={WEIGHTS.feedback} />
          </tbody>
          <tfoot>
            <tr className="border-t border-mav-line"><td className="py-2 font-medium" colSpan={5}>Overall</td>
              <td className="py-2 text-right tabular-nums font-medium">{score == null ? '—' : score.toFixed(2)}</td></tr>
          </tfoot>
        </table>

        <p className="text-xs text-mav-muted mt-3">
          Base <span className="tabular-nums text-white">{money(base)}</span> per month
          {raised
            ? <> — <span className="text-mav-yellow">raised</span> from a last-year average of {money(pm.lastYearAvg)}, because {pm.name.split(' ')[0]} already cleared that bar earlier this financial year. The higher figure is the bar from here.</>
            : <> — the last-year monthly average, still standing because it has not been beaten this financial year yet.</>}
          {' '}Growth compares it to the quarter&rsquo;s own per-month average, over {q?.monthsElapsed ?? 0} month(s) of data.
        </p>
        {decided > 0 && decided < THIN_Q2C && (
          <p className="text-xs text-amber-400 mt-2">Q2C rests on {decided} decided quote{decided === 1 ? '' : 's'} — one deal moves it by {(100 / decided).toFixed(0)} points.</p>
        )}
        {q?.feedback === 0 && (
          <p className="text-xs text-amber-400 mt-2">No feedback recorded in this quarter. Zero is a real count, so it scores 3 under the “2 or below” band — worth checking it is genuinely none rather than none captured.</p>
        )}
      </section>

      {/* ---- Month over month bookings ---------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl p-4 mb-6">
        <h2 className="font-medium mb-3">Month-over-month bookings (USD)</h2>
        {months.length === 0 ? <p className="text-sm text-mav-muted">No bookings recorded.</p> : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-[640px] h-40">
              {months.map(({ k, v }, i) => {
                const prev = i > 0 ? months[i - 1].v : null
                const up = prev != null && v >= prev
                return (
                  <div key={k} className="flex-1 flex flex-col items-center justify-end gap-1 group">
                    <span className="text-[10px] tabular-nums text-mav-muted opacity-0 group-hover:opacity-100">{money(v)}</span>
                    <div className={`w-full rounded-t ${v === 0 ? 'bg-mav-line' : up ? 'bg-mav-yellow' : 'bg-mav-yellow/45'}`}
                      style={{ height: `${Math.max(2, (v / peak) * 100)}%` }} title={`${mLabel(k)} — ${money(v)}`} />
                    <span className="text-[10px] text-mav-muted whitespace-nowrap">{mLabel(k)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-mav-muted mt-2">
          Solid bars are months up on the one before; faded bars are down. Hover for the figure.
          Apr–Jun 2026 is locked to the revenue sheet&rsquo;s pivot, the agreed final figure for that quarter.
        </p>
      </section>

      {/* ---- Pending opportunities -------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="p-4 pb-3">
          <h2 className="font-medium">Open opportunities</h2>
          <p className="text-xs text-mav-muted mt-1">
            Raised this month and still open.
            {pending.toppedUp > 0 && ` It is early in the month, so the ${pending.toppedUp} most recent open deals from previous months are included.`}
          </p>
        </div>
        {pending.rows.length === 0 ? <p className="px-4 pb-4 text-sm text-mav-muted">Nothing open.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left text-mav-muted border-y border-mav-line">
                <tr>{['Date', 'Client', 'Subject', 'Value', 'Type', 'Source', 'Status'].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {pending.rows.map(o => (
                  <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{oppDate(o).slice(0, 10)}</td>
                    <td className="px-4 py-3">{o.company_name}</td>
                    <td className="px-4 py-3 text-mav-muted max-w-[280px] truncate" title={o.source_subject}>{o.source_subject}</td>
                    <td className="px-4 py-3 tabular-nums">{o.est_value ? money(o.est_value) : <span className="text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{isNewDev(o) ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">New dev</span> : <span className="text-mav-muted text-xs">Repeat</span>}</td>
                    <td className="px-4 py-3 text-mav-muted text-xs">{o.origin}</td>
                    <td className="px-4 py-3 text-mav-muted">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Quotes shared in the quarter -------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl p-4">
        <h2 className="font-medium mb-1">New-development quotes · {qLabel(fq)}</h2>
        <p className="text-xs text-mav-muted mb-3">Quotes-tab rows whose Project Type (col I) is New Development, owned by this PC/SME (col H). Q2C is Confirmed ÷ decided; still-open quotes are excluded from the denominator.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Raised" v={q?.shared ?? 0} />
          <Stat label="Confirmed" v={q?.won ?? 0} />
          <Stat label="Cancelled" v={q?.lost ?? 0} />
          <Stat label="Still open" v={q?.open ?? 0} />
        </div>
      </section>
    </div>
  )
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="bg-mav-dark/50 border border-mav-line rounded-lg px-3 py-2">
      <div className="text-xs text-mav-muted">{label}</div>
      <div className="text-lg tabular-nums mt-0.5">{v}</div>
    </div>
  )
}

function KpiRow({ label, value, raw, bands, weight }: { label: string; value: string; raw: number | null; bands: typeof GROWTH_BANDS; weight: number }) {
  const band = bandOf(bands, raw)
  const sc = scoreOf(bands, raw)
  return (
    <tr className="border-b border-mav-line/40">
      <td className="py-2 pr-3">{label}</td>
      <td className="py-2 pr-3 tabular-nums">{value}</td>
      <td className="py-2 pr-3 text-mav-muted">{band?.label || '—'}</td>
      <td className="py-2 pr-3 tabular-nums">{sc ?? '—'}</td>
      <td className="py-2 pr-3 text-mav-muted tabular-nums">{Math.round(weight * 100)}%</td>
      <td className="py-2 text-right tabular-nums">{sc == null ? '—' : (sc * weight).toFixed(2)}</td>
    </tr>
  )
}
