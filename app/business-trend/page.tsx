'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit, unitLabel } from '@/lib/business-unit'
import { KPIRow, Segments, FilterBar, Panel, SectionTitle } from '@/components/PageParts'

import ForecastPanel from '@/components/ForecastPanel'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import KPICard from '@/components/KPICard'
import { daysSince, fmtDay, fmtMonth, type CardDetails, type DetailCol } from '@/components/CardDetail'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getQuotes, getConversions, getBookingsFull, getOpportunities, getOpportunityDepts, type RevenueRow, type Quote, type QuoteConversion, type BookingRow, type Opportunity } from '@/lib/supabase'
import { FY_TARGET, FY_TARGET_LABEL } from '@/lib/config'
import { fmtUsd } from '@/lib/metrics'

// FY 2026-27 revenue goal. One constant — the progress bar, the shortfall line and
// the plan below it all read from here, so the number can never disagree with itself.
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow text-mav-fg font-medium cursor-pointer'
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
  // Which half of the picture is on screen. Trend first: it is the one you open to see
  // what happened, and the forecast is what you go to after it raises a question.
  const [tab, setTab] = useState<'trend' | 'forecast'>('trend')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [revenueAll, setRevenue] = useState<RevenueRow[]>([])
  const [opportunitiesRawAll, setOpportunitiesRaw] = useState<Opportunity[]>([])
  const [oppDepts, setOppDepts] = useState<Map<number, string>>(new Map())
  // Line-level revenue rows: the monthly series aggregates these and loses the service
  // department, SME and owner, which is exactly what you need before ringing a client.
  const [bookingsAll, setBookings] = useState<BookingRow[]>([])

  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source, so every count, total and chart below follows the switch.
  // Opportunities carry no usable department of their own, so they are placed by
  // opportunity_dept_mv — the PM's pod, then the client's history, then geo.
  const { unit } = useUnit()
  const revenue = useMemo(() => revenueAll.filter(r => inUnit(r.service_name, unit)), [revenueAll, unit])
  const bookings = useMemo(() => bookingsAll.filter(b => inUnit(b.service_name, unit)), [bookingsAll, unit])
  const opportunitiesRaw = useMemo(
    () => opportunitiesRawAll.filter(o => inUnit(oppDepts.get(Number(o.id)), unit)), [opportunitiesRawAll, oppDepts, unit])

  const [pushSel, setPushSel] = useState<string | null>(null)
  // Using the sidebar closes this drawer — including a click on the section you are
  // already on, which is not a route change and so re-renders nothing by itself.
  useCloseOnNav(useCallback(() => setPushSel(null), []))
  const [loading, setLoading] = useState(true)
  // Set after mount so the server-rendered HTML doesn't bake in a build-time date.
  const [thisMonth, setThisMonth] = useState(''); const [todayMs, setTodayMs] = useState(0)

  useEffect(() => {
    (async () => {
      try {
        const [rev, opp, bk, od] = await Promise.all([
          getRevenue(),
          getOpportunities(),
          getBookingsFull(),
          getOpportunityDepts(),
        ])
        setRevenue(rev || [])
        setOpportunitiesRaw(opp || [])
        setBookings(bk || [])
        setOppDepts(od)
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
    const wonRows = relevant.filter(isWon)
    const confirmed = wonRows.length
    return {
      rows: relevant, wonRows,
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

  // ---- What sits behind each card ------------------------------------------------
  // Every panel's total is built the same way as the card it opens from: monthly sums
  // rounded per month (as revenueByMonthYear does), so the footer can never be a few
  // dollars off the headline.
  const cardDetails = useMemo(() => {
    type Mon = { month: string; monthLabel: string; revenue: number }
    const sumRev = (rs: Mon[]) => rs.reduce((s, r) => s + r.revenue, 0)
    const monthCol: DetailCol<Mon> = { key: 'month', label: 'Month', value: r => r.monthLabel, sort: r => ym(r.month) }
    const revCol: DetailCol<Mon> = { key: 'rev', label: 'Revenue', value: r => fmtUsd(r.revenue), align: 'right', sort: r => r.revenue,
      total: rs => fmtUsd(sumRev(rs)) }
    const fyMonths = getFY26Months()
    const have = new Set(fy26Analysis.data.map(r => ym(r.month)))

    const avg: CardDetails<Mon> = {
      subtitle: `${fmtUsd(fy26Analysis.totalRevenue)} over ${fy26Analysis.completedMonths} FY 2026-27 months with revenue, divided by ${fy26Analysis.completedMonths}`,
      rows: fy26Analysis.data, rowKey: r => r.month, defaultSort: 'month',
      columns: [monthCol, revCol,
        { key: 'vs', label: 'Vs average', align: 'right', sort: r => r.revenue - fy26Analysis.avgMonthly,
          value: r => { const d = Math.round(r.revenue - fy26Analysis.avgMonthly); return `${d >= 0 ? '+' : '-'}${fmtUsd(Math.abs(d))}` } }],
    }

    // The projection is twelve months: the ones with revenue at their actual, the rest
    // at the current average — exactly the sum the card shows.
    type Proj = { month: string; amount: number; basis: 'Actual' | 'At average' }
    const projRows: Proj[] = fyMonths.map(m => {
      const got = fy26Analysis.data.find(r => ym(r.month) === m)
      return got ? { month: m, amount: got.revenue, basis: 'Actual' } : { month: m, amount: fy26Analysis.avgMonthly, basis: 'At average' }
    })
    const projected: CardDetails<Proj> = {
      subtitle: `Actual revenue for ${fy26Analysis.completedMonths} months plus ${fmtUsd(Math.round(fy26Analysis.avgMonthly))} for each of the ${fy26Analysis.monthsRemaining} still to come`,
      rows: projRows, rowKey: r => r.month, groupBy: r => r.basis, defaultSort: 'month',
      groupTotal: rs => fmtUsd(rs.reduce((s, r) => s + r.amount, 0)),
      columns: [
        { key: 'month', label: 'Month', value: r => fmtMonth(r.month), sort: r => r.month },
        { key: 'basis', label: 'Basis', value: r => r.basis },
        { key: 'amt', label: 'Amount', value: r => fmtUsd(r.amount), align: 'right', sort: r => r.amount,
          total: rs => fmtUsd(rs.reduce((s, r) => s + r.amount, 0)) },
      ],
    }

    type Left = { month: string }
    const remaining: CardDetails<Left> = {
      subtitle: 'FY 2026-27 months with no revenue booked yet',
      rows: fyMonths.filter(m => !have.has(m)).map(month => ({ month })), rowKey: r => r.month, defaultSort: 'month',
      columns: [
        { key: 'month', label: 'Month', value: r => fmtMonth(r.month), sort: r => r.month },
        { key: 'avg', label: 'Projected at average', value: () => fmtUsd(Math.round(fy26Analysis.avgMonthly)), align: 'right',
          total: rs => fmtUsd(fy26Analysis.avgMonthly * rs.length) },
      ],
    }

    // Booked so far, line by line — the client, department and SME behind the total.
    const fyLines = revenue.filter(r => isInFY26(ym(r.month)))
    const lineTotal = (rs: RevenueRow[]) => {
      const by = new Map<string, number>()
      rs.forEach(r => by.set(ym(r.month), (by.get(ym(r.month)) || 0) + (r.amount_usd || 0)))
      return fmtUsd([...by.values()].reduce((s, v) => s + Math.round(v), 0))
    }
    const booked: CardDetails<RevenueRow> = {
      subtitle: `Every FY 2026-27 revenue line, ${fy26Analysis.completedMonths} months`,
      rows: fyLines, groupBy: r => r.service_name || 'No department', groupTotal: lineTotal, defaultSort: 'amt',
      columns: [
        { key: 'client', label: 'Client / agency', value: r => r.client_name || '—', wide: true, sort: r => r.client_name || '' },
        { key: 'amt', label: 'Amount', value: r => fmtUsd(r.amount_usd || 0), align: 'right', sort: r => r.amount_usd || 0, total: lineTotal },
        { key: 'month', label: 'Month', value: r => fmtMonth(r.month), sort: r => ym(r.month) },
        { key: 'dept', label: 'Department', value: r => r.service_name || '—', sort: r => r.service_name || '' },
        { key: 'sme', label: 'SME', value: r => r.sme || '—' },
      ],
    }

    const complete = fy26Analysis.data.filter(r => ym(r.month) !== thisMonth)
    const runRate: CardDetails<Mon> = {
      subtitle: `The ${complete.length} completed months, averaged; ${plan.partialMonth || 'the month in progress'} is left out`,
      rows: complete, rowKey: r => r.month, defaultSort: 'month', columns: [monthCol, revCol],
    }

    // The months still to bill (the one in progress counts as winnable), each at the
    // pace the target needs.
    const done = new Set(complete.map(r => ym(r.month)))
    type Need = { month: string; billed: number; inProgress: boolean }
    const needRows: Need[] = fyMonths.filter(m => !done.has(m)).map(m => ({
      month: m, inProgress: m === thisMonth, billed: fy26Analysis.data.find(r => ym(r.month) === m)?.revenue || 0 }))
    const needed: CardDetails<Need> = {
      subtitle: `${fmtUsd(plan.gap)} still to book to reach ${FY_TARGET_LABEL}, spread over ${plan.monthsLeft} months`,
      rows: needRows, rowKey: r => r.month, defaultSort: 'month',
      columns: [
        { key: 'month', label: 'Month', value: r => fmtMonth(r.month), sort: r => r.month },
        { key: 'state', label: 'Status', value: r => (r.inProgress ? 'In progress' : 'To come') },
        { key: 'billed', label: 'Billed so far', value: r => (r.billed ? fmtUsd(r.billed) : '—'), align: 'right', sort: r => r.billed },
        { key: 'need', label: 'Needed', value: () => fmtUsd(plan.needPerMonth), align: 'right',
          total: rs => fmtUsd(plan.needPerMonth * rs.length) },
      ],
    }

    // Quotes: the deduplicated opportunities dated in the six-month window.
    type Opp = Opportunity
    const oppCols = (withResult: boolean): DetailCol<Opp>[] => [
      { key: 'client', label: 'Client / agency', value: o => o.company_name || '—', wide: true, sort: o => o.company_name || '' },
      { key: 'value', label: 'Value', value: o => (o.value ? fmtUsd(o.value) : '—'), align: 'right', sort: o => o.value || 0,
        total: rs => fmtUsd(rs.reduce((s, o) => s + (o.value || 0), 0)) },
      { key: 'date', label: 'Date', value: o => fmtDay(o.source_date), sort: o => o.source_date || '' },
      withResult
        ? { key: 'res', label: 'Result', value: o => (isWon(o) ? 'Confirmed' : o.status || 'Not confirmed'), sort: o => (isWon(o) ? 1 : 0) }
        : { key: 'age', label: 'Days so far', value: o => daysSince(o.source_date) ?? '—', align: 'right', sort: o => daysSince(o.source_date) ?? -1 },
      { key: 'owner', label: 'Owner', value: o => o.sales_person || '—', sort: o => o.sales_person || '' },
    ]
    const qSub = 'Quotes dated in the last six months of revenue, one per client'
    const byGeo = (o: Opp) => o.geo || 'No GEO'
    const quotes: CardDetails<Opp> = { subtitle: qSub, rows: quotesAnalysis.rows, rowKey: o => o.id, groupBy: byGeo, defaultSort: 'date', columns: oppCols(true) }
    const confirmed: CardDetails<Opp> = { subtitle: `${qSub}, confirmed`, rows: quotesAnalysis.wonRows, rowKey: o => o.id, groupBy: byGeo, defaultSort: 'date', columns: oppCols(true) }
    const rate: CardDetails<Opp> = {
      subtitle: `${quotesAnalysis.confirmed} of ${quotesAnalysis.total} quotes confirmed`,
      rows: quotesAnalysis.rows, rowKey: o => o.id, groupBy: o => (isWon(o) ? 'Confirmed' : 'Not confirmed'), defaultSort: 'date', columns: oppCols(true),
    }
    return { avg, projected, remaining, booked, runRate, needed, quotes, confirmed, rate }
  }, [fy26Analysis, revenue, thisMonth, plan, quotesAnalysis])

  if (loading) return <div className="p-6 text-mav-muted">Loading business trend data...</div>

  return (
    <div>
      <Header title="Business Trend" subtitle="Revenue pacing, 6-month analysis, quotes and confirmations, and where the year lands"
        chip="FY 2026-27" />

      {/* Trend and Forecast were two pages answering the same question from opposite
          ends — what the year is pacing at, and what it will land at. Reading one
          without the other is how the same month got two different explanations in the
          same week. One page, two tabs. */}
      <Segments<'trend' | 'forecast'> value={tab} onChange={setTab} items={[
        { id: 'trend', label: 'Trend', count: revenueSeries.length ? `${revenueSeries.length} mo` : undefined, title: 'What happened — revenue by month, pacing, and how we close the gap' },
        { id: 'forecast', label: 'Forecast', title: 'Where the year lands if nothing changes' },
      ]} />

      {tab === 'forecast' ? <ForecastPanel embedded /> : (
      <>
      {/* The year at a glance — the four figures the FY forecast panel below used to
          carry inside it. */}
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Avg monthly revenue" value={fmtUsd(Math.round(fy26Analysis.avgMonthly))}
          sub={`${fy26Analysis.completedMonths} months completed`} details={cardDetails.avg}
          info="Based on completed months in FY 2026-27 (April 2026 to March 2027)." />
        <KPICard tone={fy26Analysis.onTrack ? 'green' : 'red'} label="Projected total (12 mo)" value={fmtUsd(fy26Analysis.projected)}
          sub={`${fy26Analysis.projectedPercent}% of ${FY_TARGET_LABEL}`} details={cardDetails.projected}
          info="(Actual revenue to date) + (Average monthly × remaining months)." />
        <KPICard tone={fy26Analysis.onTrack ? 'green' : 'red'} label="FY status" value={fy26Analysis.onTrack ? 'On Track' : 'Off Track'}
          sub={`Target ${FY_TARGET_LABEL}`} />
        <KPICard tone="amber" label="Remaining months" value={fy26Analysis.monthsRemaining.toString()} details={cardDetails.remaining} />
      </KPIRow>

      {/* The From/To pickers only narrow the chart; everything else below reads the
          whole series. */}
      <FilterBar right={<span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">{monthsInView} month(s) in view</span>}>
        <label className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">From</span>
          <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} className={selCls} />
        </label>
        <label className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">To</span>
          <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)} className={selCls} />
        </label>
        <button onClick={() => { setFromMonth(''); setToMonth('') }}
          className="rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 px-3 py-1.5 text-xs">
          Reset
        </button>
      </FilterBar>
      <RevenueChart data={revenueSeries} title="Revenue trend" from={fromMonth} to={toMonth} />

      <Panel flush className="mb-5" title="Last 6 months analysis">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm min-w-[720px]">
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
              {last6Mo.length > 0 ? last6Mo.map((item, idx) => {
                const prev = idx > 0 ? last6Mo[idx - 1].revenue : item.revenue
                const growth = prev > 0 ? Math.round(((item.revenue - prev) / prev) * 1000) / 10 : 0
                const monthKey = ym(item.month)
                const monthData = getMonthQuotes(monthKey)
                return (
                  <tr key={item.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-3 whitespace-nowrap">{item.monthLabel}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmtUsd(item.revenue)}</td>
                    <td className="px-4 py-3 text-right text-mav-muted">{growth > 0 ? '+' : ''}{growth}%</td>
                    <td className="px-4 py-3 text-right">{monthData.total}</td>
                    <td className="px-4 py-3 text-right">{monthData.confirmed}</td>
                    <td className="px-4 py-3 text-right">{monthData.total > 0 ? monthData.rate + '%' : '—'}</td>
                  </tr>
                )
              }) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-mav-muted">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mb-5" title="FY 2026-27 forecast (Apr 2026 – Mar 2027)"
        info={<>
          <p><strong>Financial Year Definition:</strong> April 2026 to March 2027 (12 months)</p>
          <p><strong>Target:</strong> {FY_TARGET_LABEL} total revenue</p>
          <p><strong>Avg Monthly Revenue:</strong> Based on completed months in FY 2026-27</p>
          <p><strong>Projected Total:</strong> (Actual revenue to date) + (Average monthly × remaining months)</p>
        </>}>
        <div className="space-y-5">
          <div>
            <div className="flex justify-between mb-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">Projected vs {FY_TARGET_LABEL} target</span>
              <span className="text-sm font-semibold text-mav-yellow">{fy26Analysis.projectedPercent}%</span>
            </div>
            <div className="w-full bg-mav-line rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full ${fy26Analysis.onTrack ? 'bg-green-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(fy26Analysis.projectedPercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-mav-muted">
              <span>Projected: <span className="text-mav-fg font-medium">{fmtUsd(fy26Analysis.projected)}</span></span>
              <span>Target: <span className="text-mav-fg font-medium">{FY_TARGET_LABEL}</span></span>
            </div>
            {!fy26Analysis.onTrack && (
              <p className="text-xs text-red-400 mt-2">
                Shortfall: {fmtUsd(FY_TARGET - fy26Analysis.projected)} | Need {fmtUsd(Math.ceil((FY_TARGET - fy26Analysis.projected) / Math.max(1, fy26Analysis.monthsRemaining)))}/month average
              </p>
            )}
            {unit !== 'all' && (
              <p className="text-[11px] text-mav-muted mt-1">{unitLabel(unit)} revenue against the company-wide {FY_TARGET_LABEL} target — there is no per-unit target.</p>
            )}
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">Monthly breakdown (FY 2026-27)</span>
              <span className="text-xs text-mav-muted">{fy26Analysis.completedMonths} months completed</span>
            </div>
            {fy26Analysis.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-mav-muted border-b border-mav-line">
                    <tr>
                      <th className="px-4 py-3 font-medium">Month</th>
                      <th className="px-4 py-3 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fy26Analysis.data.map((item) => (
                      <tr key={item.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                        <td className="px-4 py-3 whitespace-nowrap">{item.monthLabel}</td>
                        <td className="px-4 py-3 text-right font-medium">{fmtUsd(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-mav-muted">No FY 2026-27 data available yet (waiting for Apr 2026+ bookings)</p>
            )}
          </div>
        </div>
      </Panel>

      <SectionTitle right={<span className="text-xs text-mav-muted">{plan.monthsLeft} months left · {fmtUsd(plan.gap)} to go</span>}>
        How we get to {FY_TARGET_LABEL}
      </SectionTitle>
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Booked so far" value={fmtUsd(plan.booked)} details={cardDetails.booked} />
        <KPICard label="Run-rate / month" value={fmtUsd(plan.runRate)} details={cardDetails.runRate}
          info={`Average of the ${plan.completeMonths} completed months. ${plan.partialMonth || 'The month in progress'} is excluded — a half-billed month would understate it.`} />
        <KPICard tone="amber" label="Needed / month" value={fmtUsd(plan.needPerMonth)} details={cardDetails.needed} />
        <KPICard tone="red" label="Uplift required" value={`+${fmtUsd(plan.upliftPerMonth)}`} />
      </KPIRow>

      <Panel className="mb-5" title="AI insights"
        info="Read straight off the revenue and pipeline on this page — each line is a fact and the action it points to, not a forecast.">
        <div className="grid gap-3 md:grid-cols-2">
          {insights.map((i, n) => (
            <div key={n} className={`rounded-lg border p-3 ${i.tone === 'good' ? 'border-green-500/30 bg-green-500/[0.05]' : i.tone === 'warn' ? 'border-mav-yellow/30 bg-mav-yellow/[0.05]' : 'border-red-500/30 bg-red-500/[0.05]'}`}>
              <div className={`text-sm font-semibold mb-1 ${i.tone === 'good' ? 'text-green-300' : i.tone === 'warn' ? 'text-mav-yellow' : 'text-red-300'}`}>{i.head}</div>
              <p className="text-xs text-mav-muted leading-relaxed">{i.body}</p>
            </div>
          ))}
          {!insights.length && <p className="text-sm text-mav-muted">Not enough completed months in FY 2026-27 yet.</p>}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2 mb-5">
        <Panel flush title="Deals to close"
          info="Open quotes ranked by what they are actually worth — value × the win probability on the deal."
          right={<span className="text-xs text-mav-muted">{fmtUsd(plan.weighted)} weighted of {fmtUsd(plan.pipelineValue)} open</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm min-w-[720px]">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium text-right">Value</th>
                  <th className="px-3 py-2 font-medium text-right">Win %</th>
                  <th className="px-3 py-2 font-medium text-right">Weighted</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {plan.openDeals.slice(0, 12).map(o => (
                  <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-2"><ClientLink name={o.company_name} /></td>
                    <td className="px-3 py-2 text-right">{fmtUsd(o.value || 0)}</td>
                    <td className="px-3 py-2 text-right">{o.win ? `${o.win}%` : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium text-mav-yellow">{fmtUsd(o.expected)}</td>
                    <td className="px-3 py-2 text-mav-muted">{o.sales_person || '—'}</td>
                    <td className="px-3 py-2 text-mav-muted">{o.status || '—'}</td>
                    <td className={`px-4 py-2 text-right ${o.age !== null && o.age > 90 ? 'text-red-400' : 'text-mav-muted'}`}>{o.age !== null ? `${o.age}d` : '—'}</td>
                  </tr>
                ))}
                {!plan.openDeals.length && <tr><td colSpan={7} className="px-4 py-4 text-mav-muted">No open quotes carry a value yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {plan.stale.length > 0 && (
            <p className="px-4 py-2.5 text-xs text-red-400 border-t border-mav-line"
              title="Chase or close them — a dead quote in the pipeline hides the real gap.">
              {plan.stale.length} of these have not moved in over 90 days ({fmtUsd(plan.staleValue)}). Chase or close them.
            </p>
          )}
        </Panel>

        <Panel flush title="Clients to push"
          info={<>Accounts that billed materially less in the last three completed months than the three before. &ldquo;Was billing&rdquo; is their old monthly average — what comes back if the account is re-activated, worth {fmtUsd(plan.recoverable)}/month in total. Click a client to see the last business we closed with them.</>}
          right={<span className="text-xs text-mav-muted">{fmtUsd(plan.recoverable)}/mo recoverable · click a row</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm min-w-[560px]">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium text-right">Prior 3 mo</th>
                  <th className="px-3 py-2 font-medium text-right">Last 3 mo</th>
                  <th className="px-3 py-2 font-medium text-right">Was billing</th>
                  <th className="px-4 py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {plan.slipped.slice(0, 12).map(c => (
                  <tr key={c.name} onClick={() => setPushSel(c.name)} title="What did we last sell them? — service department, SME, owner and technology" className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
                    <td className="px-4 py-2 text-mav-yellow">{c.name}</td>
                    <td className="px-3 py-2 text-right text-mav-muted">{fmtUsd(Math.round(c.prior3))}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(Math.round(c.last3))}</td>
                    <td className="px-3 py-2 text-right font-medium text-mav-yellow">{fmtUsd(c.perMonth)}/mo</td>
                    <td className="px-4 py-2">{c.lapsed
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Stopped</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300">Slowing</span>}</td>
                  </tr>
                ))}
                {!plan.slipped.length && <tr><td colSpan={5} className="px-4 py-4 text-mav-muted">No client has slowed materially in the last three months.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <SectionTitle>Quotes &amp; confirmations (last 6 months)</SectionTitle>
      <KPIRow cols={3}>
        <KPICard tone="accent" label="Total quotes" value={String(quotesAnalysis.total)} details={cardDetails.quotes} />
        <KPICard tone="green" label="Confirmed" value={String(quotesAnalysis.confirmed)} details={cardDetails.confirmed} />
        <KPICard tone="yellow" label="Confirm rate" value={`${quotesAnalysis.rate}%`} details={cardDetails.rate} />
      </KPIRow>
      <Panel flush title="Monthly details">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm min-w-[720px]">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-4 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium text-right">Total Quotes</th>
                <th className="px-4 py-3 font-medium text-right">Confirmed</th>
                <th className="px-4 py-3 font-medium text-right">Confirm Rate %</th>
              </tr>
            </thead>
            <tbody>
              {last6Mo.map(month => {
                const monthKey = ym(month.month)
                const monthData = getMonthQuotes(monthKey)
                return (
                  <tr key={month.month} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-4 py-3 whitespace-nowrap">{month.monthLabel}</td>
                    <td className="px-4 py-3 text-right">{monthData.total}</td>
                    <td className="px-4 py-3 text-right">{monthData.confirmed}</td>
                    <td className="px-4 py-3 text-right">{monthData.total > 0 ? monthData.rate + '%' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {pushDetail && (
        <div className="fixed inset-0 lg:left-60 z-40" onClick={() => setPushSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6 lg:p-8">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold">{pushDetail.name}</h2>
                <div className="mt-2 flex flex-wrap gap-1">
                  {pushDetail.deal?.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{pushDetail.deal.geo}</span>}
                  {pushDetail.slip && <span className={`text-xs px-2 py-1 rounded-full ${pushDetail.slip.lapsed ? 'bg-red-500/15 text-red-400' : 'bg-orange-500/15 text-orange-300'}`}>{pushDetail.slip.lapsed ? 'Stopped billing' : 'Slowing'}</span>}
                </div>
              </div>
              <button onClick={() => setPushSel(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
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
                          {l.sme ? <>SME <span className="text-mav-fg">{l.sme}</span></> : 'SME —'}
                          {l.sales_person ? <> · Owner <span className="text-mav-fg">{l.sales_person}</span></> : ''}
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
                <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody>
                    {pushDetail.deal.history.slice().reverse().map(h => (
                      <tr key={h.month} className="border-b border-mav-line/60">
                        <td className="py-1.5 text-mav-muted">{monLabel(h.month)}</td>
                        <td className="py-1.5 text-right">{h.amount ? fmtUsd(h.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-mav-muted">No line-level revenue rows found for this client name.</p>
            )}
          </aside>
        </div>
      )}
      </>
      )}
    </div>
  )
}
