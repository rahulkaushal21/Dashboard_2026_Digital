// Which business unit the board is being read for.
//
// Pratik heads LP/Hub and reads this dashboard for that business; everybody else reads
// it for Web. One control at the top, and every total, count and chart underneath it
// follows the selection — the same rule the month picker already obeys, because a
// headline that ignores the filter above it is worse than no filter at all.
//
// THREE POSITIONS, NOT SIX. The departments split LP / HUB / WEB-AU / WEB-UK / WEB-US /
// AI & Automation, and the pages that want that detail still have their own filters.
// This control answers a different question — whose business is this — and there are
// only two answers plus "both".

import { SERVICE_DEPTS } from './deal-fields'

export type Unit = 'all' | 'lp-hub' | 'web'

export const UNITS: { id: Unit; label: string; hint: string }[] = [
  { id: 'all',    label: 'All',     hint: 'Every department' },
  { id: 'lp-hub', label: 'LP/Hub',  hint: 'LP and HUB' },
  { id: 'web',    label: 'Web',     hint: 'WEB-AU, WEB-UK, WEB-US and AI & Automation' },
]

/**
 * Which unit a department belongs to, or null when the department is unknown.
 *
 * AI & Automation sits under Web by decision, not by derivation — it is neither LP nor
 * HUB nor a WEB- pod, and leaving it out of both would have made 14 booked lines vanish
 * from every filtered view while still counting under All.
 *
 * Returns NULL rather than guessing. A row we cannot place is shown under All and
 * counted out loud on the page; it never gets quietly assigned to whichever side is
 * being looked at.
 */
export function unitOf(dept?: string | null): Exclude<Unit, 'all'> | null {
  const d = (dept || '').trim().toUpperCase()
  if (!d) return null
  if (d === 'LP' || d === 'HUB' || d === 'LP/HUB') return 'lp-hub'
  // 'WEB-US (KS)' and anything else prefixed WEB- counts as Web; the sheet has 12 of
  // the former and they are WEB-US lines with an owner's initials appended.
  if (d.startsWith('WEB')) return 'web'
  if (d.startsWith('AI')) return 'web'
  return null
}

/** Does this row belong in the current view? Unknown departments are excluded once a unit is picked. */
export function inUnit(dept: string | null | undefined, unit: Unit): boolean {
  if (unit === 'all') return true
  return unitOf(dept) === unit
}

/** How many of these rows could not be placed at all. Pages state this rather than hiding it. */
export function unplaceable<T>(rows: T[], deptOf: (r: T) => string | null | undefined): number {
  return rows.reduce((n, r) => n + (unitOf(deptOf(r)) === null ? 1 : 0), 0)
}

/** The departments a unit covers, for a subtitle or a tooltip. */
export function deptsIn(unit: Unit): string[] {
  if (unit === 'all') return [...SERVICE_DEPTS]
  return SERVICE_DEPTS.filter(d => unitOf(d) === unit)
}

export const unitLabel = (u: Unit) => UNITS.find(x => x.id === u)?.label || 'All'

// ── Remembering the choice ───────────────────────────────────────────────────────
// Per signed-in address, so two people sharing a laptop do not inherit each other's
// view, and so Pratik sets it once and every page and every later session honours it.
const key = (email?: string | null) => `dash_unit:${(email || 'anon').trim().toLowerCase()}`

export function readUnit(email?: string | null): Unit {
  if (typeof window === 'undefined') return 'all'
  try {
    const v = window.localStorage.getItem(key(email))
    return v === 'lp-hub' || v === 'web' || v === 'all' ? v : 'all'
  } catch { return 'all' }
}

export function writeUnit(email: string | null | undefined, unit: Unit) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key(email), unit) } catch { /* private window; the session still works */ }
}

/**
 * ?unit=lp-hub in the address bar wins for that load and is NOT saved.
 *
 * The saved choice deliberately stays out of the URL: a link somebody pastes into Slack
 * should mean what the sender saw, and a colleague opening it should not have their own
 * stored view silently rewritten by someone else's link.
 */
export function unitFromUrl(): Unit | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('unit')
  return v === 'lp-hub' || v === 'web' || v === 'all' ? v : null
}
