'use client'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { NAV_EVENT } from '@/lib/use-close-on-nav'

// What sits behind a headline number.
//
// Clicking a card opens this panel on the right with the rows that make up the figure —
// client, amount, date, how many days so far — so the question "which ones?" is answered
// without leaving the cards for the table below. When the rows span several groups (for
// Web, the GEO pods AU / UK / US) they split into tabs, each with its own count and total.
//
// A card only becomes clickable when the page hands it `details`; a card with nothing
// behind it stays a plain figure, so nothing looks clickable that is not.

export interface DetailCol<T> {
  key: string
  label: string
  value: (r: T) => React.ReactNode
  /** What the column sorts by; without it the column does not sort. */
  sort?: (r: T) => number | string
  align?: 'right'
  /** Shown in a footer row under this column, e.g. the tab's summed amount. */
  total?: (rows: T[]) => React.ReactNode
  /** Truncate long text; the full string goes in the tooltip. */
  wide?: boolean
}

export interface CardDetails<T = any> {
  /** Defaults to the card's label. */
  title?: string
  /** One short line under the title — what is counted and over which period. */
  subtitle?: React.ReactNode
  rows: T[]
  columns: DetailCol<T>[]
  /** Splits rows into tabs, e.g. by GEO. One group means no tabs. */
  groupBy?: (r: T) => string
  /** Sums a tab for its label, e.g. money(rows.reduce(...)). */
  groupTotal?: (rows: T[]) => string
  rowKey?: (r: T, i: number) => string | number
  /** Opens the row somewhere fuller — the page's own drawer, a client page. */
  onRowClick?: (r: T) => void
  /** Which column to sort by first (descending). Defaults to the first sortable one. */
  defaultSort?: string
  empty?: string
}

// ── Helpers pages reuse, so "days so far" means the same thing on every card ──────────
export const daysSince = (d?: string | null): number | null => {
  const t = Date.parse(d || '')
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null
}
export const fmtDay = (d?: string | null) => {
  const v = (d || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || '—'
  const [y, m, day] = v.split('-').map(Number)
  return `${String(day).padStart(2, '0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]}-${y}`
}
export const fmtMonth = (d?: string | null) => {
  const v = (d || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(v)) return '—'
  const [y, m] = v.split('-').map(Number)
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`
}

export default function CardDetail<T>({ label, value, details, onClose }: {
  label: string
  value: string
  details: CardDetails<T>
  onClose: () => void
}) {
  const { rows, columns, groupBy, groupTotal } = details
  const groups = useMemo(() => {
    if (!groupBy) return []
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = groupBy(r) || 'Unassigned'; (m.get(k) || m.set(k, []).get(k)!).push(r) }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [rows, groupBy])
  const [tab, setTab] = useState<string>('')
  const firstSort = details.defaultSort || columns.find(c => c.sort)?.key || ''
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: firstSort, dir: -1 })

  // Escape and any sidebar click close it, like every other drawer on the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    window.addEventListener(NAV_EVENT, onClose)
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener(NAV_EVENT, onClose) }
  }, [onClose])

  const inTab = tab ? (groups.find(g => g[0] === tab)?.[1] || []) : rows
  const sortCol = columns.find(c => c.key === sort.key)
  const shown = sortCol?.sort
    ? [...inTab].sort((a, b) => { const x = sortCol.sort!(a), y = sortCol.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
    : inTab
  const hasTotals = columns.some(c => c.total)
  // Drawn 300 at a time. Revenue History hands over every billing line it holds —
  // thousands — and drawing them all at once froze the panel for seconds. The footer
  // still totals the whole tab, so the sum never depends on how far you have scrolled.
  const [limit, setLimit] = useState(300)
  useEffect(() => { setLimit(300) }, [tab, sort])
  const drawn = shown.slice(0, limit)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={details.title || label}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full sm:w-[min(720px,92vw)] bg-mav-dark border-l border-mav-line shadow-2xl flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-mav-line bg-mav-panel">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">{details.title || label}</div>
              <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
              {details.subtitle && <div className="text-xs text-mav-muted mt-1">{details.subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-mav-muted hover:text-mav-fg hover:bg-mav-dark"><X size={18} /></button>
          </div>
          {groups.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-4" role="tablist">
              {[['', rows] as [string, T[]], ...groups].map(([k, rs]) => {
                const on = k === tab
                return (
                  <button key={k || 'all'} role="tab" aria-selected={on} onClick={() => setTab(k)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${
                      on ? 'bg-mav-fg text-mav-dark border-mav-fg' : 'bg-mav-panel border-mav-line hover:border-mav-fg/40'}`}>
                    {k || 'All'}
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${on ? 'bg-mav-fill text-black' : 'bg-mav-dark text-mav-muted'}`}>
                      {rs.length}{groupTotal ? ` · ${groupTotal(rs)}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {shown.length === 0 ? (
            <p className="p-6 text-sm text-mav-muted">{details.empty || 'Nothing behind this number for the current selection.'}</p>
          ) : (
            <table className="w-full text-sm bg-mav-panel">
              <thead className="sticky top-0 z-10 bg-mav-panel border-b border-mav-line text-left text-mav-muted">
                <tr>{columns.map(c => (
                  <th key={c.key} onClick={() => c.sort && setSort(s => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                    className={`px-3 py-2.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.sort ? 'cursor-pointer hover:text-mav-fg select-none' : ''}`}>
                    {c.label}{c.sort && <span className="ml-1 text-[10px]">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>}
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {drawn.map((r, i) => (
                  <tr key={details.rowKey ? details.rowKey(r, i) : i}
                    onClick={details.onRowClick ? () => { details.onRowClick!(r); onClose() } : undefined}
                    className={`border-b border-mav-line/60 ${details.onRowClick ? 'cursor-pointer hover:bg-mav-dark/60' : ''}`}>
                    {columns.map(c => {
                      const v = c.value(r)
                      return (
                        <td key={c.key} title={c.wide && typeof v === 'string' ? v : undefined}
                          className={`px-3 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.wide ? 'max-w-[16rem] truncate' : ''}`}>
                          {v ?? '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {shown.length > drawn.length && (
                  <tr><td colSpan={columns.length} className="px-3 py-3 text-center">
                    <button onClick={() => setLimit(l => l + 300)}
                      className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">
                      Show more · {shown.length - drawn.length} left
                    </button>
                  </td></tr>
                )}
              </tbody>
              {hasTotals && (
                <tfoot className="sticky bottom-0 bg-mav-panel border-t-2 border-mav-line font-semibold">
                  <tr>{columns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                      {c.total ? c.total(shown) : i === 0 ? `Total · ${shown.length}` : ''}
                    </td>
                  ))}</tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </aside>
    </div>
  )
}
