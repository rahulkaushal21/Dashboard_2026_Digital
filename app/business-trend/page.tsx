'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getQuotes, getConversions, getBookingsFull, type RevenueRow, type Quote, type QuoteConversion, type BookingRow } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const ym = (s?: string) => (s || '').slice(0, 7)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }

// Convert revenue rows to month+year keyed data, preserving month-year for accurate filtering
function revenueByMonthYear(rows: RevenueRow[]) {
  const m: Record<string, number> = {}
  rows.forEach(r => { m[r.month] = (m[r.month] || 0) + (r.amount_usd || 0) })
  return Object.keys(m).sort().map(month => ({
    month,
    monthLabel: monLabel(month),
    revenue: Math.round(m[month]),
  }))
}

// Get months in FY 2026-27 (April 2026 to March 2027)
function getFY26Months(): string[] {
  const months: string[] = []
  const fy26Start = new Date(2026, 3, 1) // April 2026
  const fy26End = new Date(2027, 2, 31) // March 2027

  for (let d = new Date(fy26Start); d <= fy26End; d.setMonth(d.getMonth() + 1)) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
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
    business_type: 'existing',
    geo: b.geo,
    sales_person: b.sales_person,
  }))
}

// Convert bookings to conversion-like data (all bookings are treated as "won")
function bookingsToConversions(bookings: BookingRow[]): QuoteConversion[] {
  return bookings.map((b, idx) => ({
    id: 200000 + (b.id || idx),
    company_name: b.company_name,
    outcome: 'won',
    amount_usd: b.booking_amount,
    decided_at: b.booking_date,
  }))
}

export default function BusinessTrend() {
  const [r, setR] = useState<RevenueRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [conversions, setConversions] = useState<QuoteConversion[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [usingBookingsAsFallback, setUsingBookingsAsFallback] = useState(false)

  useEffect(() => {
    Promise.all([
      getRevenue().then(setR),
      getBookingsFull().then(setBookings),
      getQuotes().then(q => {
        if (!q || q.length === 0) {
          setUsingBookingsAsFallback(true)
          getBookingsFull().then(b => setQuotes(bookingsToQuotes(b)))
        } else {
          setQuotes(q)
        }
      }),
      getConversions().then(c => {
        if (!c || c.length === 0) {
          getBookingsFull().then(b => setConversions(bookingsToConversions(b)))
        } else {
          setConversions(c)
        }
      }),
    ])
  }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const filtered = useMemo(() => r.filter(x => inRange(x.month)), [r, from, to])
  const series = useMemo(() => revenueByMonthYear(filtered), [filtered])

  // Get last 6 months data (including current month if we're in it)
  const last6Months = useMemo(() => {
    const all = revenueByMonthYear(r)
    return all.slice(Math.max(0, all.length - 6))
  }, [r])

  // Current month is the last month in series; prior is second-to-last
  const cur = series.length > 0 ? series[series.length - 1]?.revenue ?? 0 : 0
  const prev = series.length > 1 ? series[series.length - 2]?.revenue ?? 0 : 0
  const total = series.reduce((s, x) => s + (x.revenue || 0), 0)
  const delta = prev > 0 ? ((cur - prev) / prev) * 100 : 0

  // FY 2026-27 calculations (April 2026 to March 2027)
  const fy26RevenueData = useMemo(() => {
    return revenueByMonthYear(r.filter(x => isInFY26(x.month)))
  }, [r])

  const fy26CompletedMonths = fy26RevenueData.filter(m => {
    const mDate = new Date(m.month + '-01')
    return mDate <= new Date()
  })

  const fy26ActualRevenue = fy26CompletedMonths.reduce((s, x) => s + (x.revenue || 0), 0)

  // Average of completed months (or last 3 months if in early FY)
  const avgMonthlyRev = fy26CompletedMonths.length > 0
    ? fy26CompletedMonths.reduce((s, x) => s + (x.revenue || 0), 0) / fy26CompletedMonths.length
    : 0

  // Calculate remaining months until March 2027
  const now = new Date()
  const marchEnd = new Date(2027, 2, 31)
  const monthsRemaining = Math.ceil((marchEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44))

  // Projected total for full FY 2026-27
  const fy26Target = 3500000
  const projectedTotal = fy26ActualRevenue + (avgMonthlyRev * Math.max(0, monthsRemaining))
  const onTrack = projectedTotal >= fy26Target
  const progressPct = Math.min((fy26ActualRevenue / fy26Target) * 100, 100)

  // Calculate quotes and confirmations for last 6 months
  const last6MonthsKeys = useMemo(() => {
    return last6Months.map(m => m.month)
  }, [last6Months])

  const quotesInPeriod = useMemo(() => {
    return quotes.filter(q => q.added_date && last6MonthsKeys.includes(ym(q.added_date)))
  }, [quotes, last6MonthsKeys])

  const conversionsInPeriod = useMemo(() => {
    return conversions.filter(c => c.decided_at && last6MonthsKeys.includes(ym(c.decided_at)))
  }, [conversions, last6MonthsKeys])

  const confirmedQuotes = conversionsInPeriod.filter(c => c.outcome === 'won').length
  const conversionRate = quotesInPeriod.length > 0 ? (confirmedQuotes / quotesInPeriod.length) * 100 : 0

  const reset = () => { setFrom(''); setTo('') }

  const dataSourceNote = usingBookingsAsFallback 
    ? ' (Using Confirmed Bookings as data source)' 
    : ' (From Quote Tables)'

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
        <div className="relative group">
          <KPICard
            label="Latest month"
            value={fmtUsd(cur)}
            change={delta}
          />
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
            Latest month revenue
          </div>
        </div>
        <div className="relative group">
          <KPICard
            label="Prior month"
            value={fmtUsd(prev)}
          />
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
            Previous month revenue
          </div>
        </div>
        <div className="relative group">
          <KPICard
            label="Delta"
            value={fmtUsd(cur - prev)}
          />
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
            Month-over-Month growth %: {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </div>
        </div>
        <div className="relative group">
          <KPICard
            label="Total in range"
            value={fmtUsd(total)}
          />
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
            Sum of all months in selected range
          </div>
        </div>
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
                  <th className="px-4 py-3 font-medium text-right">{usingBookingsAsFallback ? 'Deals Booked' : 'Quotes'}</th>
                  <th className="px-4 py-3 font-medium text-right">{usingBookingsAsFallback ? 'Confirmed Deals' : 'Confirmations'}</th>
                  <th className="px-4 py-3 font-medium text-right">Confirm Rate %</th>
                </tr>
              </thead>
              <tbody>
                {last6Months.map((month, idx) => {
                  const prevMonth = idx > 0 ? last6Months[idx - 1]?.revenue : null
                  const growthPct = prevMonth ? (((month.revenue || 0) - prevMonth) / prevMonth) * 100 : 0
                  const monthQuotes = quotesInPeriod.filter(q => ym(q.added_date) === month.month).length
                  const monthConfirmed = conversionsInPeriod.filter(c => c.outcome === 'won' && ym(c.decided_at) === month.month).length
                  const confirmRate = monthQuotes > 0 ? (monthConfirmed / monthQuotes) * 100 : 0

                  return (
                    <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-4 py-3">{month.monthLabel}</td>
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
        <h3 className="text-lg font-semibold mb-4">FY 2026-27 Forecast (Apr 2026 - Mar 2027)</h3>
        <div className="bg-mav-panel border border-mav-line rounded-lg p-4 mb-4 text-xs text-mav-muted">
          <p><strong>Financial Year Definition:</strong> April 2026 to March 2027 (12 months)</p>
          <p><strong>Target:</strong> $3.5M total revenue</p>
          <p><strong>Avg Monthly Revenue:</strong> Based on completed months in FY 2026-27</p>
          <p><strong>Projected Total:</strong> (Actual revenue to date) + (Average monthly × remaining months)</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
            <div className="text-xs text-mav-muted mb-1">Avg Monthly Revenue (FY 26)</div>
            <div className="text-2xl font-semibold">{fmtUsd(avgMonthlyRev)}</div>
            <div className="text-xs text-mav-muted mt-2">{fy26CompletedMonths.length} months completed</div>
          </div>
          <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
            <div className="text-xs text-mav-muted mb-1">Projected Total (12 months)</div>
            <div className="text-2xl font-semibold">{fmtUsd(projectedTotal)}</div>
            <div className="text-xs text-mav-muted mt-2">{monthsRemaining} months remaining</div>
          </div>
          <div className={`rounded-lg p-4 border ${onTrack ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
            <div className={`text-xs mb-1 ${onTrack ? 'text-green-300' : 'text-red-300'}`}>Status</div>
            <div className={`text-2xl font-semibold ${onTrack ? 'text-green-400' : 'text-red-400'}`}>{onTrack ? '✓ On Track' : '✗ Off Track'}</div>
            <div className={`text-xs mt-2 ${onTrack ? 'text-green-300' : 'text-red-300'}`}>
              {onTrack
                ? `On pace for $${(projectedTotal / 1000000).toFixed(2)}M`
                : `Need $${((fy26Target - fy26ActualRevenue) / 1000).toFixed(0)}k more`
              }
            </div>
          </div>
        </div>
        <div className="bg-mav-panel border border-mav-line rounded-lg p-4">
          <div className="text-sm text-mav-muted mb-2">Progress toward $3.5M target</div>
          <div className="w-full bg-mav-dark rounded-full h-3 overflow-hidden border border-mav-line/40">
            <div
              className={`h-full transition-all ${projectedTotal >= fy26Target ? 'bg-green-500' : 'bg-yellow-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-3 flex justify-between text-xs text-mav-muted">
            <span>Current: {fmtUsd(fy26ActualRevenue)}</span>
            <span>{progressPct.toFixed(1)}%</span>
            <span>Target: $3.5M</span>
          </div>
          {projectedTotal >= fy26Target ? (
            <div className="mt-2 text-xs text-green-300">
              Projected to exceed target by {fmtUsd(projectedTotal - fy26Target)}
            </div>
          ) : (
            <div className="mt-2 text-xs text-yellow-300">
              Shortfall: {fmtUsd(fy26Target - projectedTotal)} | Need {fmtUsd((fy26Target - fy26ActualRevenue) / Math.max(1, monthsRemaining))}/month average
            </div>
          )}
        </div>
      </div>

      {/* Quotes & Confirmations Section */}
      <div className="mt-8 mb-8">
        <h3 className="text-lg font-semibold mb-4">Quotes & Confirmations (Last 6 Months){dataSourceNote}</h3>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="relative group">
            <KPICard
              label={usingBookingsAsFallback ? 'Deals Booked' : 'Quotes Shared'}
              value={String(quotesInPeriod.length)}
            />
            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
              {usingBookingsAsFallback ? 'From confirmed bookings' : 'From quotes table (added_date)'}
            </div>
          </div>
          <div className="relative group">
            <KPICard
              label={usingBookingsAsFallback ? 'Confirmed Deals' : 'Confirmations'}
              value={String(confirmedQuotes)}
            />
            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
              {usingBookingsAsFallback ? 'All bookings are confirmed' : 'From quote_conversions (outcome=won)'}
            </div>
          </div>
          <div className="relative group">
            <KPICard
              label="Confirmation Rate"
              value={`${conversionRate.toFixed(1)}%`}
            />
            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-mav-dark border border-mav-line rounded px-2 py-1 text-xs text-mav-muted whitespace-nowrap z-10">
              Confirmations / Deals × 100
            </div>
          </div>
        </div>

        {/* Monthly breakdown table */}
        <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-right">{usingBookingsAsFallback ? 'Deals Booked' : 'Quotes'}</th>
                  <th className="px-4 py-3 font-medium text-right">{usingBookingsAsFallback ? 'Confirmed Deals' : 'Confirmations'}</th>
                  <th className="px-4 py-3 font-medium text-right">Confirmation Rate %</th>
                </tr>
              </thead>
              <tbody>
                {last6Months.map((month) => {
                  const monthQuotes = quotesInPeriod.filter(q => ym(q.added_date) === month.month).length
                  const monthConfirmed = conversionsInPeriod.filter(c => c.outcome === 'won' && ym(c.decided_at) === month.month).length
                  const confirmRate = monthQuotes > 0 ? (monthConfirmed / monthQuotes) * 100 : 0

                  return (
                    <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-4 py-3">{month.monthLabel}</td>
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
    </div>
  )
}
