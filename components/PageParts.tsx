'use client'
import InfoTip from './InfoTip'

// The building blocks every page is laid out from, in the order they appear:
//
//   Header        title · department chip · actions               (components/Header)
//   KPIRow        the few headline cards for this page            (KPICard inside)
//   Segments      the page's main split — Open / Won / Lost …     (one tap, with counts)
//   FilterBar     search and every per-field filter, in one box
//   Panel         a white card holding a table, a chart or a list
//
// One vocabulary, so moving between pages is moving between data, not between layouts.

/** A row of headline cards. Columns follow the count so four cards never leave a hole. */
export function KPIRow({ children, cols }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const c = cols === 2 ? 'sm:grid-cols-2'
    : cols === 3 ? 'sm:grid-cols-3'
    : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4'
    : cols === 6 ? 'sm:grid-cols-3 lg:grid-cols-6'
    : 'sm:grid-cols-3 lg:grid-cols-5'
  return <div className={`grid grid-cols-2 ${c} gap-3 mb-5`}>{children}</div>
}

/** The page's main split as pills: black when on, a count beside each label. */
export function Segments<T extends string>({ items, value, onChange, className = '' }: {
  items: { id: T; label: string; count?: number | string; title?: string }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 mb-4 ${className}`} role="tablist">
      {items.map(it => {
        const on = it.id === value
        return (
          <button key={it.id} role="tab" aria-selected={on} onClick={() => onChange(it.id)} title={it.title}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              on ? 'bg-mav-fg text-mav-dark border-mav-fg' : 'bg-mav-panel text-mav-fg border-mav-line hover:border-mav-fg/40'}`}>
            {it.label}
            {it.count != null && (
              <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded-md ${on ? 'bg-mav-fill text-black' : 'bg-mav-dark text-mav-muted'}`}>{it.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Every filter for the table below, in one white box — search first, then fields. */
export function FilterBar({ children, right, className = '' }: { children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={`filterbar bg-mav-panel border border-mav-line rounded-xl p-3 mb-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {/* nowrap: the count and Clear all are one unit; wrapping split them onto two
            lines under each other, which read as two stray labels. */}
        {right && <div className="ml-auto flex items-center gap-2 whitespace-nowrap">{right}</div>}
      </div>
    </div>
  )
}

/** A card with an optional title row. Tables go in with `flush` so they meet the edges. */
export function Panel({ title, info, right, children, flush, className = '' }: {
  title?: React.ReactNode
  info?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <section className={`bg-mav-panel border border-mav-line rounded-xl ${flush ? 'overflow-hidden' : 'p-4'} ${className}`}>
      {(title || right) && (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${flush ? 'px-4 py-3 border-b border-mav-line' : 'mb-3'}`}>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">
            {title}{info && <InfoTip text={info} />}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** A section heading between blocks on a long page. */
export function SectionTitle({ children, info, right }: { children: React.ReactNode; info?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 mt-1">
      <h2 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mav-muted">
        {children}{info && <InfoTip text={info} />}
      </h2>
      {right}
    </div>
  )
}
