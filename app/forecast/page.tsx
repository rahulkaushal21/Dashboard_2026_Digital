'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, getOpportunities, type BookingRow, type Opportunity } from '@/lib/supabase'
import { buildForecast, churnDrag, type Forecast } from '@/lib/forecast'
import { fmtUsd } from '@/lib/metrics'
import { RefreshCw } from 'lucide-react'

// Kept in step with the target on Business Trend — both read the same figure so the
// two pages can never disagree about what we are chasing.
const FY_TARGET = 3200000

const usdK = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1_000_000).toFixed(2) + 'M'
  return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n) / 1000) + 'k'
}

// Historical win rate by quote size. Used to value the open pipeline on evidence
// rather than on the win% someone typed in — see the Opportunities page for the curve.
const bandRate = (v: number) => (v >= 10000 ? 0.043 : v >= 3000 ? 0.355 : v >= 1000 ? 0.455 : 0.75)

export default function ForecastPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  // Set after mount: computing "today" during render makes the static export's
  // prerendered HTML disagree with the browser.
  const [today, setToday] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [b, o] = await Promise.all([getBookingsFull(), getOpportunities()])
      setBookings(b); setOpps(o); setToday(new Date())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const fc: Forecast | null = useMemo(
    () => (today ? buildForecast(bookings, FY_TARGET, today) : null),
    [bookings, today])
  const drag = useMemo(
    () => (today ? churnDrag(bookings, today) : { clients: 0, perMonth: 0, trailing: 0 }),
    [bookings, today])

  // Open pipeline, nominal and weighted by the historical win rate for its size.
  const pipeline = useMemo(() => {
    const open = opps.filter(o => !o.won && !['lost', 'won'].includes((o.status || '').toLowerCase()) && (o.est_value || 0) > 0)
    const big = open.filter(o => (o.est_value || 0) >= 10000)
    const sum = (xs: Opportunity[]) => xs.reduce((s, o) => s + (o.est_value || 0), 0)
    return {
      nominal: sum(open),
      weighted: open.reduce((s, o) => s + (o.est_value || 0) * bandRate(o.est_value || 0), 0),
      bigCount: big.length,
      bigValue: sum(big),
      bigWeighted: sum(big) * 0.043,
      bigAt30: sum(big) * 0.30,
    }
  }, [opps])

  const futureMonths = fc ? fc.months.filter(m => !m.actual).length : 0
  const maxVal = fc ? Math.max(...fc.months.map(m => m.high), fc.neededPerMonth) : 1

  return (
    <div>
      <Header title="Forecast" subtitle="Where the year lands if nothing changes" />

      <div className="flex flex-wrap items-center gap-3 mb-6 text-xs">
        <span className="text-mav-muted">
          {loading ? 'Reading the revenue history…'
            : fc ? `${fc.fyLabel} · built from ${fc.historyMonths} complete months · recomputed every load`
              : 'Not enough history to forecast'}
        </span>
        <button onClick={load} disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white hover:border-mav-yellow disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Recalculate
        </button>
      </div>

      {!fc ? (
        <div className="bg-mav-panel border border-mav-line rounded-xl p-6">
          <p className="text-sm text-mav-muted">
            {loading ? 'Loading…' : 'A forecast needs at least 12 complete months of revenue. There is not enough history yet — this page will fill in as the data accumulates.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <KPICard label={`${fc.fyLabel} projected`} value={usdK(fc.projected)} />
            <KPICard label="Against target" value={`${fc.pctOfTarget.toFixed(0)}%`} />
            <KPICard label={fc.gap > 0 ? 'Shortfall' : 'Surplus'} value={usdK(Math.abs(fc.gap))} />
            <KPICard label="Booked so far" value={usdK(fc.bookedToDate)} />
          </div>

          {/* ---- the headline sentence, in words ---- */}
          <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
            <p className="text-sm leading-relaxed">
              On {fc.historyMonths} complete months of history, a typical month is currently worth{' '}
              <span className="font-medium tabular-nums">{fmtUsd(Math.round(fc.level))}</span> once seasonal
              shape is removed. Carrying that forward, <span className="font-medium">{fc.fyLabel}</span> lands near{' '}
              <span className="font-medium text-mav-yellow tabular-nums">{usdK(fc.projected)}</span>{' '}
              (likely range {usdK(fc.projectedLow)}–{usdK(fc.projectedHigh)}) against a{' '}
              <span className="tabular-nums">{usdK(fc.target)}</span> target
              {fc.gap > 0 && <> — a shortfall of <span className="font-medium tabular-nums">{usdK(fc.gap)}</span></>}.
            </p>
            {fc.gap > 0 && (
              <p className="text-sm leading-relaxed mt-3 text-mav-muted">
                Hitting the target would need{' '}
                <span className="text-white font-medium tabular-nums">{fmtUsd(Math.round(fc.neededPerMonth))}</span>{' '}
                in each of the {fc.monthsRemaining} full months left, on top of however the month in progress
                closes. The best month in the record is{' '}
                <span className="text-white tabular-nums">{fmtUsd(Math.round(fc.bestMonth.value))}</span> ({fc.bestMonth.label})
                {fc.neededPerMonth > fc.bestMonth.value && <>
                  {' '}— so target requires beating the all-time record by{' '}
                  <span className="text-white font-medium">
                    {Math.round(((fc.neededPerMonth - fc.bestMonth.value) / fc.bestMonth.value) * 100)}%
                  </span>, every month, {fc.monthsRemaining} times running.
                </>}
              </p>
            )}
          </div>

          {/* ---- month by month ---- */}
          <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 mb-4">
              <div className="text-sm font-medium">Month by month</div>
              <div className="text-xs text-mav-muted">
                Bar = forecast · line = pace needed for {usdK(fc.target)}
              </div>
            </div>

            <div className="px-5 pb-2 space-y-1.5">
              {fc.months.map(m => {
                const pct = (m.value / maxVal) * 100
                const lowPct = (Math.max(0, m.low) / maxVal) * 100
                const highPct = (m.high / maxVal) * 100
                const needPct = (fc.neededPerMonth / maxVal) * 100
                return (
                  <div key={m.key} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-mav-muted text-xs tabular-nums">{m.label}</span>
                    <div className="relative flex-1 h-6 bg-mav-dark/60 rounded">
                      {/* uncertainty band */}
                      {!m.actual && (
                        <div className="absolute inset-y-0 bg-mav-yellow/15 rounded"
                          style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }} />
                      )}
                      <div className={`absolute inset-y-0 left-0 rounded ${m.actual ? 'bg-green-500/70' : m.partial ? 'bg-mav-yellow/60' : 'bg-mav-yellow/40'}`}
                        style={{ width: `${pct}%` }} />
                      {fc.neededPerMonth > 0 && !m.actual && (
                        <div className="absolute inset-y-0 w-0.5 bg-red-400" style={{ left: `${needPct}%` }} />
                      )}
                    </div>
                    <span className="w-20 shrink-0 text-right tabular-nums text-xs">{fmtUsd(Math.round(m.value))}</span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-[11px] text-mav-muted hidden sm:inline">
                      {m.actual ? 'actual'
                        : m.partial ? 'part booked'
                          : `${fmtUsd(Math.round(m.low))}–${fmtUsd(Math.round(m.high))}`}
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-[11px] text-mav-muted hidden md:inline"
                      title="Seasonal index — 100 is an average month">
                      {Math.round(m.index)}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="px-5 py-3 text-xs text-mav-muted border-t border-mav-line">
              Green is settled. The last column is the seasonal index: 100 is an average month, so 113 means that
              month historically runs 13% above one.
              {fc.thinSeasonality > 0 && <> {fc.thinSeasonality} of the 12 calendar months rest on a single year of
                observations, so treat the seasonal shape as a reasonable expectation rather than an established pattern.</>}
            </p>
          </div>

          {/* ---- scenarios ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-1">What moves the number</div>
              <p className="text-xs text-mav-muted mb-4">Each row adds to the one above it.</p>
              <ul className="space-y-3">
                <Scenario name="Same situation" value={fc.projected} target={fc.target}
                  note="Churn continues, acquisition keeps replacing it, close rates hold. The base case." />
                {drag.perMonth > 0 && <>
                  <Scenario name="Recover half the quiet accounts"
                    value={fc.projected + drag.perMonth * 0.5 * Math.max(0, futureMonths - 1)} target={fc.target}
                    note={`${drag.clients} accounts have gone quiet worth ${fmtUsd(Math.round(drag.perMonth))}/mo between them. Half of that, from next month.`} />
                  <Scenario name="Stop the leak entirely"
                    value={fc.projected + drag.perMonth * Math.max(0, futureMonths - 1)} target={fc.target}
                    note="Hold every at-risk account. The only lever that does not depend on winning something new." />
                </>}
                {pipeline.bigCount > 0 && (
                  <Scenario name="…and start winning large deals"
                    value={fc.projected + drag.perMonth * Math.max(0, futureMonths - 1) + (pipeline.bigAt30 - pipeline.bigWeighted)}
                    target={fc.target}
                    note={`${pipeline.bigCount} open deals above $10k carry ${fmtUsd(Math.round(pipeline.bigValue))}. At the historical 4% win rate they are worth ${fmtUsd(Math.round(pipeline.bigWeighted))}; at 30% they are worth ${fmtUsd(Math.round(pipeline.bigAt30))}.`} />
                )}
              </ul>
            </div>

            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-4">What the forecast is already absorbing</div>
              <dl className="space-y-4 text-sm">
                <Row label="Revenue gone quiet" value={`${fmtUsd(Math.round(drag.perMonth))}/mo`}
                  note={`${drag.clients} accounts that used to bill regularly and have stopped, worth ${fmtUsd(Math.round(drag.trailing))} across their last twelve active months. The flat line is acquisition replacing this every month, not nothing happening.`} />
                <Row label="Open pipeline, nominal" value={fmtUsd(Math.round(pipeline.nominal))}
                  note={`Worth ${fmtUsd(Math.round(pipeline.weighted))} once each deal is weighted by the historical win rate for its size band.`} />
                <Row label="Underlying monthly level" value={fmtUsd(Math.round(fc.level))}
                  note={`Last six complete months with seasonality removed. Month-to-month variation runs ±${fmtUsd(Math.round(fc.sd))}.`} />
              </dl>
            </div>
          </div>

          <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
            <div className="text-sm font-medium mb-2">What this cannot see</div>
            <p className="text-sm text-mav-muted leading-relaxed">
              The model assumes no structural change. It cannot anticipate winning or losing a major account, and
              a single one moves the year by more than every scenario above. It excludes price and headcount changes,
              and any deal not yet in the Quotes tab. The month in progress is part-booked, so its estimate is the
              least certain figure here and the year total moves with it. The band covers ordinary month-to-month
              fluctuation, not a break in the trend.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Scenario({ name, value, target, note }: { name: string; value: number; target: number; note: string }) {
  const pct = target ? (value / target) * 100 : 0
  return (
    <li className="flex gap-4">
      <div className="w-20 shrink-0">
        <div className="text-base font-semibold tabular-nums leading-tight">{usdK(value)}</div>
        <div className="text-[11px] text-mav-muted tabular-nums">{pct.toFixed(0)}% of target</div>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <p className="text-xs text-mav-muted leading-relaxed mt-0.5">{note}</p>
      </div>
    </li>
  )
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-mav-muted">{label}</dt>
        <dd className="font-medium tabular-nums whitespace-nowrap">{value}</dd>
      </div>
      <p className="text-xs text-mav-muted leading-relaxed mt-1">{note}</p>
    </div>
  )
}
