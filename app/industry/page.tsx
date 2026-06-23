'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import BarCard from '@/components/BarCard'
import { getSqlLeads, type SqlLead } from '@/lib/supabase'

export default function Industry() {
  const [s, setS] = useState<SqlLead[]>([])
  useEffect(() => { getSqlLeads().then(setS) }, [])
  const counts: Record<string, number> = {}
  s.forEach(x => { const k = x.industry || 'Unknown'; counts[k] = (counts[k] || 0) + 1 })
  const data = Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  return (
    <div>
      <Header title="Industry Focus" subtitle="Where demand is concentrated, by lead volume" />
      <BarCard title="Leads by industry" data={data} />
    </div>
  )
}
