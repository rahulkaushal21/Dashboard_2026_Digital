// Shared by the two views of Revenue history (department and client). One place for the
// financial-year arithmetic, so a year-on-year figure means the same thing on both tabs.

export type Row = { month: string; amount: number; client: string; model: string; dept: string; geo: string; era: 'history' | 'live' }

export const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monLabel = (k: string) => { const p = k.split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0].slice(2)}` : k }
// The financial year runs April-March, matching FY_TARGET on the other pages.
export const fyOf = (k: string) => { const [y, m] = k.split('-').map(Number); return m >= 4 ? y : y - 1 }
export const fyLabel = (fy: number) => `FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`
// The month in progress is only part-billed, so it never sits in a like-for-like window.
export const thisYm = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }

// The two departments this tab compares. LP and HUB are one business (Pratik's); everything
// else is Web, including a sheet row whose department is blank - counted, not dropped.
export type Dept = 'WEB' | 'LP/HUB'
export const DEPTS: Dept[] = ['WEB', 'LP/HUB']
export const DEPT_COLOR: Record<Dept, string> = { 'WEB': '#FFDB2D', 'LP/HUB': '#3b82f6' }
export const deptGroup = (d: string): Dept => {
  const v = (d || '').trim().toUpperCase()
  return v === 'LP' || v === 'HUB' || v === 'LP/HUB' ? 'LP/HUB' : 'WEB'
}
export const isUnplacedDept = (d: string) => {
  const v = (d || '').trim().toUpperCase()
  return !v || v === 'UNSPECIFIED'
}

export const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)
export const fmtPct = (p: number | null, dp = 0) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(dp)}%`)
export const pctTone = (p: number | null) => (p == null ? 'text-mav-muted' : p >= 0 ? 'text-green-400' : 'text-red-400')

export interface FyStat {
  fy: number
  /** Everything billed in the year, in-progress month included. */
  total: number
  /** This year / last year over the SAME completed months. */
  cmpCur: number
  cmpPrev: number
  /** null when there is no honest comparison (no prior year, prior year does not cover the window, or it billed nothing). */
  pct: number | null
  /** The year does not span a full Apr-Mar of completed months. */
  partial: boolean
  windowLabel: string
}

/**
 * Year-on-year for each financial year in `years`, over `rows`, with the window decided by
 * `universe` (every row, every department) so WEB, LP/HUB and the total all use the same
 * months. A finished year compares twelve months to twelve; the year in progress compares
 * the completed months so far against the same months last year.
 */
export function fyStats(rows: Row[], universe: Row[], years: number[]): FyStat[] {
  const now = thisYm()
  const monthsOf = new Map<number, Set<number>>()
  for (const r of universe) {
    const fy = fyOf(r.month)
    if (!monthsOf.has(fy)) monthsOf.set(fy, new Set())
    if (r.month !== now) monthsOf.get(fy)!.add(+r.month.slice(5, 7))
  }
  const sumIn = (fy: number, wnd?: Set<number>) =>
    rows.reduce((s, r) => (fyOf(r.month) === fy && (!wnd || wnd.has(+r.month.slice(5, 7))) ? s + r.amount : s), 0)
  return years.map(fy => {
    const wnd = monthsOf.get(fy) || new Set<number>()
    const prevCovers = [...wnd].every(m => (monthsOf.get(fy - 1) || new Set()).has(m)) && wnd.size > 0
    const cmpCur = sumIn(fy, wnd), cmpPrev = sumIn(fy - 1, wnd)
    const o = [...wnd].sort((x, y) => ((x + 8) % 12) - ((y + 8) % 12))
    return {
      fy, total: sumIn(fy), cmpCur, cmpPrev,
      pct: prevCovers ? pctChange(cmpCur, cmpPrev) : null,
      partial: wnd.size < 12,
      windowLabel: o.length ? (o.length === 1 ? SHORT[o[0]] : `${SHORT[o[0]]}–${SHORT[o[o.length - 1]]}`) : '',
    }
  })
}

/** The same four movements as the client bridge, for any slice of rows and one financial year. */
export function bridge(rows: Row[], fy: number, wnd: Set<number>) {
  const key = (n: string) => n.trim().toLowerCase()
  const sum = (y: number) => {
    const m = new Map<string, number>()
    for (const r of rows) {
      if (fyOf(r.month) !== y || !wnd.has(+r.month.slice(5, 7))) continue
      m.set(key(r.client), (m.get(key(r.client)) || 0) + r.amount)
    }
    return m
  }
  const a = sum(fy), b = sum(fy - 1)
  let nw = 0, nwN = 0, ex = 0, exN = 0, co = 0, coN = 0, ch = 0, chN = 0, retP = 0, retC = 0
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const c = a.get(k) || 0, p = b.get(k) || 0
    if (p <= 0) { nw += c; if (c > 0) nwN++; continue }
    retP += p; retC += c
    if (c <= 0) { ch -= p; chN++ } else if (c > p) { ex += c - p; exN++ } else if (c < p) { co += c - p; coN++ }
  }
  const cur = [...a.values()].reduce((s, v) => s + v, 0), prev = [...b.values()].reduce((s, v) => s + v, 0)
  return {
    cur, prev, nw, nwN, ex, exN, co, coN, ch, chN,
    nrr: retP ? (retC / retP) * 100 : null,
    logoRet: b.size ? ((b.size - chN) / b.size) * 100 : null,
    clients: a.size, prevClients: b.size,
  }
}
