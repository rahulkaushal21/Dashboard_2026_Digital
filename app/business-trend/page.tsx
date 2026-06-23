'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, type RevenueRow } from '@/lib/supabase'
import { fmtUsd, revenueByMonth } from '@/lib/metrics'

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function BusinessTrend() {
  const [r, setR] = useState<RevenueRow[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  useEffect(() => { getRevenue().then(setR) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const filtered = useMemo(() => r.filter(x => inRange(x.month)), [r, from, to])
  const series = revenueByMonth(filtered)
  const cur = series[series.length - 1]?.revenue ?? 0
  const prev = series[series.length - 2]?.revenue ?? 0
  const total = series.reduce((s, x) => s + (x.revenue || 0), 0)
  const delta = prev ? ((cur - prev) / prev) * 100 : 0
  const reset = () => { setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing month over month — filter by date range" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
        <span className="text-xs text-mav-muted ml-2">{series.length} month(s) in view</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Latest month" value={fmtUsd(cur)} change={delta} />
        <KPICard label="Prior month" value={fmtUsd(prev)} />
        <KPICard label="Delta" value={fmtUsd(cur - prev)} />
        <KPICard label="Total in range" value={fmtUsd(total)} />
      </div>
      <RevenueChart data={series} />
    </div>
  )
}
