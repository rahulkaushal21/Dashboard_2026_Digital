// Everything the PM pages count, in one place. The team overview and each
// individual PM page both read from here so they cannot drift apart — the bug
// that had Business Trend and Forecast quoting two different FY targets.

import type { BookingRow, EmailSignal, Opportunity, PmFeedbackRow, Quote } from './supabase'
import { PM_TEAM, pmOf, qRange, qStartMonth, qCalYear, baselineFor, PM_REASSIGN, Q1_FY2026_ACTUALS, type FQ, type PmMember } from './pm-team'

export const monthKey = (d?: string) => (d || '').slice(0, 7)
const inQ = (k: string, f: FQ) => { const [a, b] = qRange(f); return !!k && k >= a && k <= b }
const norm = (s?: string) => (s || '').trim().toLowerCase()
// The key web_client_owners uses: letters and digits only, so 'ZULU 8' and 'Zulu8' are
// one client.
const ckey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

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

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The date a Quotes-tab row was CONFIRMED, which is what decides the quarter its
 * win counts in. The sheet records "confirmed in days" rather than a date, so it
 * is added to the raised date — 485 of the 504 confirmed rows carry it; the other
 * 19 fall back to the raised date.
 *
 * The value can be NEGATIVE (as low as -34), meaning the row was written up after
 * the client had already said yes. That is kept rather than clamped: the client
 * confirmed when they confirmed, and late paperwork should not move the win into
 * a later quarter.
 *
 * Empty for anything not confirmed. Cancellations have no date at all — only 3 of
 * 190 carry one — so a cancelled quote can only ever sit in the quarter it was
 * raised in. Worth fixing in the sheet if cancellation timing ever matters.
 */
export function quoteConfirmDate(q: Quote): string {
  if (!quoteWon(q) || !q.added_date) return ''
  const base = q.added_date.slice(0, 10)
  return q.confirmed_in_days == null ? base : addDays(base, q.confirmed_in_days)
}

/** The same, for an email-origin deal: when it was marked won, else when it arrived. */
export function oppConfirmDate(o: Opportunity): string {
  if (!isWon(o)) return ''
  return (o.email_won_at || o.status_checked_at || oppDate(o) || '').slice(0, 10)
}

// ---------------------------------------------------------------------------
// Classifying an EMAIL opportunity as New Development.
//
// The team often works a deal entirely over email and never raises a Quotes-tab
// line for it, so a Q2C built only on the sheet under-counts them. Email rows
// carry no Project Type — their `business_type` is free text and unusable for
// this ("Repeat", "Existing", "Agency", "Website", "Analytics/Web", "Staff
// augmentation", and null on a third of them) — so the work is read from the
// subject and summary instead.
//
// Deliberately CONSERVATIVE: a deal counts as New Development only on an explicit
// build signal, and anything unrecognised is left out. Over-counting would inflate
// a PM's Q2C with maintenance tickets, which is worse than missing a deal. Every
// row this matches is listed on the PM's own page, tagged `email`, so the
// classification can be checked rather than trusted.
//
// Order matters: a strong build signal wins over a service word, because
// "Squarespace Support — Figma to Squarespace, 6 pages" is a build despite
// the word "Support".
const BUILD_SIGNAL = /\bnew website\b|\bnew site\b|\bnew project\b|\brevamp\b|\bre-?design\b|\bre-?build\b|\bbuilds?\b|\bdevelopment brief\b|\bfigma to\b|\bdesign (?:&|and) development\b|\bfull[- ]stack developer\b|\bwebsite refresh\b/i
const SERVICE_WORD = /\bmaint[ae]?[in]*ance\b|\bad-?hoc\b|\bretainer\b|\bcare plan\b|\bqa\b|\bsecurity\b|\bmalware\b|\bplugin\b|\bbug ?fix|\bdedicated\b|\bstaff aug|\bbanner\b|\bfeedback\b|\bhosting\b|\badditional\b/i

/**
 * True when an email-origin opportunity looks like New Development work.
 * `reason` is exposed separately so the page can show why it counted.
 */
export function emailNewDev(o: Opportunity): boolean {
  const t = `${o.source_subject || ''} ${o.summary || o.gist || ''}`
  if (BUILD_SIGNAL.test(t)) return true
  if (SERVICE_WORD.test(t)) return false
  return false
}

/** Flags an opportunity as new-development, for the open-deals list only. */
export const isNewDev = (o: Opportunity) =>
  o.origin === 'email' ? emailNewDev(o) : norm(o.business_type).includes('new')

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
  /** New-development quotes raised in the quarter: Quotes tab + email. */
  shared: number
  won: number
  lost: number
  open: number
  /** How many of the above came from email rather than the Quotes tab. */
  sharedFromEmail: number
  /** Feedbacks split by where they were found. */
  feedbackFromSheet: number
  feedbackFromEmail: number
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
  /** Praise picked out of email and attributed to this PM via their client list. */
  praise: EmailSignal[]
  /** Email-origin deals this PM owns that read as New Development. */
  emailNewDevOpps: Opportunity[]
  quarter: (f: FQ) => PmQuarter
  /** The ratcheted bar for a quarter: last-year average, or better if already beaten this FY. */
  baseline: (f: FQ) => number
}

export function buildPmStats(
  bookings: BookingRow[],
  opps: Opportunity[],
  quotes: Quote[],
  feedback: PmFeedbackRow[],
  signals: EmailSignal[] = [],
  today = NOW_DEFAULT,
  // Who owns each client, from web_client_owners — every owner, primary first. Optional
  // so a caller with nothing to pass still gets the old behaviour rather than an empty
  // scorecard.
  clientOwners?: Map<string, string[]>,
): Map<string, PmStats> {
  const out = new Map<string, PmStats>()
  for (const pm of PM_TEAM) {
    out.set(pm.slug, {
      pm, byMonth: new Map(), bookings: [], opps: [], quotes: [], feedback: [],
      praise: [], emailNewDevOpps: [],
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
  // Feedback follows the client, not the cell.
  //
  // The feedback sheet's PC/SME column is whoever typed the row up, and on a shared
  // client that is regularly not the person who owns it: ZULU 8's feedback was landing on
  // Nitin Mishra's scorecard while most of ZULU 8 is Maitri Shah's work. So the client's
  // primary owner takes it — the one with the most revenue against that client — and the
  // cell is the fallback for a client nobody owns. One credit either way; counting it for
  // both co-owners would inflate the measure it feeds.
  for (const f of feedback) {
    const owners = clientOwners?.get(ckey(f.agency)) || []
    const pm = pmOf(owners[0]) || pmOf(f.pc_sme)
    if (pm) out.get(pm.slug)!.feedback.push(f)
  }

  // Email-origin deals that read as New Development, so Q2C stops depending on
  // somebody remembering to raise a Quotes line.
  for (const o of opps) {
    if (o.origin !== 'email' || !emailNewDev(o)) continue
    const pm = pmOf(o.pm_owner); if (!pm) continue
    out.get(pm.slug)!.emailNewDevOpps.push(o)
  }

  // Praise found in email, attributed to the PM who owns that client. Threads
  // already captured as a feedback row are skipped so nothing counts twice.
  const ownerOf = clientOwnerMap(quotes, bookings)
  const seenThreads = new Set(feedback.map(f => f.thread_id).filter(Boolean) as string[])
  for (const sig of signals) {
    if (!isPraise(sig)) continue
    if (sig.thread_id && seenThreads.has(sig.thread_id)) continue
    const pm = pmOf(ownerOf.get(norm(sig.company_name)))
    if (!pm) continue
    out.get(pm.slug)!.praise.push(sig)
  }

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

const EMPTY_Q: PmQuarter = {
  booked: 0, avg: 0, monthsElapsed: 0, shared: 0, won: 0, lost: 0, open: 0,
  sharedFromEmail: 0, feedbackFromSheet: 0, feedbackFromEmail: 0, q2c: null, feedback: 0,
}

/**
 * Which signal types count as a client feedback. Positive sentiment alone is too
 * loose — a cheerful "commercial" or "sales" note is not the client praising the
 * work — so only the explicitly appreciative types count.
 */
const PRAISE_TYPES = new Set(['praise', 'feedback', 'positive_feedback', 'delight', 'testimonial'])
export const isPraise = (s: EmailSignal) =>
  norm(s.sentiment) === 'positive' && PRAISE_TYPES.has(norm(s.signal_type))

/**
 * Client name → the PM who owns them, so a praise email that names only the
 * client can still be credited. Built from the two places ownership is recorded,
 * the Quotes tab and the revenue sheet, taking whoever appears against that
 * client most often.
 */
function clientOwnerMap(quotes: Quote[], bookings: BookingRow[]): Map<string, string> {
  const tally = new Map<string, Map<string, number>>()
  const add = (co?: string, who?: string) => {
    const c = norm(co), w = (who || '').trim()
    if (!c || !w) return
    if (!tally.has(c)) tally.set(c, new Map())
    const m = tally.get(c)!
    m.set(w, (m.get(w) || 0) + 1)
  }
  for (const q of quotes) add(q.agency, q.pc_sme)
  for (const b of bookings) add(b.company_name, PM_REASSIGN[norm(b.company_name)] || b.sme)
  const out = new Map<string, string>()
  for (const [co, m] of tally) {
    let best = '', n = 0
    for (const [who, c] of m) if (c > n) { best = who; n = c }
    if (best) out.set(co, best)
  }
  return out
}

function quarterOf(s: PmStats, f: FQ, today: Date): PmQuarter {
  let booked = 0
  for (const [k, v] of s.byMonth) if (inQ(k, f)) booked += v
  const me = monthsElapsed(f, today)

  // ---------------------------------------------------------------------
  // The Q2C cohort for a quarter is:
  //     everything RAISED in it  ∪  everything CONFIRMED in it
  //
  // A confirmation belongs to the quarter it was WON in, not the quarter the
  // quote was raised — a Q1 quote signed in Q2 is Q2's win. Six Q1 quotes
  // confirmed in Q2, and ten confirmed in Q1 came from quotes raised earlier,
  // so this is not a rounding detail.
  //
  // A closed quarter cannot move afterwards. A quote raised in Q and still open
  // when Q ended stays in Q's denominator for good and never later joins Q's
  // numerator — when it converts, that win lands in the quarter it converted in.
  // So the only thing a past quarter ever shows is what was true on its last day.
  // ---------------------------------------------------------------------
  let shared = 0, w = 0, l = 0, open = 0, fromEmail = 0
  const tally = (raisedInQ: boolean, wonInQ: boolean, lost: boolean, isEmail: boolean) => {
    shared++
    if (isEmail) fromEmail++
    if (wonInQ) w++
    else if (raisedInQ && lost) l++
    else if (raisedInQ) open++    // open at the quarter's close, or won later
  }

  for (const q of s.quotes) {
    if (!isNewDevQuote(q)) continue
    const raisedInQ = inQ(monthKey(q.added_date), f)
    const cd = quoteConfirmDate(q)
    const wonInQ = !!cd && inQ(monthKey(cd), f)
    if (!raisedInQ && !wonInQ) continue
    tally(raisedInQ, wonInQ, quoteLost(q), false)
  }

  // The same rule for deals worked over email that never reached the sheet.
  for (const o of s.emailNewDevOpps) {
    const raisedInQ = inQ(monthKey(oppDate(o)), f)
    const cd = oppConfirmDate(o)
    const wonInQ = !!cd && inQ(monthKey(cd), f)
    if (!raisedInQ && !wonInQ) continue
    tally(raisedInQ, wonInQ, isLost(o), true)
  }

  // month_year is preferred over added_date because it is the month the feedback
  // is *about*, not the day somebody typed it in; it is blank on most rows and
  // added_date covers the rest, so nothing in the feed goes uncounted.
  const fbSheet = s.feedback.filter(x => inQ(monthKey(x.month_year || x.added_date), f)).length
  const fbEmail = s.praise.filter(x => inQ(monthKey(x.source_date), f)).length

  const decided = w + l
  return {
    booked,
    avg: me > 0 ? booked / me : 0,
    monthsElapsed: me,
    shared, won: w, lost: l, open, sharedFromEmail: fromEmail,
    // Confirmed against EVERY New-development quote raised in the quarter, not
    // just the decided ones. Excluding the still-open quotes let a PM who had
    // converted five of twelve read as 100%, because the seven they had not yet
    // closed simply vanished from the denominator.
    q2c: shared > 0 ? (w / shared) * 100 : null,
    feedbackFromSheet: fbSheet,
    feedbackFromEmail: fbEmail,
    feedback: fbSheet + fbEmail,
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
