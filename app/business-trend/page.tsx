'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getQuotes, getConversions, type RevenueRow, type Quote, type QuoteConversion } from '@/lib/supabase'
import { fmtUsd, revenueByMonth } from '@/lib/metrics'

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const ym = (s?: string) => (s || '').slice(0, 7)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }

export default function BusinessTrend() {
  const [r, setR] = useState<RevenueRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [conversions, setConversions] = useState<QuoteConversion[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  
  useEffect(() => { 
    getRevenue().then(setR)
    getQuotes().then(setQuotes)
    getConversions().then(setConversions)
  }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const filtered = useMemo(() => r.filter(x => inRange(x.month)), [r, from, to])
  const series = revenueByMonth(filtered)
  
  // Get last 6 months data
  const last6Months = useMemo(() => {
    const all = revenueByMonth(r)
    return all.slice(Math.max(0, all.length - 6))
  }, [r])
  
  const cur = series[series.length - 1]?.revenue ?? 0
  const prev = series[series.length - 2]?.revenue ?? 0
  const total = series.reduce((s, x) => s + (x.revenue || 0), 0)
  const delta = prev ? ((cur - prev) / prev) * 100 : 0
  
  // Calculate quotes and confirmations for last 6 months
  const quotesInPeriod = useMemo(() => {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    return quotes.filter(q => {
      const qDate = q.quote_date ? new Date(q.quote_date) : new Date()
      return qDate >= sixMonthsAgo
    })
  }, [quotes])
  
  const confirmedQuotes = useMemo(() => {
    return conversions.filter(c => c.outcome === 'won').length
  }, [conversions])
  
  // FY 2026-27 forecast (target $3.5M by March 2027)
  const fy26Target = 3500000
  const avgMonthlyRev = last6Months.length > 0 
    ? last6Months.reduce((s, x) => s + (x.revenue || 0), 0) / last6Months.length 
    : 0
  const monthsRemaining = 9 // April 2026 to December 2026, then Jan-Mar 2027 = 12 months total
  const projectedTotal = last6Months.length > 0
    ? last6Months.reduce((s, x) => s + (x.revenue || 0), 0) + (avgMonthlyRev * monthsRemaining)
    : 0
  const onTrack = projectedTotal >= fy26Target
  
  const reset = () => { setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing, 6-month analysis, quotes/confirmations tracking, and FY 2026-27 forecast" />
      
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

      {/* 6-Month Analysis Section */}
      <div className="mt-8 mb-6">
        <h3 className="text-lg font-semibold mb-4">Last 6 Months Analysis</h3>
        <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-right">Revenue</th>
                  <th className="px-4 py-3 font-medium text-right">Growth %</th>
                  <th className="px-4 py-3 font-medium text-right">Quotes</th>
                  <th className="px-4 py-3 font-medium text-right">Confirmations</th>
                  <th className="px-4 py-3 font-medium text-right">Confirm Rate %</th>
                </tr>
              </thead>
              <tbody>
                {last6Months.map((month, idx) => {
                  const prevMonth = idx > 0 ? last6Months[idx - 1]?.revenue : null
                  const growthPct = prevMonth ? (((month.revenue || 0) - prevMonth) / prevMonth) * 100 : 0
                  const monthQuotes = quotesInPeriod.filter(q => ym(q.quote_date) === month.month).length
                  const monthConfirmed = conversions.filter(c => c.outcome === 'won' && ym(c.decision_date) === month.month).length
                  const confirmRate = monthQuotes > 0 ? (monthConfirmed / monthQuotes) * 100 : 0
                  
                  return (
                    <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-4 py-3">{monLabel(month.month)}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtUsd(month.revenue || 0)}</td>
                      <td className={`px-4 py-3 text-right ${growthPct > 0 ? 'text-green-400' : growthPct < 0 ? 'text-red-400' : 'text-mav-muted'}`}>
                        {growthPct !== 0 ? `${growthPct > 0 ? '+' : ''}${growthPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-mav-muted">{monthQuotes}</td>
                      <td className="px-4 py-3 text-right text-mav-muted">{monthConfirmed}</td>
                      <td className="px-4 py-3 text-right text-mav-muted">{monthQuotes > 0 ? `${confirmRate.toFixed(0)}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FY 2026-27 Forecast Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">FY 2026-27 Forecast (Target: $3.5M by March 2027)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
            <div className="text-xs text-mav-muted mb-1">Avg Monthly Revenue</div>
            <div className="text-2xl font-semibold">{fmtUsd(avgMonthlyRev)}</div>
          </div>
          <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
            <div className="text-xs text-mav-muted mb-1">Projected Total (12 months)</div>
            <div className="text-2xl font-semibold">{fmtUsd(projectedTotal)}</div>
          </div>
          <div className={`rounded-lg p-4 border ${onTrack ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
            <div className={`text-xs mb-1 ${onTrack ? 'text-green-300' : 'text-red-300'}`}>Status</div>
            <div className={`text-2xl font-semibold ${onTrack ? 'text-green-400' : 'text-red-400'}`}>{onTrack ? '✓ On Track' : '✗ Off Track'}</div>
          </div>
        </div>
        <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
          <div className="text-sm text-mav-muted mb-2">Progress toward $3.5M target</div>
          <div className="w-full bg-mav-dark rounded-full h-2 overflow-hidden">
            <div 
              className={`h-full ${projectedTotal >= fy26Target ? 'bg-green-500' : 'bg-yellow-500'}`}
              style={{ width: `${Math.min((projectedTotal / fy26Target) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-mav-muted">
            {projectedTotal >= fy26Target 
              ? `Projected to exceed target by ${fmtUsd(projectedTotal - fy26Target)}`
              : `Shortfall: ${fmtUsd(fy26Target - projectedTotal)} (need ${(((fy26Target - projectedTotal) / monthsRemaining) / 1000).toFixed(0)}k/month)`
            }
          </div>
        </div>
      </div>

      {/* Quotes & Confirmations Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Quotes & Confirmations (Last 6 Months)</h3>
        <div className="grid grid-cols-3 gap-4">
          <KPICard label="Quotes Shared" value={String(quotesInPeriod.length)} />
          <KPICard label="Confirmed" value={String(confirmedQuotes)} />
          <KPICard label="Conversion Rate" value={quotesInPeriod.length > 0 ? `${((confirmedQuotes / quotesInPeriod.length) * 100).toFixed(0)}%` : '0%'} />
        </div>
      </div>
    </div>
  )
}
