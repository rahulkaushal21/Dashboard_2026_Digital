'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, type RevenueRow } from '@/lib/supabase'
import { fmtUsd, revenueByMonth, momChange } from '@/lib/metrics'

export default function BusinessTrend() {
  const [r, setR] = useState<RevenueRow[]>([])
  useEffect(() => { getRevenue().then(setR) }, [])
  const series = revenueByMonth(r)
  const cur = series[series.length - 1]?.revenue ?? 0
  const prev = series[series.length - 2]?.revenue ?? 0
  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing month over month" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KPICard label="This month" value={fmtUsd(cur)} change={momChange(r)} />
        <KPICard label="Last month" value={fmtUsd(prev)} />
        <KPICard label="Delta" value={fmtUsd(cur - prev)} />
      </div>
      <RevenueChart data={series} />
    </div>
  )
}
