'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getBookingsFull, getOpportunities, type BookingRow, type Opportunity } from '@/lib/supabase'
import { buildForecast, churnDrag, backtest, type Forecast } from '@/lib/forecast'
import { FY_TARGET } from '@/lib/config'
import { fmtUsd } from '@/lib/metrics'
import { RefreshCw } from 'lucide-react'

const usdK = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? '-' : ''
  if (a >= 1_000_000) return sign + '$' + (a / 1_000_000).toFixed(2) + 'M'
  return sign + '$' + Math.round(a / 1000) + 'k'
}
const pct = (n: number, d = 0) => (n >= 0 ? '+' : '') + n.toFixed(d) + '%'

// Historical win rate by quote size — the curve on the Opportunities page. Used to
// value open pipeline on evidence rather than on the win% someone typed in.
const bandRate = (v: number) => (v >= 10000 ? 0.043 : v >= 3000 ? 0.355 : v >= 1000 ? 0.455 : 0.75)

const Card = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 mb-4">
      <div className="text-sm font-medium">{title}</div>
      {note && <div className="text-xs text-mav-muted">{note}</div>}
    </div>
    {children}
  </div>
)

export default function ForecastPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [showAccounts, setShowAccounts] = useState(false)
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
    () => (today ? buildForecast(bookings, FY_TARGET, today) : null), [bookings, today])
  const drag = useMemo(
    () => (today ? churnDrag(bookings, today) : { clients: 0, perMonth: 0, trailing: 0, accounts: [] }),
    [bookings, today])
  const bt = useMemo(() => (today ? backtest(bookings, today) : null), [bookings, today])

  const pipeline = useMemo(() => {
    const open = opps.filter(o => !o.won && !['lost', 'won'].includes((o.status || '').toLowerCase()) && (o.est_value || 0) > 0)
    const big = open.filter(o => (o.est_value || 0) >= 10000)
    const sum = (xs: Opportunity[]) => xs.reduce((s, o) => s + (o.est_value || 0), 0)
    return {
      count: open.length, nominal: sum(open),
      weighted: open.reduce((s, o) => s + (o.est_value || 0) * bandRate(o.est_value || 0), 0),
      bigCount: big.length, bigValue: sum(big),
      bigWeighted: sum(big) * 0.043, bigAt30: sum(big) * 0.30,
    }
  }, [opps])

  const futureMonths = fc ? fc.months.filter(m => !m.actual).length : 0
  // Months the scenarios can still act on — next month onward, not the one in progress.
  const actionable = Math.max(0, futureMonths - 1)

  return (
    <div>
      <Header title="Forecast" subtitle="Where the year lands if nothing changes" />

      <div className="flex flex-wrap items-center gap-3 mb-6 text-xs">
        <span className="text-mav-muted">
          {loading ? 'Reading the revenue history…'
            : fc ? `${fc.fyLabel} · built from ${fc.historyMonths} complete months · recomputed every load, never stored`
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
            {loading ? 'Loading…' : 'A forecast needs at least 12 complete months of revenue. There is not enough history yet — this page fills in as the data accumulates.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <KPICard label={`${fc.fyLabel} projected`} value={usdK(fc.projected)} />
            <KPICard label="Against target" value={`${fc.pctOfTarget.toFixed(0)}%`} />
            <KPICard label={fc.gap > 0 ? 'Shortfall' : 'Surplus'} value={usdK(Math.abs(fc.gap))} />
            <KPICard label="Needed / full month left" value={usdK(fc.neededPerMonth)} />
          </div>

          {/* ---------------- headline ---------------- */}
          <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
            <p className="text-sm leading-relaxed">
              Across {fc.historyMonths} complete months, a typical month is currently worth{' '}
              <span className="font-medium tabular-nums">{fmtUsd(Math.round(fc.level))}</span> once seasonal shape is
              removed. Carried forward, <span className="font-medium">{fc.fyLabel}</span> lands near{' '}
              <span className="font-medium text-mav-yellow tabular-nums">{usdK(fc.projected)}</span>{' '}
              (likely {usdK(fc.projectedLow)}–{usdK(fc.projectedHigh)}) against a{' '}
              <span className="tabular-nums">{usdK(fc.target)}</span> target
              {fc.gap > 0 && <> — short by <span className="font-medium tabular-nums">{usdK(fc.gap)}</span></>}.
            </p>
            {fc.gap > 0 && fc.monthsRemaining > 0 && (
              <p className="text-sm leading-relaxed mt-3 text-mav-muted">
                Reaching target needs{' '}
                <span className="text-white font-medium tabular-nums">{fmtUsd(Math.round(fc.neededPerMonth))}</span>{' '}
                in each of the {fc.monthsRemaining} full months left, on top of however the month in progress closes.
                The best month on record is{' '}
                <span className="text-white tabular-nums">{fmtUsd(Math.round(fc.bestMonth.value))}</span> ({fc.bestMonth.label})
                {fc.neededPerMonth > fc.bestMonth.value && <>
                  {' '}— so target means beating the all-time record by{' '}
                  <span className="text-white font-medium">
                    {Math.round(((fc.neededPerMonth - fc.bestMonth.value) / fc.bestMonth.value) * 100)}%
                  </span>, every month, {fc.monthsRemaining} times running.
                </>}
              </p>
            )}
          </div>

          {/* ---------------- history + forecast chart ---------------- */}
          <Card title="The line so far, and where it goes"
            note={`${fc.historyMonths} months actual · ${futureMonths} forecast`}>
            <div className="px-5 pb-5">
              <TrendChart fc={fc} />
            </div>
          </Card>

          {/* ---------------- why it's flat ---------------- */}
          <Card title="Why it lands there" note="Flat is not idle">
            <div className="px-5 pb-5 space-y-3 text-sm leading-relaxed max-w-3xl">
              <p>
                The last six complete months averaged{' '}
                <span className="font-medium tabular-nums">{fmtUsd(Math.round(fc.drift.recent))}</span> against{' '}
                <span className="tabular-nums">{fmtUsd(Math.round(fc.drift.prior))}</span> in the six before —{' '}
                <span className={`font-medium ${Math.abs(fc.drift.pct) < 5 ? 'text-amber-300' : fc.drift.pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pct(fc.drift.pct, 1)}
                </span>. Monthly revenue has stayed inside a narrow band for well over a year.
              </p>
              {drag.perMonth > 0 && (
                <>
                  <p className="text-mav-muted">
                    That is not because nothing is happening. <span className="text-white">{drag.clients} accounts</span> that
                    used to bill regularly have gone quiet, and at their own historical rate they were worth{' '}
                    <span className="text-white font-medium tabular-nums">{fmtUsd(Math.round(drag.perMonth))} a month</span>{' '}
                    between them. That revenue is gone — yet the monthly total has not fallen.
                  </p>
                  <p className="text-mav-muted">
                    Something is replacing roughly {fmtUsd(Math.round(drag.perMonth))} of run-rate every month and landing
                    almost exactly where the losses left off. That equilibrium is what produces a flat line. The acquisition
                    work is real; it is being spent standing still.{' '}
                    <span className="text-white">Growth needs acquisition to exceed replacement, or churn to fall below it.</span>
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* ---------------- month by month ---------------- */}
          <Card title="Month by month" note={`Bar = forecast · red line = ${usdK(fc.neededPerMonth)} pace needed for ${usdK(fc.target)}`}>
            <MonthTable fc={fc} />
            <p className="px-5 py-3 text-xs text-mav-muted border-t border-mav-line leading-relaxed">
              Green is settled. <span className="text-mav-muted">Index</span> is the seasonal index: 100 is an average
              month, so 113 means that month historically runs 13% above one.
              {fc.thinSeasonality > 0 && <> {fc.thinSeasonality} of the 12 calendar months rest on a single year of
                observations, so treat the seasonal shape as a reasonable expectation, not an established pattern.</>}
            </p>
          </Card>

          {/* ---------------- scenarios ---------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-1">What moves the number</div>
              <p className="text-xs text-mav-muted mb-4">Each row adds to the one above it, applied from next month.</p>
              <ul className="space-y-3.5">
                <Scenario name="Same situation" value={fc.projected} target={fc.target}
                  note="Churn continues, acquisition keeps replacing it, close rates hold. The base case, and on the evidence the most likely one." />
                {drag.perMonth > 0 && <>
                  <Scenario name="Recover half the quiet accounts"
                    value={fc.projected + drag.perMonth * 0.5 * actionable} target={fc.target}
                    note={`Worth ${usdK(drag.perMonth * 0.5 * actionable)} over ${actionable} months. The cheapest money here — these clients already bought, already know us, and left without complaining.`} />
                  <Scenario name="Stop the leak entirely"
                    value={fc.projected + drag.perMonth * actionable} target={fc.target}
                    note={`Worth ${usdK(drag.perMonth * actionable)}. The only lever that does not depend on winning anything new.`} />
                </>}
                {pipeline.bigCount > 0 && (
                  <Scenario name="…and start winning large deals"
                    value={fc.projected + drag.perMonth * actionable + (pipeline.bigAt30 - pipeline.bigWeighted)}
                    target={fc.target}
                    note={`${pipeline.bigCount} open deals above $10k carry ${fmtUsd(Math.round(pipeline.bigValue))}. At the historical 4% win rate that is worth ${fmtUsd(Math.round(pipeline.bigWeighted))}; at 30% it is ${fmtUsd(Math.round(pipeline.bigAt30))}. Real — but note it adds less than retention does.`} />
                )}
              </ul>
            </div>

            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-4">What the forecast already absorbs</div>
              <dl className="space-y-4 text-sm">
                <Row label="Revenue gone quiet" value={`${fmtUsd(Math.round(drag.perMonth))}/mo`}
                  note={`${drag.clients} accounts that used to bill regularly and have stopped, worth ${fmtUsd(Math.round(drag.trailing))} across their last twelve active months.`} />
                <Row label="Open pipeline, nominal" value={fmtUsd(Math.round(pipeline.nominal))}
                  note={`${pipeline.count} deals. Worth ${fmtUsd(Math.round(pipeline.weighted))} once each is weighted by the historical win rate for its size band — barely a third of face value.`} />
                <Row label="Underlying monthly level" value={fmtUsd(Math.round(fc.level))}
                  note={`Last six complete months with seasonality stripped out. Ordinary month-to-month variation runs ±${fmtUsd(Math.round(fc.sd))}.`} />
              </dl>
              {drag.accounts.length > 0 && (
                <div className="mt-4 pt-4 border-t border-mav-line">
                  <button onClick={() => setShowAccounts(v => !v)} className="text-xs text-mav-yellow hover:underline">
                    {showAccounts ? 'Hide the quiet accounts' : `Show the ${drag.accounts.length} quiet accounts`}
                  </button>
                  {showAccounts && (
                    <ul className="mt-3 space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {drag.accounts.map(a => (
                        <li key={a.name} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate">{a.name}</span>
                          <span className="shrink-0 text-mav-muted tabular-nums">
                            {fmtUsd(Math.round(a.perMonth))}/mo · quiet {a.silentFor}mo · last {a.lastMonth}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---------------- seasonal profile ---------------- */}
          <Card title="Seasonal shape" note="100 = an average month">
            <div className="px-5 pb-5">
              <div className="flex items-end gap-1.5 h-32">
                {fc.seasonal.map(s => {
                  const h = Math.max(4, ((s.index - 70) / 50) * 100)
                  return (
                    <div key={s.month} className="flex-1 flex flex-col items-center gap-1.5" title={`${s.label}: index ${s.index.toFixed(0)} from ${s.years} year${s.years === 1 ? '' : 's'}`}>
                      <span className="text-[10px] text-mav-muted tabular-nums">{s.index.toFixed(0)}</span>
                      <div className={`w-full rounded-t ${s.index >= 100 ? 'bg-mav-yellow/70' : 'bg-mav-yellow/25'} ${s.years <= 1 ? 'opacity-60' : ''}`}
                        style={{ height: `${h}%` }} />
                      <span className="text-[10px] text-mav-muted">{s.label}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-mav-muted mt-4 leading-relaxed max-w-3xl">
                Faded bars rest on a single year of data. A March peak and a January trough fit a client base weighted to
                the UK and Australia, where the financial year ends in March — but with this much history that is a
                plausible explanation, not a proven one.
              </p>
            </div>
          </Card>

          {/* ---------------- backtest ---------------- */}
          {bt && (
            <Card title="How accurate has this been?" note={`Walk-forward test over the last ${bt.folds} months`}>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
                  <Stat label="Average miss" value={`${bt.mape.toFixed(1)}%`}
                    note="Typical absolute error on a single month" />
                  <Stat label="Bias" value={pct(bt.bias, 1)}
                    note={Math.abs(bt.bias) < 3 ? 'Essentially unbiased' : bt.bias > 0 ? 'Runs optimistic' : 'Runs pessimistic'} />
                  <Stat label="Worst miss" value={pct(bt.worst.errPct, 0)} note={bt.worst.label} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead className="text-left text-mav-muted border-b border-mav-line">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Month</th>
                        <th className="py-2 px-4 font-medium text-right">Predicted</th>
                        <th className="py-2 px-4 font-medium text-right">Actual</th>
                        <th className="py-2 pl-4 font-medium text-right">Miss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bt.results.map(r => (
                        <tr key={r.key} className="border-b border-mav-line/60">
                          <td className="py-2 pr-4">{r.label}</td>
                          <td className="py-2 px-4 text-right tabular-nums text-mav-muted">{fmtUsd(Math.round(r.predicted))}</td>
                          <td className="py-2 px-4 text-right tabular-nums">{fmtUsd(Math.round(r.actual))}</td>
                          <td className={`py-2 pl-4 text-right tabular-nums font-medium ${Math.abs(r.errPct) > 15 ? 'text-red-400' : Math.abs(r.errPct) > 8 ? 'text-amber-300' : 'text-green-400'}`}>
                            {pct(r.errPct, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-mav-muted mt-4 leading-relaxed max-w-3xl">
                  Each month was predicted using only the months before it — the model never saw the answer. It misses a
                  single month by about {bt.mape.toFixed(0)}% on average, but the errors run in both directions
                  ({pct(bt.bias, 1)} bias overall), so they largely cancel across a full year. That is why the annual figure
                  deserves more confidence than any one month on it.
                </p>
              </div>
            </Card>
          )}

          {/* ---------------- method + caveats ---------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-3">How this is calculated</div>
              <ol className="space-y-2 text-sm text-mav-muted list-decimal pl-4 leading-relaxed">
                <li>Roll revenue to complete calendar months. The month in progress is never used to fit anything, because revenue books to the month and today&apos;s month is always short.</li>
                <li>Build a seasonal index per calendar month — that month&apos;s average against the all-month average.</li>
                <li>Divide each of the last six complete months by its own index and average them. That is the underlying level: <span className="text-white tabular-nums">{fmtUsd(Math.round(fc.level))}</span>.</li>
                <li>Forecast each remaining month as level × its index.</li>
                <li>Band it by the historical standard deviation of monthly revenue (<span className="text-white tabular-nums">{fmtUsd(Math.round(fc.sd))}</span>).</li>
              </ol>
              <p className="text-xs text-mav-muted mt-3 leading-relaxed">
                Nothing here is stored. A forecast that stops updating keeps sounding confident while the ground moves,
                so every figure is recomputed from <span className="text-white">web_revenue</span> on each load.
              </p>
            </div>

            <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
              <div className="text-sm font-medium mb-3">What this cannot see</div>
              <ul className="space-y-2 text-sm text-mav-muted leading-relaxed">
                <li>• <span className="text-white">Structural change.</span> Winning or losing one major account moves the year by more than every scenario above combined.</li>
                <li>• <span className="text-white">The month in progress</span> is part-booked, so its estimate is the least certain figure here and the year total moves with it.</li>
                <li>• <span className="text-white">Price and headcount changes</span>, and any deal not yet in the Quotes tab.</li>
                <li>• <span className="text-white">The band</span> covers ordinary fluctuation, not a break in the trend.</li>
                <li>• <span className="text-white">The target itself.</span> {usdK(fc.target)} is taken as given from Business Trend; nothing here judges whether it was the right number when it was set.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ chart --- */
function TrendChart({ fc }: { fc: Forecast }) {
  const W = 900, H = 260, PADL = 52, PADR = 12, PADT = 14, PADB = 26
  const hist = fc.history
  const fut = fc.months.filter(m => !m.actual)
  const pts = [...hist.map(h => ({ ...h, kind: 'a' as const })), ...fut.map(f => ({ key: f.key, label: f.label, value: f.value, kind: 'f' as const }))]
  if (pts.length < 2) return null

  const hi = Math.max(...pts.map(p => p.value), ...fut.map(f => f.high), fc.neededPerMonth) * 1.08
  const x = (i: number) => PADL + (i * (W - PADL - PADR)) / (pts.length - 1)
  const y = (v: number) => PADT + (1 - v / hi) * (H - PADT - PADB)

  const histPath = hist.map((h, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(h.value)}`).join(' ')
  const ji = hist.length - 1
  const futPath = [`M ${x(ji)} ${y(hist[ji].value)}`, ...fut.map((f, i) => `L ${x(ji + 1 + i)} ${y(f.value)}`)].join(' ')
  const bandPath = fut.length
    ? `M ${x(ji)} ${y(hist[ji].value)} ` +
      fut.map((f, i) => `L ${x(ji + 1 + i)} ${y(f.high)}`).join(' ') + ' ' +
      [...fut].reverse().map((f, i) => `L ${x(pts.length - 1 - i)} ${y(Math.max(0, f.low))}`).join(' ') + ' Z'
    : ''

  const ticks = [0, 100000, 200000, 300000].filter(t => t <= hi)
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px]" role="img"
        aria-label={`Monthly revenue, ${hist.length} actual months followed by ${fut.length} forecast months, against the pace needed for the target`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PADL} y1={y(t)} x2={W - PADR} y2={y(t)} stroke="#333333" strokeWidth="1" />
            <text x={PADL - 8} y={y(t) + 3} fontSize="10" fill="#9a9a9a" textAnchor="end" className="tabular-nums">
              {t === 0 ? '$0' : `$${t / 1000}k`}
            </text>
          </g>
        ))}
        {bandPath && <path d={bandPath} fill="#FFDB2D" opacity="0.10" />}
        {fc.neededPerMonth > 0 && fc.neededPerMonth < hi && (
          <>
            <line x1={x(ji)} y1={y(fc.neededPerMonth)} x2={W - PADR} y2={y(fc.neededPerMonth)}
              stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={W - PADR} y={y(fc.neededPerMonth) - 6} fontSize="10" fill="#f87171" textAnchor="end">
              {usdK(fc.neededPerMonth)}/mo needed
            </text>
          </>
        )}
        <path d={histPath} fill="none" stroke="#4ade80" strokeWidth="2" strokeLinejoin="round" />
        <path d={futPath} fill="none" stroke="#FFDB2D" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
        <line x1={x(ji)} y1={PADT} x2={x(ji)} y2={H - PADB} stroke="#555" strokeWidth="1" strokeDasharray="2 3" />
        {pts.map((p, i) =>
          i % 3 === 0 || i === pts.length - 1 ? (
            <text key={p.key} x={x(i)} y={H - 8} fontSize="9" fill="#9a9a9a" textAnchor="middle">{p.label}</text>
          ) : null)}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-mav-muted mt-2">
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-0.5 bg-green-400 inline-block" /> Actual</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-0.5 bg-mav-yellow inline-block" /> Forecast</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-2 bg-mav-yellow/20 inline-block rounded-sm" /> Likely range</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-0.5 bg-red-400 inline-block" /> Pace needed for target</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- month table --- */
function MonthTable({ fc }: { fc: Forecast }) {
  const max = Math.max(...fc.months.map(m => m.high), fc.neededPerMonth)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="text-left text-mav-muted border-b border-mav-line">
          <tr>
            <th className="px-5 py-2.5 font-medium">Month</th>
            <th className="px-3 py-2.5 font-medium text-right">Index</th>
            <th className="px-3 py-2.5 font-medium w-1/3">Shape</th>
            <th className="px-3 py-2.5 font-medium text-right">Forecast</th>
            <th className="px-5 py-2.5 font-medium text-right">Range</th>
          </tr>
        </thead>
        <tbody>
          {fc.months.map(m => (
            <tr key={m.key} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
              <td className="px-5 py-2.5 whitespace-nowrap">
                {m.label}
                {m.actual && <span className="ml-2 text-[10px] text-green-400 uppercase tracking-wide">actual</span>}
                {m.partial && <span className="ml-2 text-[10px] text-amber-300 uppercase tracking-wide">part booked</span>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-mav-muted">{Math.round(m.index)}</td>
              <td className="px-3 py-2.5">
                <div className="relative h-4 bg-mav-dark/60 rounded">
                  {!m.actual && (
                    <div className="absolute inset-y-0 bg-mav-yellow/15 rounded"
                      style={{ left: `${(Math.max(0, m.low) / max) * 100}%`, width: `${Math.max(0, ((m.high - Math.max(0, m.low)) / max) * 100)}%` }} />
                  )}
                  <div className={`absolute inset-y-0 left-0 rounded ${m.actual ? 'bg-green-500/70' : m.partial ? 'bg-mav-yellow/60' : 'bg-mav-yellow/40'}`}
                    style={{ width: `${(m.value / max) * 100}%` }} />
                  {!m.actual && fc.neededPerMonth > 0 && (
                    <div className="absolute inset-y-0 w-0.5 bg-red-400" style={{ left: `${(fc.neededPerMonth / max) * 100}%` }} />
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{fmtUsd(Math.round(m.value))}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-xs text-mav-muted whitespace-nowrap">
                {m.actual ? '—' : `${fmtUsd(Math.round(Math.max(0, m.low)))} – ${fmtUsd(Math.round(m.high))}`}
              </td>
            </tr>
          ))}
          <tr className="bg-mav-dark/30">
            <td className="px-5 py-3 font-semibold">{fc.fyLabel} total</td>
            <td /><td />
            <td className="px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap">{usdK(fc.projected)}</td>
            <td className="px-5 py-3 text-right text-xs text-mav-muted tabular-nums whitespace-nowrap">
              {usdK(fc.projectedLow)} – {usdK(fc.projectedHigh)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ bits --- */
function Scenario({ name, value, target, note }: { name: string; value: number; target: number; note: string }) {
  const p = target ? (value / target) * 100 : 0
  return (
    <li className="flex gap-4">
      <div className="w-20 shrink-0">
        <div className="text-base font-semibold tabular-nums leading-tight">{usdK(value)}</div>
        <div className="text-[11px] text-mav-muted tabular-nums">{p.toFixed(0)}% of target</div>
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

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-mav-dark/50 border border-mav-line rounded-lg p-3">
      <div className="text-xs text-mav-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
      <div className="text-[11px] text-mav-muted mt-0.5 leading-snug">{note}</div>
    </div>
  )
}
