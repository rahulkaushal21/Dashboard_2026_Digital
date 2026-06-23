import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
export default function KPICard({ label, value, change }: { label: string; value: string; change?: number | null }) {
  const up = (change ?? 0) >= 0
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-mav-muted">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
      {change != null && (
        <div className={`flex items-center gap-1 text-sm mt-2 ${up ? 'text-green-400' : 'text-red-400'}`}>
          {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          {Math.abs(change).toFixed(1)}% vs last month
        </div>
      )}
    </div>
  )
}
