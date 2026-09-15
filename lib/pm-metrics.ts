// Everything the PM pages count, in one place. The team overview and each
// individual PM page both read from here so they cannot drift apart — the bug
// that had Business Trend and Forecast quoting two different FY targets.

import type { BookingRow, Opportunity, PmFeedbackRow, Quote } from './supabase'
import { PM_TEAM, pmOf, qRange, qStartMonth, qCalYear, baselineFor, PM_REASSIGN, Q1_FY2026_ACTUALS, type FQ, type PmMember } from './pm-team'

export const monthKey = (d?: string) => (d || '').slice(0, 7)
const inQ = (k: string, f: FQ) => { const [a, b] = qRange(f); return !!k && k >= a && k <= b }
const norm = (s?: string) => (s || '').trim().toLowerCase()

// ---------------------------------------------------------------------------
// Deal outcome, for the open-opportunity list. `status` is overwritten by the
// sheet sync every 30 minutes, so a dashboard decision (email_won / email_lost)
// has to win over it — the same rule the Opportunities page applies.
// ---------------------------------------------------------------------------
export const isWon = (o: Opportunity) => !!o.won || !!o.email_won || norm(o.status) === 'confirmed'
export const isLost = (o: Opportunity) =>
  !!o.email_lost || norm(o.status) === 'lost' || norm(o.status).includes('cancel')
export const isOpen = (o: Opportunity) => !isWon(o) && !isLost(o)

/**
 * The Q2C set: Project Type (Quotes col I) is "New Development".
 *
 * NOT the Business Type column — that marks new *client* vs repeat client, and
 * only 74 rows carry "New" against 432 here. The other Project Types (Ad-hoc,
 * Maintanance, Additional Pages, Ballpark, Dedicated) are existing-account work
 * and are excluded, which is what the Q2C% for PM tab does.
 */
export const isNewDevQuote = (q: Quote) => norm(q.project_type).includes('new')
const quoteWon = (q: Quote) => norm(q.status) === 'confirmed'
const quoteLost = (q: Quote) => norm(q.status).includes('cancel')

/** Flags an opportunity as new-development, for the open-deals list only. */
export const isNewDev = (o: Opportunity) => norm(o.business_type).includes('new')

/**
 * The date a quote belongs to. quote_date is the Quotes-tab "Added" date;
 * email-origin deals have no sheet line, so they fall back to the date the mail
 * arrived — without that, every email deal would drop out of the period filters.
 */
export const oppDate = (o: Opportunity) => o.quote_date || o.first_date || o.source_date || ''

const NOW_DEFAULT = new Date()

/**
 * How many months of a quarter have actually happened, so an in-progress quarter
 * averages over the months elapsed rather than always dividing by three — which
 * would show every PM collapsing in the first week of a quarter.
 */
export function monthsElapsed(f: FQ, today = NOW_DEFAULT): number {
  const y = qCalYear(f), sm = qStartMonth(f.q)
  const cy = today.getFullYear(), cm = today.getMonth() + 1
  if (cy > y || (cy === y && cm > sm + 2)) return 3        // quarter is over
  if (cy < y || (cy === y && cm < sm)) return 0            // not started
  return Math.min(3, cm - sm + 1)
}

export interface PmQuarter {
  /** Booked USD inside the quarter, from web_revenue.sme. */
  booked: number
  /** Booked ÷ months elapsed — the figure Growth is scored on. */
  avg: number
  monthsElapsed: number
  /** New-development quotes raised in the quarter, from the Quotes tab. */
  shared: number
  won: number
  lost: number
  open: number
  /** Confirmed ÷ decided among New-development quotes, as a percentage. */
  q2c: number | null
  feedback: number
}

export interface PmStats {
  pm: PmMember
  /** 'YYYY-MM' → booked USD. */
  byMonth: Map<string, number>
  bookings: BookingRow[]
  opps: Opportunity[]
  quotes: Quote[]
  feedback: PmFeedbackRow[]
  quarter: (f: FQ) => PmQuarter
  /** The ratcheted bar for a quarter: last-year average, or better if already beaten this FY. */
  baseline: (f: FQ) => number
}

export function buildPmStats(
  bookings: BookingRow[],
  opps: Opportunity[],
  quotes: Quote[],
  feedback: PmFeedbackRow[],
  today = NOW_DEFAULT,
): Map<string, PmStats> {
  const out = new Map<string, PmStats>()
  for (const pm of PM_TEAM) {
    out.set(pm.slug, {
      pm, byMonth: new Map(), bookings: [], opps: [], quotes: [], feedback: [],
      quarter: () => EMPTY_Q, baseline: () => pm.lastYearAvg,
    })
  }

  for (const b of bookings) {
    // A known-wrong SME cell is corrected here before attribution, so the booking
    // lands on the PM who actually owns the account.
    const owner = PM_REASSIGN[norm(b.company_name)] || b.sme
    const pm = pmOf(owner); if (!pm) continue
    const s = out.get(pm.slug)!
    s.bookings.push(b)
    const k = monthKey(b.booking_month)
    if (k) s.byMonth.set(k, (s.byMonth.get(k) || 0) + (b.booking_amount || 0))
  }

  // Apr–Jun 2026 is settled: the revenue sheet's pivot is the agreed final figure
  // for the quarter, including adjustments made at source after our last sync.
  // Overwrite rather than add, so a stale feed cannot inflate a closed quarter.
  for (const [slug, m] of Object.entries(Q1_FY2026_ACTUALS)) {
    const s = out.get(slug); if (!s) continue
    for (const [k, v] of Object.entries(m)) s.byMonth.set(k, v)
  }
  for (const o of opps) { const pm = pmOf(o.pm_owner); if (pm) out.get(pm.slug)!.opps.push(o) }
  for (const q of quotes) { const pm = pmOf(q.pc_sme); if (pm) out.get(pm.slug)!.quotes.push(q) }
  for (const f of feedback) { const pm = pmOf(f.pc_sme); if (pm) out.get(pm.slug)!.feedback.push(f) }

  for (const s of out.values()) {
    // Newest first, so "the latest open opportunities" needs no further sorting.
    s.opps.sort((a, b) => (oppDate(b) || '').localeCompare(oppDate(a) || ''))
    s.quarter = (f: FQ) => quarterOf(s, f, today)
    s.baseline = (f: FQ) => {
      // Quarters already posted in the same financial year, which is where the
      // ratchet gets its raised bars from.
      const prior: number[] = []
      for (let q = 1; q < f.q; q++) prior.push(quarterOf(s, { fy: f.fy, q }, today).avg)
      return baselineFor(s.pm, prior)
    }
  }
  return out
}

const EMPTY_Q: PmQuarter = { booked: 0, avg: 0, monthsElapsed: 0, shared: 0, won: 0, lost: 0, open: 0, q2c: null, feedback: 0 }

function quarterOf(s: PmStats, f: FQ, today: Date): PmQuarter {
  let booked = 0
  for (const [k, v] of s.byMonth) if (inQ(k, f)) booked += v
  const me = monthsElapsed(f, today)

  let shared = 0, w = 0, l = 0, open = 0
  for (const q of s.quotes) {
    if (!isNewDevQuote(q) || !inQ(monthKey(q.added_date), f)) continue
    shared++
    if (quoteWon(q)) w++
    else if (quoteLost(q)) l++
    else open++
  }

  // month_year is preferred over added_date because it is the month the feedback
  // is *about*, not the day somebody typed it in; it is blank on most rows and
  // added_date covers the rest, so nothing in the feed goes uncounted.
  const feedback = s.feedback.filter(x => inQ(monthKey(x.month_year || x.added_date), f)).length

  const decided = w + l
  return {
    booked,
    avg: me > 0 ? booked / me : 0,
    monthsElapsed: me,
    shared, won: w, lost: l, open,
    q2c: decided > 0 ? (w / decided) * 100 : null,
    feedback,
  }
}

/**
 * Growth is average-against-average: the quarter's per-month booking average
 * against the baseline monthly figure. Matches the sheet's own Growth column.
 */
export const growthPct = (quarterAvg: number, base: number): number | null =>
  base > 0 ? ((quarterAvg - base) / base) * 100 : null

/**
 * The open deals to put in front of a PM.
 *
 * Normally: everything still open that was raised this month. In the first 10
 * days of a month there is barely anything yet, so the list is topped up with the
 * most recent open deals from earlier months until it holds at least `min` — the
 * page would otherwise be blank every month-start, which is precisely when
 * somebody is looking at it.
 */
export function pendingOpps(opps: Opportunity[], today = NOW_DEFAULT, min = 5): { rows: Opportunity[]; toppedUp: number } {
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const open = opps.filter(isOpen)                    // already newest-first
  const thisMonth = open.filter(o => monthKey(oppDate(o)) === cur)
  if (today.getDate() > 10 || thisMonth.length >= min) return { rows: thisMonth, toppedUp: 0 }
  const older = open.filter(o => monthKey(oppDate(o)) < cur).slice(0, min - thisMonth.length)
  return { rows: [...thisMonth, ...older], toppedUp: older.length }
}
