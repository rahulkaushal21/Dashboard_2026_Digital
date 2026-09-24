// The PM (project manager) team, their quarterly KPI bands, and the last-year
// baseline each one is measured against.
//
// Attribution: revenue comes from web_revenue.sme, quotes from opportunities.pm_owner
// (which covers BOTH the sheet rows and the email-origin deals, so a Q2C number here
// is "email and sheet combined" as asked). Both columns are free text typed by hand,
// so the same person is spelled several ways — `Malay Srivastava` and `Malay
// Shrivastava` are one person, as are `Sankalp Bhoyar` and `Sankalp Waman Bhoyar`.
// Aliases are explicit rather than fuzzy for the same reason lib/nbd.ts keeps them
// explicit: a loose match silently moves somebody else's revenue.

export interface PmMember {
  name: string
  slug: string
  /**
   * Work email, used to decide whose scorecard a signed-in PM may open. Taken
   * from real mail traffic rather than guessed from the name — `rahul.j@` is
   * Rahul Jain and `rahul.k@` is Rahul Kaushal, a different person, so a
   * first-name guess would have shown one of them the other's numbers.
   */
  email: string
  aliases: string[]
  /**
   * The PM's LAST-YEAR MONTHLY AVERAGE booking in USD — the `Base Data` column of
   * the `Report - PM` tab. This is the denominator for the Growth KPI.
   *
   * Growth is average-vs-average, NOT total-vs-total: a quarter is scored on its
   * per-month average against this figure. Afzal's Apr–Jun 2026 totals $83,801,
   * averages $27,934, and scores (27,934 − 23,081) / 23,081 = +21.02%, which is
   * what the sheet's own Growth column shows.
   *
   * Hand-typed from the sheet, because the `Report - PM` tab is not ingested.
   * Replace with that feed rather than re-typing when it is wired up.
   */
  lastYearAvg: number
}

export const PM_TEAM: PmMember[] = [
  { name: 'Afzal Multani', slug: 'afzal-multani', email: 'afzal@mavlers.com', aliases: ['afzal multani', 'afzal'], lastYearAvg: 23081 },
  { name: 'Bonny Chhatbar', slug: 'bonny-chhatbar', email: 'bonny@mavlers.com', aliases: ['bonny chhatbar', 'bonny chhatbhar', 'bonny'], lastYearAvg: 22962 },
  { name: 'Gagandeep Singh', slug: 'gagandeep-singh', email: 'gagandeep@mavlers.com', aliases: ['gagandeep singh', 'gagandeep'], lastYearAvg: 21416 },
  { name: 'Gaurav Pardeshi', slug: 'gaurav-pardeshi', email: 'gaurav@mavlers.com', aliases: ['gaurav pardeshi', 'gaurav'], lastYearAvg: 12201 },
  { name: 'Madhav Maheshwari', slug: 'madhav-maheshwari', email: 'madhav@mavlers.com', aliases: ['madhav maheshwari', 'madhav'], lastYearAvg: 10000 },
  { name: 'Maitri Shah', slug: 'maitri-shah', email: 'maitri@mavlers.com', aliases: ['maitri shah', 'maitri'], lastYearAvg: 15638 },
  // The revenue sheet also spells him 'Malay Srivastava' (no 'h').
  { name: 'Malay Shrivastava', slug: 'malay-shrivastava', email: 'malay@mavlers.com', aliases: ['malay shrivastava', 'malay srivastava', 'malay'], lastYearAvg: 20464 },
  { name: 'Nitin Mishra', slug: 'nitin-mishra', email: 'nitin@mavlers.com', aliases: ['nitin mishra', 'nitin'], lastYearAvg: 23333 },
  { name: 'Paryusha Jain', slug: 'paryusha-jain', email: 'paryusha@mavlers.com', aliases: ['paryusha jain', 'paryusha'], lastYearAvg: 16251 },
  // 'Rahul' alone is deliberately NOT an alias. Rahul Kaushal is a different
  // person who also appears as a pc_sme, and a bare first-name match would hand
  // his rows to Rahul Jain. Confirmed by the user: keep them apart.
  { name: 'Rahul Jain', slug: 'rahul-jain', email: 'rahul.j@mavlers.com', aliases: ['rahul jain'], lastYearAvg: 5738 },
  { name: 'Sankalp Waman Bhoyar', slug: 'sankalp-waman-bhoyar', email: 'sankalp@mavlers.com', aliases: ['sankalp waman bhoyar', 'sankalp bhoyar', 'sankalp'], lastYearAvg: 16224 },
]

/**
 * RETIRED, 24 Sep 2026 — and kept empty rather than deleted, so the next person who
 * thinks of re-adding one reads why it went.
 *
 * This held clients whose revenue-sheet `sme` column was thought wrong: 'zulu 8' was
 * moved wholesale to Maitri Shah because most of it is hers. But "most of it" is not
 * "all of it". ZULU 8 carries genuine Nitin Mishra lines ($643 in July, $674 in
 * September, $936 in May and June) and a Manmohan Jangra one, and this moved every one
 * of them onto Maitri — inflating her and understating him, in the one figure both of
 * them are measured on.
 *
 * It also put the scorecard at odds with the business number, which counts the lines
 * carrying a person's name and nothing else. Two answers to "what did Maitri book" is
 * worse than either answer being slightly off.
 *
 * If an sme cell is genuinely wrong, the fix is the cell.
 */
export const PM_REASSIGN: Record<string, string> = {}

/**
 * RETIRED, 24 Sep 2026 — the feed now agrees with the pivot it was pinned from.
 *
 * These were Apr–Jun 2026 per-month bookings typed in from the revenue sheet's own pivot,
 * because our feed disagreed with it at the time. Re-checked against live data: every PM
 * now matches within $1–2, which is the export's rounding and not a disagreement.
 *
 * A hard-coded override that agrees with the data is not harmless — it is a second source
 * of truth that will go on being right until the day the sheet is corrected and it
 * silently is not.
 */
export const Q1_FY2026_ACTUALS: Record<string, Record<string, number>> = {}

const BY_ALIAS = new Map<string, PmMember>()
for (const m of PM_TEAM) for (const a of m.aliases) BY_ALIAS.set(a, m)

/** The PM who owns a free-text name cell, or undefined if they aren't on the team. */
export const pmOf = (raw?: string): PmMember | undefined =>
  raw ? BY_ALIAS.get(raw.trim().toLowerCase()) : undefined

/**
 * The PM a signed-in viewer IS, if any.
 *
 * Someone who matches is a PM and sees only their own scorecard. Someone who
 * does not — leadership, an AM, anyone else in the business — is not being
 * measured by this page and sees the whole team. That is the whole rule; there
 * is no separate list of who is allowed to see everything.
 */
export const pmByEmail = (email?: string | null): PmMember | undefined =>
  email ? PM_TEAM.find(m => m.email === email.trim().toLowerCase()) : undefined

export const pmBySlug = (slug: string): PmMember | undefined => PM_TEAM.find(m => m.slug === slug)

// ---------------------------------------------------------------------------
// Fiscal calendar. The business runs April–March, so Q1 = Apr–Jun, Q2 = Jul–Sep,
// Q3 = Oct–Dec, Q4 = Jan–Mar. This mirrors app/last-year so the two pages cannot
// disagree about which months a quarter contains.
// ---------------------------------------------------------------------------
export interface FQ { fy: number; q: number }
export const fqOf = (y: number, m: number): FQ =>
  m >= 4 && m <= 6 ? { fy: y, q: 1 } : m >= 7 && m <= 9 ? { fy: y, q: 2 } : m >= 10 ? { fy: y, q: 3 } : { fy: y - 1, q: 4 }
export const qStartMonth = (q: number) => (q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1)
export const qCalYear = (f: FQ) => (f.q === 4 ? f.fy + 1 : f.fy)
const pad = (n: number) => String(n).padStart(2, '0')
/** Inclusive 'YYYY-MM' bounds for a fiscal quarter. */
export const qRange = (f: FQ): [string, string] => {
  const sm = qStartMonth(f.q)
  const y = qCalYear(f)
  return [`${y}-${pad(sm)}`, `${y}-${pad(sm + 2)}`]
}
export const qLabel = (f: FQ) => `Q${f.q} FY${String(f.fy).slice(2)}-${String(f.fy + 1).slice(2)}`
export const decQ = (f: FQ): FQ => (f.q > 1 ? { fy: f.fy, q: f.q - 1 } : { fy: f.fy - 1, q: 4 })

// ---------------------------------------------------------------------------
// Quarterly KPI scoring — the band tables from the scorecard.
//
// Weights: Growth 40%, Q2C 40%, Feedback 20%.
//
// One deliberate deviation, because the scorecard as written has a hole in it:
// Growth lists "16% or more" = 10 and "10% to less than 15%" = 8, which leaves
// 15.0–15.99% scoring nothing at all. It is read here as "10% to less than 16%",
// so the bands are continuous. Nothing else is altered.
// ---------------------------------------------------------------------------
export interface Band { min: number; score: number; label: string }

export const GROWTH_BANDS: Band[] = [
  { min: 16, score: 10, label: '16% or more' },
  { min: 10, score: 8, label: '10% to less than 16%' },
  { min: 8, score: 6, label: '8% to less than 10%' },
  { min: 6, score: 5, label: '6% to less than 8%' },
  { min: 4, score: 4, label: '4% to less than 6%' },
  { min: -Infinity, score: 3, label: 'Less than 4%' },
]

export const Q2C_BANDS: Band[] = [
  { min: 85, score: 10, label: '85% or more' },
  { min: 55, score: 8, label: '55% to less than 85%' },
  { min: 35, score: 6, label: '35% to less than 55%' },
  { min: 15, score: 5, label: '15% to less than 35%' },
  { min: 10, score: 4, label: '10% to less than 15%' },
  { min: -Infinity, score: 3, label: 'Less than 10%' },
]

export const FEEDBACK_BANDS: Band[] = [
  { min: 8, score: 10, label: '8 or more' },
  { min: 6, score: 8, label: '6–7 feedbacks' },
  { min: 3, score: 6, label: '3–5 feedbacks' },
  { min: -Infinity, score: 3, label: '2 feedbacks or below' },
]

export const WEIGHTS = { growth: 0.4, q2c: 0.4, feedback: 0.2 }

// ---------------------------------------------------------------------------
// The TOTAL, as the KPI sheet computes it.
//
// Total is NOT the 1–10 band score weighted together. It is attainment against
// the top band — how far each measure got towards a full 10 — capped at 100% and
// weighted 40/40/20:
//
//   Total % = 40% x (growth / 16) + 40% x (Q2C / 85) + 20% x (feedbacks / 8)
//
// Verified against every PM on the Q1 2026 KPI sheet: Maitri 24, Rahul Jain 69,
// Gaurav 61, Paryusha 56, Bonny 8, Gagandeep 41 — all exact. Note what the shape
// of it means: negative growth contributes nothing rather than going negative,
// and a missing Q2C contributes nothing too, which is why Bonny (no Q2C, 1%
// growth, 2 feedbacks) lands at 8% rather than being left blank.
// ---------------------------------------------------------------------------
export const TARGETS = { growth: 16, q2c: 85, feedback: 8 }

/** How far a measure got towards its top band: 0 at or below zero, 1 at target. */
export const attainment = (v: number | null | undefined, target: number): number =>
  v == null || !Number.isFinite(v) ? 0 : Math.min(Math.max(v, 0) / target, 1)

/** The Total, as a percentage. Every component counts, including a zero one. */
export function totalPct(growth: number | null, q2c: number | null, feedback: number | null): number {
  return 100 * (
    WEIGHTS.growth * attainment(growth, TARGETS.growth) +
    WEIGHTS.q2c * attainment(q2c, TARGETS.q2c) +
    WEIGHTS.feedback * attainment(feedback, TARGETS.feedback)
  )
}

/** The band a value falls in. `null` in → `null` out, so "no data" never scores 3. */
export const bandOf = (bands: Band[], v: number | null | undefined): Band | null =>
  v == null || !Number.isFinite(v) ? null : bands.find(b => v >= b.min) || bands[bands.length - 1]

export const scoreOf = (bands: Band[], v: number | null | undefined): number | null => bandOf(bands, v)?.score ?? null

/**
 * Weighted total out of 10. Returns null unless every component scored — a
 * partial total would read as a low score rather than as missing data, and the
 * feedback feed is thin enough that this happens often.
 */
export function overallScore(growth: number | null, q2c: number | null, fb: number | null): number | null {
  const g = scoreOf(GROWTH_BANDS, growth)
  const c = scoreOf(Q2C_BANDS, q2c)
  const f = scoreOf(FEEDBACK_BANDS, fb)
  if (g == null || c == null || f == null) return null
  return g * WEIGHTS.growth + c * WEIGHTS.q2c + f * WEIGHTS.feedback
}

/**
 * Below this many decided quotes a Q2C percentage is noise, not performance —
 * one deal moves it 20 points. The pages still show the number, marked thin.
 */
export const THIN_Q2C = 5

// ---------------------------------------------------------------------------
// The baseline RATCHET.
//
// A PM is measured against their last-year monthly average until they beat it.
// Once they do, the bar rises to what they actually achieved — "the higher number
// is the base for the quarter". A PM who misses keeps the same bar next quarter
// rather than being handed an easier one.
//
// So the base for a quarter is the greatest of the last-year average and every
// quarterly average already posted this financial year. For Q2 FY2026 that means
// Afzal, Gagandeep, Gaurav, Paryusha, Rahul Jain and Sankalp — who cleared Q1 —
// carry their Q1 average forward, while Bonny, Maitri, Malay, Nitin and Madhav,
// who did not, stay on their last-year figure.
export function baselineFor(m: PmMember, priorQuarterAverages: number[]): number {
  return Math.max(m.lastYearAvg, ...priorQuarterAverages.filter(v => Number.isFinite(v) && v > 0))
}
