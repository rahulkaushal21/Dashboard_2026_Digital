import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import InfoTip from './InfoTip'

// Web PM's headline card: a small spaced mono label, the figure large in mono, one short
// line under it. `tone` tints the whole card the way Web PM tints Confirmed green and
// Cancelled pink, so the row of cards reads as a status strip before any figure is read.
// `accent` is the yellow top edge Web PM gives the first card of a row.
export type KPITone = 'default' | 'accent' | 'green' | 'amber' | 'yellow' | 'red' | 'blue'

const TONES: Record<KPITone, string> = {
  default: 'bg-mav-panel border-mav-line',
  accent:  'bg-mav-panel border-mav-line border-t-2 border-t-mav-fill',
  green:   'bg-green-500/10 border-green-500/30',
  amber:   'bg-orange-500/10 border-orange-500/30',
  yellow:  'bg-amber-500/10 border-amber-500/30',
  red:     'bg-rose-500/10 border-rose-500/30',
  blue:    'bg-sky-500/10 border-sky-500/30',
}

export default function KPICard({ label, value, change, changeLabel = 'vs last month', note, sub, tone = 'default', info, onClick, active }: {
  label: string
  value: string
  change?: number | null
  changeLabel?: string
  /** A caveat on the figure. Short ones print; the long explanations belong in `info`. */
  note?: string
  /** The line under the figure — "512 quotes won". */
  sub?: React.ReactNode
  tone?: KPITone
  /** Explanation behind an ⓘ next to the label. */
  info?: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const up = (change ?? 0) >= 0
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`text-left border rounded-xl p-4 min-w-0 ${TONES[tone]} ${onClick ? 'hover:shadow-md transition-shadow cursor-pointer' : ''} ${active ? 'ring-2 ring-mav-fill' : ''}`}>
      <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-mav-muted">
        <span className="truncate" title={label}>{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className="font-mono text-2xl sm:text-[26px] font-semibold mt-2 tabular-nums tracking-tight break-words leading-tight">{value}</div>
      {sub && <div className="text-xs text-mav-muted mt-1">{sub}</div>}
      {change != null && (
        <div className={`flex items-center gap-1 text-xs mt-1.5 ${up ? 'text-green-400' : 'text-red-400'}`}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(change).toFixed(1)}% {changeLabel}
        </div>
      )}
      {note && <div className="text-[11px] text-mav-muted mt-1 leading-snug line-clamp-2" title={note}>{note}</div>}
    </Tag>
  )
}
