'use client'
import { isLive } from '@/lib/supabase'
import { useUnit } from './BusinessUnitProvider'
import { unitLabel } from '@/lib/business-unit'
import InfoTip from './InfoTip'

/**
 * Every page opens the same way: the title, a dark chip saying which slice of the business
 * you are looking at, then the page's own actions on the right. Web PM's header, so the
 * two tools read alike.
 *
 * `subtitle` is kept for every existing caller but is no longer printed as a line — it
 * sits behind the ⓘ next to the title. `chip` adds page context to the department
 * ("FROM 01-APR-2026"); `actions` is for the page's buttons (Add, Refresh…), which used
 * to float in their own row below the heading.
 *
 * The department switch itself moved to the sidebar; the chip is how a page says which
 * department it is showing.
 */
export default function Header({ title, subtitle, chip, actions }: {
  title: string
  subtitle?: React.ReactNode
  chip?: string
  actions?: React.ReactNode
}) {
  const { unit, canSwitch } = useUnit()
  const dept = canSwitch ? (unit === 'all' ? 'All departments' : unitLabel(unit)) : ''
  const chipText = [dept, chip].filter(Boolean).join(' · ')
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-5">
      <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-none">{title}</h1>
        {chipText && (
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 rounded-md border border-mav-yellow/30 bg-mav-yellow/10 text-mav-yellow whitespace-nowrap">
            {chipText}
          </span>
        )}
        {subtitle && <InfoTip text={subtitle} />}
      </div>
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        {actions}
        <span className={`font-mono text-[10.5px] uppercase tracking-[0.08em] px-2 py-1 rounded-full border flex items-center gap-1.5 ${isLive ? 'border-green-500/40 text-green-400' : 'border-mav-line text-mav-muted'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500' : 'bg-mav-muted'}`} />
          {isLive ? 'Live' : 'Sample'}
        </span>
      </div>
    </header>
  )
}
