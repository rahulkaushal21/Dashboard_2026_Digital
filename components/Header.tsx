'use client'
import { isLive } from '@/lib/supabase'
import UnitToggle from './UnitToggle'
export default function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  // Wraps on narrow screens so a long title and the Live-data pill stop fighting
  // each other for one row.
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {/* The section's own colour. Every page used to open with the same grey heading,
            so they were indistinguishable at a glance and nothing said where you were. */}
        <div className="h-1 w-12 rounded-full mt-2" style={{ background: 'var(--section)' }} />
        {subtitle && <p className="text-sm text-mav-muted mt-2">{subtitle}</p>}
      </div>
      {/* The business-unit switch sits with the page title rather than in the sidebar,
          because it changes what every number below it means — it belongs where the eye
          already is when reading the heading. Renders nothing for non-admins. */}
      <div className="shrink-0 flex items-center gap-2">
        <UnitToggle />
        <span className={`text-xs px-2 py-1 rounded-full border ${isLive ? 'border-green-500/40 text-green-400' : 'border-mav-line text-mav-muted'}`}>
          {isLive ? 'Live data' : 'Sample data'}
        </span>
      </div>
    </header>
  )
}
