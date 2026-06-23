'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
export default function BarCard({ title, data, dataKey = 'value' }: { title: string; data: any[]; dataKey?: string }) {
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium mb-4">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
          <XAxis type="number" stroke="#9a9a9a" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="#9a9a9a" fontSize={12} width={120} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: '#1B1B1B', border: '1px solid #333', borderRadius: 8 }} cursor={{ fill: '#ffffff08' }} />
          <Bar dataKey={dataKey} fill="#FFDB2D" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
