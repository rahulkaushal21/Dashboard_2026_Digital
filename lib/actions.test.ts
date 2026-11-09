// Run with: npx -y tsx lib/actions.test.ts
//
// The two record-keeping buckets. Every case here is a judgement that was made on real
// data and could be silently reversed by a one-character edit: a zero that is not a cost,
// a Cancelled row that owes nobody anything, a Delivered row that still does, and the
// 1 April line that keeps the frozen spreadsheet out of the list.

import assert from 'node:assert/strict'
import { gapBuckets, bucketCounts, totalOf, GAP_FROM, BUCKETS, ALL_BUCKETS, isLedgerBucket } from './actions'
import type { LedgerRow } from './supabase'

// Only the fields the rules read; the rest of a LedgerRow is irrelevant here.
const row = (p: Partial<LedgerRow>): LedgerRow => ({
  row_key: Math.random().toString(36).slice(2), source: 'raw', source_id: 1, in_sheet: true,
  booking_month: '2026-07-01', delivery_status: 'Delivered', ...p,
} as LedgerRow)

const ids = (rs: LedgerRow[]) => rs.map(r => r.project_name).sort()

const tests: [string, () => void][] = [

  ['a booked row with no internal date is listed', () => {
    const { internal } = gapBuckets([row({ project_name: 'a', internal_delivery: undefined })])
    assert.deepEqual(ids(internal), ['a'])
  }],

  ['a row that HAS an internal date is not', () => {
    const { internal } = gapBuckets([row({ project_name: 'a', internal_delivery: '2026-07-20' })])
    assert.equal(internal.length, 0)
  }],

  ['an empty-string internal date counts as missing, not as filled in', () => {
    const { internal } = gapBuckets([row({ project_name: 'a', internal_delivery: '' })])
    assert.deepEqual(ids(internal), ['a'], 'a blank cell is a blank cell')
  }],

  ['Delivered rows stay in — that is where most of them are', () => {
    const { internal } = gapBuckets([row({ project_name: 'a', delivery_status: 'Delivered' })])
    assert.deepEqual(ids(internal), ['a'])
  }],

  ['Cancelled rows are out of both lists', () => {
    const rows = [
      row({ project_name: 'a', delivery_status: 'Cancelled' }),
      row({ project_name: 'b', delivery_status: 'cancelled', expert: 'Contractor' }),
    ]
    const { internal, outsource } = gapBuckets(rows)
    assert.equal(internal.length, 0)
    assert.equal(outsource.length, 0)
  }],

  ['THE DATE WINDOW: anything booked before 1 April 2026 is a closed book', () => {
    const rows = [
      row({ project_name: 'old', booking_month: '2026-03-01' }),
      row({ project_name: 'edge', booking_month: GAP_FROM }),
      row({ project_name: 'new', booking_month: '2026-11-01' }),
    ]
    assert.deepEqual(ids(gapBuckets(rows).internal), ['edge', 'new'], '1 April itself is IN')
  }],

  ['a row with no booking month at all falls outside the window', () => {
    const { internal } = gapBuckets([row({ project_name: 'a', booking_month: undefined })])
    assert.equal(internal.length, 0, 'not guessed into the list')
  }],

  ['contractor work with no price is listed', () => {
    const { outsource } = gapBuckets([row({ project_name: 'a', expert: 'Contractor', outsource_price: undefined })])
    assert.deepEqual(ids(outsource), ['a'])
  }],

  ['THE ZERO: a price of 0 is not a cost anybody entered', () => {
    const { outsource } = gapBuckets([row({ project_name: 'a', expert: 'Contractor', outsource_price: 0 })])
    assert.deepEqual(ids(outsource), ['a'], 'a real outsourced job never costs nothing')
  }],

  ['a contractor row WITH a price is not listed', () => {
    const { outsource } = gapBuckets([row({ project_name: 'a', expert: 'Contractor', outsource_price: 250 })])
    assert.equal(outsource.length, 0)
  }],

  ['"Contractor" is matched whatever its case and spacing, and nobody else is', () => {
    const rows = [
      row({ project_name: 'a', expert: 'contractor' }),
      row({ project_name: 'b', expert: '  Contractor ' }),
      row({ project_name: 'c', expert: 'Hardik Kotak' }),
      row({ project_name: 'd', expert: undefined }),
    ]
    assert.deepEqual(ids(gapBuckets(rows).outsource), ['a', 'b'])
  }],

  ['one row can be in both lists at once', () => {
    const { internal, outsource } = gapBuckets([row({ project_name: 'a', expert: 'Contractor' })])
    assert.deepEqual(ids(internal), ['a'])
    assert.deepEqual(ids(outsource), ['a'])
  }],

  ['newest booking month first — the fixable end of the list', () => {
    const rows = [
      row({ project_name: 'jul', booking_month: '2026-07-01' }),
      row({ project_name: 'nov', booking_month: '2026-11-01' }),
      row({ project_name: 'sep', booking_month: '2026-09-01' }),
    ]
    assert.deepEqual(gapBuckets(rows).internal.map(r => r.project_name), ['nov', 'sep', 'jul'])
  }],

  ['THE HEADLINE: the gap lists are counted but never added to it', () => {
    const pb = { today: [1], week: [1, 1], past: [1, 1, 1] }
    const qb = { quiet: [1], yes: [1] }
    const gb = { internal: Array(141).fill(1), outsource: Array(25).fill(1) }
    const c = bucketCounts(pb as any, qb as any, gb as any)
    assert.equal(c.internal, 141)
    assert.equal(c.outsource, 25)
    assert.equal(totalOf(c), 8, 'what needs somebody today, not what is missing from the books')
  }],

  ['the tab row offers both, and only quotes draw the other table', () => {
    assert.deepEqual(ALL_BUCKETS.slice(BUCKETS.length), ['internal', 'outsource'])
    assert.equal(isLedgerBucket('internal'), true)
    assert.equal(isLedgerBucket('outsource'), true)
    assert.equal(isLedgerBucket('quiet'), false)
    assert.equal(isLedgerBucket('yes'), false)
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ok   ${name}`) }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`) }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\n${tests.length} passed`)
process.exit(failed ? 1 : 0)
