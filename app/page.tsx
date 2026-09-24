'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import ClientLink from '@/components/ClientLink'
import GreetingBar from '@/components/GreetingBar'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import { getRevenue, getClients, getOpportunities, getLastSync, getLastSyncStatus, getBookingsFull, getQuoteCloseSpeed, getEmailReviewState, type RevenueRow, type Client, type Opportunity, type BookingRow, type EmailReviewState } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'
import { fmtUsd, topClients } from '@/lib/metrics'
import { buildInsights, type Tone } from '@/lib/insights'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'
import { RefreshCw, Sparkles, ArrowRight } from 'lucide-react'
import Link from 'next/link'

// --- date helpers ------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const monthLabel = (key: string) =>
  new Date(key + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })

const now = new Date()
function presetRange(key: string): { from: string; to: string } {
  const to = ymd(monthEnd(now))
  // YTD is the FINANCIAL year, which starts on 1 April — the year this business is run,
  // reported and targeted on, and the one the revenue sheet's own quarters follow. In
  // January to March that means April of the PREVIOUS calendar year, which is exactly
  // when a calendar-year YTD is most wrong: on 2 January it would have shown two days.
  if (key === 'ytd') {
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    return { from: `${fyStart}-04-01`, to }
  }
  const back = key === 'm3' ? 2 : key === 'm6' ? 5 : key === 'm12' ? 11 : 0 // 'mtd' -> 0
  return { from: ymd(monthStart(new Date(now.getFullYear(), now.getMonth() - back, 1))), to }
}

const PRESETS: { key: string; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'm3', label: 'Last 3 mo' },
  { key: 'm6', label: 'Last 6 mo' },
  { key: 'm12', label: 'Last 12 mo' },
  { key: 'ytd', label: 'YTD' },   // financial year, from 1 April
]
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

// Severity is carried in colour AND in a word, so an insight that needs attention
// reads at a glance without relying on the reader distinguishing red from amber.
const TONE: Record<Tone, { dot: string; text: string; ring: string; word: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', ring: 'border-red-500/35', word: 'Acting on this' },
  watch: { dot: 'bg-amber-400', text: 'text-amber-300', ring: 'border-amber-400/30', word: 'Worth watching' },
  neutral: { dot: 'bg-sky-400', text: 'text-sky-300', ring: 'border-sky-400/25', word: 'Context' },
  good: { dot: 'bg-green-400', text: 'text-green-300', ring: 'border-green-400/25', word: 'Going well' },
}

// Supabase returns timestamps like "2026-06-26 21:44:18.160673+00" — normalise so every browser parses it.
const parseTs = (ts: string | null) => {
  if (!ts) return NaN
  let s = ts.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  if (/[+-]\d{2}$/.test(s)) s += ':00'                 // "+00" -> "+00:00"
  else if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) s += 'Z'  // assume UTC if no zone
  return new Date(s).getTime()
}
const ago = (ts: string | null, nowMs: number) => {
  const t = parseTs(ts)
  if (!ts || isNaN(t)) return '—'
  const s = (nowMs - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const freshWithin = (ts: string | null, mins: number, nowMs: number) => { const t = parseTs(ts); return !isNaN(t) && (nowMs - t) / 60000 < mins }
const later = (a: string | null, b: string | null) => { const ta = parseTs(a), tb = parseTs(b); if (isNaN(ta)) return b; if (isNaN(tb)) return a; return ta >= tb ? a : b }
const FN_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '') + '/functions/v1/sync-web-revenue'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// --- segment (service department) bifurcation --------------------------------
const SEG_ORDER = ['WEB-US', 'WEB-UK', 'WEB-AU', 'LP', 'HUB', 'AI & Automation']
const segOf = (s?: string) => {
  const v = (s || '').trim()
  if (/^WEB-?US/i.test(v)) return 'WEB-US'
  if (/^WEB-?UK/i.test(v)) return 'WEB-UK'
  if (/^WEB-?AU/i.test(v)) return 'WEB-AU'
  if (/^LP/i.test(v)) return 'LP'
  if (/^HUB/i.test(v)) return 'HUB'
  if (/AI\s*&?\s*Auto/i.test(v)) return 'AI & Automation'
  return 'Other'
}

// Dedicated against pay-per-project, the two ways this business earns.
//
// There is no 'P2P' value in the data — it is everything that is NOT a retainer, which
// is New Development, Ad-hoc, Maintenance, Additional Pages and Change Request. Matching
// on 'dedicated' rather than listing the others means a new engagement type added to the
// sheet lands in P2P by default, which is the right default: a new retainer type would
// be noticed, a new project type would not.
//
// PARTIAL DEDICATED COUNTS AS DEDICATED. It is a retainer with part of a person's time
// on it, so it behaves like committed revenue rather than won-again-each-time revenue —
// $89k of the last six months. Worth knowing, since it is the one judgement call here.
const ENG = ['P2P', 'Dedicated'] as const
type Eng = typeof ENG[number]
const engOf = (v?: string): Eng => /dedicated/i.test(v || '') ? 'Dedicated' : 'P2P'

// The five buckets the business is actually run by. LP and HUB are one team, so they are
// one row here — this mirrors biz_bucket() behind Business Numbers, and the two pages
// have to agree or "what did WEB-UK do this month" has two answers.
const BIZ_ORDER = ['LP/HUB', 'WEB-AU', 'WEB-UK', 'WEB-US', 'AI & Automation']
const bizOf = (s?: string) => { const v = segOf(s); return v === 'LP' || v === 'HUB' ? 'LP/HUB' : v }

export default function Dashboard() {
  const [rev, setRev] = useState<RevenueRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  // The dashboard opens on this person's own accounts: their revenue, their clients,
  // their open deals, and insights read from their numbers rather than the company's.
  // Somebody not in the PM directory sees everything, because none of it is theirs.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])
  const scoped = justMine && mine.canScope
  const [bookingRows, setBookingRows] = useState<BookingRow[]>([])
  // 90th-percentile days-to-confirm, so the stale-pipeline insight argues from evidence.
  const [closeSpeed, setCloseSpeed] = useState<{ median: number; p90: number; n: number } | null>(null)
  const [insightsOpen, setInsightsOpen] = useState<string | null>(null)

  const init = presetRange('mtd')
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [preset, setPreset] = useState('mtd')

  const [syncRev, setSyncRev] = useState<string | null>(null)
  const [syncOpp, setSyncOpp] = useState<string | null>(null)
  // Whether the most recent opportunities scan FAILED (e.g. Gmail auth expired).
  const [syncOppFailed, setSyncOppFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  // How far behind the mailbox is. Reading it is a person's job, so this is a fact to
  // report, not a job to trigger.
  const [mail, setMail] = useState<EmailReviewState | null>(null)
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 30000); return () => clearInterval(id) }, [])
  const load = async () => {
    setRefreshing(true)
    try {
      const [r, c, o, b, cs, srA, srB, so, mr] = await Promise.all([
        getRevenue(), getClients(), getOpportunities(), getBookingsFull(), getQuoteCloseSpeed(),
        getLastSync('web-revenue-appscript'), getLastSync('web-revenue-sync'), getLastSyncStatus('email-opportunities-scan'),
        getEmailReviewState(),
      ])
      setRev(r); setClients(c); setOpps(o); setBookingRows(b); setCloseSpeed(cs); setSyncRev(later(srA, srB))
      setSyncOpp(so?.ran_at ?? null); setSyncOppFailed(so ? !so.ok : false); setMail(mr)
      setLastRefreshed(new Date()); setNowMs(Date.now())
    } finally { setRefreshing(false) }
  }
  // "Sync now" actually re-pulls the revenue sheet (via a Supabase edge function) THEN reloads the data.
  const refreshAll = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const res = await fetch(FN_URL, { method: 'POST', headers: ANON ? { apikey: ANON, Authorization: 'Bearer ' + ANON } : {} })
      const j = await res.json().catch(() => null)
      setSyncResult(j && j.ok ? `Sheet synced · ${j.rows} rows · ${j.agencies} agencies` : 'Sheet sync did not complete — showing last data')
    } catch { setSyncResult('Sheet sync unreachable — showing last data') }
    await load()
    setSyncing(false)
  }
  useEffect(() => { load() }, [])

  const applyPreset = (key: string) => { const r = presetRange(key); setFrom(r.from); setTo(r.to); setPreset(key) }
  const onFrom = (v: string) => { setFrom(v); setPreset('') }
  const onTo = (v: string) => { setTo(v); setPreset('') }

  // Tested on the MONTH the row belongs to, because that is how the web revenue sheet
  // reports a month and the two have to agree. The start date is used for the
  // month-on-month comparison below, where a per-day date is the only thing that works.
  const inMonthRange = (m?: string) => { if (!m) return false; const d = m.slice(0, 10); return d >= from && d <= to }
  const inDayRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return false; return v >= from && v <= to }

  // Scoped before the date range, so every figure on the page — the revenue total, the
  // month-on-month change, the active client count, the chart — is about this person's
  // work. A dashboard that greets you by name and then shows the company's numbers is
  // just the company's dashboard with your name on it.
  //
  // MONEY IS SCOPED BY THE NAME ON THE LINE, not by who owns the client. They are
  // different questions, and this page was answering the wrong one: on an account two
  // people share by service, filtering by client owner put the whole month on one of
  // them and nothing on the other. Checked line by line against the revenue sheet's own
  // Q2 pivot, per person per month, summing the lines whose PC/SME cell is this person
  // is what reproduces it.
  const rangeRev = useMemo(
    () => rev.filter(r => inMonthRange(r.month)).filter(r => !scoped || mine.ownsPm(r.sme)),
    [rev, from, to, scoped, mine])

  // monthly totals within range (drives period total)
  const monthSeries = useMemo(() => {
    const m: Record<string, number> = {}
    rangeRev.forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return Object.keys(m).sort().map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(m[k]) }))
  }, [rangeRev])

  // full-data monthly totals (for MoM + trend)
  // Scoped like the rest of the page. This feeds the trend chart and the month-on-month
  // change, so leaving it company-wide would have put everybody's revenue in the one
  // chart on a dashboard that says it is yours.
  const allMonthTotals = useMemo(() => {
    const m: Record<string, number> = {}
    rev.filter(r => !scoped || mine.ownsPm(r.sme))
       .forEach(r => { const k = (r.month || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return m
  }, [rev, scoped, mine])

  // Six months, always — independent of the KPI date filter above. Three months is two
  // comparisons, which is not enough to tell a trend from a quiet month.
  const trendSeries = useMemo(() => {
    const keys: string[] = []
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }
    return keys.map(k => ({ key: k, month: monthLabel(k), revenue: Math.round(allMonthTotals[k] || 0) }))
  }, [allMonthTotals])

  // --- segment x month matrix (trailing 6 months, independent of filter) -----
  const segMonths = useMemo(() => {
    const keys: string[] = []
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }
    return keys
  }, [])
  // Two matrices off one pass: the segment totals, and the same split by engagement.
  const { segData, engData } = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    const e: Record<string, Record<Eng, Record<string, number>>> = {}
    bookingRows.forEach(b => {
      const k = (b.booking_month || '').slice(0, 7)
      if (!segMonths.includes(k)) return
      const seg = segOf(b.service_name)
      const amt = b.booking_amount || 0
      m[seg] = m[seg] || {}
      m[seg][k] = (m[seg][k] || 0) + amt
      e[seg] = e[seg] || { P2P: {}, Dedicated: {} }
      const g = engOf(b.engagement_model)
      e[seg][g][k] = (e[seg][g][k] || 0) + amt
    })
    return { segData: m, engData: e }
  }, [bookingRows, segMonths])
  const segRows = useMemo(() => {
    const rows = [...SEG_ORDER]
    if (segData['Other'] && Object.values(segData['Other']).some(v => v)) rows.push('Other')
    return rows
  }, [segData])
  const colTotal = (k: string) => segRows.reduce((s, seg) => s + (segData[seg]?.[k] || 0), 0)
  const rowTotal = (seg: string) => segMonths.reduce((s, k) => s + (segData[seg]?.[k] || 0), 0)
  const engCell = (seg: string, g: Eng, k: string) => engData[seg]?.[g]?.[k] || 0
  const engRowTotal = (seg: string, g: Eng) => segMonths.reduce((s, k) => s + engCell(seg, g, k), 0)
  const engColTotal = (g: Eng, k: string) => segRows.reduce((s, seg) => s + engCell(seg, g, k), 0)

  const periodTotal = monthSeries.reduce((s, x) => s + x.revenue, 0)

  // In scope but ignoring the date filter. The same-days comparison and the "starting
  // later this month" note both need days the filter has deliberately cut off.
  const scopedRev = useMemo(
    () => rev.filter(r => !scoped || mine.ownsPm(r.sme)),
    [rev, scoped, mine])
  const sumBetween = (a: string, b: string) => scopedRev.reduce((s, r) => {
    const v = (r.date || r.month || '').slice(0, 10)
    return v >= a && v <= b ? s + (r.amount_usd || 0) : s
  }, 0)

  // True while the range is the current month, which is the default view.
  const isMtd = from === ymd(monthStart(now)) && to === ymd(monthEnd(now))
  // What the date filter currently covers, in words. Panels that follow the filter say
  // this out loud: "Top clients" sits beside a chart fixed to the last six months, and
  // without a label the two read as one period and quietly disagree.
  // Hours, not minutes: a review done by a person is not late at 45 minutes. Green for
  // this session's work, amber for today's, red once a working day has gone by unread.
  const mailDot = (() => {
    if (syncOppFailed) return 'bg-red-500'
    const t = parseTs(mail?.last_reviewed ?? syncOpp)
    if (isNaN(t)) return 'bg-mav-line'
    const h = (nowMs - t) / 3600000
    return h < 4 ? 'bg-green-400' : h < 24 ? 'bg-amber-400' : 'bg-red-500'
  })()

  const rangeLabel = useMemo(() => {
    if (!from || !to) return ''
    const d = (x: string) => new Date(x + 'T00:00:00')
    const f = d(from), t = d(to)
    const sameMonth = f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()
    if (sameMonth && from === ymd(monthStart(f)) && to === ymd(monthEnd(f))) {
      return f.toLocaleDateString('en', { month: 'long', year: 'numeric' })
    }
    const short = (x: Date) => x.toLocaleDateString('en', { day: 'numeric', month: 'short' })
    return `${short(f)} – ${short(t)} ${t.getFullYear()}`
  }, [from, to])
  const daysGone = now.getDate()
  const daysInMonth = monthEnd(now).getDate()

  // Where this month's money came from, by service.
  //
  // This month is counted by the sheet's Month column, so the five cards add up to the
  // headline figure above them. Last month is counted to TODAY'S DATE on the start date,
  // exactly as Business Numbers does it — held against a finished month, every service
  // reads as collapsing, every month, until the 30th.
  const bizNow = useMemo(() => {
    const curKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevFrom = ymd(monthStart(pm))
    // Clamped, so the 31st does not run off the end of a 30-day month.
    const prevTo = ymd(new Date(pm.getFullYear(), pm.getMonth(), Math.min(daysGone, monthEnd(pm).getDate())))
    const m: Record<string, { now: number; prev: number }> = {}
    bookingRows.forEach(b => {
      const k = bizOf(b.service_name)
      m[k] = m[k] || { now: 0, prev: 0 }
      if ((b.booking_month || '').slice(0, 7) === curKey) m[k].now += b.booking_amount || 0
      const d = (b.booking_date || '').slice(0, 10)
      if (d >= prevFrom && d <= prevTo) m[k].prev += b.booking_amount || 0
    })
    const rows = [...BIZ_ORDER]
    if (m['Other'] && (m['Other'].now || m['Other'].prev)) rows.push('Other')
    return { rows, m }
  }, [bookingRows, daysGone])

  // The comparison stops at today's DATE last month rather than running to the end of it.
  // Held against a finished month, this month reads as a 49% collapse every single time
  // until the 30th — a fact about the calendar, not about the business. Same rule as
  // Business Numbers, so the two pages agree.
  //
  // Both sides are returned, not just the percentage: "down 9.7%" says nothing about
  // whether that is $2k or $20k, and it is the money people act on.
  // ONLY for "This month". Over a 3-month, 6-month or year-to-date range there is no
  // "last month" to hold the headline against: the card would show a quarter's revenue
  // and, under it, a percentage comparing two single months inside that quarter. The two
  // numbers are unrelated, which is worse than having no comparison at all.
  const mom = useMemo(() => {
    if (!isMtd) return { pct: null, prev: 0 }
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    // Clamped, so the 31st does not run off the end of a 30-day month.
    const end = Math.min(now.getDate(), monthEnd(pm).getDate())
    const prev = sumBetween(ymd(pm), ymd(new Date(pm.getFullYear(), pm.getMonth(), end)))
    return { pct: prev ? ((periodTotal - prev) / prev) * 100 : null, prev }
  }, [isMtd, periodTotal, scopedRev])

  // Everything below reads these, not the raw lists. A booking carries its own PC/SME
  // cell, so it is scoped by the name on it like every other figure here; a delight or an
  // escalation names only a company, and ownership of those still comes from the client.
  const myBookings = useMemo(
    () => scoped ? bookingRows.filter(b => mine.ownsPm(b.sme)) : bookingRows,
    [bookingRows, scoped, mine])
  const myOpps = useMemo(
    // A deal counts as theirs by its PM, or by the client being theirs — an email-found
    // deal often has no PM on it yet, and dropping those would hide the newest work.
    () => scoped ? opps.filter(o => mine.ownsPm(o.pm_owner) || mine.ownsClient(o.company_name)) : opps,
    [opps, scoped, mine])

  const activeClients = useMemo(() =>
    new Set(rangeRev.filter(r => (r.amount_usd || 0) !== 0).map(r => r.client_name)).size, [rangeRev])
  // Open pipeline raised in this period, as MONEY.
  //
  // It read 0 because it counted rfq_status 'pending' or 'received', and rfq_status is
  // free text — four rows in the whole table say 'pending' and none say 'received'. The
  // sales state lives in `status`, which is clean: Won / Open / Lost / On Hold. A count
  // was the wrong unit anyway; twelve small quotes and one large one are not comparable.
  const openPipeline = useMemo(() => {
    const rows = myOpps.filter(o => /^open$/i.test((o.status || '').trim()) && inDayRange(o.source_date))
    return {
      usd: rows.reduce((s, o) => s + (o.est_value || 0), 0),
      n: rows.length,
      // A deal with no figure is not a small deal, it is an unpriced one. Saying how many
      // stops the total reading as the whole picture when it is not.
      unpriced: rows.filter(o => !o.est_value).length,
    }
  }, [myOpps, from, to])
  const bookings = rangeRev.length

  // AI Insights read the WHOLE history, not the date filter — a six-month trend
  // cannot be computed from a one-month window, and silently narrowing it to the
  // filter would make the panel say something different (and wrong) on every click.
  const insights = useMemo(
    () => buildInsights(myBookings, myOpps, closeSpeed?.p90 ?? null),
    [myBookings, myOpps, closeSpeed],
  )

  return (
    <div>
      {/* The greeting replaces the page header here: "Dashboard / Revenue, clients and
          pipeline at a glance" told a returning user nothing they did not know. The name
          and their client region's holidays do. */}
      <GreetingBar />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-xs">
        <span className="uppercase tracking-wide text-mav-muted">Last sync</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${freshWithin(syncRev, 45, nowMs) ? 'bg-green-400' : syncRev ? 'bg-amber-400' : 'bg-mav-line'}`} />
          <span className="text-mav-muted">Web revenue</span><span className="font-medium">{ago(syncRev, nowMs)}</span>
        </span>
        {/* Email review is a PERSON reading the mailbox — there is no cron behind it, and
            the page used to imply there was ("auto hourly + on-demand", beside a button
            that queued work nothing ever claimed). So it states the fact instead: when
            the mail was last read, and how much has landed since. The count is what
            makes it honest — "2h ago" sounds fine until you know 54 mails came in after
            it. */}
        <span className="inline-flex items-center gap-1.5"
          title="The revenue and quote syncs are automatic. Reading the mailbox for deals that never reach the Quotes tab is not — it happens when someone runs a review.">
          <span className={`w-2 h-2 rounded-full ${mailDot}`} />
          <span className="text-mav-muted">Email reviewed</span>
          <span className="font-medium">{ago(mail?.last_reviewed ?? syncOpp, nowMs)}</span>
          {syncOppFailed
            ? <span className="text-red-400 font-medium">· ⚠ the last review failed — capture may be stalled</span>
            : <span className="text-mav-muted">· by hand</span>}
          {/* CONVERSATIONS, not messages. "618 unread" is true and useless — it is mostly
              alerts and calendar invites, and a number nobody can act on gets ignored,
              which is how it ends up meaning nothing at all. This counts threads with a
              person outside the company on them. */}
          {mail && mail.waiting_threads > 0 && (
            <span className={mail.arrived_since > 0 ? 'text-amber-300' : 'text-mav-muted'}
              title={`${mail.waiting_msgs.toLocaleString('en-US')} messages across ${mail.waiting_threads} conversations with someone outside the company. ${mail.unread_total.toLocaleString('en-US')} unread in total — the rest is alerts, calendar invites and automatic replies.`}>
              · {mail.waiting_threads} client conversation{mail.waiting_threads === 1 ? '' : 's'} waiting
              {mail.arrived_since > 0 ? ` (${mail.arrived_since} since)` : ''}
            </span>
          )}
        </span>
        <span className="ml-auto text-mav-muted">{syncing ? 'Pulling the revenue sheet…' : refreshing ? 'Refreshing…' : syncResult ? syncResult : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString()}` : ''}</span>
        <button onClick={refreshAll} disabled={syncing || refreshing} title="Pull the latest revenue sheet into the dashboard"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg hover:border-mav-yellow disabled:opacity-50">
          <RefreshCw size={13} className={(syncing || refreshing) ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`text-sm px-3 py-2 rounded-md border transition-colors ${preset === p.key
              ? 'bg-mav-fill text-black border-mav-yellow font-medium'
              : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>{p.label}</button>
        ))}
        {mine.canScope && (
          <span className="ml-2">
            <MineFilter on={justMine} onChange={setJustMine} label="My accounts"
              hidden={clients.filter(c => !mine.ownsClient(c.company_name)).length} />
          </span>
        )}
        <span className="text-xs text-mav-muted ml-2">From</span>
        <input type="date" value={from} onChange={e => onFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => onTo(e.target.value)} className={selCls} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label={isMtd ? 'Revenue (this month)' : 'Revenue (period)'} value={fmtUsd(periodTotal)} change={mom.pct}
          changeLabel={`vs ${fmtUsd(mom.prev)} by this date last month`}
          note={isMtd && daysGone < daysInMonth ? `${daysGone} of ${daysInMonth} days gone — the month is still filling` : undefined} />
        <KPICard label="Active clients" value={String(activeClients)} />
        <KPICard label="Open opportunities" value={fmtUsd(openPipeline.usd)}
          note={openPipeline.n
            ? `${openPipeline.n} open${openPipeline.unpriced ? ` · ${openPipeline.unpriced} with no value yet` : ''}`
            : undefined} />
        <KPICard label="Bookings (period)" value={String(bookings)} />
      </div>

      {/* Company-wide by service, so this is an admin's view: a PM's accounts sit inside
          one of these cards and the other four are somebody else's. */}
      {(!scoped || mine.isAdmin) && (
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <div className="text-sm font-medium">This month by service</div>
            <div className="text-xs text-mav-muted">
              {monthLabel(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)} · against last month to the same date
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {bizNow.rows.map(seg => {
              const v = bizNow.m[seg] || { now: 0, prev: 0 }
              const d = v.prev > 0 ? ((v.now - v.prev) / v.prev) * 100 : null
              return (
                <div key={seg} className="bg-mav-panel border border-mav-line rounded-xl p-4 border-t-2"
                  style={{ borderTopColor: 'var(--section)' }}>
                  <div className="text-xs text-mav-muted truncate" title={seg}>{seg}</div>
                  <div className="text-xl font-semibold mt-1.5 tabular-nums">{fmtUsd(v.now)}</div>
                  <div className={`text-xs mt-1 ${d === null ? 'text-mav-muted' : d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {/* Nothing last month is not "up infinity per cent". Say what happened. */}
                    {d === null ? (v.now > 0 ? 'new' : '—') : `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`}
                  </div>
                  <div className="text-[11px] text-mav-muted mt-0.5 tabular-nums">{fmtUsd(v.prev)} last</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* THE ORDER OF THIS PAGE IS DELIBERATE: where this month's money came from,
          then the same question month on month, then the six-month shape with the
          clients behind it — and only last, what the numbers do not say. AI Insights
          used to sit second, above every figure it was commenting on. */}

      {/* Revenue by segment — month over month.
          Company-wide, by service department, so it answers a question a PM does not
          have: their own accounts sit inside one department and the other five rows are
          somebody else's. It stays for admins, who are the ones comparing departments,
          and for anyone who has cleared the scope to see all of Web. */}
      {/* mb-6 like every other block here: it lost its gap when it moved above the
          chart row, and the table ended flush against the next card. */}
      {(!scoped || mine.isAdmin) && (
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex items-baseline justify-between px-5 pt-5 mb-3">
          <div className="text-sm font-medium">Revenue by segment — month over month</div>
          <div className="text-xs text-mav-muted">Service department · trailing 6 months · USD</div>
        </div>
        <div className="px-5 pb-3 text-xs text-mav-muted max-w-3xl">
          {/* Said once, here, rather than leaving two unlabelled sub-rows to be guessed at. */}
          Each segment is split into <span className="text-mav-fg">Dedicated</span> — retainers, including
          Partial Dedicated — and <span className="text-mav-fg">P2P</span>, which is everything won project by
          project: new development, ad-hoc, maintenance, additional pages.
        </div>
        <div className="overflow-x-auto">
          {/* A real grid, not just row rules.
              The lines are mav-FG at low alpha rather than mav-line, so they follow the
              theme in the right direction on their own: fg is near-white on the dark
              themes, where a visible line has to be LIGHTER than the panel, and
              near-black on the light ones, where it has to be darker. A fixed
              border-mav-line was doing neither well enough to separate a month from the
              month beside it. */}
          <table className="w-full text-sm min-w-[720px] border-collapse">
            <thead className="text-left text-mav-muted">
              <tr className="border-b-2 border-mav-fg/25">
                <th className="px-5 py-3 font-medium border-r border-mav-fg/15">Segment</th>
                {segMonths.map(k => <th key={k} className="px-4 py-3 font-medium text-right whitespace-nowrap border-r border-mav-fg/15">{monthLabel(k)}</th>)}
                <th className="px-5 py-3 font-medium text-right whitespace-nowrap">6-mo total</th>
              </tr>
            </thead>
            <tbody>
              {segRows.map(seg => (
                // A fragment, not nested tables: the segment total and its two parts have to
                // stay in ONE table or the month columns stop lining up across segments.
                <Fragment key={seg}>
                  {/* The heavier rule goes ABOVE each segment, so the three rows that
                      belong together read as one block rather than three stripes. */}
                  {/* The segment's own line is the one being compared across the table;
                      its two parts are the detail under it. Yellow says which is which at
                      a glance, so the eye can run down the totals without reading labels.
                      A tint, not filled: twenty solid yellow cells would shout louder
                      than the numbers on them. */}
                  <tr className="border-t-2 border-mav-fg/20 bg-mav-yellow/10 text-mav-fg">
                    <td className="px-5 pt-3 pb-1.5 font-semibold whitespace-nowrap border-r border-mav-fg/15">{seg}</td>
                    {segMonths.map(k => <td key={k} className="px-4 pt-3 pb-1.5 text-right font-medium tabular-nums whitespace-nowrap border-r border-mav-fg/15">{fmtUsd(segData[seg]?.[k] || 0)}</td>)}
                    <td className="px-5 pt-3 pb-1.5 text-right font-semibold tabular-nums whitespace-nowrap">{fmtUsd(rowTotal(seg))}</td>
                  </tr>
                  {ENG.map(g => (
                    <tr key={g} className="text-xs text-mav-muted hover:bg-mav-dark/40 border-t border-mav-fg/10">
                      <td className="pl-9 pr-5 py-1 whitespace-nowrap border-r border-mav-fg/15">{g}</td>
                      {segMonths.map(k => <td key={k} className="px-4 py-1 text-right tabular-nums whitespace-nowrap border-r border-mav-fg/15">{fmtUsd(engCell(seg, g, k))}</td>)}
                      <td className="px-5 py-1 text-right tabular-nums whitespace-nowrap">{fmtUsd(engRowTotal(seg, g))}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {/* Stronger than a segment row, because it is a different kind of line. */}
              <tr className="border-t-2 border-mav-yellow/60 bg-mav-yellow/20 text-mav-fg">
                <td className="px-5 pt-3 pb-1.5 font-semibold border-r border-mav-fg/15">Total</td>
                {segMonths.map(k => <td key={k} className="px-4 pt-3 pb-1.5 text-right font-semibold tabular-nums whitespace-nowrap border-r border-mav-fg/15">{fmtUsd(colTotal(k))}</td>)}
                <td className="px-5 pt-3 pb-1.5 text-right font-semibold tabular-nums whitespace-nowrap">{fmtUsd(segMonths.reduce((s, k) => s + colTotal(k), 0))}</td>
              </tr>
              {ENG.map(g => (
                <tr key={g} className="text-xs text-mav-muted bg-mav-yellow/[0.06] border-t border-mav-fg/10">
                  <td className="pl-9 pr-5 py-1 whitespace-nowrap border-r border-mav-fg/15">{g}</td>
                  {segMonths.map(k => <td key={k} className="px-4 py-1 text-right tabular-nums whitespace-nowrap border-r border-mav-fg/15">{fmtUsd(engColTotal(g, k))}</td>)}
                  <td className="px-5 py-1 text-right tabular-nums whitespace-nowrap">{fmtUsd(segMonths.reduce((s, k) => s + engColTotal(g, k), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2"><RevenueChart data={trendSeries} title={scoped ? 'Your revenue — last 6 months' : 'Revenue — last 6 months'}
          note="The last bar is the month still running, so it is part of a month against five whole ones." /></div>
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="mb-4">
            <div className="text-sm font-medium">Top clients</div>
            {/* The period, because this panel follows the date filter while the chart
                next to it is fixed to six months. Two panels side by side on different
                periods, with only one of them saying so, is how a number gets quoted in
                a meeting as the wrong thing. */}
            <div className="text-xs text-mav-muted mt-0.5">{rangeLabel}{isMtd ? ' · so far' : ''}</div>
          </div>
          {monthSeries.length === 0 ? (
            <p className="text-sm text-mav-muted">No revenue in the selected range.</p>
          ) : (
            <ul className="space-y-3">
              {topClients(rangeRev).map((c, i) => (
                <li key={c.client_name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0"><span className="text-mav-muted w-4 shrink-0">{i + 1}</span><ClientLink name={c.client_name} className="truncate" /></span>
                  <span className="font-medium">{fmtUsd(c.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {insights.length > 0 && (
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <div className="text-sm font-medium inline-flex items-center gap-2">
              <Sparkles size={15} className="text-mav-yellow" /> AI Insights
            </div>
            <div className="text-xs text-mav-muted">
              Full history · recomputed every load{closeSpeed ? ` · close speed from ${closeSpeed.n} quotes` : ''}
            </div>
          </div>
          <p className="text-xs text-mav-muted mb-4">
            What the numbers above don&apos;t say. Ignores the date filter — these read the whole revenue and quote history
            {scoped ? <> for <span className="text-mav-fg">your accounts</span></> : ''}.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {insights.map(ins => {
              const t = TONE[ins.tone]
              const open = insightsOpen === ins.key
              return (
                <div key={ins.key} className={`bg-mav-dark/50 border ${t.ring} rounded-lg p-4 flex flex-col gap-2.5`}>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
                    <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                    <span className="text-mav-muted">{ins.topic}</span>
                    <span className={`ml-auto ${t.text}`}>{t.word}</span>
                  </div>

                  <div className={`text-2xl font-semibold tabular-nums leading-none ${t.text}`}>{ins.figure}</div>
                  <div className="text-sm leading-snug">{ins.headline}</div>
                  <p className="text-xs text-mav-muted leading-relaxed">{ins.detail}</p>

                  {ins.examples && ins.examples.length > 0 && (
                    <div>
                      <button
                        onClick={() => setInsightsOpen(open ? null : ins.key)}
                        className="text-xs text-mav-yellow hover:underline">
                        {open ? 'Hide the numbers' : `Show the numbers (${ins.examples.length})`}
                      </button>
                      {open && (
                        <ul className="mt-2 space-y-1.5 border-t border-mav-line pt-2">
                          {ins.examples.map((e, i) => (
                            <li key={i} className="text-xs text-mav-muted tabular-nums leading-snug">{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {ins.link && (
                    <Link href={ins.link.href}
                      className="mt-auto pt-1 text-xs text-mav-muted hover:text-mav-fg inline-flex items-center gap-1 w-fit">
                      {ins.link.label} <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
