'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getClients, getOpportunities, type RevenueRow, type Client, type Opportunity } from '@/lib/supabase'
import { fmtUsd, revenueByMonth, momChange, topClients } from '@/lib/metrics'

export default function Dashboard() {
  const [rev, setRev] = useState<RevenueRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  useEffect(() => { (async () => {
    setRev(await getRevenue()); setClients(await getClients()); setOpps(await getOpportunities())
  })() }, [])

  const series = revenueByMonth(rev)
  const total = series.reduce((s, x) => s + x.revenue, 0)
  const latest = series[series.length - 1]?.revenue ?? 0
  const active = clients.filter(c => c.client_status === 'active').length
  const openOpps = opps.filter(o => o.rfq_status === 'pending' || o.rfq_status === 'received').length

  return (
    <div>
      <Header title="Dashboard" subtitle="Revenue, clients and pipeline at a glance" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Revenue (latest month)" value={fmtUsd(latest)} change={momChange(rev)} />
        <KPICard label="Total revenue (period)" value={fmtUsd(total)} />
        <KPICard label="Active clients" value={String(active)} />
        <KPICard label="Open opportunities" value={String(openOpps)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><RevenueChart data={series} /></div>
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="text-sm font-medium mb-4">Top clients</div>
          <ul className="space-y-3">
            {topClients(rev).map((c, i) => (
              <li key={c.client_name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className="text-mav-muted w-4">{i + 1}</span>{c.client_name}</span>
                <span className="font-medium">{fmtUsd(c.revenue)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
