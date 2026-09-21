// The fixed choices on a deal, in ONE place so the add form, the confirm dialog and
// anything later cannot drift apart. Free-text versions of these are what made the
// Quotes tab hard to aggregate — the same department typed six ways — so they are
// dropdowns everywhere.

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
export const normBusinessType = (v?: string | null) => {
  const t = (v || '').trim().toLowerCase()
  if (!t) return ''
  // Repeat is tested FIRST: "New Repeat" starts with "new" and is still a repeat client.
  if (/repeat|existing/.test(t)) return 'Repeat'
  if (/^new\b/.test(t)) return 'New'
  return (v || '').trim()
}

/** Project types with no delivery date — a retainer is not delivered on a day. */
export const OPEN_ENDED_TYPES = ['Dedicated', 'Partial Dedicated', 'Ballpark']
