// The fixed choices on a deal, in ONE place so the add form, the confirm dialog and
// anything later cannot drift apart. Free-text versions of these are what made the
// Quotes tab hard to aggregate — the same department typed six ways — so they are
// dropdowns everywhere.

/**
 * Does a line count as revenue? The mirror of `counts_as_revenue(text)` in the database
 * (migration 141), which `web_revenue_lines` applies — so the home page, the forecast and
 * the PM scorecards all obey it already.
 *
 * Three states are NOT money. Awaiting Information is a quote; Cancelled did not happen;
 * On Hold has not happened yet and may not.
 *
 * It lives here because two pages had each written their own copy testing only
 * /awaiting/, and both therefore counted On Hold as revenue. On 2 Nov 2026 that made the
 * KB report and the Project sheet read October as $201,834 against the $196,074 every
 * other page showed — one Appleprint line, "CC Internal Umbraco", $5,760, On Hold.
 * One definition, imported, so the next page cannot drift again.
 */
export const countsAsRevenue = (deliveryStatus?: string | null) =>
  !/awaiting|on hold|cancel/i.test(deliveryStatus || '')

/** Departments work is booked against. */
export const SERVICE_DEPTS = ['LP', 'HUB', 'WEB-AU', 'WEB-UK', 'WEB-US', 'AI & Automation'] as const

/**
 * Currencies a quote can be raised in.
 *
 * 'EURO' is deliberately absent even though the revenue sheet's own formula accepts it
 * alongside 'EUR'. One spelling in, one meaning out; the conversion still understands
 * 'EURO' for the historical rows that carry it.
 */
export const CURRENCIES = ['USD', 'AUD', 'NZD', 'GBP', 'EUR', 'CAD', 'SGD', 'INR', 'AED'] as const

/** Engagement model — what kind of work it is. Spelling matches the revenue sheet. */
export const PROJECT_TYPES = [
  'New Development', 'Ad-hoc', 'Maintanance', 'Additional Pages',
  'Dedicated', 'Partial Dedicated', 'Ballpark',
] as const

/**
 * Geography.
 *
 * The dashboard stores the short code and always has — ten pages filter on 'US'/'UK'/'AU'
 * and 823 rows carry them. The revenue sheet writes the region: 'US/Canada', 'AU/NZ',
 * 'UK/EU', 'Others'. Both are right for their own side, so the code is what is STORED and
 * the region is what is SHOWN and what gets written to the sheet. Changing the stored
 * value to match the sheet would break every existing filter for no gain.
 */
export const GEOS = ['US', 'UK', 'AU', 'Other'] as const

/** What each code is called in the revenue sheet — the label PMs recognise. */
export const GEO_SHEET_LABEL: Record<string, string> = {
  US: 'US/Canada', UK: 'UK/EU', AU: 'AU/NZ', Other: 'Others',
}

/** Where a hand-entered deal came from, when email did not catch it. */
export const CHANNELS = ['referral', 'linkedin', 'upsell', 'event', 'inbound', 'other'] as const

/** Which pod a PM sits in. Used for tagging and grouping the team, not for permissions. */
export const PM_TEAMS = ['LP/HUB', 'WEB-AU', 'WEB-UK', 'WEB-US'] as const

/**
 * Fields whose options come out of the revenue sheet rather than out of this file, via
 * the `web_sheet_vocab` view. They have been filled by hand for 3,218 rows and those
 * spellings ARE the vocabulary — a parallel list here would write "Dev & Design" where
 * every historical row says "Dev and Design", and the tab would stop grouping.
 */
export type SheetVocabField =
  'service_type' | 'delivery_type' | 'client_type' | 'technology' | 'delivery_status' | 'business_type'

/** Used when the sheet has not been captured yet, so a dropdown is never empty. */
export const VOCAB_FALLBACK: Record<SheetVocabField, string[]> = {
  service_type: ['Development Only', 'Dev and Design', 'Project Management', 'Dev and Search', 'AI & Automation'],
  delivery_type: ['Effort based', 'Expedite', 'Client Specified TAT', 'Super Expedite'],
  client_type: ['Agency', 'Direct/End'],
  technology: ['Wordpress', 'Hubspot', 'Shopify', 'HTML', 'React'],
  delivery_status: ['Under Development', 'Delivered', 'On Hold', 'Cancelled', 'Under Review'],
  // Two values, not four. The revenue sheet has been filled by hand with Repeat, New and
  // New Repeat, and the dashboard's own Quotes sync writes a fourth, "Existing". Three of
  // those mean the same thing — a client who has bought before — and the split was never
  // deliberate, it was two people typing. Folded to Repeat / New; see normBusinessType.
  business_type: ['Repeat', 'New'],
}

/**
 * Existing → Repeat, New Repeat → Repeat, New stays New.
 *
 * Applied wherever a business type is READ (prefilling the confirm dialog, building the
 * dropdown from the sheet's own vocabulary) as well as written, so a deal carrying the
 * old spelling shows the new one rather than an odd "(not in list)" option. The historical
 * sheet rows are left exactly as they are: rewriting 3,218 rows of somebody else's tab to
 * tidy a word is not a change this dashboard should make on its own.
 */
/**
 * Who delivery sits with for a department, when nobody has been named yet.
 *
 * Set by Rahul on 23 Nov 2026, and NOT the historical majority — that was checked first
 * and disagrees for three of the six. Since July 2026 WEB-UK is Rahul Kumar at 52% (a
 * third of it Contractor), WEB-US is Gagandeep Singh at 43% with Harshal at 10%, and
 * LP/HUB are Harshvardhan Sharma at ~89%; neither Pratik nor Hiren appears in the column
 * at all. These names are who is ACCOUNTABLE for the department now, which no amount of
 * history can tell you. Do not "correct" them back towards the majority.
 *
 * A DEFAULT, not a lock: it fills the field when it is empty and the person confirming
 * can pick anyone else, including Contractor. The database carries the same map as a
 * backstop (migration 195) so a row created by the email scan, which never opens this
 * form, is not left blank.
 */
/**
 * People whose work is only ever LP or HUB, and never a Web department.
 *
 * Rahul found rows on the project sheet where Nitin Mishra or Madhav Maheshwari were the
 * PC/SME or the expert while Service Department said WEB-AU, WEB-UK or WEB-US, and fixed
 * them by hand on 25 Nov 2026. The department is not cosmetic — it is what the Business
 * Unit switch splits on and what every per-team total is grouped by — so an LP delivery
 * filed under WEB-US moves money between two teams' numbers.
 *
 * The check is a BLOCK, not a nudge, because the wrong value is invisible once saved: the
 * row looks complete and only a person who knows who works where can spot it.
 *
 * Add somebody here only when they genuinely never take Web work. Aliases exist because
 * the sheet writes short names ("Manvi", "Nevilson"), and a BARE FIRST NAME is listed
 * only where exactly one person in the book carries it — same trap as the NBD list, where
 * three Kaustubhs and two Rahuls make a bare first name dangerous. There is one Madhav
 * and one Nitin today; check before adding another.
 */
export const LP_HUB_ONLY: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: 'Nitin Mishra', aliases: ['nitin mishra', 'nitin'] },
  { name: 'Madhav Maheshwari', aliases: ['madhav maheshwari', 'madhav'] },
]

/** The LP/HUB-only person among these names, if any. */
export const lpHubOnlyPerson = (...who: (string | null | undefined)[]): string | null => {
  for (const w of who) {
    const t = (w || '').trim().toLowerCase()
    if (!t) continue
    const hit = LP_HUB_ONLY.find(p => p.aliases.includes(t))
    if (hit) return hit.name
  }
  return null
}

/**
 * null when the row is fine; otherwise the one-line reason it is not.
 *
 * A blank department is NOT a conflict — that is a missing field, and it already has its
 * own check. This one only fires when a department is set and contradicts the person.
 */
export const deptPersonConflict = (
  dept: string | null | undefined, ...who: (string | null | undefined)[]
): string | null => {
  const person = lpHubOnlyPerson(...who)
  if (!person) return null
  const d = (dept || '').trim()
  if (!d || d === 'LP' || d === 'HUB') return null
  return `${person} works LP/HUB — ${d} is wrong for this row`
}

export const DEPT_EXPERT_DEFAULT: Record<string, string> = {
  'WEB-AU': 'KS',
  'WEB-UK': 'Rahul Kumar',
  'WEB-US': 'Harshal Mehuriya',
  'LP': 'Pratik Bhatt',
  'HUB': 'Pratik Bhatt',
  'AI & Automation': 'Rahul Kaushal',
}
export const defaultExpertFor = (dept?: string | null): string =>
  DEPT_EXPERT_DEFAULT[(dept || '').trim()] || ''

export const normBusinessType = (v?: string | null) => {
  const t = (v || '').trim().toLowerCase()
  if (!t) return ''
  // Repeat is tested FIRST: "New Repeat" starts with "new" and is still a repeat client.
  if (/repeat|existing/.test(t)) return 'Repeat'
  if (/^new\b/.test(t)) return 'New'
  return (v || '').trim()
}

/**
 * The retainer-shaped project types.
 *
 * These used to be EXEMPT from needing a delivery date, on the grounds that a retainer
 * is not delivered on a day. That is true of the engagement and false of the line: a
 * Dedicated line covers one month, that month ends, and the delivery team works from
 * the date. The old sheet settles it — all 44 Dedicated and 19 Partial Dedicated rows
 * in it carry a delivery date, so PMs were filling it in regardless of the rule.
 *
 * Since 145 the date is required on every type and this list only decides whether to
 * HINT what the date usually is. Rahul, 12 Oct 2026.
 */
export const RETAINER_SHAPED_TYPES = ['Dedicated', 'Partial Dedicated', 'Ballpark']
