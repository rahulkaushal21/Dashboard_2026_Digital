// AI Insights — the "why" behind the numbers on the rest of the dashboard.
//
// Every insight here is COMPUTED from the live data, never written down. That is
// deliberate: the findings these replaced were true on 27 Aug 2026 and would have
// been quietly wrong a month later, which is the fastest way to make people stop
// trusting a dashboard. If an insight has nothing to say this month, it returns
// null and disappears rather than restating a stale headline.
//
// Each insight carries the evidence it was derived from, so a reader can argue
// with the number instead of taking it on faith.

import type { BookingRow, Opportunity } from './supabase'

export type Tone = 'critical' | 'watch' | 'good' | 'neutral'

export interface Insight {
  key: string
  tone: Tone
  /** Short label for the category, e.g. "Retention". */
  topic: string
  /** The single figure the insight turns on. */
  figure: string
  /** One sentence: what is true. */
  headline: string
  /** One or two sentences: why it matters / what to do. */
  detail: string
  /** Where the reader should go to act on it. */
  link?: { href: string; label: string }
  /** Named examples, when naming them is the useful part. */
  examples?: string[]
}

// ---------------------------------------------------------------- helpers ---
const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const keyOf = (m?: string) => (m || '').slice(0, 7)
const shiftKey = (k: string, months: number) => {
  const [y, m] = k.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + months, 1))
}
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}
const label = (k: string) =>
  new Date(k + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })
const usd = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US')
const usdShort = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (a >= 1_000) return '$' + Math.round(n / 1000) + 'k'
  return usd(n)
}
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.floor(s.length / 2)
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2
}

/** Revenue is booked to a month, so the month in progress is always short. Never compare against it. */
const currentMonthKey = () => monthKey(new Date())

// Roll bookings up to one row per client per month.
function clientMonths(bookings: BookingRow[]) {
  const byClient = new Map<string, Map<string, number>>()
  for (const b of bookings) {
    const name = (b.company_name || '').trim()
    const k = keyOf(b.booking_month)
    if (!name || !k) continue
    let m = byClient.get(name)
    if (!m) { m = new Map(); byClient.set(name, m) }
    m.set(k, (m.get(k) || 0) + (b.booking_amount || 0))
  }
  return byClient
}

function monthTotals(bookings: BookingRow[]) {
  const m = new Map<string, number>()
  for (const b of bookings) {
    const k = keyOf(b.booking_month)
    if (!k) continue
    m.set(k, (m.get(k) || 0) + (b.booking_amount || 0))
  }
  return m
}

// --------------------------------------------------------------- insights ---

/**
 * Is the top line actually moving? A month-by-month chart rescales its own axis,
 * so a business that has not grown in a year still looks busy. This compares the
 * newest complete half-year against the one before it.
 */
function revenueTrend(bookings: BookingRow[]): Insight | null {
  const totals = monthTotals(bookings)
  const cur = currentMonthKey()
  // Complete months only, and only months with real volume (the earliest rows are
  // a partial backfill — one client, one line — and would distort the band).
  const keys = [...totals.keys()].filter(k => k < cur).sort()
  const real = keys.filter(k => (totals.get(k) || 0) > 20000)
  if (real.length < 12) return null

  const recent = real.slice(-6)
  const prior = real.slice(-12, -6)
  const sum = (ks: string[]) => ks.reduce((s, k) => s + (totals.get(k) || 0), 0)
  const rSum = sum(recent), pSum = sum(prior)
  const change = pSum ? ((rSum - pSum) / pSum) * 100 : 0

  const vals = real.map(k => totals.get(k) || 0)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const spread = mean ? ((hi - lo) / mean) * 100 : 0

  const flat = Math.abs(change) < 5
  return {
    key: 'trend',
    tone: flat ? 'watch' : change > 0 ? 'good' : 'critical',
    topic: 'Growth',
    figure: (change >= 0 ? '+' : '') + change.toFixed(1) + '%',
    headline: flat
      ? `Revenue is oscillating, not trending — every one of the last ${real.length} complete months landed between ${usdShort(lo)} and ${usdShort(hi)}.`
      : `The last six months are ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% against the six before them.`,
    detail: flat
      ? `That is a spread of ${Math.round(spread)}% around a mean of ${usdShort(mean)}. Nothing in the last ${real.length} months has moved the top line — the business is replacing what it loses rather than adding to it.`
      : `${usdShort(rSum)} across ${recent.map(label)[0]}–${label(recent[recent.length - 1])}, against ${usdShort(pSum)} in the prior six months.`,
    link: { href: '/business-trend', label: 'Business Trend' },
  }
}

/**
 * The leak nothing else on the dashboard catches. A client who complains raises an
 * escalation; a client who simply stops buying generates no event at all. Each
 * client is judged against their OWN billing rhythm, so a quarterly maintenance
 * account is not flagged for missing a month.
 */
function silentChurn(bookings: BookingRow[]): Insight | null {
  const byClient = clientMonths(bookings)
  const cur = currentMonthKey()
  const at: { name: string; lost: number; silentFor: number; cadence: number }[] = []

  byClient.forEach((months, name) => {
    const keys = [...months.keys()].filter(k => k < cur).sort()
    if (keys.length < 3) return                       // too little history to know a rhythm
    const last = keys[keys.length - 1]
    const silentFor = monthsBetween(last, cur)
    if (silentFor < 2) return                          // still billing normally
    // Past nine months a client is churned, not churning. Keeping them here would
    // bury the accounts someone could still pick up the phone to, which is the
    // only reason this insight exists.
    if (silentFor > 9) return

    // The client's own normal gap between billing months.
    const gaps: number[] = []
    for (let i = 1; i < keys.length; i++) gaps.push(monthsBetween(keys[i - 1], keys[i]))
    const cadence = Math.max(1, median(gaps))
    if (silentFor < cadence * 1.5 + 1) return          // within their normal rhythm

    // Size the loss on what they were actually worth: their last 12 active months.
    const recent = keys.slice(-12).reduce((s, k) => s + (months.get(k) || 0), 0)
    if (recent < 3000) return                          // not material
    at.push({ name, lost: recent, silentFor, cadence })
  })

  if (!at.length) return null
  at.sort((a, b) => b.lost - a.lost)
  const total = at.reduce((s, x) => s + x.lost, 0)
  const top = at.slice(0, 5)

  return {
    key: 'churn',
    tone: 'critical',
    topic: 'Retention',
    figure: usdShort(total),
    headline: `${at.length} account${at.length === 1 ? ' has' : 's have'} gone quiet without raising a complaint.`,
    detail: `Each has stopped billing for noticeably longer than their own normal gap, within the last nine months — recent enough to still be worth a call. Together they were worth ${usdShort(total)} across their last twelve active months. Silence raises no flag anywhere else on this dashboard, so these clients leave without ever being counted as lost.`,
    examples: top.map(x => `${x.name} · ${usdShort(x.lost)} · quiet ${x.silentFor} mo (normally bills every ${x.cadence === 1 ? 'month' : x.cadence + ' mo'})`),
    link: { href: '/clients', label: 'Clients' },
  }
}

/**
 * Win rate against deal size. The single most decision-relevant cut in the quote
 * data, and the one that explains why a bigger pipeline has not produced a bigger year.
 */
function dealSizeCurve(opps: Opportunity[]): Insight | null {
  const BANDS = [
    { name: 'under $250', lo: 0, hi: 250 },
    { name: '$250–$1k', lo: 250, hi: 1000 },
    { name: '$1k–$3k', lo: 1000, hi: 3000 },
    { name: '$3k–$10k', lo: 3000, hi: 10000 },
    { name: '$10k+', lo: 10000, hi: Infinity },
  ]
  const rows = opps.filter(o => o.origin === 'sheet' && (o.est_value || 0) > 0)
  if (rows.length < 100) return null

  const stats = BANDS.map(b => {
    const inBand = rows.filter(o => (o.est_value || 0) >= b.lo && (o.est_value || 0) < b.hi)
    const won = inBand.filter(o => o.won)
    const lost = inBand.filter(o => !o.won && (o.status || '').toLowerCase() === 'lost')
    return {
      name: b.name,
      quotes: inBand.length,
      won: won.length,
      rate: inBand.length ? (won.length / inBand.length) * 100 : 0,
      lostValue: lost.reduce((s, o) => s + (o.est_value || 0), 0),
    }
  }).filter(s => s.quotes > 0)

  const small = stats[0], big = stats[stats.length - 1]
  if (!small || !big || big === small) return null
  if (big.rate >= small.rate - 20) return null       // no collapse worth reporting

  return {
    key: 'dealsize',
    tone: 'critical',
    topic: 'Conversion',
    figure: big.rate.toFixed(0) + '%',
    headline: `Win rate collapses as deals get bigger — ${small.rate.toFixed(0)}% on quotes ${small.name}, ${big.rate.toFixed(0)}% on ${big.name}.`,
    detail: `${big.won} of ${big.quotes} quotes at ${big.name} have converted, against ${usdShort(big.lostValue)} of value lost in that band alone. Large projects are the only arithmetic that reaches an eight-figure-adjacent year, and they are where we are weakest — that is a capability question, not a pipeline one.`,
    examples: stats.map(s => `${s.name} · ${s.rate.toFixed(0)}% of ${s.quotes} quotes · ${usdShort(s.lostValue)} lost`),
    link: { href: '/opportunities', label: 'Opportunities' },
  }
}

/**
 * How much of the reported open pipeline is still plausibly live. Measured against
 * how fast quotes ACTUALLY close, so the threshold argues from evidence rather
 * than from a number someone picked.
 */
function stalePipeline(opps: Opportunity[], p90Days: number | null): Insight | null {
  const open = opps.filter(o => !o.won && !['lost', 'won'].includes((o.status || '').toLowerCase()))
  if (open.length < 20) return null

  const nowMs = Date.now()
  const ageOf = (o: Opportunity) => {
    const raw = o.first_date || o.source_date || o.quote_date
    if (!raw) return null
    const t = new Date(String(raw).slice(0, 10) + 'T00:00:00').getTime()
    return isNaN(t) ? null : Math.floor((nowMs - t) / 86400000)
  }
  // Well past the point where quotes historically close. Falls back to 60 days
  // when the Quotes tab has not given us a close-speed distribution.
  const threshold = Math.max(30, Math.round((p90Days ?? 11) * 5))

  const withAge = open.map(o => ({ o, age: ageOf(o) })).filter(x => x.age !== null) as { o: Opportunity; age: number }[]
  if (!withAge.length) return null
  const stale = withAge.filter(x => x.age > threshold)
  if (!stale.length) return null

  const totalValue = withAge.reduce((s, x) => s + (x.o.est_value || 0), 0)
  const staleValue = stale.reduce((s, x) => s + (x.o.est_value || 0), 0)
  const pct = totalValue ? (staleValue / totalValue) * 100 : 0
  if (pct < 25) return null

  const avgProb = Math.round(
    stale.reduce((s, x) => s + (x.o.win_probability || 0), 0) / Math.max(1, stale.filter(x => x.o.win_probability != null).length)
  )

  return {
    key: 'stale',
    tone: 'watch',
    topic: 'Pipeline quality',
    figure: Math.round(pct) + '%',
    headline: `${usdShort(staleValue)} of the ${usdShort(totalValue)} open pipeline is older than ${threshold} days.`,
    detail: p90Days
      ? `Nine in ten quotes that convert do so within ${p90Days} days. These ${stale.length} deals are far past that${avgProb ? `, yet still carry an average ${avgProb}% win probability` : ''} — so reported pipeline is materially more optimistic than the evidence supports.`
      : `These ${stale.length} deals have been open long enough that they are unresolved rather than in progress${avgProb ? `, yet still carry an average ${avgProb}% win probability` : ''}.`,
    link: { href: '/opportunities', label: 'Opportunities' },
  }
}

/**
 * How much of each month's revenue comes from a client billing for the very first
 * time. The acquisition engine, measured in money rather than in deal count.
 */
function newLogoShare(bookings: BookingRow[]): Insight | null {
  const byClient = clientMonths(bookings)
  const firstMonth = new Map<string, string>()
  byClient.forEach((months, name) => {
    const keys = [...months.keys()].sort()
    if (keys.length) firstMonth.set(name, keys[0])
  })

  const cur = currentMonthKey()
  const totals = monthTotals(bookings)
  const keys = [...totals.keys()].filter(k => k < cur && (totals.get(k) || 0) > 20000).sort()
  if (keys.length < 6) return null
  const window = keys.slice(-6)

  let newRev = 0, allRev = 0
  for (const b of bookings) {
    const k = keyOf(b.booking_month)
    if (!window.includes(k)) continue
    const name = (b.company_name || '').trim()
    const amt = b.booking_amount || 0
    allRev += amt
    if (firstMonth.get(name) === k) newRev += amt
  }
  if (!allRev) return null
  const pct = (newRev / allRev) * 100

  return {
    key: 'newlogo',
    tone: pct < 12 ? 'watch' : 'good',
    topic: 'Acquisition',
    figure: pct.toFixed(1) + '%',
    headline: `New clients produced ${pct.toFixed(1)}% of the last six months' revenue.`,
    detail: `${usdShort(newRev)} of ${usdShort(allRev)} came from clients billing for the first time; everything else is existing accounts re-buying. ${pct < 12 ? 'With acquisition this small, the growth question is entirely about whether the existing base expands.' : 'Acquisition is carrying a meaningful share of the top line.'}`,
    link: { href: '/business-trend', label: 'Business Trend' },
  }
}

/**
 * Revenue concentration. Answers "how much of this business would survive losing
 * our best relationships", which no other page asks.
 */
function concentration(bookings: BookingRow[]): Insight | null {
  const byClient = clientMonths(bookings)
  if (byClient.size < 30) return null
  const cur = currentMonthKey()

  const rows: { name: string; rev: number; active: number }[] = []
  byClient.forEach((months, name) => {
    let rev = 0, active = 0
    months.forEach((v, k) => { if (k < cur) { rev += v; active++ } })
    if (rev > 0) rows.push({ name, rev, active })
  })
  if (!rows.length) return null

  const total = rows.reduce((s, r) => s + r.rev, 0)
  const totalMonths = new Set(bookings.map(b => keyOf(b.booking_month)).filter(k => k && k < cur)).size
  const alwaysOn = rows.filter(r => r.active >= Math.max(6, Math.round(totalMonths * 0.7)))
  const onceOnly = rows.filter(r => r.active === 1)
  if (!alwaysOn.length) return null

  const alwaysRev = alwaysOn.reduce((s, r) => s + r.rev, 0)
  const pct = (alwaysRev / total) * 100

  return {
    key: 'concentration',
    tone: pct > 50 ? 'watch' : 'neutral',
    topic: 'Concentration',
    figure: pct.toFixed(0) + '%',
    headline: `${alwaysOn.length} always-on clients produce ${pct.toFixed(0)}% of all revenue.`,
    detail: `They are ${((alwaysOn.length / rows.length) * 100).toFixed(0)}% of the ${rows.length} clients who have ever billed us, averaging ${usdShort(alwaysRev / alwaysOn.length)} each. At the other end, ${onceOnly.length} clients billed in exactly one month ever. These are two different businesses reported as one number, and they need different targets.`,
    link: { href: '/clients', label: 'Clients' },
  }
}

/**
 * What we are selling more and less of. The headline can sit still while the mix
 * underneath it moves — which is how you end up staffed for work that is going away.
 */
function mixShift(bookings: BookingRow[]): Insight | null {
  const cur = currentMonthKey()
  const keys = [...monthTotals(bookings).keys()].filter(k => k < cur).sort()
  if (keys.length < 12) return null
  const recent = new Set(keys.slice(-6))
  const prior = new Set(keys.slice(-12, -6))

  const agg = new Map<string, { now: number; then: number }>()
  for (const b of bookings) {
    const tech = (b.technology || '').trim()
    const k = keyOf(b.booking_month)
    if (!tech || !k) continue
    const cell = agg.get(tech) || { now: 0, then: 0 }
    if (recent.has(k)) cell.now += b.booking_amount || 0
    else if (prior.has(k)) cell.then += b.booking_amount || 0
    agg.set(tech, cell)
  }

  const moves = [...agg.entries()]
    .filter(([, v]) => v.then > 15000 || v.now > 15000)   // ignore rounding-error lines
    .map(([tech, v]) => ({ tech, ...v, pct: v.then ? ((v.now - v.then) / v.then) * 100 : 100 }))
  if (moves.length < 3) return null

  const risers = moves.filter(m => m.pct > 15).sort((a, b) => b.pct - a.pct)
  const fallers = moves.filter(m => m.pct < -15).sort((a, b) => a.pct - b.pct)
  if (!risers.length && !fallers.length) return null

  return {
    key: 'mix',
    tone: 'neutral',
    topic: 'Service mix',
    figure: fallers.length ? fallers[0].pct.toFixed(0) + '%' : '+' + risers[0].pct.toFixed(0) + '%',
    headline: fallers.length && risers.length
      ? `${risers[0].tech} is up ${risers[0].pct.toFixed(0)}% while ${fallers[0].tech} is down ${Math.abs(fallers[0].pct).toFixed(0)}%.`
      : risers.length
        ? `${risers[0].tech} is up ${risers[0].pct.toFixed(0)}% on the prior six months.`
        : `${fallers[0].tech} is down ${Math.abs(fallers[0].pct).toFixed(0)}% on the prior six months.`,
    detail: `Comparing the last six complete months against the six before. The total can sit still while the mix moves underneath it — this is the input to who we hire and what we sell next.`,
    examples: [...risers.slice(0, 3), ...fallers.slice(0, 3)]
      .map(m => `${m.tech} · ${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(0)}% · ${usdShort(m.now)} last 6 mo`),
    link: { href: '/business-trend', label: 'Business Trend' },
  }
}

// ------------------------------------------------------------------ public ---

/**
 * Build the insight set. Anything with nothing to say returns null and is dropped,
 * so the section shrinks in a good month instead of padding itself out.
 *
 * @param p90Days 90th-percentile days-to-confirm from the Quotes tab, when known.
 */
export function buildInsights(
  bookings: BookingRow[],
  opps: Opportunity[],
  p90Days: number | null = null,
): Insight[] {
  const RANK: Record<Tone, number> = { critical: 0, watch: 1, neutral: 2, good: 3 }
  return [
    silentChurn(bookings),
    dealSizeCurve(opps),
    revenueTrend(bookings),
    stalePipeline(opps, p90Days),
    concentration(bookings),
    newLogoShare(bookings),
    mixShift(bookings),
  ]
    .filter((x): x is Insight => x !== null)
    .sort((a, b) => RANK[a.tone] - RANK[b.tone])
}
