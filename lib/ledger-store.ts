// The months this browser has already seen, kept between visits.
//
// The ledger is 3,517 rows and about 3.9 MB of JSON, and all but the last two months of
// it are the old spreadsheet, frozen since 4 October. Re-downloading a settled month is
// work nobody asked for: September cannot change.
//
// So each month is stored under the digest it had when it arrived (see
// web_ledger_month_digest, migration 167). On the next visit the dashboard asks the
// server only for the digests — 23 small rows — and fetches a month again only when its
// hash has moved. An edit to any field of any row changes that month's hash, so a stale
// month is not possible; the worst case is a month comes down that did not need to.
//
// WHY INDEXEDDB AND NOT localStorage. 3.9 MB against a 5 MB per-origin limit, shared
// with everything else the dashboard keeps there (the business-unit switch, filters,
// dismissed banners). That is not a margin, it is a coin toss — and a quota error here
// would be intermittent, browser-specific and would look like "sometimes it loads slow"
// all over again. IndexedDB is not troubled by a few megabytes.
//
// EVERY PATH HERE FAILS SOFT. A private window, blocked site data, an old browser, a
// corrupt store, a quota refusal: all of them return empty or do nothing, and the caller
// falls back to fetching the month from the server exactly as it did before this file
// existed. Nothing in the dashboard depends on the cache being there — it is only ever
// allowed to save a request, never to decide what the data is.

const DB_NAME = 'mavlers-dashboard'
// 2: the key gained a dataset prefix. A browser that opened version 1 keeps ITS schema
// unless the version moves, and keyPath cannot be altered in place — so the bump is not
// optional, and the upgrade drops the old store rather than migrating it. Everything in
// here is a copy of something the server will hand over again; the cost of throwing it
// away is one slow load.
const DB_VERSION = 2
const STORE = 'ledger-months'

// Two datasets live in this one store — the project ledger and the revenue lines — so
// every key carries which one it belongs to. Without the prefix October's ledger rows
// and October's revenue rows are both "2026-10" and the second to be written wins,
// handing one page the other page's data. The prefix is in the KEY, not a field, because
// the key is what getAll() hands back and what delete() takes.
export type Dataset = 'ledger' | 'revenue'
const keyOf = (set: Dataset, month: string) => `${set}:${month}`

export interface StoredMonth<T> { month: string; digest: string; rows: T[] }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      // Safari in a private window can leave the request pending forever rather than
      // erroring. Nothing here is worth a hung page load.
      setTimeout(() => resolve(null), 2000)
    } catch { resolve(null) }
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>(resolve => {
    if (!db) return resolve(null)
    try {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(null)
      t.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch { resolve(null) }
  }))
}

/** One dataset's months, as {month: digest-and-rows}. Empty when storage is unavailable. */
export async function readStoredMonths<T>(set: Dataset): Promise<Map<string, StoredMonth<T>>> {
  const all = await tx<(StoredMonth<T> & { key?: string })[]>('readonly', s => s.getAll())
  const out = new Map<string, StoredMonth<T>>()
  const prefix = `${set}:`
  for (const m of all || []) {
    if (!m || typeof m.key !== 'string' || !m.key.startsWith(prefix)) continue
    if (m.month && m.digest && Array.isArray(m.rows)) out.set(m.month, m)
  }
  return out
}

/** Keep a month under the digest it arrived with. Silent on failure, by design. */
export async function storeMonth<T>(set: Dataset, month: string, digest: string, rows: T[]): Promise<void> {
  await tx('readwrite', s => s.put({ key: keyOf(set, month), month, digest, rows }))
}

/** Months the server no longer reports — a deleted row can empty one. */
export async function dropMonths(set: Dataset, months: string[]): Promise<void> {
  for (const m of months) await tx('readwrite', s => s.delete(keyOf(set, m)))
}

/** Used by the "refresh" button: forget everything and start from the server. */
export async function clearLedgerStore(): Promise<void> {
  await tx('readwrite', s => s.clear())
}
