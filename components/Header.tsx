'use client'
import { isLive } from '@/lib/supabase'
export default function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-mav-muted mt-1">{subtitle}</p>}
      </div>
      <span className={`text-xs px-2 py-1 rounded-full border ${isLive ? 'border-green-500/40 text-green-400' : 'border-mav-line text-mav-muted'}`}>
        {isLive ? 'Live data' : 'Sample data'}
      </span>
    </header>
  )
}
