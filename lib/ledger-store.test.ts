// Run with: npx -y tsx lib/ledger-store.test.ts
//
// The store, against a fake IndexedDB.
//
// This file exists because of a bug that nearly shipped. Two datasets now share one
// object store — the project ledger and the revenue lines — and both call October
// "2026-10". Keyed on the month alone, the second write wins and a page is handed the
// other page's rows: same shape, same month, wrong numbers, nothing on screen to say so.
// The assembly tests cannot see it, because each of them only ever runs one dataset.

import assert from 'node:assert/strict'

// A fake of the three operations ledger-store actually uses. Installed before the module
// is imported, because it reads `indexedDB` at open time.
function installFakeIndexedDB() {
  const dbs = new Map<string, { version: number; stores: Map<string, Map<string, any>> }>()
  const req = (run: (r: any) => void) => {
    const r: any = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null }
    queueMicrotask(() => { run(r); r.onsuccess?.() })
    return r
  }
  ;(globalThis as any).indexedDB = {
    open(name: string, version: number) {
      const r: any = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null }
      queueMicrotask(() => {
        let d = dbs.get(name)
        const fresh = !d || d.version < version
        if (!d) { d = { version, stores: new Map() }; dbs.set(name, d) }
        const api = {
          objectStoreNames: { contains: (s: string) => d!.stores.has(s) },
          createObjectStore: (s: string, _o: any) => { d!.stores.set(s, new Map()); return {} },
          deleteObjectStore: (s: string) => { d!.stores.delete(s) },
          transaction: (s: string) => ({
            onerror: null, onabort: null,
            objectStore: () => {
              const m = d!.stores.get(s)!
              return {
                getAll: () => req(r => { r.result = [...m.values()] }),
                put: (v: any) => req(() => { m.set(v.key, v) }),
                delete: (k: string) => req(() => { m.delete(k) }),
                clear: () => req(() => { m.clear() }),
              }
            },
          }),
        }
        r.result = api
        if (fresh) { d.version = version; r.onupgradeneeded?.() }
        r.onsuccess?.()
      })
      return r
    },
    __reset: () => dbs.clear(),
  }
}
installFakeIndexedDB()

// Imported inside main(), after the fake is installed and without top-level await.
let store: typeof import('./ledger-store')

type L = { row_key: string }
type B = { id: number }

const tests: [string, () => Promise<void>][] = [

  ['a month is kept and read back', async () => {
    await store.storeMonth<L>('ledger', '2026-10', 'oct-1', [{ row_key: 'a' }, { row_key: 'b' }])
    const held = await store.readStoredMonths<L>('ledger')
    assert.equal(held.size, 1)
    assert.equal(held.get('2026-10')!.digest, 'oct-1')
    assert.equal(held.get('2026-10')!.rows.length, 2)
  }],

  ['THE BUG: two datasets share a month name and must not overwrite each other', async () => {
    await store.storeMonth<L>('ledger', '2026-10', 'led-1', [{ row_key: 'ledger-row' }])
    await store.storeMonth<B>('revenue', '2026-10', 'rev-1', [{ id: 1 }, { id: 2 }, { id: 3 }])

    const ledger = await store.readStoredMonths<L>('ledger')
    const revenue = await store.readStoredMonths<B>('revenue')

    assert.equal(ledger.get('2026-10')!.digest, 'led-1', 'ledger kept its own digest')
    assert.equal(ledger.get('2026-10')!.rows.length, 1, 'and its own rows')
    assert.equal(revenue.get('2026-10')!.digest, 'rev-1', 'revenue kept its own digest')
    assert.equal(revenue.get('2026-10')!.rows.length, 3, 'and its own rows')
  }],

  ['one dataset never sees the other, however many months are held', async () => {
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      await store.storeMonth<L>('ledger', m, `l-${m}`, [{ row_key: m }])
      await store.storeMonth<B>('revenue', m, `r-${m}`, [{ id: 1 }])
    }
    const ledger = await store.readStoredMonths<L>('ledger')
    const revenue = await store.readStoredMonths<B>('revenue')
    assert.equal(ledger.size, 3)
    assert.equal(revenue.size, 3)
    assert.deepEqual([...ledger.values()].map(v => v.digest).sort(),
                     ['l-2026-08', 'l-2026-09', 'l-2026-10'])
    assert.deepEqual([...revenue.values()].map(v => v.digest).sort(),
                     ['r-2026-08', 'r-2026-09', 'r-2026-10'])
  }],

  ['dropping a month touches only that dataset', async () => {
    await store.storeMonth<L>('ledger', '2026-07', 'l7', [{ row_key: 'x' }])
    await store.storeMonth<B>('revenue', '2026-07', 'r7', [{ id: 9 }])
    await store.dropMonths('ledger', ['2026-07'])
    assert.equal((await store.readStoredMonths<L>('ledger')).has('2026-07'), false, 'gone')
    assert.equal((await store.readStoredMonths<B>('revenue')).has('2026-07'), true, 'untouched')
  }],

  ['clearing empties both, which is what Sync now means', async () => {
    await store.storeMonth<L>('ledger', '2026-06', 'l6', [{ row_key: 'x' }])
    await store.storeMonth<B>('revenue', '2026-06', 'r6', [{ id: 1 }])
    await store.clearLedgerStore()
    assert.equal((await store.readStoredMonths<L>('ledger')).size, 0)
    assert.equal((await store.readStoredMonths<B>('revenue')).size, 0)
  }],

  ['storage that refuses still resolves, never throws', async () => {
    const saved = (globalThis as any).indexedDB
    try {
      // Every request errors, the way a private window or blocked site data behaves.
      ;(globalThis as any).indexedDB = { open: () => {
        const r: any = { onsuccess: null, onerror: null, onupgradeneeded: null }
        queueMicrotask(() => r.onerror?.())
        return r
      } }
      const fresh = await import(`./ledger-store?x=${Date.now()}`) as typeof store
      await fresh.storeMonth('ledger', '2026-05', 'x', [{}])
      await fresh.dropMonths('ledger', ['2026-05'])
      const held = await fresh.readStoredMonths('ledger')
      assert.ok(held instanceof Map, 'a Map, not an exception')
      assert.equal(held.size, 0, 'and empty, so the caller falls back to the server')
    } finally { (globalThis as any).indexedDB = saved }
  }],
]

async function main() {
  store = await import('./ledger-store')
  let failed = 0
  for (const [name, fn] of tests) {
    ;(globalThis as any).indexedDB.__reset?.()
    try { await fn(); console.log(`  ok   ${name}`) }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`) }
  }
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\n${tests.length} passed`)
  process.exit(failed ? 1 : 0)
}
main()
