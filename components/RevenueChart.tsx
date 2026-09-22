'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { useThemeInk } from '@/lib/use-theme-ink'
type Pt = { month: string; revenue: number; monthLabel?: string }
export default function RevenueChart({ data, title = 'Revenue — last 6 months', note, from, to }: { data: Pt[]; title?: string; note?: string; from?: string; to?: string }) {
  const ink = useThemeInk()
  // from/to are 'YYYY-MM' month keys (from <input type="month">); compare against the raw month key.
  const inRange = (p: Pt) => {
    const k = (p.month || '').slice(0, 7)
    if (from && k < from) return false
    if (to && k > to) return false
    return true
  }
  // Use monthLabel for display when provided; fall back to the raw month string.
  const view = data.filter(inRange).map(p => ({ ...p, label: p.monthLabel ?? p.month }))
  // Which bar is the month still running: the last one. Deliberately positional rather
  // than matched on a date — this component's callers put the PRINTED label in `month`
  // ("Sep 2026"), so comparing it against a YYYY-MM key would never match and the bar
  // would quietly never dim. The series is always trailing months ending with today's.
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium">{title}</div>
      {note ? <p className="text-[11px] text-mav-muted mt-0.5 mb-3">{note}</p> : <div className="mb-4" />}
      {/* Bars, not an area.
          A month's revenue is a quantity you compare against the month beside it, and a
          filled curve between six of them draws a slope that is not in the data — it
          invites reading a trend through months that are simply separate totals.

          The current month is dimmed: it is two thirds of a month against five whole
          ones, and at full strength it reads as a collapse every time. */}
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={view} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" {...{stroke: ink.grid}} vertical={false} />
          <XAxis dataKey="label" stroke={ink.axis} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke={ink.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
          <Tooltip cursor={{ fill: ink.hover }}
            contentStyle={{ background: ink.tip, border: `1px solid ${ink.grid}`, borderRadius: 8 }}
            formatter={(v: number) => [`$${Number(v).toLocaleString('en-US')}`, 'Revenue']} />
          <Bar dataKey="revenue" fill="#FFDB2D" radius={[4, 4, 0, 0]}>
            {view.map((p, i) => (
              <Cell key={p.month} fill="#FFDB2D" fillOpacity={i === view.length - 1 ? 0.45 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
