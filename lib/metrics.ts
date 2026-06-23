import type { RevenueRow } from './supabase'

export const fmtUsd = (n: number) => {
  const v = Number(n) || 0
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export function revenueByMonth(rows: RevenueRow[]) {
  const m: Record<string, number> = {}
  rows.forEach(r => { m[r.month] = (m[r.month] || 0) + (r.amount_usd || 0) })
  return Object.keys(m).sort().map(month => ({
    month: new Date(month).toLocaleDateString('en', { month: 'short' }),
    revenue: Math.round(m[month]),
  }))
}

export function momChange(rows: RevenueRow[]) {
  const series = revenueByMonth(rows)
  if (series.length < 2) return null
  const cur = series[series.length - 1].revenue
  const prev = series[series.length - 2].revenue
  return prev ? ((cur - prev) / prev) * 100 : null
}

export function topClients(rows: RevenueRow[], n = 5) {
  const m: Record<string, number> = {}
  rows.forEach(r => { m[r.client_name] = (m[r.client_name] || 0) + (r.amount_usd || 0) })
  return Object.entries(m).map(([client_name, revenue]) => ({ client_name, revenue: Math.round(revenue) }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, n)
}
