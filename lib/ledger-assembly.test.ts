// Run with: npx -y tsx lib/ledger-assembly.test.ts
//
// Every branch of assembleLedger, because this is the part of the caching change that no
// hash could prove. The rule each case is holding to the fire is the same one: WHATEVER
// HAPPENS, THE CALLER GETS EVERY ROW. Slower is allowed. Short is not.

import assert from 'node:assert/strict'
import { assembleLedger, nextMonthStart, type MonthDigest, type HeldMonth } from './ledger-assembly'

type Row = { row_key: string; month: string }
const row = (m: string, i: number): Row => ({ row_key: `${m}:${i}`, month: m })
const rowsFor = (m: string, n: number) => Array.from({ length: n }, (_, i) => row(m, i))

const SERVER: Record<string, { digest: string; rows: Row[] }> = {
  '2026-11': { digest: 'nov-1', rows: rowsFor('2026-11', 35) },
  '2026-10': { digest: 'oct-1', rows: rowsFor('2026-10', 185) },
  '2026-09': { digest: 'sep-1', rows: rowsFor('2026-09', 174) },
  '2026-08': { digest: 'aug-1', rows: rowsFor('2026-08', 178) },
  '2026-07': { digest: 'jul-1', rows: rowsFor('2026-07', 192) },
  'none':    { digest: 'non-1', rows: rowsFor('none', 2) },
}
const digestsOf = (s = SERVER): MonthDigest[] =>
  Object.entries(s).map(([month, v]) => ({ month, digest: v.digest, n_rows: v.rows.length }))
const allRows = (s = SERVER) => Object.values(s).flatMap(v => v.rows)
const keys = (rows: Row[]) => rows.map(r => r.row_key).sort()

/** A browser, with whatever it is holding and a tally of what it asked the server for. */
function harness(opts: {
  server?: typeof SERVER
  held?: Map<string, HeldMonth<Row>>
  digestsFail?: boolean
  failMonth?: string
  shortMonth?: string
  storageDead?: boolean
}) {
  const server = opts.server || SERVER
  const held = opts.held || new Map<string, HeldMonth<Row>>()
  const calls = { digests: 0, months: [] as string[], whole: 0, stored: [] as string[], dropped: [] as string[] }
  const deps = {
    held,
    monthOf: (r: Row) => r.month,
    digests: async () => { calls.digests++; return opts.digestsFail ? null : digestsOf(server) },
    monthRows: async (d: MonthDigest) => {
      calls.months.push(d.month)
      if (d.month === opts.failMonth) return null
      const rows = server[d.month].rows
      return d.month === opts.shortMonth ? rows.slice(0, -1) : rows
    },
    whole: async () => { calls.whole++; return allRows(server) },
    store: (m: string, dg: string, rows: Row[]) => {
      if (opts.storageDead) return
      calls.stored.push(m); held.set(m, { month: m, digest: dg, rows })
    },
    drop: (ms: string[]) => { calls.dropped.push(...ms) },
  }
  return { deps, calls, held, server }
}

const tests: [string, () => Promise<void>][] = [

  ['a fresh browser takes one whole read and keeps every month', async () => {
    const { deps, calls, held } = harness({})
    const out = await assembleLedger(deps)
    assert.deepEqual(keys(out), keys(allRows()), 'must return every row')
    assert.equal(calls.whole, 1, 'one whole read, not 23 month requests')
    assert.equal(calls.months.length, 0)
    assert.equal(held.size, 6, 'every month kept for next time')
  }],

  ['a browser that is up to date fetches nothing at all', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const { deps, calls } = harness({ held: d1.held })
    const out = await assembleLedger(deps)
    assert.deepEqual(keys(out), keys(allRows()), 'still every row')
    assert.equal(calls.digests, 1, 'the digest request')
    assert.equal(calls.months.length, 0, 'and nothing else')
    assert.equal(calls.whole, 0)
  }],

  ['one edited month fetches that month and only that month', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    // Somebody confirms a deal: November gains a row and its hash moves.
    const server = { ...SERVER, '2026-11': { digest: 'nov-2', rows: rowsFor('2026-11', 36) } }
    const { deps, calls } = harness({ server, held: d1.held })
    const out = await assembleLedger(deps)
    assert.deepEqual(calls.months, ['2026-11'], 'only November')
    assert.equal(calls.whole, 0, 'and no whole read')
    assert.equal(out.length, allRows(server).length)
    assert.deepEqual(keys(out), keys(allRows(server)), 'the new row is there')
  }],

  ['a month the server stops reporting is dropped, not left on screen', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const server = { ...SERVER }
    delete (server as any)['2026-07']            // every row in July removed
    const { deps, calls, held } = harness({ server, held: d1.held })
    const out = await assembleLedger(deps)
    assert.deepEqual(calls.dropped, ['2026-07'])
    assert.equal(held.has('2026-07'), false, 'forgotten')
    assert.equal(out.some(r => r.month === '2026-07'), false, 'and gone from the answer')
    assert.deepEqual(keys(out), keys(allRows(server)))
  }],

  ['a failed month request falls back to the whole table', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const server = { ...SERVER, '2026-10': { digest: 'oct-2', rows: rowsFor('2026-10', 186) } }
    const { deps, calls } = harness({ server, held: d1.held, failMonth: '2026-10' })
    const out = await assembleLedger(deps)
    assert.equal(calls.whole, 1, 'fell back')
    assert.deepEqual(keys(out), keys(allRows(server)), 'still every row')
  }],

  ['a month SHORTER than its digest says falls back — the silent one', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const server = { ...SERVER, '2026-10': { digest: 'oct-2', rows: rowsFor('2026-10', 186) } }
    const { deps, calls } = harness({ server, held: d1.held, shortMonth: '2026-10' })
    const out = await assembleLedger(deps)
    assert.equal(calls.whole, 1, 'a truncated month must never be accepted')
    assert.equal(out.length, allRows(server).length)
  }],

  ['a dead digest endpoint behaves exactly like the old code', async () => {
    const { deps, calls } = harness({ digestsFail: true })
    const out = await assembleLedger(deps)
    assert.equal(calls.whole, 1)
    assert.deepEqual(keys(out), keys(allRows()))
  }],

  ['no storage at all still returns every row, every time', async () => {
    for (let visit = 0; visit < 3; visit++) {
      const { deps, calls } = harness({ storageDead: true })
      const out = await assembleLedger(deps)
      assert.deepEqual(keys(out), keys(allRows()), `visit ${visit + 1}`)
      assert.equal(calls.whole, 1, 'pays the old cost, never a wrong answer')
    }
  }],

  ['more than three stale months prefers one whole read', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const server = Object.fromEntries(
      Object.entries(SERVER).map(([m, v]) => [m, { digest: v.digest + 'x', rows: v.rows }])) as typeof SERVER
    const { deps, calls } = harness({ server, held: d1.held })
    await assembleLedger(deps)
    assert.equal(calls.whole, 1)
    assert.equal(calls.months.length, 0)
  }],

  ['exactly three stale months are fetched one by one', async () => {
    const { deps: d1 } = harness({})
    await assembleLedger(d1)
    const server = { ...SERVER,
      '2026-11': { digest: 'nov-2', rows: rowsFor('2026-11', 35) },
      '2026-10': { digest: 'oct-2', rows: rowsFor('2026-10', 185) },
      '2026-09': { digest: 'sep-2', rows: rowsFor('2026-09', 174) } }
    const { deps, calls } = harness({ server, held: d1.held })
    const out = await assembleLedger(deps)
    assert.equal(calls.whole, 0)
    assert.deepEqual(calls.months.sort(), ['2026-09', '2026-10', '2026-11'])
    assert.deepEqual(keys(out), keys(allRows(server)))
  }],

  ['the no-month bucket is carried like any other month', async () => {
    const { deps: d1 } = harness({})
    const first = await assembleLedger(d1)
    assert.equal(first.filter(r => r.month === 'none').length, 2)
    const { deps, calls } = harness({ held: d1.held })
    const out = await assembleLedger(deps)
    assert.equal(out.filter(r => r.month === 'none').length, 2, 'kept across visits')
    assert.equal(calls.months.length, 0)
  }],

  ['a month boundary is half-open, and December rolls the year', async () => {
    assert.equal(nextMonthStart('2026-11'), '2026-12-01')
    assert.equal(nextMonthStart('2026-12'), '2027-01-01')
    assert.equal(nextMonthStart('2026-01'), '2026-02-01')
    assert.equal(nextMonthStart('2026-09'), '2026-10-01')
  }],
]

async function main() {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ok   ${name}`) }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`) }
  }
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\n${tests.length} passed`)
  process.exit(failed ? 1 : 0)
}
main()
