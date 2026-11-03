// Deciding which months to fetch, with nothing else attached.
//
// This is the one piece of the ledger change that a hash could not prove. The database
// side was checkable — every month's filter returns exactly the rows its digest counted,
// 3,517 in all — but "fetch this month, keep that one, fall back here" is branching, and
// branching is only ever proved by running it.
//
// So it lives here, taking its world as arguments, and lib/ledger-assembly.test.ts runs
// all of it: a fresh browser, a quiet one, a single edited month, a month deleted out
// from under us, a failed request, a short month, a dead digest, and storage that is not
// there at all. supabase.ts supplies the real implementations and holds no logic of its
// own.

export interface MonthDigest { month: string; digest: string; n_rows: number }
export interface HeldMonth<T> { month: string; digest: string; rows: T[] }

export interface AssemblyDeps<T> {
  /** The server's one-row-per-month hashes, or null if they could not be read. */
  digests: () => Promise<MonthDigest[] | null>
  /** One month's rows, or null if the request failed. */
  monthRows: (d: MonthDigest) => Promise<T[] | null>
  /** The old whole-table read. Every failure path ends here. */
  whole: () => Promise<T[]>
  /** What this browser already holds. Empty when storage is unavailable. */
  held: Map<string, HeldMonth<T>>
  store: (month: string, digest: string, rows: T[]) => void
  drop: (months: string[]) => void
  /** 'YYYY-MM' for a row, or 'none' when it has no booking month. */
  monthOf: (row: T) => string
}

/**
 * How many months have to differ before one whole-table read beats fetching each.
 * A whole read is ~264 ms and one month is ~60; four separate months is the point where
 * the round trips stop being worth it. A first visit has 23 and takes the whole read.
 */
export const WHOLE_READ_THRESHOLD = 3

export async function assembleLedger<T>(deps: AssemblyDeps<T>): Promise<T[]> {
  const { digests, monthRows, whole, held, store, drop, monthOf } = deps

  const wanted = await digests()
  if (!wanted?.length) return whole()

  // A month the server no longer reports — every row in it deleted — must not survive in
  // the browser, or the figure would stay on screen after the rows were removed.
  const live = new Set(wanted.map(d => d.month))
  const gone = [...held.keys()].filter(m => !live.has(m))
  if (gone.length) { gone.forEach(m => held.delete(m)); drop(gone) }

  const stale = wanted.filter(d => held.get(d.month)?.digest !== d.digest)
  // The common case: every month on the server is one this browser already holds, byte
  // for byte. Costs the digest request alone.
  if (!stale.length) return flatten(wanted, held)

  if (stale.length > WHOLE_READ_THRESHOLD) {
    const all = await whole()
    if (!all.length) return []
    const byMonth = new Map<string, T[]>()
    for (const r of all) {
      const k = monthOf(r)
      const bucket = byMonth.get(k)
      if (bucket) bucket.push(r); else byMonth.set(k, [r])
    }
    // Stored under the digest the SERVER reported, and only where the row count agrees:
    // if a write landed between the digest and the fetch, the counts differ and that
    // month is not kept, so it comes down again next time rather than being remembered
    // wrong.
    for (const d of wanted) {
      const rows = byMonth.get(d.month) || []
      if (rows.length === d.n_rows) { held.set(d.month, { ...d, rows }); store(d.month, d.digest, rows) }
    }
    return all
  }

  const fetched = await Promise.all(stale.map(async d => ({ d, rows: await monthRows(d) })))
  // A short month is the one failure that would not look like one: the request errored, a
  // write landed between the digest and the fetch, or a month grew past the 1,000-row cap
  // a single request returns. The biggest today is 192, but a silently truncated month
  // would show wrong totals with nothing on screen to say so. The count the digest
  // reported is the check. A half-loaded revenue tab is worse than a slow one.
  if (fetched.some(f => f.rows === null || f.rows.length !== f.d.n_rows)) return whole()

  for (const f of fetched) {
    held.set(f.d.month, { month: f.d.month, digest: f.d.digest, rows: f.rows! })
    store(f.d.month, f.d.digest, f.rows!)
  }
  return flatten(wanted, held)
}

// In the server's own month order, so the assembled array does not depend on what order
// IndexedDB happened to hand its keys back.
function flatten<T>(wanted: MonthDigest[], held: Map<string, HeldMonth<T>>): T[] {
  const out: T[] = []
  for (const d of wanted) { const m = held.get(d.month); if (m) out.push(...m.rows) }
  return out
}

/** '2026-11' -> '2026-12-01', so a month filter is a half-open range and December's 1st
 *  belongs to December. */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
