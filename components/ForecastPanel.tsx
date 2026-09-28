'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import InfoTip from '@/components/InfoTip'
import { KPIRow, Panel } from '@/components/PageParts'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit, unitLabel } from '@/lib/business-unit'
import { useThemeInk } from '@/lib/use-theme-ink'
import { getBookingsFull, getOpportunities, getOpportunityDepts, type BookingRow, type Opportunity } from '@/lib/supabase'
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

// The forecast, as a panel.
//
// It lives here rather than in app/forecast so Business Trend can show it as a tab. The
// two were separate pages answering the same question from opposite ends — what the year
// is pacing at, and what it will land at — and reading one without the other is how the
// same month got two different explanations in the same week.
//
// `embedded` drops its own page header when it is a tab under Business Trend's.
export default function ForecastPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [bookingsAll, setBookings] = useState<BookingRow[]>([])
  const [oppsAll, setOpps] = useState<Opportunity[]>([])
  const [oppDepts, setOppDepts] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [showAccounts, setShowAccounts] = useState(false)
  // Set after mount: computing "today" during render makes the static export's
  // prerendered HTML disagree with the browser.
  const [today, setToday] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [b, o, od] = await Promise.all([getBookingsFull(), getOpportunities(), getOpportunityDepts()])
      setBookings(b); setOpps(o); setOppDepts(od); setToday(new Date())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source, the way Business Trend's own tab is: revenue lines by their
  // service department, open deals by opportunity_dept_mv (the PM's pod, then the
  // client's history, then geo). Everything below — the fit, the churn drag, the
  // backtest, the pipeline — is then that unit's, not the company's.
  const { unit } = useUnit()
  const bookings = useMemo(() => bookingsAll.filter(b => inUnit(b.service_name, unit)), [bookingsAll, unit])
  const opps = useMemo(() => oppsAll.filter(o => inUnit(oppDepts.get(Number(o.id)), unit)), [oppsAll, oppDepts, unit])

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

  const recalc = (
    <button onClick={load} disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs disabled:opacity-50">
      <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Recalculate
    </button>
  )

  // The method and its blind spots, one hover away. They matter when a figure is
  // questioned, not on every read.
  const method = fc && (
    <>
      <ol className="space-y-1.5 list-decimal pl-4">
        <li>Roll revenue to complete calendar months. The month in progress is never used to fit anything, because revenue books to the month and today&apos;s month is always short.</li>
        <li>Build a seasonal index per calendar month — that month&apos;s average against the all-month average.</li>
        <li>Divide each of the last six complete months by its own index and average them. That is the underlying level: <span className="font-semibold tabular-nums">{fmtUsd(Math.round(fc.level))}</span>.</li>
        <li>Forecast each remaining month as level × its index.</li>
        <li>Band it by the historical standard deviation of monthly revenue (<span className="font-semibold tabular-nums">{fmtUsd(Math.round(fc.sd))}</span>).</li>
      </ol>
      <p className="mt-2">Nothing here is stored. A forecast that stops updating keeps sounding confident while the ground moves, so every figure is recomputed from <span className="font-semibold">web_revenue</span> on each load.</p>
    </>
  )
  const blind = fc && (
    <ul className="space-y-1.5">
      <li>• <span className="font-semibold">Structural change.</span> Winning or losing one major account moves the year by more than every scenario above combined.</li>
      <li>• <span className="font-semibold">The month in progress</span> is part-booked, so its estimate is the least certain figure here and the year total moves with it.</li>
      <li>• <span className="font-semibold">Price and headcount changes</span>, and any deal not yet in the Quotes tab.</li>
      <li>• <span className="font-semibold">The band</span> covers ordinary fluctuation, not a break in the trend.</li>
      <li>• <span className="font-semibold">The target itself.</span> {usdK(fc.target)} is taken as given from Business Trend; nothing here judges whether it was the right number when it was set.</li>
    </ul>
  )

  return (
    <div>
      {!embedded && <Header title="Forecast" subtitle="Where the year lands if nothing changes"
        chip={fc?.fyLabel} actions={recalc} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">
        <span>
          {loading ? 'Reading the revenue history…'
            : fc ? `${fc.fyLabel} · built from ${fc.historyMonths} complete months · recomputed every load, never stored`
              : 'Not enough history to forecast'}
        </span>
        {method && <span className="inline-flex items-center gap-1.5">How it&apos;s calculated <InfoTip text={method} /></span>}
        {blind && <span className="inline-flex items-center gap-1.5">What it cannot see <InfoTip text={blind} align="right" /></span>}
        {embedded && <span className="ml-auto normal-case tracking-normal font-sans">{recalc}</span>}
      </div>
      {fc && unit !== 'all' && (
        <p className="-mt-2 mb-4 text-[11px] text-mav-muted">
          {unitLabel(unit)} revenue only, measured against the company-wide {usdK(fc.target)} target — there is no per-unit target.
        </p>
      )}

      {!fc ? (
        <Panel>
          <p className="text-sm text-mav-muted">
            {loading ? 'Loading…' : 'A forecast needs at least 12 complete months of revenue. There is not enough history yet — this page fills in as the data accumulates.'}
          </p>
        </Panel>
      ) : (
        <>
          {/* The headline sentence used to sit in its own box under these cards; its
              figures are on the cards now and the sentence itself is behind their ⓘ. */}
          <KPIRow cols={4}>
            <KPICard tone="accent" label={`${fc.fyLabel} projected`} value={usdK(fc.projected)}
              sub={`likely ${usdK(fc.projectedLow)}–${usdK(fc.projectedHigh)}`}
              info={<>Across {fc.historyMonths} complete months, a typical month is currently worth {fmtUsd(Math.round(fc.level))} once seasonal shape is removed. Carried forward, {fc.fyLabel} lands near {usdK(fc.projected)} (likely {usdK(fc.projectedLow)}–{usdK(fc.projectedHigh)}) against a {usdK(fc.target)} target{fc.gap > 0 && <> — short by {usdK(fc.gap)}</>}.</>} />
            <KPICard tone={fc.pctOfTarget >= 100 ? 'green' : 'amber'} label="Against target" value={`${fc.pctOfTarget.toFixed(0)}%`}
              sub={`of ${usdK(fc.target)}`} />
            <KPICard tone={fc.gap > 0 ? 'red' : 'green'} label={fc.gap > 0 ? 'Shortfall' : 'Surplus'} value={usdK(Math.abs(fc.gap))} />
            <KPICard tone="amber" label="Needed / full month left" value={usdK(fc.neededPerMonth)}
              sub={fc.gap > 0 && fc.monthsRemaining > 0
                ? <>{fc.monthsRemaining} months · record {fmtUsd(Math.round(fc.bestMonth.value))} ({fc.bestMonth.label})</>
                : undefined}
              info={fc.gap > 0 && fc.monthsRemaining > 0 ? <>
                Reaching target needs {fmtUsd(Math.round(fc.neededPerMonth))} in each of the {fc.monthsRemaining} full months left, on top of however the month in progress closes. The best month on record is {fmtUsd(Math.round(fc.bestMonth.value))} ({fc.bestMonth.label})
                {fc.neededPerMonth > fc.bestMonth.value && <> — so target means beating the all-time record by {Math.round(((fc.neededPerMonth - fc.bestMonth.value) / fc.bestMonth.value) * 100)}%, every month, {fc.monthsRemaining} times running</>}.
              </> : undefined} />
          </KPIRow>

          {/* ---------------- history + forecast chart ---------------- */}
          <Panel className="mb-5" title="The line so far, and where it goes"
            right={<span className="text-xs text-mav-muted">{fc.historyMonths} months actual · {futureMonths} forecast</span>}>
            <TrendChart fc={fc} />
          </Panel>

          {/* ---------------- why it's flat ---------------- */}
          <Panel className="mb-5" title="Why it lands there"
            info={drag.perMonth > 0 ? <>
              Monthly revenue has stayed inside a narrow band for well over a year. That is not because nothing is happening: {drag.clients} accounts that used to bill regularly have gone quiet, and at their own historical rate they were worth {fmtUsd(Math.round(drag.perMonth))} a month between them. That revenue is gone — yet the monthly total has not fallen. Something is replacing roughly {fmtUsd(Math.round(drag.perMonth))} of run-rate every month and landing almost exactly where the losses left off. That equilibrium is what produces a flat line. The acquisition work is real; it is being spent standing still. Growth needs acquisition to exceed replacement, or churn to fall below it.
            </> : 'Monthly revenue has stayed inside a narrow band for well over a year.'}
            right={<span className="text-xs text-mav-muted">Flat is not idle</span>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Last 6 complete months" value={fmtUsd(Math.round(fc.drift.recent))} note="average per month" />
              <Stat label="The 6 before" value={fmtUsd(Math.round(fc.drift.prior))} note="average per month" />
              <Stat label="Change" value={pct(fc.drift.pct, 1)}
                tone={Math.abs(fc.drift.pct) < 5 ? 'text-amber-300' : fc.drift.pct > 0 ? 'text-green-400' : 'text-red-400'}
                note="recent six vs prior six" />
              {drag.perMonth > 0 && (
                <Stat label="Gone quiet" value={`${fmtUsd(Math.round(drag.perMonth))}/mo`}
                  note={`${drag.clients} accounts that used to bill regularly — replaced, so the total held`} />
              )}
            </div>
          </Panel>

          {/* ---------------- month by month ---------------- */}
          <Panel flush className="mb-5" title="Month by month"
            info={<>Bar = forecast · red line = {usdK(fc.neededPerMonth)} pace needed for {usdK(fc.target)}. Green is settled. Index is the seasonal index: 100 is an average month, so 113 means that month historically runs 13% above one.</>}
            right={<span className="text-xs text-mav-muted">red line = {usdK(fc.neededPerMonth)}/mo needed</span>}>
            <MonthTable fc={fc} />
            {fc.thinSeasonality > 0 && (
              <p className="px-4 py-2.5 text-[11px] text-mav-muted border-t border-mav-line">
                {fc.thinSeasonality} of the 12 calendar months rest on a single year of observations — treat the seasonal shape as a reasonable expectation, not an established pattern.
              </p>
            )}
          </Panel>

          {/* ---------------- scenarios ---------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <Panel title="What moves the number" info="Each row adds to the one above it, applied from next month.">
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
            </Panel>

            <Panel title="What the forecast already absorbs">
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
                  <button onClick={() => setShowAccounts(v => !v)} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">
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
            </Panel>
          </div>

          {/* ---------------- seasonal profile ---------------- */}
          <Panel className="mb-5" title="Seasonal shape"
            info={<>Bars run above and below the 100 line, because the index measures a month against a typical one — a March at {fc.seasonal[2] ? fc.seasonal[2].index.toFixed(0) : '—'} bills that much above average, a January at {fc.seasonal[0] ? fc.seasonal[0].index.toFixed(0) : '—'} that much below. Hatched bars rest on a single year of data. A March peak and a January trough fit a client base weighted to the UK and Australia, where the financial year ends in March — but on this much history that is a plausible explanation, not a proven one.</>}
            right={<span className="text-xs text-mav-muted">100 = an average month</span>}>
            <SeasonChart seasonal={fc.seasonal} />
          </Panel>

          {/* ---------------- backtest ---------------- */}
          {bt && (
            <Panel className="mb-5" title="How accurate has this been?"
              info={<>Each month was predicted using only the months before it — the model never saw the answer. It misses a single month by about {bt.mape.toFixed(0)}% on average, but the errors run in both directions ({pct(bt.bias, 1)} bias overall), so they largely cancel across a full year. That is why the annual figure deserves more confidence than any one month on it.</>}
              right={<span className="text-xs text-mav-muted">Walk-forward test over the last {bt.folds} months</span>}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
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
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ chart --- */
function TrendChart({ fc }: { fc: Forecast }) {
  const ink = useThemeInk()
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
            <line x1={PADL} y1={y(t)} x2={W - PADR} y2={y(t)} stroke={ink.grid} strokeWidth="1" />
            <text x={PADL - 8} y={y(t) + 3} fontSize="10" fill={ink.axis} textAnchor="end" className="tabular-nums">
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
            <text key={p.key} x={x(i)} y={H - 8} fontSize="9" fill={ink.axis} textAnchor="middle">{p.label}</text>
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

/* --------------------------------------------------------- seasonal shape --- */
// Diverging bars around the 100 line. An index says "this month runs N% above or
// below a typical one", so a chart growing from zero would be mostly dead space and
// would make an 86 and a 113 look far more alike than they are.
//
// Heights are in PIXELS against halves with a definite height. The first cut used a
// percentage height inside an auto-height flex column — a percentage resolves against
// an auto parent as `auto`, which on an empty div is zero, so every bar rendered
// invisible and the whole chart came out blank.
const HALF = 62   // px available above and below the centre line

function SeasonChart({ seasonal }: { seasonal: Forecast['seasonal'] }) {
  const maxDev = Math.max(6, ...seasonal.map(s => Math.abs(s.index - 100)))
  return (
    <div>
      <div className="flex gap-1.5">
        {seasonal.map(s => {
          const dev = s.index - 100
          const px = Math.max(3, Math.round((Math.abs(dev) / maxDev) * HALF))
          const thin = s.years <= 1
          return (
            <div key={s.month} className="flex-1 flex flex-col items-center"
              title={`${s.label}: index ${s.index.toFixed(0)} — ${dev >= 0 ? 'above' : 'below'} an average month by ${Math.abs(dev).toFixed(0)}%, from ${s.years} year${s.years === 1 ? '' : 's'} of data`}>
              <span className="text-[10px] text-mav-muted tabular-nums mb-1">{s.index.toFixed(0)}</span>
              {/* upper half */}
              <div className="w-full flex items-end justify-center" style={{ height: HALF }}>
                {dev > 0 && (
                  <div className={`w-full rounded-t bg-mav-yellow ${thin ? 'opacity-40' : 'opacity-80'}`}
                    style={{ height: px }} />
                )}
              </div>
              <div className="w-full h-px bg-mav-line" />
              {/* lower half */}
              <div className="w-full flex items-start justify-center" style={{ height: HALF }}>
                {dev < 0 && (
                  <div className={`w-full rounded-b bg-red-400 ${thin ? 'opacity-30' : 'opacity-60'}`}
                    style={{ height: px }} />
                )}
              </div>
              <span className="text-[10px] text-mav-muted mt-1">{s.label}</span>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-mav-muted mt-3">
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-2 bg-mav-yellow/80 inline-block rounded-sm" /> Above average</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-2 bg-red-400/60 inline-block rounded-sm" /> Below average</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-4 h-2 bg-mav-yellow/40 inline-block rounded-sm" /> One year of data only</span>
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

function Stat({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="bg-mav-dark/50 border border-mav-line rounded-lg p-3">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mav-muted">{label}</div>
      <div className={`font-mono text-xl font-semibold tabular-nums mt-1 ${tone}`}>{value}</div>
      <div className="text-[11px] text-mav-muted mt-0.5 leading-snug">{note}</div>
    </div>
  )
}
