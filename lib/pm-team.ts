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
  { name: 'Afzal Multani', slug: 'afzal-multani', aliases: ['afzal multani', 'afzal'], lastYearAvg: 23081 },
  { name: 'Bonny Chhatbar', slug: 'bonny-chhatbar', aliases: ['bonny chhatbar', 'bonny chhatbhar', 'bonny'], lastYearAvg: 22962 },
  { name: 'Gagandeep Singh', slug: 'gagandeep-singh', aliases: ['gagandeep singh', 'gagandeep'], lastYearAvg: 21416 },
  { name: 'Gaurav Pardeshi', slug: 'gaurav-pardeshi', aliases: ['gaurav pardeshi', 'gaurav'], lastYearAvg: 12201 },
  { name: 'Madhav Maheshwari', slug: 'madhav-maheshwari', aliases: ['madhav maheshwari', 'madhav'], lastYearAvg: 10000 },
  { name: 'Maitri Shah', slug: 'maitri-shah', aliases: ['maitri shah', 'maitri'], lastYearAvg: 15638 },
  // The revenue sheet also spells him 'Malay Srivastava' (no 'h').
  { name: 'Malay Shrivastava', slug: 'malay-shrivastava', aliases: ['malay shrivastava', 'malay srivastava', 'malay'], lastYearAvg: 20464 },
  { name: 'Nitin Mishra', slug: 'nitin-mishra', aliases: ['nitin mishra', 'nitin'], lastYearAvg: 23333 },
  { name: 'Paryusha Jain', slug: 'paryusha-jain', aliases: ['paryusha jain', 'paryusha'], lastYearAvg: 16251 },
  // 'Rahul' alone is deliberately NOT an alias. Rahul Kaushal is a different
  // person who also appears as a pc_sme, and a bare first-name match would hand
  // his rows to Rahul Jain. Confirmed by the user: keep them apart.
  { name: 'Rahul Jain', slug: 'rahul-jain', aliases: ['rahul jain'], lastYearAvg: 5738 },
  { name: 'Sankalp Waman Bhoyar', slug: 'sankalp-waman-bhoyar', aliases: ['sankalp waman bhoyar', 'sankalp bhoyar', 'sankalp'], lastYearAvg: 16224 },
]

/**
 * Clients whose revenue-sheet `sme` column is wrong, and who they actually belong to.
 *
 * ZULU 8 is Maitri's account — it is booked to her in 24 of its 33 monthly rows.
 * The strays (Rahul Jain $3,793 in May 2026, Nitin Mishra in May/Jun/Jul 2026,
 * plus older Harshvardhan and Manmohan rows) are mis-keyed, and the May one alone
 * moved $3,793 off Maitri and onto Rahul Jain — enough to swing both their growth
 * figures by 19 and 8 points against the revenue sheet's own pivot.
 *
 * Applied in the app rather than patched into the database, because web_revenue is
 * FULL REPLACE on every sync and a hand-edit there is gone within 30 minutes. The
 * real fix is the SME column in the revenue sheet; until then this keeps the
 * scorecard honest. Keys are lower-cased company names.
 */
export const PM_REASSIGN: Record<string, string> = {
  'zulu 8': 'Maitri Shah',
}

/**
 * Q1 FY2026 (Apr–Jun 2026) per-month bookings, taken verbatim from the revenue
 * sheet's own pivot table, which is the agreed final figure for the quarter.
 *
 * Some members were adjusted at source after our feed last read them, so these
 * override whatever web_revenue aggregates for these three months. They total
 * $144,069 / $196,677 / $217,251 against the pivot's $144,070 / $196,676 /
 * $217,250 — a $1 rounding difference per month, because the revenue export
 * rounds to whole dollars before we ever see it.
 *
 * Keyed by PM slug. Delete a row here once the feed agrees with the sheet again.
 */
export const Q1_FY2026_ACTUALS: Record<string, Record<string, number>> = {
  'afzal-multani':        { '2026-04': 21250, '2026-05': 22290, '2026-06': 40011 },
  'bonny-chhatbar':       { '2026-04': 11119, '2026-05': 29264, '2026-06': 24687 },
  'gagandeep-singh':      { '2026-04': 23036, '2026-05': 21385, '2026-06': 20322 },
  'gaurav-pardeshi':      { '2026-04': 18199, '2026-05': 5126, '2026-06': 19613 },
  'madhav-maheshwari':    { '2026-04': 1469, '2026-05': 1258, '2026-06': 5109 },
  'maitri-shah':          { '2026-04': 7679, '2026-05': 13672, '2026-06': 17360 },
  'malay-shrivastava':    { '2026-04': 6608, '2026-05': 22743, '2026-06': 17723 },
  'nitin-mishra':         { '2026-04': 17230, '2026-05': 27682, '2026-06': 25006 },
  'paryusha-jain':        { '2026-04': 17971, '2026-05': 21200, '2026-06': 14950 },
  'rahul-jain':           { '2026-04': 5008, '2026-05': 6610, '2026-06': 7473 },
  'sankalp-waman-bhoyar': { '2026-04': 14500, '2026-05': 25447, '2026-06': 24997 },
}

const BY_ALIAS = new Map<string, PmMember>()
for (const m of PM_TEAM) for (const a of m.aliases) BY_ALIAS.set(a, m)

/** The PM who owns a free-text name cell, or undefined if they aren't on the team. */
export const pmOf = (raw?: string): PmMember | undefined =>
  raw ? BY_ALIAS.get(raw.trim().toLowerCase()) : undefined

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
