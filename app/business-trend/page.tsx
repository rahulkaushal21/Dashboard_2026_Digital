'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getQuotes, getConversions, getBookingsFull, getOpportunities, type RevenueRow, type Quote, type QuoteConversion, type BookingRow, type Opportunity } from '@/lib/supabase'
import { FY_TARGET, FY_TARGET_LABEL } from '@/lib/config'
import { fmtUsd } from '@/lib/metrics'

// FY 2026-27 revenue goal. One constant — the progress bar, the shortfall line and
// the plan below it all read from here, so the number can never disagree with itself.
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow text-white font-medium cursor-pointer'
const ym = (s?: string) => (s || '').slice(0, 7)
const ymd = (s?: string) => (s || '').slice(0, 10)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }

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

function isInFY26(monthStr?: string): boolean {
  if (!monthStr) return false
  const fy26Months = getFY26Months()
  return fy26Months.includes(monthStr)
}

// A "confirmed" opportunity is one that booked (won). getOpportunities() never
// sets rfq_status to 'confirmed' — it flags wins via `won`/rfq_status 'won'.
const isWon = (opp: Opportunity) => opp.won === true || (opp.rfq_status || '').toLowerCase() === 'won'

function deduplicateOpportunities(opps: Opportunity[]): Opportunity[] {
  const dedupMap: Record<string, Opportunity> = {}
  opps.forEach(opp => {
    const name = (opp.company_name || '').trim().toLowerCase()
    if (!name) return
    const existing = dedupMap[name]
    if (!existing) {
      dedupMap[name] = opp
    } else {
      const won = isWon(opp)
      const existingWon = isWon(existing)
      if (won && !existingWon) {
        dedupMap[name] = opp
      } else if (won === existingWon) {
        // same status → keep the most recent
        const oppDate = new Date(opp.source_date || 0).getTime()
        const existingDate = new Date(existing.source_date || 0).getTime()
        if (oppDate > existingDate) {
          dedupMap[name] = opp
        }
      }
    }
  })
  return Object.values(dedupMap)
}

export default function BusinessTrendPage() {
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [revenue, setRevenue] = useState<RevenueRow[]>([])
  const [opportunitiesRaw, setOpportunitiesRaw] = useState<Opportunity[]>([])
  // Line-level revenue rows: the monthly series aggregates these and loses the service
  // department, SME and owner, which is exactly what you need before ringing a client.
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [pushSel, setPushSel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Set after mount so the server-rendered HTML doesn't bake in a build-time date.
  const [thisMonth, setThisMonth] = useState(''); const [todayMs, setTodayMs] = useState(0)

  useEffect(() => {
    (async () => {
      try {
        const [rev, opp, bk] = await Promise.all([
          getRevenue(),
          getOpportunities(),
          getBookingsFull(),
        ])
        setRevenue(rev || [])
        setOpportunitiesRaw(opp || [])
        setBookings(bk || [])
        setLoading(false)
      } catch (e) {
        console.error('Error loading business trend data:', e)
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => { const d = new Date(); setThisMonth(d.toISOString().slice(0, 7)); setTodayMs(d.getTime()) }, [])

  const opportunities = useMemo(() => deduplicateOpportunities(opportunitiesRaw), [opportunitiesRaw])

  // Full monthly revenue series; the chart filters it by the From/To month pickers.
  const revenueSeries = useMemo(() => revenueByMonthYear(revenue), [revenue])
  const monthsInView = useMemo(() => revenueSeries.filter(r => {
    const k = ym(r.month)
    if (fromMonth && k < fromMonth) return false
    if (toMonth && k > toMonth) return false
    return true
  }).length, [revenueSeries, fromMonth, toMonth])

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

  const fy26Analysis = useMemo(() => {
    const fy26Months = getFY26Months()
    const fy26Rev = revenueByMonthYear(revenue).filter(r => isInFY26(ym(r.month)))
    const totalRev = fy26Rev.reduce((sum, r) => sum + r.revenue, 0)
    const completedMonths = fy26Rev.length
    const monthsRemaining = Math.max(0, 12 - completedMonths)
    const avgMonthly = completedMonths > 0 ? totalRev / completedMonths : 0
    const projected = totalRev + (avgMonthly * monthsRemaining)
    const target = FY_TARGET
    const onTrack = projected >= target
    const projectedPercent = Math.round((projected / target) * 100)
    return {
      completedMonths,
      totalRevenue: totalRev,
      avgMonthly,
      projected: Math.round(projected),
      monthsRemaining,
      projectedPercent,
      targetProgress: Math.round((totalRev / target) * 100),
      onTrack,
      data: fy26Rev,
    }
  }, [revenue])


  // ---- Closing the gap to the FY target -------------------------------------
  // Everything below is computed from the same revenue and pipeline the rest of the
  // page uses. Nothing is estimated by hand: if a number isn't in the data it isn't
  // shown. The run-rate deliberately EXCLUDES the month in progress — a half-billed
  // month drags the average down and would overstate the shortfall by ~$100k.
  const plan = useMemo(() => {
    const fy = fy26Analysis.data
    const complete = fy.filter(r => ym(r.month) !== thisMonth)
    const partial = fy.find(r => ym(r.month) === thisMonth)
    const runRate = complete.length ? complete.reduce((s, r) => s + r.revenue, 0) / complete.length : 0
    const booked = fy.reduce((s, r) => s + r.revenue, 0)
    // Months still to bill, counting the one in progress as still winnable.
    const monthsLeft = Math.max(0, 12 - complete.length)
    const gap = Math.max(0, FY_TARGET - booked)
    const needPerMonth = monthsLeft ? gap / monthsLeft : 0
    const upliftPerMonth = Math.max(0, needPerMonth - runRate)

    // Deals to close: open quotes with a real number on them, ranked by what they're
    // actually worth — value × the win probability someone recorded — not by headline
    // size. Age is shown because a 30%-probability deal from last year is not the same
    // prospect as a 30% deal from last week.
    const today = todayMs
    const openDeals = opportunities
      .filter(o => !o.won && !/lost|cancel/i.test(o.status || '') && (o.value || 0) > 0)
      .map(o => {
        const d = Date.parse(o.source_date || o.first_date || '')
        const age = Number.isFinite(d) && today ? Math.floor((today - d) / 86400000) : null
        const win = o.win_probability ?? 0
        return { ...o, age, win, expected: Math.round((o.value || 0) * win / 100) }
      })
      .sort((a, b) => b.expected - a.expected)
    const pipelineValue = openDeals.reduce((s, o) => s + (o.value || 0), 0)
    const weighted = openDeals.reduce((s, o) => s + o.expected, 0)
    const fresh = openDeals.filter(o => o.age !== null && o.age <= 90)
    const stale = openDeals.filter(o => o.age !== null && o.age > 90)
    const staleValue = stale.reduce((s, o) => s + (o.value || 0), 0)

    // Clients to push: accounts that were billing and then stopped or slowed. Compares
    // the last three completed months against the three before them, per client. The
    // "recoverable" figure is what they used to bill per month — not a forecast, a
    // statement of what they were worth before they went quiet.
    const keys = complete.map(r => ym(r.month))
    const last3 = new Set(keys.slice(-3)), prior3 = new Set(keys.slice(-6, -3))
    const byClient = new Map<string, { name: string; last3: number; prior3: number }>()
    revenue.forEach(r => {
      const k = ym(r.month), name = (r.client_name || '').trim()
      if (!name) return
      const e = byClient.get(name.toLowerCase()) || { name, last3: 0, prior3: 0 }
      if (last3.has(k)) e.last3 += r.amount_usd || 0
      else if (prior3.has(k)) e.prior3 += r.amount_usd || 0
      byClient.set(name.toLowerCase(), e)
    })
    const slipped = [...byClient.values()]
      .filter(c => c.prior3 > 0 && c.last3 < c.prior3 * 0.7)
      .map(c => ({ ...c, drop: Math.round(c.prior3 - c.last3), perMonth: Math.round(c.prior3 / 3), lapsed: c.last3 === 0 }))
      .sort((a, b) => b.drop - a.drop)
    const recoverable = slipped.reduce((s, c) => s + c.perMonth, 0)

    // Concentration: how much of the year so far rests on the ten biggest accounts.
    const fyByClient = new Map<string, number>()
    revenue.forEach(r => { const k = ym(r.month); if (!isInFY26(k)) return; const n = (r.client_name || '').trim(); if (n) fyByClient.set(n, (fyByClient.get(n) || 0) + (r.amount_usd || 0)) })
    const ranked = [...fyByClient.entries()].sort((a, b) => b[1] - a[1])
    const top10 = ranked.slice(0, 10).reduce((s, [, v]) => s + v, 0)
    const activeClients = ranked.length

    return {
      runRate: Math.round(runRate), booked: Math.round(booked), gap: Math.round(gap),
      monthsLeft, needPerMonth: Math.round(needPerMonth), upliftPerMonth: Math.round(upliftPerMonth),
      completeMonths: complete.length, partialMonth: partial ? partial.monthLabel : '',
      openDeals, pipelineValue, weighted, fresh, stale, staleValue,
      slipped, recoverable, top10, top10Share: booked > 0 ? Math.round((top10 / (ranked.reduce((s, [, v]) => s + v, 0) || 1)) * 100) : 0,
      activeClients,
    }
  }, [fy26Analysis, opportunities, revenue, thisMonth, todayMs])

  // Plain readings of the numbers above — each one is a fact from the data plus the
  // action it implies. No projection is invented here that the figures don't support.
  const insights = useMemo(() => {
    const out: { tone: 'good' | 'warn' | 'bad'; head: string; body: string }[] = []
    if (!plan.completeMonths) return out
    const cover = plan.gap > 0 ? Math.round((plan.weighted / plan.gap) * 100) : 100
    out.push({
      tone: cover >= 100 ? 'good' : cover >= 50 ? 'warn' : 'bad',
      head: `Open pipeline covers ${cover}% of the gap`,
      body: `${fmtUsd(plan.pipelineValue)} is open across ${plan.openDeals.length} quotes; weighted by the win probability on each, that is ${fmtUsd(plan.weighted)} against a ${fmtUsd(plan.gap)} gap. ${cover >= 100 ? 'The pipeline is large enough — this is a conversion problem, not a lead problem.' : `Closing everything open still leaves ${fmtUsd(Math.max(0, plan.gap - plan.weighted))}, so new demand has to come from somewhere else.`}`,
    })
    if (plan.staleValue > 0) out.push({
      tone: 'warn',
      head: `${fmtUsd(plan.staleValue)} is sitting in deals older than 90 days`,
      body: `${plan.stale.length} of ${plan.openDeals.length} open quotes have had no dated movement in over three months. Some are dead and are inflating the pipeline; the rest need a decision. Working this list costs nothing and makes every other number on this page honest.`,
    })
    if (plan.recoverable > 0) out.push({
      tone: 'bad',
      head: `${fmtUsd(plan.recoverable)}/month walked out of accounts we already have`,
      body: `${plan.slipped.length} clients billed materially less in the last three months than the three before — ${plan.slipped.filter(c => c.lapsed).length} stopped entirely. Winning back a client who already bought is cheaper than any new logo, and at ${fmtUsd(plan.recoverable)}/month this alone would cover ${Math.round((plan.recoverable / Math.max(1, plan.upliftPerMonth)) * 100)}% of the monthly uplift needed.`,
    })
    out.push({
      tone: plan.upliftPerMonth > plan.runRate * 0.4 ? 'bad' : 'warn',
      head: `The number needs ${fmtUsd(plan.needPerMonth)}/month for ${plan.monthsLeft} months`,
      body: `The run-rate across ${plan.completeMonths} completed months is ${fmtUsd(plan.runRate)}/month, so this is an uplift of ${fmtUsd(plan.upliftPerMonth)}/month — about ${plan.runRate ? Math.round((plan.upliftPerMonth / plan.runRate) * 100) : 0}% above where the business runs today.${plan.partialMonth ? ` ${plan.partialMonth} is still billing and is excluded from the run-rate.` : ''}`,
    })
    if (plan.top10Share >= 30) out.push({
      tone: 'warn',
      head: `Top 10 clients are ${plan.top10Share}% of the year so far`,
      body: `${fmtUsd(plan.top10)} of FY revenue comes from ten of ${plan.activeClients} active clients. That concentration cuts both ways: it is the fastest place to grow — one upsell moves the number — and the biggest single risk to the target if one of them goes quiet.`,
    })
    return out
  }, [plan])


  // ---- What we last sold a client, for the "clients to push" drawer -----------------
  // The revenue sheet carries the service department (HUB, WEB-US…), the delivery SME
  // and the owner, but NOT the technology — that lives on the Quotes tab, so it is read
  // from the client's most recent quote and labelled as such rather than implied.
  const ckey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const lastDealBy = useMemo(() => {
    const by = new Map<string, BookingRow[]>()
    for (const b of bookings) {
      const k = ckey(b.company_name); if (!k) continue
      const arr = by.get(k); if (arr) arr.push(b); else by.set(k, [b])
    }
    const out = new Map<string, { name: string; month: string; total: number; lines: BookingRow[]; history: { month: string; amount: number }[]; geo?: string }>()
    for (const [k, rows] of by) {
      const dated = rows.filter(r => ym(r.booking_month))
      if (!dated.length) continue
      const months = [...new Set(dated.map(r => ym(r.booking_month)))].sort()
      const last = months[months.length - 1]
      const lines = dated.filter(r => ym(r.booking_month) === last).sort((a, b) => (b.booking_amount || 0) - (a.booking_amount || 0))
      const history = months.slice(-6).map(m => ({ month: m, amount: Math.round(dated.filter(r => ym(r.booking_month) === m).reduce((sm, r) => sm + (r.booking_amount || 0), 0)) }))
      out.set(k, { name: rows[0].company_name || '', month: last, total: Math.round(lines.reduce((sm, r) => sm + (r.booking_amount || 0), 0)), lines, history, geo: dated.map(r => r.geo).filter(Boolean).pop() })
    }
    return out
  }, [bookings])

  // Technology is a Quotes-tab field; take the client's most recent quote that names one.
  const techBy = useMemo(() => {
    const out = new Map<string, { technology: string; when?: string; company?: string }>()
    const sorted = [...opportunities].sort((a, b) => (b.source_date || b.first_date || '').localeCompare(a.source_date || a.first_date || ''))
    for (const o of sorted) {
      const k = ckey(o.company_name); if (!k || !o.technology) continue
      if (!out.has(k)) out.set(k, { technology: o.technology, when: o.source_date || o.first_date, company: o.company_name })
    }
    return out
  }, [opportunities])

  const pushDetail = useMemo(() => {
    if (!pushSel) return null
    const k = ckey(pushSel)
    const slip = plan.slipped.find(c => ckey(c.name) === k)
    // What this client actually buys, all-time, by technology — biggest spend first.
    const mix = new Map<string, number>()
    for (const b of bookings) {
      if (ckey(b.company_name) !== k || !b.technology) continue
      mix.set(b.technology, (mix.get(b.technology) || 0) + (b.booking_amount || 0))
    }
    const techMix = [...mix.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    return { name: pushSel, slip, deal: lastDealBy.get(k) || null, tech: techBy.get(k) || null, techMix }
  }, [pushSel, plan, lastDealBy, techBy, bookings])

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
    const relevant = opportunities.filter(opp => {
      const oppDate = ymd(opp.source_date)
      return oppDate && oppDate >= (sixMonthsAgo + '-01') && oppDate <= (lastMonthStr + '-31')
    })
    const confirmed = relevant.filter(isWon).length
    return {
      total: relevant.length,
      confirmed,
      rate: relevant.length > 0 ? Math.round((confirmed / relevant.length) * 100) : 0,
    }
  }, [opportunities, last6Mo])

  const getMonthQuotes = (monthStr: string) => {
    const monthQuotes = opportunities.filter(opp => {
      const oppMonth = ym(opp.source_date)
      return oppMonth === monthStr
    })
    const confirmed = monthQuotes.filter(isWon).length
    return {
      total: monthQuotes.length,
      confirmed,
      rate: monthQuotes.length > 0 ? Math.round((confirmed / monthQuotes.length) * 100) : 0,
    }
  }

  if (loading) return <div className="p-6 text-mav-muted">Loading business trend data...</div>

  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing, 6-month analysis, quotes/confirmations tracking, and FY 2026-27 forecast" />
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
          {monthsInView} month(s) in view
        </span>
      </div>
      <RevenueChart data={revenueSeries} title="Revenue trend" from={fromMonth} to={toMonth} />
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
                const monthData = getMonthQuotes(monthKey)
                return (
                  <tr key={item.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-3 whitespace-nowrap">{item.monthLabel}</td>
                    <td className="px-5 py-3 text-right font-medium">{fmtUsd(item.revenue)}</td>
                    <td className="px-5 py-3 text-right text-mav-muted">{growth > 0 ? '+' : ''}{growth}%</td>
                    <td className="px-5 py-3 text-right">{monthData.total}</td>
                    <td className="px-5 py-3 text-right">{monthData.confirmed}</td>
                    <td className="px-5 py-3 text-right">{monthData.total > 0 ? monthData.rate + '%' : '—'}</td>
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
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">FY 2026-27 Forecast (Apr 2026 - Mar 2027)</div>
        </div>
        <div className="p-5 space-y-6">
          <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-4">
            <div className="text-xs font-medium text-mav-yellow mb-3">Definitions</div>
            <div className="text-xs text-mav-muted space-y-1">
              <p><strong className="text-white">Financial Year Definition:</strong> April 2026 to March 2027 (12 months)</p>
              <p><strong className="text-white">Target:</strong> {FY_TARGET_LABEL} total revenue</p>
              <p><strong className="text-white">Avg Monthly Revenue:</strong> Based on completed months in FY 2026-27</p>
              <p><strong className="text-white">Projected Total:</strong> (Actual revenue to date) + (Average monthly × remaining months)</p>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-mav-yellow mb-3">Key Metrics</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Avg Monthly Revenue</div>
                <KPICard label="" value={fmtUsd(Math.round(fy26Analysis.avgMonthly))} />
              </div>
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Projected Total (12 mo)</div>
                <KPICard label="" value={fmtUsd(fy26Analysis.projected)} />
              </div>
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">FY Status</div>
                <KPICard label="" value={fy26Analysis.onTrack ? '✓ On Track' : '✗ Off Track'} />
              </div>
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Remaining Months</div>
                <KPICard label="" value={fy26Analysis.monthsRemaining.toString()} />
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-mav-yellow mb-3">Progress Toward {FY_TARGET_LABEL} Target</div>
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-4">
              <div className="flex justify-between mb-3">
                <span className="text-sm font-medium">Projected vs Target</span>
                <span className="text-sm font-medium text-mav-yellow">{fy26Analysis.projectedPercent}%</span>
              </div>
              <div className="w-full bg-mav-line rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full ${fy26Analysis.onTrack ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(fy26Analysis.projectedPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-3 text-xs text-mav-muted">
                <span>Projected: <span className="text-white font-medium">{fmtUsd(fy26Analysis.projected)}</span></span>
                <span>Target: <span className="text-white font-medium">{FY_TARGET_LABEL}</span></span>
              </div>
              {!fy26Analysis.onTrack && (
                <p className="text-xs text-red-400 mt-3">
                  Shortfall: {fmtUsd(FY_TARGET - fy26Analysis.projected)} | Need {fmtUsd(Math.ceil((FY_TARGET - fy26Analysis.projected) / Math.max(1, fy26Analysis.monthsRemaining)))}/month average
                </p>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-mav-yellow mb-3">Monthly Breakdown (FY 2026-27)</div>
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
                    {fy26Analysis.data.map((item) => (
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
            <p className="text-xs text-mav-muted mt-3">
              {fy26Analysis.completedMonths} months completed
            </p>
          </div>
        </div>
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">How we get to {FY_TARGET_LABEL}</div>
          <div className="text-xs text-mav-muted">{plan.monthsLeft} months left · {fmtUsd(plan.gap)} to go</div>
        </div>
        <div className="p-5 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
              <div className="text-xs text-mav-muted mb-1">Booked so far</div>
              <div className="text-xl font-bold">{fmtUsd(plan.booked)}</div>
            </div>
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
              <div className="text-xs text-mav-muted mb-1" title={`Average of the ${plan.completeMonths} completed months. ${plan.partialMonth || 'The month in progress'} is excluded — a half-billed month would understate it.`}>Run-rate / month</div>
              <div className="text-xl font-bold">{fmtUsd(plan.runRate)}</div>
            </div>
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
              <div className="text-xs text-mav-muted mb-1">Needed / month</div>
              <div className="text-xl font-bold text-mav-yellow">{fmtUsd(plan.needPerMonth)}</div>
            </div>
            <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
              <div className="text-xs text-mav-muted mb-1">Uplift required</div>
              <div className="text-xl font-bold text-red-400">+{fmtUsd(plan.upliftPerMonth)}</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-mav-yellow mb-1">🤖 AI insights</div>
            <p className="text-xs text-mav-muted mb-3">Read straight off the revenue and pipeline on this page — each line is a fact and the action it points to, not a forecast.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {insights.map((i, n) => (
                <div key={n} className={`rounded-lg border p-3 ${i.tone === 'good' ? 'border-green-500/30 bg-green-500/[0.05]' : i.tone === 'warn' ? 'border-mav-yellow/30 bg-mav-yellow/[0.05]' : 'border-red-500/30 bg-red-500/[0.05]'}`}>
                  <div className={`text-sm font-semibold mb-1 ${i.tone === 'good' ? 'text-green-300' : i.tone === 'warn' ? 'text-mav-yellow' : 'text-red-300'}`}>{i.head}</div>
                  <p className="text-xs text-mav-muted leading-relaxed">{i.body}</p>
                </div>
              ))}
              {!insights.length && <p className="text-sm text-mav-muted">Not enough completed months in FY 2026-27 yet.</p>}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-mav-yellow mb-1">Deals to close</div>
            <p className="text-xs text-mav-muted mb-3">Open quotes ranked by what they are actually worth — value × the win probability on the deal. {fmtUsd(plan.weighted)} weighted out of {fmtUsd(plan.pipelineValue)} open.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium text-right">Value</th>
                    <th className="px-3 py-2 font-medium text-right">Win %</th>
                    <th className="px-3 py-2 font-medium text-right">Weighted</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.openDeals.slice(0, 12).map(o => (
                    <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                      <td className="px-3 py-2">{o.company_name}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(o.value || 0)}</td>
                      <td className="px-3 py-2 text-right">{o.win ? `${o.win}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-mav-yellow">{fmtUsd(o.expected)}</td>
                      <td className="px-3 py-2 text-mav-muted">{o.sales_person || '—'}</td>
                      <td className="px-3 py-2 text-mav-muted">{o.status || '—'}</td>
                      <td className={`px-3 py-2 text-right ${o.age !== null && o.age > 90 ? 'text-red-400' : 'text-mav-muted'}`}>{o.age !== null ? `${o.age}d` : '—'}</td>
                    </tr>
                  ))}
                  {!plan.openDeals.length && <tr><td colSpan={7} className="px-3 py-4 text-mav-muted">No open quotes carry a value yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {plan.stale.length > 0 && <p className="text-xs text-red-400 mt-2">{plan.stale.length} of these have not moved in over 90 days ({fmtUsd(plan.staleValue)}). Chase or close them — a dead quote in the pipeline hides the real gap.</p>}
          </div>

          <div>
            <div className="text-xs font-medium text-mav-yellow mb-1">Clients to push</div>
            <p className="text-xs text-mav-muted mb-3">Accounts that billed materially less in the last three completed months than the three before. &ldquo;Was billing&rdquo; is their old monthly average — what comes back if the account is re-activated, worth {fmtUsd(plan.recoverable)}/month in total. <span className="text-mav-yellow">Click a client</span> to see the last business we closed with them.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium text-right">Prior 3 mo</th>
                    <th className="px-3 py-2 font-medium text-right">Last 3 mo</th>
                    <th className="px-3 py-2 font-medium text-right">Was billing</th>
                    <th className="px-3 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.slipped.slice(0, 12).map(c => (
                    <tr key={c.name} onClick={() => setPushSel(c.name)} title="What did we last sell them? — service department, SME, owner and technology" className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
                      <td className="px-3 py-2 text-mav-yellow">{c.name}</td>
                      <td className="px-3 py-2 text-right text-mav-muted">{fmtUsd(Math.round(c.prior3))}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(Math.round(c.last3))}</td>
                      <td className="px-3 py-2 text-right font-medium text-mav-yellow">{fmtUsd(c.perMonth)}/mo</td>
                      <td className="px-3 py-2">{c.lapsed
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Stopped</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300">Slowing</span>}</td>
                    </tr>
                  ))}
                  {!plan.slipped.length && <tr><td colSpan={5} className="px-3 py-4 text-mav-muted">No client has slowed materially in the last three months.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-3 border-b border-mav-line">
          <div className="text-sm font-medium">Quotes & Confirmations (Last 6 Months)</div>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs font-medium text-mav-yellow mb-3">Summary</div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Total Quotes</div>
                <div className="text-2xl font-bold">{quotesAnalysis.total}</div>
              </div>
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Confirmed</div>
                <div className="text-2xl font-bold">{quotesAnalysis.confirmed}</div>
              </div>
              <div className="bg-mav-dark/40 border border-mav-line/40 rounded-lg p-3">
                <div className="text-xs text-mav-muted mb-1">Confirm Rate</div>
                <div className="text-2xl font-bold text-mav-yellow">{quotesAnalysis.rate}%</div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-mav-yellow mb-3">Monthly Details</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className="px-5 py-3 font-medium">Month</th>
                    <th className="px-5 py-3 font-medium text-right">Total Quotes</th>
                    <th className="px-5 py-3 font-medium text-right">Confirmed</th>
                    <th className="px-5 py-3 font-medium text-right">Confirm Rate %</th>
                  </tr>
                </thead>
                <tbody>
                  {last6Mo.map(month => {
                    const monthKey = ym(month.month)
                    const monthData = getMonthQuotes(monthKey)
                    return (
                      <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                        <td className="px-5 py-3 whitespace-nowrap">{month.monthLabel}</td>
                        <td className="px-5 py-3 text-right">{monthData.total}</td>
                        <td className="px-5 py-3 text-right">{monthData.confirmed}</td>
                        <td className="px-5 py-3 text-right">{monthData.total > 0 ? monthData.rate + '%' : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {pushDetail && (
        <div className="fixed inset-0 z-40" onClick={() => setPushSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold">{pushDetail.name}</h2>
                <div className="mt-2 flex flex-wrap gap-1">
                  {pushDetail.deal?.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{pushDetail.deal.geo}</span>}
                  {pushDetail.slip && <span className={`text-xs px-2 py-1 rounded-full ${pushDetail.slip.lapsed ? 'bg-red-500/15 text-red-400' : 'bg-orange-500/15 text-orange-300'}`}>{pushDetail.slip.lapsed ? 'Stopped billing' : 'Slowing'}</span>}
                </div>
              </div>
              <button onClick={() => setPushSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            {pushDetail.slip && (
              <div className="rounded-lg border border-mav-line bg-mav-dark/40 p-3 mb-4 text-sm">
                <div className="flex justify-between"><span className="text-mav-muted">Prior 3 months</span><span>{fmtUsd(Math.round(pushDetail.slip.prior3))}</span></div>
                <div className="flex justify-between"><span className="text-mav-muted">Last 3 months</span><span>{fmtUsd(Math.round(pushDetail.slip.last3))}</span></div>
                <div className="flex justify-between mt-1 pt-1 border-t border-mav-line"><span className="text-mav-muted">Was billing</span><span className="text-mav-yellow font-medium">{fmtUsd(pushDetail.slip.perMonth)}/mo</span></div>
              </div>
            )}

            <div className="text-xs uppercase tracking-wide text-mav-yellow mb-2">Last business we closed</div>
            {pushDetail.deal ? (
              <>
                <div className="rounded-lg border border-mav-line bg-mav-dark/40 p-3 mb-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-medium">{monLabel(pushDetail.deal.month)}</span>
                    <span className="text-lg font-bold text-mav-yellow">{fmtUsd(pushDetail.deal.total)}</span>
                  </div>
                  <div className="space-y-2">
                    {pushDetail.deal.lines.map((l, i) => (
                      <div key={i} className="text-sm border-t border-mav-line/60 pt-2 first:border-0 first:pt-0">
                        <div className="flex justify-between gap-2">
                          <span className="flex flex-wrap gap-1">
                            <span className="px-1.5 py-0.5 rounded-full bg-mav-line text-xs">{l.service_name || 'no department'}</span>
                            {l.technology && <span className="px-1.5 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow text-xs">{l.technology}</span>}
                          </span>
                          <span>{fmtUsd(Math.round(l.booking_amount || 0))}</span>
                        </div>
                        <div className="mt-1 text-xs text-mav-muted">
                          {l.sme ? <>SME <span className="text-white">{l.sme}</span></> : 'SME —'}
                          {l.sales_person ? <> · Owner <span className="text-white">{l.sales_person}</span></> : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-mav-line bg-mav-dark/40 p-3 mb-4">
                  <div className="text-xs text-mav-muted mb-1">Technology they buy</div>
                  {pushDetail.techMix.length
                    ? <><div className="flex flex-wrap gap-1">
                          {pushDetail.techMix.map(t => <span key={t.name} className="px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow text-xs">{t.name} · {fmtUsd(t.amount)}</span>)}
                        </div>
                        <p className="text-[11px] text-mav-muted mt-2">All-time billing by technology, from column F of the revenue sheet.</p></>
                    : pushDetail.tech
                      ? <><span className="text-sm">{pushDetail.tech.technology}</span>
                          <p className="text-[11px] text-mav-muted mt-1">No technology on their revenue lines — taken from their most recent quote{pushDetail.tech.when ? ` (${ymd(pushDetail.tech.when)})` : ''}.</p></>
                      : <p className="text-sm text-mav-muted">Not recorded on their revenue lines or on any quote.</p>}
                </div>
                <div className="text-xs uppercase tracking-wide text-mav-yellow mb-2">Billing, last {pushDetail.deal.history.length} months</div>
                <table className="w-full text-sm">
                  <tbody>
                    {pushDetail.deal.history.slice().reverse().map(h => (
                      <tr key={h.month} className="border-b border-mav-line/60">
                        <td className="py-1.5 text-mav-muted">{monLabel(h.month)}</td>
                        <td className="py-1.5 text-right">{h.amount ? fmtUsd(h.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-sm text-mav-muted">No line-level revenue rows found for this client name.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
