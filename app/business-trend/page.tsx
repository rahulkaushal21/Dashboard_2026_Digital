'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getQuotes, getConversions, getBookingsFull, type RevenueRow, type Quote, type QuoteConversion, type BookingRow } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow text-white font-medium cursor-pointer'
const ym = (s?: string) => (s || '').slice(0, 7)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }

// Convert revenue rows to month+year keyed data, preserving month-year for accurate filtering
function revenueByMonthYear(rows: RevenueRow[]) {
  const m: Record<string, number> = {}
  rows.forEach(r => {
    const monthKey = ym(r.month)
    m[monthKey] = (m[monthKey] || 0) + (r.amount_usd || 0)
  })
  return Object.keys(m).sort().map(month => ({
    month,
    monthLabel: monLabel(month),
    revenue: Math.round(m[month]),
  }))
}

// Get months in FY 2026-27 (April 2026 to March 2027)
function getFY26Months(): string[] {
  const months: string[] = []
  for (let year = 2026; year <= 2027; year++) {
    const startMonth = year === 2026 ? 4 : 1
    const endMonth = year === 2026 ? 12 : 3
    for (let month = startMonth; month <= endMonth; month++) {
      months.push(`${year}-${String(month).padStart(2, '0')}`)
    }
  }
  return months
}

// Check if a month is in FY 2026-27
function isInFY26(monthStr?: string): boolean {
  if (!monthStr) return false
  const fy26Months = getFY26Months()
  return fy26Months.includes(monthStr)
}

// Convert bookings to quote-like data for fallback display
function bookingsToQuotes(bookings: BookingRow[]): Quote[] {
  return bookings.map((b, idx) => ({
    id: 100000 + (b.id || idx),
    quote_id: b.id?.toString(),
    added_date: b.booking_date,
    agency: b.company_name,
    usd_value: b.booking_amount,
    status: 'confirmed',
  }))
}

export default function BusinessTrendPage() {
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [revenue, setRevenue] = useState<RevenueRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [conversions, setConversions] = useState<QuoteConversion[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [rev, q, c, b] = await Promise.all([
          getRevenue(),
          getQuotes(),
          getConversions(),
          getBookingsFull(),
        ])
        setRevenue(rev || [])
        setQuotes(q && q.length > 0 ? q : (b ? bookingsToQuotes(b) : []))
        setConversions(c || [])
        setBookings(b || [])
        setLoading(false)
      } catch (e) {
        console.error('Error loading business trend data:', e)
        setLoading(false)
      }
    })()
  }, [])

  // Last 6 months: identify latest month, go back 6, show all data in range
  const last6Mo = useMemo(() => {
    const byMonth = revenueByMonthYear(revenue)
    if (byMonth.length === 0) return []

    const [lastMonthStr] = byMonth[byMonth.length - 1].month.split('-')
    const lastYear = +lastMonthStr
    const lastMo = +byMonth[byMonth.length - 1].month.split('-')[1]

    let year = lastYear, mo = lastMo
    const sixMonthsBack: string[] = []
    for (let i = 0; i < 6; i++) {
      sixMonthsBack.unshift(`${year}-${String(mo).padStart(2, '0')}`)
      mo--
      if (mo < 1) {
        mo = 12
        year--
      }
    }

    return byMonth.filter(item => {
      const itemMonth = ym(item.month)
      return sixMonthsBack.includes(itemMonth)
    })
  }, [revenue])

  // FY 2026-27 analysis: Apr 2026 - Mar 2027
  const fy26Analysis = useMemo(() => {
    const fy26Months = getFY26Months()
    const fy26Rev = revenueByMonthYear(revenue).filter(r => isInFY26(ym(r.month)))

    const totalRev = fy26Rev.reduce((sum, r) => sum + r.revenue, 0)
    const completedMonths = fy26Rev.length
    const monthsRemaining = Math.max(0, 12 - completedMonths)
    const avgMonthly = completedMonths > 0 ? totalRev / completedMonths : 0
    const projected = totalRev + (avgMonthly * monthsRemaining)

    const target = 3500000
    const onTrack = projected >= target

    return {
      completedMonths,
      totalRevenue: totalRev,
      avgMonthly,
      projected: Math.round(projected),
      monthsRemaining,
      targetProgress: Math.round((totalRev / target) * 100),
      onTrack,
      data: fy26Rev,
    }
  }, [revenue])

  // Quotes and confirmations: last 6 months
  const quotesAnalysis = useMemo(() => {
    const lastMonthStr = last6Mo.length > 0 ? ym(last6Mo[last6Mo.length - 1].month) : ''
    const sixMonthsAgo = lastMonthStr
      ? (() => {
          const [y, m] = lastMonthStr.split('-')
          let year = +y, mo = +m - 6
          if (mo < 1) { mo += 12; year-- }
          return `${year}-${String(mo).padStart(2, '0')}`
        })()
      : ''

    const relevant = quotes.filter(q => {
      const qm = ym(q.added_date)
      return !sixMonthsAgo || (qm >= sixMonthsAgo && qm <= lastMonthStr)
    })

    const confirmed = relevant.filter(q => (q.status || '').toLowerCase() === 'confirmed').length
    return {
      total: relevant.length,
      confirmed,
      rate: relevant.length > 0 ? Math.round((confirmed / relevant.length) * 100) : 0,
    }
  }, [quotes, last6Mo])

  if (loading) return <div className="p-6 text-mav-muted">Loading business trend data...</div>

  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing, 6-month analysis, quotes/confirmations tracking, and FY 2026-27 forecast" />

      {/* Date range selector for manual exploration */}
      <div className="flex gap-4 items-center mb-6 text-xs">
        <label className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-mav-muted">From</span>
          <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} className={selCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-mav-muted">To</span>
          <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)} className={selCls} />
        </label>
        <button onClick={() => { setFromMonth(''); setToMonth('') }} className="mt-6 text-xs px-3 py-2 bg-mav-line border border-mav-line text-mav-muted rounded hover:border-mav-yellow hover:text-white transition-colors">
          Reset
        </button>
        <span className="text-xs text-mav-muted ml-4">
          {revenue.length} month(s) in view
        </span>
      </div>

      {/* Revenue trend chart */}
      <RevenueChart data={revenueByMonthYear(revenue)} from={fromMonth} to={toMonth} />

      {/* Last 6 months analysis table */}
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">Last 6 Months Analysis</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-5 py-3 font-medium">Month</th>
                <th className="px-5 py-3 font-medium text-right">Revenue</th>
                <th className="px-5 py-3 font-medium text-right">Growth %</th>
                <th className="px-5 py-3 font-medium text-right">Quotes</th>
                <th className="px-5 py-3 font-medium text-right">Confirmations</th>
                <th className="px-5 py-3 font-medium text-right">Confirm Rate %</th>
              </tr>
            </thead>
            <tbody>
              {last6Mo.length > 0 ? last6Mo.map((item, idx) => {
                const prev = idx > 0 ? last6Mo[idx - 1].revenue : item.revenue
                const growth = prev > 0 ? Math.round(((item.revenue - prev) / prev) * 1000) / 10 : 0
                const monthKey = ym(item.month)
                const monthQuotes = quotes.filter(q => ym(q.added_date) === monthKey)
                const confirmed = monthQuotes.filter(q => (q.status || '').toLowerCase() === 'confirmed').length
                const confirmRate = monthQuotes.length > 0 ? Math.round((confirmed / monthQuotes.length) * 100) : 0
                return (
                  <tr key={item.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-3 whitespace-nowrap">{item.monthLabel}</td>
                    <td className="px-5 py-3 text-right font-medium">{fmtUsd(item.revenue)}</td>
                    <td className="px-5 py-3 text-right text-mav-muted">{growth > 0 ? '+' : ''}{growth}%</td>
                    <td className="px-5 py-3 text-right">{monthQuotes.length}</td>
                    <td className="px-5 py-3 text-right">{confirmed}</td>
                    <td className="px-5 py-3 text-right">{monthQuotes.length > 0 ? confirmRate + '%' : '—'}</td>
                  </tr>
                )
              }) : (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-mav-muted">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FY 2026-27 Forecast section */}
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">FY 2026-27 Forecast (Apr 2026 - Mar 2027)</div>
        </div>

        <div className="p-5 space-y-5">
          <div className="text-xs text-mav-muted space-y-1">
            <p><strong className="text-white">Financial Year Definition:</strong> April 2026 to March 2027 (12 months)</p>
            <p><strong className="text-white">Target:</strong> $3.5M total revenue</p>
            <p><strong className="text-white">Avg Monthly Revenue:</strong> Based on completed months in FY 2026-27</p>
            <p><strong className="text-white">Projected Total:</strong> (Actual revenue to date) + (Average monthly × remaining months)</p>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Avg Monthly Revenue (FY 26)" value={fmtUsd(Math.round(fy26Analysis.avgMonthly))} />
            <KPICard title="Projected Total (12 months)" value={fmtUsd(fy26Analysis.projected)} />
            <KPICard title={`Status`} value={fy26Analysis.onTrack ? '✓ On Track' : '✗ Off Track'} />
            <KPICard title="Remaining Months" value={fy26Analysis.monthsRemaining.toString()} />
          </div>

          {/* Progress bar */}
          <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-4">
            <div className="flex justify-between mb-3">
              <span className="text-sm font-medium">Progress toward $3.5M target</span>
              <span className="text-sm font-medium text-mav-yellow">{fy26Analysis.targetProgress}%</span>
            </div>
            <div className="w-full bg-mav-line rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full ${fy26Analysis.onTrack ? 'bg-green-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(fy26Analysis.targetProgress, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-3 text-xs text-mav-muted">
              <span>Current: <span className="text-white font-medium">{fmtUsd(fy26Analysis.totalRevenue)}</span></span>
              <span>Target: <span className="text-white font-medium">$3.5M</span></span>
            </div>
            {!fy26Analysis.onTrack && (
              <p className="text-xs text-red-400 mt-3">
                Shortfall: {fmtUsd(3500000 - fy26Analysis.projected)} | Need {fmtUsd(Math.ceil((3500000 - fy26Analysis.projected) / Math.max(1, fy26Analysis.monthsRemaining)))}/month average
              </p>
            )}
          </div>

          {/* FY data table */}
          {fy26Analysis.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className="px-5 py-3 font-medium">Month</th>
                    <th className="px-5 py-3 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {fy26Analysis.data.map((item, idx) => (
                    <tr key={item.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-5 py-3 whitespace-nowrap">{item.monthLabel}</td>
                      <td className="px-5 py-3 text-right font-medium">{fmtUsd(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-mav-muted">No FY 2026-27 data available yet (waiting for Apr 2026+ bookings)</p>
          )}

          <p className="text-xs text-mav-muted">
            {fy26Analysis.completedMonths} months completed
          </p>
        </div>
      </div>

      {/* Quotes and conversions section */}
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">Quotes & Confirmations (Last 6 Months) {quotes.length === 0 && <span className="text-xs text-mav-muted font-normal ml-2">(From Quote Tables)</span>}</div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <KPICard title="QUOTES SHARED" value={quotesAnalysis.total.toString()} />
            <KPICard title="CONFIRMATIONS" value={quotesAnalysis.confirmed.toString()} />
            <KPICard title="CONFIRMATION RATE" value={quotesAnalysis.rate.toFixed(1) + '%'} />
          </div>

          {/* Empty quotes fallback */}
          {quotes.length === 0 && (
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded p-3 text-xs text-mav-muted">
              No quote data available. Showing bookings as confirmed conversions.
            </div>
          )}

          {/* Quotes table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium text-right">Quotes</th>
                  <th className="px-5 py-3 font-medium text-right">Confirmations</th>
                  <th className="px-5 py-3 font-medium text-right">Confirmation Rate %</th>
                </tr>
              </thead>
              <tbody>
                {last6Mo.map(month => {
                  const monthKey = ym(month.month)
                  const monthQuotes = quotes.filter(q => ym(q.added_date) === monthKey)
                  const confirmed = monthQuotes.filter(q => (q.status || '').toLowerCase() === 'confirmed').length
                  const rate = monthQuotes.length > 0 ? Math.round((confirmed / monthQuotes.length) * 100) : 0
                  return (
                    <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-5 py-3 whitespace-nowrap">{month.monthLabel}</td>
                      <td className="px-5 py-3 text-right">{monthQuotes.length}</td>
                      <td className="px-5 py-3 text-right">{confirmed}</td>
                      <td className="px-5 py-3 text-right">{monthQuotes.length > 0 ? rate + '%' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
