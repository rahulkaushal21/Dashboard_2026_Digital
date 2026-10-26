// The Actions buckets, as pure rules.
//
// One copy, read by two places: app/actions/page.tsx draws the lists, and the sidebar
// shows how many there are beside "Actions". They used to be able to disagree only if
// somebody edited one and not the other — so the rules live here and nowhere else.

import { inUnit, type Unit } from './business-unit'
import {
  ownerMatches, getProjectLedger, getOpportunities, getOpportunityDepts, getDirectoryMember,
  type LedgerRow, type Opportunity, type DirectoryMember,
} from './supabase'

export const QUIET_DAYS = 14

export type ProjectBucket = 'today' | 'week' | 'past'
export type QuoteBucket = 'quiet' | 'yes'
export type Bucket = ProjectBucket | QuoteBucket
export const PROJECT_BUCKETS: Bucket[] = ['today', 'week', 'past']
export const BUCKETS: Bucket[] = ['today', 'week', 'past', 'quiet', 'yes']

/** Today as YYYY-MM-DD in the viewer's own timezone. */
export const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Whole calendar days from a to b, both YYYY-MM-DD. Parsed as UTC so a clock change
// never turns one day into 0.96 of one.
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
export const day = (d?: string | null) => { const v = (d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '' }

// A project is open until it is Delivered or Cancelled. On Hold stays in: a held job with
// a date in the past is exactly the one nobody is looking at.
export const isOpenProject = (r: LedgerRow) => !/^(delivered|cancel)/i.test((r.delivery_status || '').trim())

// WHAT IS ACTUALLY WAITING ON DELIVERY. Not merely "not finished": a project ON HOLD is
// not late, it is parked, usually by the client, and chasing it is somebody's time spent
// on a decision that is not theirs to make. Awaiting Information is the same — the ball
// is with the client. Owner's call, 26 Oct 2026: "only project with under development or
// under review should be visible".
//
// This decides all three delivery buckets, not just the overdue one. Splitting it would
// mean a parked project sat in Due this week and then vanished the day it went late,
// which reads as a bug however it is explained.
const DELIVERABLE = ['under development', 'under review'];
export const isAwaitingDelivery = (r: LedgerRow) =>
  DELIVERABLE.includes((r.delivery_status || '').trim().toLowerCase())

// Same verdict the Opportunities page reaches, kept to the open case: anything won,
// booked, lost or on hold is not a quote waiting on anybody.
export const isOpenDeal = (x: Opportunity) => {
  if (x.won || x.email_won || x.booked_month || x.email_lost || x.rolled_into || x.merged) return false
  const s = (x.status || '').toLowerCase()
  return !(s.includes('cancel') || s === 'lost' || s.includes('hold') || s.includes('won') || s.includes('confirm'))
}
export const dealDate = (x: Opportunity) => day(x.source_date || x.first_date)
// days_since_touch comes from email where it exists, which is the better answer; the
// quote's own date is the fallback.
export const quietDays = (x: Opportunity, today: string): number | null => {
  if (x.days_since_touch != null && Number.isFinite(Number(x.days_since_touch))) return Number(x.days_since_touch)
  const d = dealDate(x)
  return d ? Math.max(0, dayDiff(d, today)) : null
}

/**
 * Does a cell name the chosen person? '' means everyone. For the signed-in PM their
 * directory aliases count too — the sheet spells people several ways.
 */
export function personMatcher(person: string, me: DirectoryMember | null): (cell?: string) => boolean {
  if (!person) return () => true
  const names = [person.toLowerCase()]
  if (me && me.name === person) names.push(...me.aliases)
  return (cell?: string) => ownerMatches(cell, names)
}

/** Whose list the page opens on: a PM their own, an admin (or anyone not on the directory) everybody's. */
export const defaultPerson = (me: DirectoryMember | null, isAdmin: boolean) => (!isAdmin && me?.name) ? me.name : ''

export interface Scope { unit: Unit; isPerson: (cell?: string) => boolean; deptById: Map<number, string> }

export const scopeLedger = (ledger: LedgerRow[], s: Scope) => ledger.filter(r => inUnit(r.service_dept, s.unit) && s.isPerson(r.pm_owner))
export const scopeDeals = (deals: Opportunity[], s: Scope) =>
  deals.filter(x => inUnit(s.deptById.get(Number(x.id)) || '', s.unit) && s.isPerson(x.pm_owner))

/** Open projects by delivery date: today, the next seven days, and anything already past. */
export function projectBuckets(rows: LedgerRow[], today: string): Record<ProjectBucket, LedgerRow[]> {
  const out: Record<ProjectBucket, LedgerRow[]> = { today: [], week: [], past: [] }
  for (const r of rows) {
    const dd = day(r.delivery_date)
    if (!isAwaitingDelivery(r) || !dd) continue
    const n = dayDiff(today, dd)
    if (n === 0) out.today.push(r)
    else if (n >= 1 && n <= 7) out.week.push(r)
    else if (n < 0) out.past.push(r)
  }
  out.week.sort((a, b) => day(a.delivery_date).localeCompare(day(b.delivery_date)))
  out.past.sort((a, b) => day(a.delivery_date).localeCompare(day(b.delivery_date)))   // longest overdue first
  return out
}

/** Open quotes gone quiet, and open quotes the client has already said yes to. */
export function quoteBuckets(rows: Opportunity[], today: string): Record<QuoteBucket, Opportunity[]> {
  const quiet: Opportunity[] = [], yes: Opportunity[] = []
  for (const x of rows) {
    if (!isOpenDeal(x)) continue
    if (x.flag_committed_in_email) yes.push(x)
    const q = quietDays(x, today)
    if (!x.unlikely && q != null && q >= QUIET_DAYS) quiet.push(x)
  }
  quiet.sort((a, b) => (quietDays(b, today) ?? 0) - (quietDays(a, today) ?? 0))
  yes.sort((a, b) => dealDate(b).localeCompare(dealDate(a)))
  return { quiet, yes }
}

export const bucketCounts = (pb: Record<ProjectBucket, unknown[]>, qb: Record<QuoteBucket, unknown[]>): Record<Bucket, number> => ({
  today: pb.today.length, week: pb.week.length, past: pb.past.length, quiet: qb.quiet.length, yes: qb.yes.length,
})
export const totalOf = (c: Record<Bucket, number>) => BUCKETS.reduce((s, b) => s + c[b], 0)

/**
 * The headline total of the Actions page as this viewer first sees it — their own rows
 * for a PM, everyone's for an admin — in the given department. Uses the same cached
 * readers the page does, so opening the page after this costs nothing extra.
 */
export async function countActionsFor(email: string | null, isAdmin: boolean, unit: Unit, today = localToday()): Promise<number> {
  const [ledger, deals, deptById, me] = await Promise.all([
    getProjectLedger(), getOpportunities(),
    getOpportunityDepts().catch(() => new Map<number, string>()),
    getDirectoryMember(email),
  ])
  const scope: Scope = { unit, deptById, isPerson: personMatcher(defaultPerson(me, isAdmin), me) }
  return totalOf(bucketCounts(projectBuckets(scopeLedger(ledger, scope), today), quoteBuckets(scopeDeals(deals, scope), today)))
}

/** Fired by the Actions page after any write, so the sidebar recounts. */
export const ACTIONS_CHANGED = 'actions-changed'
export const announceActionsChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACTIONS_CHANGED)) }
