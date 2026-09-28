'use client'
import { useEffect, useRef, useState } from 'react'
import { Columns3 } from 'lucide-react'
import { useAuth } from './AuthProvider'

// Which columns a table shows, chosen per person and per page.
//
// The wide tables (Opportunities, Project sheet) carried every field at once, so they
// scrolled sideways and the column you wanted was always off the edge. Now each table
// opens on its few essential columns; the rest are one tick away in "Columns", and the
// choice sticks — for this person, on this page — until they change it again.
//
// Remembered in this browser, keyed by the signed-in address, the same way the
// department choice is. A second laptop starts on the defaults.

export interface ColumnDef {
  key: string
  label: string
  /** Shown before anybody has chosen. */
  default?: boolean
  /** Always shown and not offered in the picker — the row's name, its action. */
  locked?: boolean
}

const storeKey = (email: string | null | undefined, page: string) =>
  `cols:${(email || 'anon').trim().toLowerCase()}:${page}`

export function useColumns(page: string, columns: ColumnDef[]) {
  const { email } = useAuth()
  const defaults = columns.filter(c => c.default || c.locked).map(c => c.key)
  const [shown, setShown] = useState<string[]>(defaults)

  // Read after mount: this is a static export, and seeding state from localStorage
  // would hydrate a different tree than the HTML that was served.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey(email, page))
      if (!raw) return
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        // A column added to the page since the choice was saved is not in it; locked
        // ones are always on regardless.
        const known = new Set(columns.map(c => c.key))
        setShown(Array.from(new Set([...saved.filter((k: string) => known.has(k)),
          ...columns.filter(c => c.locked).map(c => c.key)])))
      }
    } catch { /* blocked storage; the defaults stand */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, page])

  const save = (next: string[]) => {
    setShown(next)
    try { localStorage.setItem(storeKey(email, page), JSON.stringify(next)) } catch { /* session only */ }
  }
  const toggle = (key: string) => save(shown.includes(key) ? shown.filter(k => k !== key) : [...shown, key])
  const reset = () => { save(defaults); try { localStorage.removeItem(storeKey(email, page)) } catch { /* fine */ } }
  const showAll = () => save(columns.map(c => c.key))
  const on = (key: string) => shown.includes(key)
  const allOn = columns.every(c => shown.includes(c.key))

  return { on, shown, toggle, reset, showAll, allOn, columns }
}

/** The "Columns" button above a table. */
export default function ColumnPicker({ cols }: { cols: ReturnType<typeof useColumns> }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const pickable = cols.columns.filter(c => !c.locked)
  const n = pickable.filter(c => cols.on(c.key)).length
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-mav-line bg-mav-panel text-[13px] font-medium hover:border-mav-fg/40">
        <Columns3 size={15} /> Columns <span className="text-mav-muted">{n}/{pickable.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 max-h-80 overflow-y-auto rounded-lg border border-mav-line bg-mav-panel shadow-xl p-1">
          {pickable.map(c => {
            const on = cols.on(c.key)
            return (
              <button key={c.key} type="button" onClick={() => cols.toggle(c.key)}
                className="w-full text-left text-sm px-2 py-1.5 rounded flex items-center gap-2 hover:bg-mav-fg/5">
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] shrink-0 ${on ? 'bg-mav-fill border-mav-yellow text-black' : 'border-mav-line'}`}>{on ? '✓' : ''}</span>
                <span className="truncate">{c.label}</span>
              </button>
            )
          })}
          <button type="button" onClick={cols.reset}
            className="w-full text-left text-xs px-2 py-1.5 mt-1 border-t border-mav-line text-mav-muted hover:text-mav-fg">
            Back to the default columns
          </button>
        </div>
      )}
    </div>
  )
}
