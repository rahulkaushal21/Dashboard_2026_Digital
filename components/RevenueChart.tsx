'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
type Pt = { month: string; revenue: number; monthLabel?: string }
export default function RevenueChart({ data, title = 'Revenue trend (last 3 months)', from, to }: { data: Pt[]; title?: string; from?: string; to?: string }) {
  // from/to are 'YYYY-MM' month keys (from <input type="month">); compare against the raw month key.
  const inRange = (p: Pt) => {
    const k = (p.month || '').slice(0, 7)
    if (from && k < from) return false
    if (to && k > to) return false
    return true
  }
  // Use monthLabel for display when provided; fall back to the raw month string.
  const view = data.filter(inRange).map(p => ({ ...p, label: p.monthLabel ?? p.month }))
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium mb-4">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={view}>
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFDB2D" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#FFDB2D" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
          <XAxis dataKey="label" stroke="#9a9a9a" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#9a9a9a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
          <Tooltip contentStyle={{ background: '#1B1B1B', border: '1px solid #333', borderRadius: 8 }} />
          <Area type="monotone" dataKey="revenue" stroke="#FFDB2D" strokeWidth={2} fill="url(#g)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
