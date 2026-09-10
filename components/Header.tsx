'use client'
import { isLive } from '@/lib/supabase'
export default function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  // Wraps on narrow screens so a long title and the Live-data pill stop fighting
  // each other for one row.
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-mav-muted mt-1">{subtitle}</p>}
      </div>
      <span className={`shrink-0 text-xs px-2 py-1 rounded-full border ${isLive ? 'border-green-500/40 text-green-400' : 'border-mav-line text-mav-muted'}`}>
        {isLive ? 'Live data' : 'Sample data'}
      </span>
    </header>
  )
}
