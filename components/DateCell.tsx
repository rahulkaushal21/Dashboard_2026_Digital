'use client'
import { fmtDay } from './CardDetail'

// One way to print a row's date in a table: 21-Jan-2026, with today's rows marked.
//
// Feedback, Opportunities and Critical Escalations all open on their newest rows, and the
// question on reading them is "what came in today". A small yellow tag answers it
// without anybody having to compare the date against the calendar.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const isToday = (d?: string | null) => (d || '').slice(0, 10) === localToday()

export default function DateCell({ d }: { d?: string | null }) {
  if (!d) return <span className="text-mav-muted">—</span>
  const today = isToday(d)
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums ${today ? 'font-semibold text-mav-fg' : ''}`}>
      <span className="whitespace-nowrap">{fmtDay(d)}</span>
      {today && <span className="text-[10px] leading-none font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-mav-yellow/15 text-mav-yellow border border-mav-yellow/40">Today</span>}
    </span>
  )
}
