'use client'
import { useEffect, useRef, useState } from 'react'

// A filter that takes more than one answer.
//
// Every filter on this dashboard was a <select> — one value or "All". That is fine for
// "which geo", and wrong for "WEB-UK and WEB-US but not AU", which is a question people
// actually have and were answering by exporting to a spreadsheet.
//
// Deliberately NOT a native <select multiple>: it renders as a scrolling box, needs
// ctrl-click to add a second value, and silently clears the lot if somebody clicks one
// item without holding it. Tick boxes cost a click to open and then behave the way the
// name suggests.
//
// Closes on outside click and on Escape. Both matter — a panel that only closes by
// clicking the button again reads as stuck.
export default function MultiSelect({ label, options, selected, onChange, className = '' }: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  className?: string
}) {
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

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])

  // What the closed button says. One selection is worth naming; several are not worth
  // truncating into nonsense, so they become a count.
  const text = selected.length === 0 ? label
    : selected.length === 1 ? selected[0]
    : `${label} · ${selected.length}`

  return (
    <div className={`relative ${className}`} ref={box}>
      <button type="button" onClick={() => setOpen(v => !v)}
        title={selected.length ? selected.join(', ') : label}
        className={`w-full text-left text-sm rounded-md border px-2 py-2 transition-colors inline-flex items-center gap-1.5 ${selected.length
          ? 'bg-mav-yellow/15 border-mav-yellow/50 text-mav-fg'
          : 'bg-mav-panel border-mav-line text-mav-muted hover:text-mav-fg'}`}>
        <span className="truncate">{text}</span>
        <span className="ml-auto text-[10px] opacity-70 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-max min-w-full max-w-[20rem] max-h-72 overflow-y-auto rounded-md border border-mav-line bg-mav-panel shadow-2xl p-1">
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left text-xs px-2 py-1.5 rounded text-mav-yellow hover:bg-mav-yellow/10">
              ✕ Clear {selected.length}
            </button>
          )}
          {options.length === 0 && <div className="px-2 py-2 text-xs text-mav-muted">Nothing to choose from.</div>}
          {options.map(o => {
            const on = selected.includes(o)
            return (
              <button key={o} type="button" onClick={() => toggle(o)}
                className={`w-full text-left text-sm px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${on ? 'text-mav-fg' : 'text-mav-muted hover:text-mav-fg hover:bg-mav-fg/5'}`}>
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] shrink-0 ${on ? 'bg-mav-fill border-mav-yellow text-black' : 'border-mav-line'}`}>
                  {on ? '✓' : ''}
                </span>
                <span className="truncate">{o}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
