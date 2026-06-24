'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
export default function RevenueChart({ data }: { data: { month: string; revenue: number }[] }) {
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium mb-4">Revenue trend (last 3 months)</div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFDB2D" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#FFDB2D" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
          <XAxis dataKey="month" stroke="#9a9a9a" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#9a9a9a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
          <Tooltip contentStyle={{ background: '#1B1B1B', border: '1px solid #333', borderRadius: 8 }} />
          <Area type="monotone" dataKey="revenue" stroke="#FFDB2D" strokeWidth={2} fill="url(#g)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
