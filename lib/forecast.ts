// Revenue forecast to the end of the financial year.
//
// Computed on every load from web_revenue, never written down — a forecast that
// stops updating is worse than no forecast, because it keeps sounding confident
// while the ground moves. If there is too little history to say anything honest,
// build() returns null and the page says so instead of guessing.
//
// Method, in full, because a forecast nobody can audit is just an opinion:
//
//   1. Roll revenue to complete calendar months. The month in progress is always
//      short (revenue books to the month) and is never used to fit anything.
//   2. Build a seasonal index per calendar month: that month's average against the
//      all-month average, so 113 means "March runs 13% above a typical month".
//   3. Divide each of the last six complete months by its own index to strip the
//      seasonality out, and average them. That is the underlying LEVEL — what a
//      typical month is worth right now, with seasonal shape removed.
//   4. Forecast each remaining month as level x its index.
//   5. Band it by the historical standard deviation of monthly revenue, which
//      covers ordinary fluctuation but explicitly NOT a structural break like
//      winning or losing a major account.
//
// That is the SEASONAL model. There is a second one, RUN RATE, and each department
// gets whichever of the two has predicted ITS OWN past better (chooseModel, below):
//
//   a. Retainers — a client billed in each of the last three months, within 15% each
//      time — carry forward at their latest amount. That money is as close to known
//      as revenue gets.
//   b. Everything else is ad-hoc work: its average over the last six months, with any
//      one client's month capped at 10% of a typical month. A $16k one-off is real,
//      but it does not repeat, and letting it into the run rate is what made the
//      forecast expect it again next month.
//   c. No seasonal index. With 17 months of history, 7 calendar months rest on one
//      year — for LP/HUB (~$45k a month, lumpy) that index was fitting last year's
//      noise, and the forecast copied April 2025 into April 2026 to the dollar.
//
// Tested walk-forward on 6 held-out months (Sep 2026): LP/HUB 29.9% average miss and
// +16.8% bias on the seasonal model, 14.0% and -0.7% on run rate. Web and All stay
// seasonal, which still tests better for them (11.3% and 8.5%).

import type { BookingRow } from './supabase'

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (m?: string) => (m || '').slice(0, 7)
const mk = (y: number, m: number) => `${y}-${pad(m)}`

export interface ForecastMonth {
  key: string
  label: string
  /** Seasonal index for this calendar month; 100 = an average month. */
  index: number
  value: number
  low: number
  high: number
  actual: boolean
  /** True for the month currently in progress — booked so far, not final. */
  partial?: boolean
  /** Already invoiced in the invoice app for this month (the floor under the forecast). */
  invoiced?: number
  /** Month in progress: what is booked in the sheet so far. */
  booked?: number
}

/** Automatic inputs beyond the revenue history — nothing typed by anybody. */
export interface ForecastInputs {
  /** Month in progress, from its own booking dates (see nowcast()). */
  nowcast?: Nowcast | null
  /** Invoices already raised per month 'YYYY-MM' in the invoice app, this unit. */
  ahead?: Map<string, number>
}

export interface Forecast {
  fyLabel: string
  target: number
  months: ForecastMonth[]
  bookedToDate: number
  projected: number
  projectedLow: number
  projectedHigh: number
  gap: number
  pctOfTarget: number
  /** What each FULL month left would have to bill to reach the target. */
  neededPerMonth: number
  /** Count of whole months left, excluding the one in progress. */
  monthsRemaining: number
  /** Best complete month ever recorded, for comparison against neededPerMonth. */
  bestMonth: { key: string; label: string; value: number }
  level: number
  sd: number
  historyMonths: number
  /** Calendar months that have only one year of observations behind their index. */
  thinSeasonality: number
  /** Every complete month on record, oldest first — the line the forecast continues. */
  history: { key: string; label: string; value: number }[]
  /** Seasonal index for all 12 calendar months, with how many years back each one. */
  seasonal: { month: number; label: string; index: number; years: number }[]
  /** Flat-line test: the newest six complete months against the six before them. */
  drift: { recent: number; prior: number; pct: number }
  /** Which model produced the months above. */
  model: ModelId
  /** The run-rate split, when that is the model (and for the indicators either way). */
  runrate: RunRate
}

export type ModelId = 'seasonal' | 'runrate'
export const MODEL_LABEL: Record<ModelId, string> = {
  seasonal: 'Seasonal level',
  runrate: 'Retainers + run rate',
}

export interface RunRate {
  /** Retainers carried forward + the ad-hoc run rate: the forecast for a typical month. */
  level: number
  retainer: number
  retainers: { name: string; amount: number }[]
  adhoc: number
  /** The per-client monthly cap on ad-hoc work, and how much the cap took out on average. */
  cap: number
  capped: number
}

// ── Shared history ─────────────────────────────────────────────────────────────
// Month totals, the same totals per client, and the months with real volume.
interface Hist {
  totals: Map<string, number>
  byClient: Map<string, Map<string, number>>
  names: Map<string, string>
  complete: [string, number][]
}
function readHistory(bookings: BookingRow[], curKey: string): Hist {
  const totals = new Map<string, number>()
  const byClient = new Map<string, Map<string, number>>()
  const names = new Map<string, string>()
  for (const b of bookings) {
    const k = keyOf(b.booking_month)
    if (!k) continue
    const a = b.booking_amount || 0
    totals.set(k, (totals.get(k) || 0) + a)
    const raw = (b.company_name || '').trim()
    const c = raw.toLowerCase() || '?'
    if (!names.has(c)) names.set(c, raw || '(no client)')
    let m = byClient.get(c)
    if (!m) { m = new Map(); byClient.set(c, m) }
    m.set(k, (m.get(k) || 0) + a)
  }
  // Months with real volume only. The earliest rows are a partial backfill (one
  // client, one line) and would drag the level and the band down if included.
  const complete = [...totals.entries()]
    .filter(([k, v]) => k < curKey && v > 20000)
    .sort((a, b) => a[0].localeCompare(b[0]))
  return { totals, byClient, names, complete }
}

// Seasonal level for month `k`, fitted on `train` only.
function seasonalFit(train: [string, number][]) {
  const vals = train.map(([, v]) => v)
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const byCal = new Map<number, number[]>()
  for (const [tk, tv] of train) {
    const m = Number(tk.slice(5, 7))
    byCal.set(m, [...(byCal.get(m) || []), tv])
  }
  const idx = (m: number) => {
    const xs = byCal.get(m)
    if (!xs || !xs.length || !mean) return 100
    return (xs.reduce((a, b) => a + b, 0) / xs.length / mean) * 100
  }
  const recent = train.slice(-6)
  const level = recent.reduce((s, [rk, rv]) => s + rv / (idx(Number(rk.slice(5, 7))) / 100), 0) / recent.length
  return { idx, level, mean, byCal }
}

// Retainers carried + capped ad-hoc average, fitted on `train` only.
function runRateFit(h: Hist, train: [string, number][]): RunRate {
  const keys = train.map(([k]) => k)
  const last3 = keys.slice(-3)
  const last6 = keys.slice(-6)
  const retainers: { name: string; amount: number }[] = []
  const isRetainer = new Set<string>()
  h.byClient.forEach((ms, c) => {
    const v = last3.map(k => ms.get(k) || 0)
    if (v.length === 3 && v.every(a => a > 0) && Math.max(...v) <= Math.min(...v) * 1.15) {
      isRetainer.add(c)
      retainers.push({ name: h.names.get(c) || c, amount: v[2] })
    }
  })
  const last12 = train.slice(-12)
  const typical = last12.reduce((s, [, v]) => s + v, 0) / Math.max(1, last12.length)
  const cap = 0.10 * typical
  let adhocSum = 0, cappedSum = 0
  for (const k of last6) {
    h.byClient.forEach((ms, c) => {
      if (isRetainer.has(c)) return
      const a = ms.get(k) || 0
      adhocSum += Math.min(a, cap)
      cappedSum += Math.max(0, a - cap)
    })
  }
  const n = Math.max(1, last6.length)
  const retainer = retainers.reduce((s, r) => s + r.amount, 0)
  retainers.sort((a, b) => b.amount - a.amount)
  return { level: retainer + adhocSum / n, retainer, retainers, adhoc: adhocSum / n, cap, capped: cappedSum / n }
}

function predict(model: ModelId, h: Hist, train: [string, number][], k: string) {
  if (model === 'runrate') return runRateFit(h, train).level
  const f = seasonalFit(train)
  return f.level * (f.idx(Number(k.slice(5, 7))) / 100)
}

const label = (k: string) =>
  new Date(k + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })

/** FY runs April to March. Returns the April that starts the FY containing `d`. */
export const fyStartYear = (d: Date) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1)

export function buildForecast(
  bookings: BookingRow[],
  target: number,
  today: Date = new Date(),
  model: ModelId = 'seasonal',
  inputs: ForecastInputs = {},
): Forecast | null {
  // --- 1. monthly totals -----------------------------------------------------
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)
  const h = readHistory(bookings, curKey)
  const { totals, complete } = h
  if (complete.length < 12) return null

  const vals = complete.map(([, v]) => v)
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1))

  // --- 2. seasonal index per calendar month ----------------------------------
  const byCal = new Map<number, number[]>()
  for (const [k, v] of complete) {
    const m = Number(k.slice(5, 7))
    byCal.set(m, [...(byCal.get(m) || []), v])
  }
  const indexOf = (m: number) => {
    const xs = byCal.get(m)
    if (!xs || !xs.length || !mean) return 100
    const avg = xs.reduce((s, v) => s + v, 0) / xs.length
    return (avg / mean) * 100
  }
  // How many calendar months rest on a single year — the honesty caveat.
  let thinSeasonality = 0
  for (let m = 1; m <= 12; m++) if ((byCal.get(m) || []).length <= 1) thinSeasonality++

  // --- 3. deseasonalised level from the last six complete months -------------
  const recent = complete.slice(-6)
  const rr = runRateFit(h, complete)
  const level = model === 'runrate' ? rr.level
    : recent.reduce((s, [k, v]) => s + v / (indexOf(Number(k.slice(5, 7))) / 100), 0) / recent.length
  // The index the projection applies. Run rate has none — it is flat by design; the
  // seasonal shape is still computed below so the page can show what was set aside.
  const applied = (m: number) => (model === 'runrate' ? 100 : indexOf(m))

  // --- 4/5. walk the financial year -----------------------------------------
  const fyY = fyStartYear(today)
  const fyLabel = `FY ${fyY}-${String(fyY + 1).slice(2)}`
  const months: ForecastMonth[] = []
  let bookedToDate = 0
  let projected = 0
  let futureCount = 0
  // Settled months plus the estimated close of the month in progress — the base the
  // required pace is measured from.
  let settledAndPartial = 0

  for (let i = 0; i < 12; i++) {
    const d = new Date(fyY, 3 + i, 1)
    const k = mk(d.getFullYear(), d.getMonth() + 1)
    const idx = applied(d.getMonth() + 1)
    const seen = totals.get(k)

    if (k < curKey && seen != null) {
      // Settled month — the actual, no band.
      months.push({ key: k, label: label(k), index: idx, value: seen, low: seen, high: seen, actual: true })
      bookedToDate += seen
      projected += seen
      settledAndPartial += seen
      continue
    }

    if (k === curKey) {
      // The month in progress: part booked. Expect it to finish somewhere between
      // what is already in and what the seasonal level implies — never below what
      // has actually been billed.
      const sofar = seen || 0
      const expected = level * (idx / 100)
      const inv = inputs.ahead?.get(k) || 0
      const nc = inputs.nowcast
      // With a nowcast: blend what this month's own bookings imply with the model, in
      // the proportion that has tested best at this day of the month. Without one, the
      // old halfway rule. Either way never below what is booked or already invoiced.
      const floor = Math.max(sofar, inv)
      const est = nc ? Math.max(floor, nc.estimate(sofar, expected)) : Math.max(floor, (sofar + expected) / 2)
      const e = nc ? nc.mape / 100 : 0.16
      months.push({
        key: k, label: label(k), index: idx,
        value: est, low: Math.max(floor, est * (1 - e)), high: Math.max(est * (1 + e), floor),
        actual: false, partial: true, invoiced: inv, booked: sofar,
      })
      bookedToDate += sofar
      projected += est
      settledAndPartial += est
      continue
    }

    // Invoices already raised for a future month are known money: the forecast never
    // sits below them. For LP/HUB that is the retainer instalments raised in advance.
    const inv = inputs.ahead?.get(k) || 0
    const v = Math.max(level * (idx / 100), inv)
    months.push({ key: k, label: label(k), index: idx, value: v, low: Math.max(v - sd, inv), high: v + sd, actual: false, invoiced: inv })
    projected += v
    futureCount++
  }

  // Band on the FY total: independent monthly errors, so the standard deviation of
  // the sum grows with the square root of the number of forecast months, not linearly.
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const seasonal = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, label: MON[i], index: indexOf(i + 1), years: (byCal.get(i + 1) || []).length,
  }))
  const history = complete.map(([k, v]) => ({ key: k, label: label(k), value: v }))
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const recentAvg = avg(complete.slice(-6).map(([, v]) => v))
  const priorAvg = avg(complete.slice(-12, -6).map(([, v]) => v))
  const drift = { recent: recentAvg, prior: priorAvg, pct: priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0 }

  const spread = sd * Math.sqrt(Math.max(1, futureCount + 1))
  const best = complete.reduce((b, [k, v]) => (v > b[1] ? [k, v] : b), ['', 0] as [string, number])

  // Required pace is spread over the WHOLE months left, not over the month already
  // in progress — that one cannot absorb a full month's catch-up when most of it has
  // already happened. Counting it divides the gap by one more month than is really
  // available: with August part-booked that is the difference between a comfortable
  // "$270k a month" and the honest "$306k a month".
  const needed = futureCount > 0 ? Math.max(0, (target - settledAndPartial) / futureCount) : 0

  return {
    fyLabel,
    target,
    months,
    bookedToDate,
    projected,
    projectedLow: projected - spread,
    projectedHigh: projected + spread,
    gap: target - projected,
    pctOfTarget: target ? (projected / target) * 100 : 0,
    neededPerMonth: needed,
    monthsRemaining: futureCount,
    bestMonth: { key: best[0], label: best[0] ? label(best[0]) : '—', value: best[1] },
    level,
    sd,
    historyMonths: complete.length,
    thinSeasonality,
    history,
    seasonal,
    drift,
    model,
    runrate: rr,
  }
}

/**
 * Walk-forward backtest: how wrong has this method been in the past?
 *
 * For each of the last `folds` complete months, refit the level and seasonal index
 * using ONLY the months before it, predict that month, and compare against what it
 * actually billed. Nothing after the predicted month is allowed into the fit, so
 * this is an honest out-of-sample test rather than the model marking its own
 * homework. Returns null when there is not enough history to hold months back.
 *
 * A forecast that cannot say how accurate it has been is asking to be trusted on
 * faith, which for a number that will drive a target is not good enough.
 */
export function backtest(bookings: BookingRow[], today: Date = new Date(), folds = 6, model: ModelId = 'seasonal') {
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)
  const h = readHistory(bookings, curKey)
  const all = h.complete
  // Need a decent training window before the first held-out month.
  const MIN_TRAIN = 9
  if (all.length < MIN_TRAIN + 2) return null

  const usable = Math.min(folds, all.length - MIN_TRAIN)
  const results: { key: string; label: string; predicted: number; actual: number; errPct: number }[] = []

  for (let i = all.length - usable; i < all.length; i++) {
    const [k, actual] = all[i]
    const predicted = predict(model, h, all.slice(0, i), k)
    results.push({
      key: k, label: label(k), predicted, actual,
      errPct: actual ? ((predicted - actual) / actual) * 100 : 0,
    })
  }

  const mape = results.reduce((s, r) => s + Math.abs(r.errPct), 0) / results.length
  const bias = results.reduce((s, r) => s + r.errPct, 0) / results.length
  const worst = results.reduce((w, r) => (Math.abs(r.errPct) > Math.abs(w.errPct) ? r : w), results[0])
  return { results, mape, bias, worst, folds: results.length, model }
}
export type Backtest = NonNullable<ReturnType<typeof backtest>>

/**
 * Which model to trust for THIS set of bookings: the one that has missed least on the
 * held-out months. Run on every load, so it re-decides as history accrues — once LP/HUB
 * has two full years, seasonality may well start to earn its place, and it will be
 * picked without anybody changing code. Ties within half a point go to seasonal, the
 * established method.
 */
export function chooseModel(bookings: BookingRow[], today: Date = new Date()) {
  const tried = (['seasonal', 'runrate'] as ModelId[])
    .map(m => backtest(bookings, today, 6, m))
    .filter((b): b is Backtest => !!b)
  if (!tried.length) return { model: 'seasonal' as ModelId, bt: null, tried }
  const best = tried.reduce((a, b) => (b.mape < a.mape - 0.5 ? b : a))
  return { model: best.model, bt: best, tried }
}

/**
 * Revenue currently sitting in accounts that have stopped billing — the headwind
 * the forecast is already absorbing. Same cadence test the AI Insights churn card
 * uses, valued at each client's own trailing monthly rate rather than a flat average.
 */
export function churnDrag(bookings: BookingRow[], today: Date = new Date()) {
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)
  const byClient = new Map<string, Map<string, number>>()
  for (const b of bookings) {
    const name = (b.company_name || '').trim()
    const k = keyOf(b.booking_month)
    if (!name || !k || k >= curKey) continue
    let m = byClient.get(name)
    if (!m) { m = new Map(); byClient.set(name, m) }
    m.set(k, (m.get(k) || 0) + (b.booking_amount || 0))
  }
  const gapMonths = (a: string, b: string) =>
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))

  const accounts: { name: string; perMonth: number; trailing: number; silentFor: number; cadence: number; lastMonth: string }[] = []
  byClient.forEach((months, name) => {
    const keys = [...months.keys()].sort()
    if (keys.length < 3) return
    const silentFor = gapMonths(keys[keys.length - 1], curKey)
    if (silentFor < 2 || silentFor > 9) return
    const gaps: number[] = []
    for (let i = 1; i < keys.length; i++) gaps.push(gapMonths(keys[i - 1], keys[i]))
    gaps.sort((a, b) => a - b)
    const cadence = Math.max(1, gaps[Math.floor(gaps.length / 2)])
    if (silentFor < cadence * 1.5 + 1) return
    const last12 = keys.slice(-12)
    const rev = last12.reduce((s, k) => s + (months.get(k) || 0), 0)
    if (rev < 3000) return
    accounts.push({
      name, perMonth: rev / last12.length, trailing: rev, silentFor, cadence,
      lastMonth: label(keys[keys.length - 1]),
    })
  })
  accounts.sort((a, b) => b.trailing - a.trailing)
  return {
    clients: accounts.length,
    perMonth: accounts.reduce((s, a) => s + a.perMonth, 0),
    trailing: accounts.reduce((s, a) => s + a.trailing, 0),
    accounts,
  }
}

/** The run-rate split as it stood `back` complete months ago — for "retainer base then vs now". */
export function runRateAt(bookings: BookingRow[], today: Date = new Date(), back = 0): RunRate | null {
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)
  const h = readHistory(bookings, curKey)
  const train = h.complete.slice(0, h.complete.length - back)
  return train.length >= 6 ? runRateFit(h, train) : null
}

/**
 * The month in progress, read from its own bookings.
 *
 * Every sheet row carries a booking date inside its month, and by any given day a
 * fairly steady share of a month's final revenue is already dated — for LP/HUB by the
 * 15th it has run between 46% and 84%, 67% on average. So "dated so far ÷ the usual
 * share by this day" is an estimate of the close that needs nobody to type anything.
 *
 * It is noisy on its own, so it is blended with the model's forecast. The blend weight
 * is not a guess: each of the backtest's held-out months is replayed as if it were
 * today's day of the month — using only the months before it for the usual share — and
 * the weight that would have missed least is the one used. Retrained on every load.
 */
export interface Nowcast {
  day: number
  /** Share of a month usually dated by `day`, from the last 12 complete months. */
  share: number
  weight: number
  mape: number
  bias: number
  /** Before-the-month miss on the same months, for comparison. */
  priorMape: number
  /** Dated in the month in progress up to today. */
  datedSoFar: number
  estimate: (bookedSoFar: number, expected: number) => number
}

export function nowcast(bookings: BookingRow[], today: Date, bt: Backtest | null): Nowcast | null {
  if (!bt) return null
  const day = today.getDate()
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)
  const tot = new Map<string, number>(), dated = new Map<string, number>()
  let datedSoFar = 0
  for (const b of bookings) {
    const k = keyOf(b.booking_month)
    if (!k || k > curKey) continue
    const a = b.booking_amount || 0
    // A row without a date inside its own month counts as dated from the 1st.
    const d = b.booking_date && b.booking_date.slice(0, 7) === k ? Number(b.booking_date.slice(8, 10)) : 1
    if (k === curKey) { if (d <= day) datedSoFar += a; continue }
    tot.set(k, (tot.get(k) || 0) + a)
    if (d <= day) dated.set(k, (dated.get(k) || 0) + a)
  }
  const months = [...tot.keys()].filter(k => (tot.get(k) || 0) > 20000).sort()
  const shareOf = (k: string) => (dated.get(k) || 0) / (tot.get(k) || 1)
  const avgShare = (ks: string[]) => ks.length ? ks.reduce((s, k) => s + shareOf(k), 0) / ks.length : 0

  const W = [0, 0.25, 0.5, 0.75, 1]
  let best = { w: 0, mape: Infinity, bias: 0 }
  for (const w of W) {
    const errs: number[] = []
    for (const r of bt.results) {
      const prior = months.filter(k => k < r.key).slice(-12)
      if (prior.length < 6) continue
      const f = avgShare(prior)
      const d = dated.get(r.key) || 0
      const raw = f > 0 ? d / f : r.predicted
      const p = Math.max(d, w * raw + (1 - w) * r.predicted)
      errs.push(((p - r.actual) / r.actual) * 100)
    }
    if (!errs.length) return null
    const mape = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length
    if (mape < best.mape - 0.25) best = { w, mape, bias: errs.reduce((s, e) => s + e, 0) / errs.length }
  }
  const share = avgShare(months.slice(-12))
  const w = best.w
  return {
    day, share, weight: w, mape: best.mape, bias: best.bias, priorMape: bt.mape, datedSoFar,
    estimate: (bookedSoFar, expected) => {
      const raw = share > 0 ? datedSoFar / share : expected
      return Math.max(bookedSoFar, w * raw + (1 - w) * expected)
    },
  }
}
