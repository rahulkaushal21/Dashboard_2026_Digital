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
}

const label = (k: string) =>
  new Date(k + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })

/** FY runs April to March. Returns the April that starts the FY containing `d`. */
export const fyStartYear = (d: Date) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1)

export function buildForecast(
  bookings: BookingRow[],
  target: number,
  today: Date = new Date(),
): Forecast | null {
  // --- 1. monthly totals -----------------------------------------------------
  const totals = new Map<string, number>()
  for (const b of bookings) {
    const k = keyOf(b.booking_month)
    if (!k) continue
    totals.set(k, (totals.get(k) || 0) + (b.booking_amount || 0))
  }
  const curKey = mk(today.getFullYear(), today.getMonth() + 1)

  // Months with real volume only. The earliest rows are a partial backfill (one
  // client, one line) and would drag the level and the band down if included.
  const complete = [...totals.entries()]
    .filter(([k, v]) => k < curKey && v > 20000)
    .sort((a, b) => a[0].localeCompare(b[0]))
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
  const level =
    recent.reduce((s, [k, v]) => s + v / (indexOf(Number(k.slice(5, 7))) / 100), 0) / recent.length

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
    const idx = indexOf(d.getMonth() + 1)
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
      const est = Math.max(sofar, (sofar + expected) / 2)
      months.push({
        key: k, label: label(k), index: idx,
        value: est, low: Math.max(sofar, expected * 0.84), high: expected * 1.02,
        actual: false, partial: true,
      })
      bookedToDate += sofar
      projected += est
      settledAndPartial += est
      continue
    }

    const v = level * (idx / 100)
    months.push({ key: k, label: label(k), index: idx, value: v, low: v - sd, high: v + sd, actual: false })
    projected += v
    futureCount++
  }

  // Band on the FY total: independent monthly errors, so the standard deviation of
  // the sum grows with the square root of the number of forecast months, not linearly.
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
  }
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

  let clients = 0, perMonth = 0, trailing = 0
  byClient.forEach(months => {
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
    clients++
    trailing += rev
    perMonth += rev / last12.length
  })
  return { clients, perMonth, trailing }
}
