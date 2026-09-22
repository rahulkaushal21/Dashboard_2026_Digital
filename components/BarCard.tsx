'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useThemeInk } from '@/lib/use-theme-ink'
export default function BarCard({ title, data, dataKey = 'value' }: { title: string; data: any[]; dataKey?: string }) {
  const ink = useThemeInk()
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium mb-4">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" {...{stroke: ink.grid}} horizontal={false} />
          <XAxis type="number" stroke={ink.axis} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke={ink.axis} fontSize={12} width={120} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: ink.tip, border: `1px solid ${ink.grid}`, borderRadius: 8 }} cursor={{ fill: ink.hover }} />
          <Bar dataKey={dataKey} fill="#FFDB2D" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
