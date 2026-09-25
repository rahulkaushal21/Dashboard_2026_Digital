'use client'
import { useUnit } from './BusinessUnitProvider'
import { UNITS } from '@/lib/business-unit'

/**
 * The business-unit switch, shown to admins only.
 *
 * Deliberately three plain buttons rather than a dropdown: it changes what every number
 * on the page means, so which one is active has to be readable without opening anything.
 */
export default function UnitToggle({ className = '' }: { className?: string }) {
  const { unit, setUnit, canSwitch } = useUnit()
  if (!canSwitch) return null

  return (
    <div className={`inline-flex items-center rounded-lg border border-mav-line bg-mav-panel p-0.5 ${className}`}
      role="group" aria-label="Business unit">
      {UNITS.map(u => {
        const on = u.id === unit
        return (
          <button key={u.id} onClick={() => setUnit(u.id)} title={u.hint} aria-pressed={on}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              on ? 'bg-mav-yellow text-black' : 'text-mav-muted hover:text-mav-fg'}`}>
            {u.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The line a page prints when some of its rows carry no department.
 *
 * Absent and unknown must not look alike. An escalation nobody can place has to stay
 * visible as a number, or a filtered page reads as "nothing happened" — which is exactly
 * how a client's QBR looked empty for a quarter.
 */
export function UnplacedNote({ n, noun, className = '' }: { n: number; noun: string; className?: string }) {
  const { unit } = useUnit()
  if (unit === 'all' || n <= 0) return null
  return (
    <p className={`text-[11px] text-mav-muted/80 ${className}`}>
      {n.toLocaleString()} {noun}{n === 1 ? '' : ''} could not be placed in a business unit
      {' '}— {n === 1 ? 'it is' : 'they are'} shown under <span className="text-mav-fg/70">All</span>.
    </p>
  )
}

/** For a page that genuinely cannot be split, rather than one that has been filtered. */
export function NotSplitNote({ what, reason, className = '' }: { what: string; reason: string; className?: string }) {
  const { unit } = useUnit()
  if (unit === 'all') return null
  return (
    <p className={`text-[11px] text-mav-muted/80 ${className}`}>
      {what} {reason} — showing everything regardless of the unit above.
    </p>
  )
}
