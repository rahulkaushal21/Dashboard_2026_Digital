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

export const GEOS = ['US', 'UK', 'AU'] as const

/** Where a hand-entered deal came from, when email did not catch it. */
export const CHANNELS = ['referral', 'linkedin', 'upsell', 'event', 'inbound', 'other'] as const
