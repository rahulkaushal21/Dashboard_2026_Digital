'use client'

// The "just mine" switch.
//
// Every page that has one starts ON for a PM: they open these pages to work their own
// accounts, and a list of everybody's is something to scroll past. It is one click to see
// everything, and the count of what is being hidden is always on screen — a filter you
// cannot see is a filter that makes people think data is missing.
export default function MineFilter({ on, onChange, label, hidden }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hidden: number
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={() => onChange(!on)}
        className={`text-sm px-3 py-2 rounded-md border transition-colors ${on
          ? 'border-mav-yellow text-mav-yellow bg-mav-yellow/10 font-medium'
          : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
        {on ? label : `Showing everyone${hidden > 0 ? '' : ''}`}
      </button>
      {on && hidden > 0 && (
        <span className="text-xs text-mav-muted">
          {hidden.toLocaleString()} other{hidden === 1 ? '' : 's'} hidden &middot;{' '}
          <button onClick={() => onChange(false)} className="text-mav-yellow hover:underline">show all</button>
        </span>
      )}
    </div>
  )
}
