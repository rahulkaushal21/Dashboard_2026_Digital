'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import type { CardDetails, DetailCol } from '@/components/CardDetail'
import InfoTip from '@/components/InfoTip'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
import { NotSplitNote } from '@/components/UnitToggle'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit } from '@/lib/business-unit'

import Link from 'next/link'
import { getBusinessNumbers, getBigOpenDeals, getOpportunityDepts, getMonthDateMismatches, getBookingTargets, getCrossSells, BIZ_ORDER, type BizRow, type MonthDateMismatch, type Opportunity, type BookingTarget, type CrossSell } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

// Business Numbers — the month, by service, for somebody who runs the business.
//
// SAME DAYS, BOTH MONTHS. Every figure here compares 1st-to-today against 1st-to-the-same-
// day last month. A whole August against three weeks of September says every service is
// collapsing, every month, until the 30th — and a page that cries wolf for three weeks in
// four stops being read.
//
// DATED ON START DATE, because that is what the Business Overview sheet the team already
// reads is dated on. Confirmation date is defensible on its own terms — "what did we win
// this month" — but it disagreed with the sheet on WEB-US by nearly double ($60,116
// against $31,445 for 1–22 August), and a second set of numbers nobody can reconcile is
// worse than no numbers. The other four services barely moved either way: their work
// usually starts in the month it is confirmed in, and WEB-US books further ahead.
//
// Won and quoted are kept apart and never added together. They are different money at
// different certainty, and a single headline number that mixes them is the fastest way to
// a forecast nobody believes.

// The Month column is a month, so print it as one — "month 1 Sep" reads like a date.
const monLabel = (v?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(v || '')
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return m ? `${MON[+m[2] - 1]} ${m[1]}` : '—'
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

// Ranges people actually ask for. There is deliberately no "this month so far": the whole
// month is the number the business reports, and the fair comparison is made by cutting
// the PREVIOUS month short at today's date rather than by cutting this one short.
const RANGES = (n: Date) => [
  { key: 'month', label: 'This month', from: ymd(monthStart(n)), to: ymd(monthEnd(n)) },
  { key: 'prev', label: 'Last month', from: ymd(monthStart(new Date(n.getFullYear(), n.getMonth() - 1, 1))), to: ymd(monthEnd(new Date(n.getFullYear(), n.getMonth() - 1, 1))) },
  { key: 'q', label: 'Last 3 months', from: ymd(monthStart(new Date(n.getFullYear(), n.getMonth() - 2, 1))), to: ymd(monthEnd(n)) },
]

const pct = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null

const deltaTone = (d: number | null) =>
  d === null ? 'text-mav-muted' : d > 0 ? 'text-green-400' : d < 0 ? 'text-red-400' : 'text-mav-muted'

const Delta = ({ now, before, suffix }: { now: number; before: number; suffix?: string }) => {
  const d = pct(now, before)
  if (d === null) {
    // Nothing last time is not "up infinity%". Say what actually happened.
    return <span className="text-mav-muted text-xs">{now > 0 ? `new${suffix ? ` ${suffix}` : ''}` : '—'}</span>
  }
  return <span className={`text-xs ${deltaTone(d)}`}>{d > 0 ? '+' : ''}{d}%{suffix ? ` ${suffix}` : ''}</span>
}

const dayLabel = (v?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  if (!m) return ''
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${+m[3]} ${MON[+m[2] - 1]}`
}

// A bar per service, scaled to the biggest of the two months so this month and last month
// are readable against each other rather than each against itself.
const Bars = ({ now, before, max }: { now: number; before: number; max: number }) => (
  <div className="space-y-1 min-w-[7rem]">
    <div className="h-2 rounded-sm bg-mav-dark overflow-hidden">
      <div className="h-full bg-mav-yellow rounded-sm" style={{ width: `${max > 0 ? (now / max) * 100 : 0}%` }} />
    </div>
    <div className="h-2 rounded-sm bg-mav-dark overflow-hidden">
      <div className="h-full bg-mav-fg/25 rounded-sm" style={{ width: `${max > 0 ? (before / max) * 100 : 0}%` }} />
    </div>
  </div>
)

// Revenue against the month's target: the figure, then how far along it is. The bar is
// the share of target already booked, capped at full so a month that beat its target does
// not spill out of its cell. Red under a third, amber under two thirds, green from there.
const Against = ({ now, target }: { now: number; target: number | null }) => {
  if (target === null) return <span className="text-mav-fg/35 text-xs">no target</span>
  if (target === 0) return <span className="text-mav-muted text-xs">target is 0</span>
  const p = (now / target) * 100
  const tone = p >= 100 ? 'bg-green-400' : p >= 66 ? 'bg-mav-yellow' : p >= 33 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="min-w-[7rem]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums">{fmtUsd(target)}</span>
        <span className={`text-xs tabular-nums ${p >= 100 ? 'text-green-400' : 'text-mav-muted'}`}>{Math.round(p)}%</span>
      </div>
      <div className="h-2 rounded-sm bg-mav-dark overflow-hidden mt-1">
        <div className={`h-full rounded-sm ${tone}`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
    </div>
  )
}

// The first day of every month the window touches, so a two-month range reads against
// two months of target.
// The cross-sell tracker dates a row by its month, written out as a day — 01-10-2026.
const dmy = (v?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

/**
 * The cross-sell tracker's ten columns, in its order.
 *
 * Defined once and read by the table, the clipboard and the CSV, so what is on screen is
 * exactly what gets pasted. A separate export builder is how an export quietly drifts
 * from the page it claims to export.
 */
const XSELL_COLS: { label: string; get: (r: CrossSell) => string; num?: boolean; wide?: boolean }[] = [
  { label: 'Month (DD-MM-YYYY)', get: r => dmy(r.booking_month) },
  { label: 'Company Name', get: r => r.client },
  { label: 'Client Name', get: r => r.client_name || '' },
  { label: 'Client Email ID', get: r => r.client_email || '' },
  { label: 'Agency / Direct', get: r => r.client_type || '' },
  { label: 'PC/SME Name', get: r => r.pm },
  { label: 'BU Name', get: r => r.service_dept || '' },
  { label: 'Cross Sell Service Name', get: r => r.project, wide: true },
  { label: 'Email Subject line', get: r => r.mail_subject, wide: true },
  // Plain digits, no $ and no thousands separator: the cell has to arrive as a number.
  { label: 'Invoice Billable (USD) - RFQ', get: r => r.amount_usd.toFixed(2), num: true },
]

const monthsIn = (from: string, to: string): string[] => {
  const out: string[] = []
  const a = new Date(+from.slice(0, 4), +from.slice(5, 7) - 1, 1)
  const b = new Date(+to.slice(0, 4), +to.slice(5, 7) - 1, 1)
  for (let d = a; d <= b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(ymd(d))
  return out
}

export default function BusinessNumbers() {
  const [rowsAll, setRows] = useState<BizRow[]>([])
  const [dealsAll, setDeals] = useState<Opportunity[]>([])
  const [oppDepts, setOppDepts] = useState<Map<number, string>>(new Map())

  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source, so every figure follows the switch.
  // BizRow.bucket is already the department rolled up the way this page reports it
  // ('LP/HUB', 'WEB-US'…), which is the same vocabulary the switch speaks.
  const { unit } = useUnit()
  const rows = useMemo(() => rowsAll.filter(r => inUnit(r.bucket, unit)), [rowsAll, unit])
  // The top 25 are taken AFTER the department filter, not before: cutting to 25 across
  // every department first left a department view with whichever handful of its deals
  // happened to rank in the company-wide top 25.
  const deals = useMemo(() => dealsAll.filter(d => inUnit(oppDepts.get(Number(d.id)), unit)).slice(0, 25), [dealsAll, oppDepts, unit])
  const [unpriced, setUnpriced] = useState(0)
  const [loading, setLoading] = useState(true)
  // The month's booking targets, typed in Settings → Targets. Fetched for every month the
  // window touches; a service with no row has no target and the table says so.
  const [targets, setTargets] = useState<BookingTarget[]>([])
  const [xsellAll, setXsellAll] = useState<CrossSell[]>([])
  // Normally empty, and then this renders nothing at all.
  const [mismatchAll, setMismatch] = useState<MonthDateMismatch[]>([])
  // The sheet rows carry their service department, so the warning follows the switch too.
  const mismatch = useMemo(() => mismatchAll.filter(r => inUnit(r.service_dept, unit)), [mismatchAll, unit])

  // Opens on the whole of the current month, first day to last.
  const now = useMemo(() => new Date(), [])
  const ranges = useMemo(() => RANGES(now), [now])
  const [from, setFrom] = useState(() => ymd(monthStart(new Date())))
  const [to, setTo] = useState(() => ymd(monthEnd(new Date())))

  // Every figure on the page comes from the database for this window, so the dates are
  // not a filter over something already fetched — changing them refetches.
  useEffect(() => {
    if (!from || !to || from > to) return
    let live = true
    setLoading(true)
    getBusinessNumbers(from, to)
      .then(n => { if (live) setRows(n) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [from, to])

  useEffect(() => {
    if (!from || !to || from > to) return
    const ms = monthsIn(from, to)
    getBookingTargets(ms[0], ms[ms.length - 1]).then(setTargets).catch(() => setTargets([]))
    // A cross-sell is dated by the month its revenue lands in, so it follows the same
    // window as everything else on the page — but by whole months, since that is the only
    // date it has. A narrow window inside one month shows that month's cross-sells.
    getCrossSells(ms[0], ms[ms.length - 1]).then(setXsellAll).catch(() => setXsellAll([]))
  }, [from, to])

  // Sum of the window's months for a service, or null when none of them has a target.
  const targetFor = (bucket: string): number | null => {
    const hit = targets.filter(t => t.dept === bucket)
    return hit.length ? hit.reduce((n, t) => n + t.target_usd, 0) : null
  }
  // A target is a whole-month number. On a part-month window it still shows, labelled as
  // the month's figure, rather than being pro-rated into something nobody set.
  const partMonth = !!rows[0] && !rows[0].whole_month

  useEffect(() => {
    // Every priced open deal, ranked; the page cuts to 25 once the department is applied.
    getBigOpenDeals(100000).then(d => { setDeals(d.rows); setUnpriced(d.unpriced) })
    getOpportunityDepts().then(setOppDepts)
    getMonthDateMismatches().then(setMismatch)
  }, [])

  // "Other" earns its row only when it holds something. An empty bucket on a leadership
  // page is a question mark nobody can answer.
  const shown = useMemo(() => rows.filter(r =>
    r.bucket !== 'Other' || r.this_revenue || r.prev_revenue || r.open_quotes), [rows])

  const t = useMemo(() => shown.reduce((a, r) => ({
    this_revenue: a.this_revenue + r.this_revenue, prev_revenue: a.prev_revenue + r.prev_revenue,
    this_deals: a.this_deals + r.this_deals, prev_deals: a.prev_deals + r.prev_deals,
    this_quotes: a.this_quotes + r.this_quotes, prev_quotes: a.prev_quotes + r.prev_quotes,
    this_quotes_usd: a.this_quotes_usd + r.this_quotes_usd, prev_quotes_usd: a.prev_quotes_usd + r.prev_quotes_usd,
    open_quotes: a.open_quotes + r.open_quotes, open_quotes_usd: a.open_quotes_usd + r.open_quotes_usd,
  }), {
    this_revenue: 0, prev_revenue: 0, this_deals: 0, prev_deals: 0, this_quotes: 0, prev_quotes: 0,
    this_quotes_usd: 0, prev_quotes_usd: 0, open_quotes: 0, open_quotes_usd: 0,
  }), [shown])

  const tTarget = useMemo(() => {
    const hit = shown.map(r => targetFor(r.bucket)).filter((x): x is number => x !== null)
    return hit.length ? hit.reduce((a, b) => a + b, 0) : null
  }, [shown, targets]) // eslint-disable-line react-hooks/exhaustive-deps

  const w = rows[0]
  const thisLabel = w ? `${dayLabel(w.this_start)} – ${dayLabel(w.this_end)}` : ''
  const prevLabel = w ? `${dayLabel(w.prev_start)} – ${dayLabel(w.prev_end)}` : ''
  const maxRev = Math.max(...shown.map(r => Math.max(r.this_revenue, r.prev_revenue)), 1)

  // ── Cross-sells ───────────────────────────────────────────────────────────────
  // Each row carries its own department, so the business-unit switch applies the same
  // way it does to a booked line.
  const xsell = useMemo(() => xsellAll.filter(r => inUnit(r.service_dept, unit)), [xsellAll, unit])
  const xsellClosed = useMemo(() => xsell.filter(r => r.status === 'closed'), [xsell])
  const xsellOpen = useMemo(() => xsell.filter(r => r.status === 'open'), [xsell])
  const xsellTotal = useMemo(() => xsellClosed.reduce((a, r) => a + r.amount_usd, 0), [xsellClosed])
  // Grouped by PM, biggest first: whose mailbox it came from is the question this panel
  // is read for. Within a PM, biggest line first.
  const xsellByPm = useMemo(() => {
    const m = new Map<string, { pm: string; usd: number; rows: CrossSell[] }>()
    for (const r of xsellClosed) {
      const e = m.get(r.pm) || { pm: r.pm, usd: 0, rows: [] as CrossSell[] }
      e.usd += r.amount_usd
      e.rows.push(r)
      m.set(r.pm, e)
    }
    return [...m.values()]
      .map(e => ({ ...e, rows: [...e.rows].sort((a, b) => b.amount_usd - a.amount_usd) }))
      .sort((a, b) => b.usd - a.usd)
  }, [xsellClosed])
  const xsellClients = useMemo(() => new Set(xsellClosed.map(r => r.client)).size, [xsellClosed])

  // Copy pastes the ROWS ONLY, tab-separated — the tracker already has its header, and a
  // header pasted under one becomes a data row somebody has to delete. Tabs rather than
  // commas because a paste into Sheets or Excel splits on tabs without an import step,
  // and three of these columns (service name, subject) routinely contain a comma.
  const [copied, setCopied] = useState('')
  const copyXsell = async () => {
    const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim()
    const tsv = xsellClosed.map(r => XSELL_COLS.map(c => clean(c.get(r))).join('\t')).join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(`${xsellClosed.length} copied`)
    } catch {
      // Clipboard is blocked without https or a user gesture in some browsers; say so
      // rather than leaving a button that silently does nothing.
      setCopied('Copy blocked — use CSV')
    }
    setTimeout(() => setCopied(''), 2500)
  }

  const exportXsell = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const head = XSELL_COLS.map(c => esc(c.label)).join(',')
    const body = xsellClosed.map(r => XSELL_COLS.map(c => esc(c.get(r))).join(','))
    // The BOM is what makes Excel read the em dashes and accented names as UTF-8 rather
    // than as mojibake.
    const blob = new Blob(['﻿' + [head, ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cross-sell-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const activeRange = ranges.find(r => r.from === from && r.to === to)?.key || ''

  // ── What sits behind each headline card ─────────────────────────────────────────
  // The figures arrive from the database already summed per service, so the rows behind
  // a card are the services themselves — the same rows the "By service" total adds up,
  // so the panel's footer is the card's figure. Per-deal rows are not fetched for these
  // windows, and the 25 biggest open deals below do not add up to the pipeline, so they
  // are not offered as its breakdown.
  const cardDetails = useMemo(() => {
    const svc: DetailCol<BizRow> = { key: 'svc', label: 'Service', value: r => r.bucket, sort: r => r.bucket, wide: true }
    const pair = (key: string, label: string, get: (r: BizRow) => number, before: (r: BizRow) => number, show: (n: number) => string): DetailCol<BizRow>[] => [
      { key, label, align: 'right', value: r => show(get(r)), sort: get, total: rs => show(rs.reduce((a, r) => a + get(r), 0)) },
      { key: `${key}_prev`, label: `Last (${prevLabel})`, align: 'right', value: r => show(before(r)), sort: before, total: rs => show(rs.reduce((a, r) => a + before(r), 0)) },
      { key: `${key}_delta`, label: 'Change', align: 'right', value: r => <Delta now={get(r)} before={before(r)} />, sort: r => pct(get(r), before(r)) ?? -1e9 },
    ]
    const base = { rows: shown, rowKey: (r: BizRow) => r.bucket }
    const out: Record<string, CardDetails<BizRow>> = {
      'Revenue': { ...base, subtitle: `Revenue by service, ${thisLabel} against ${prevLabel}`, defaultSort: 'rev',
        columns: [svc, ...pair('rev', 'Revenue', r => r.this_revenue, r => r.prev_revenue, fmtUsd),
          { key: 'clients', label: 'Clients', align: 'right', value: r => r.this_clients, sort: r => r.this_clients }] },
      'Projects started': { ...base, subtitle: `Projects started by service, ${thisLabel} against ${prevLabel}`, defaultSort: 'deals',
        columns: [svc, ...pair('deals', 'Projects', r => r.this_deals, r => r.prev_deals, n => String(n)),
          { key: 'rev', label: 'Revenue', align: 'right', value: r => fmtUsd(r.this_revenue), sort: r => r.this_revenue, total: rs => fmtUsd(rs.reduce((a, r) => a + r.this_revenue, 0)) }] },
      'Quotes raised': { ...base, subtitle: `Quotes raised by service, ${thisLabel} against ${prevLabel}`, defaultSort: 'q',
        columns: [svc, ...pair('q', 'Quotes', r => r.this_quotes, r => r.prev_quotes, n => String(n)),
          { key: 'qusd', label: 'Quoted', align: 'right', value: r => fmtUsd(r.this_quotes_usd), sort: r => r.this_quotes_usd, total: rs => fmtUsd(rs.reduce((a, r) => a + r.this_quotes_usd, 0)) }] },
      'Open pipeline': { ...base, subtitle: 'Quotes still in play by service, all time', defaultSort: 'open',
        columns: [svc,
          { key: 'open', label: 'Open pipeline', align: 'right', value: r => fmtUsd(r.open_quotes_usd), sort: r => r.open_quotes_usd, total: rs => fmtUsd(rs.reduce((a, r) => a + r.open_quotes_usd, 0)) },
          { key: 'n', label: 'Quotes', align: 'right', value: r => r.open_quotes, sort: r => r.open_quotes, total: rs => String(rs.reduce((a, r) => a + r.open_quotes, 0)) }] },
    }
    return out
  }, [shown, thisLabel, prevLabel])

  const td = 'px-3 py-3 whitespace-nowrap'
  const th = 'px-3 py-2 font-medium whitespace-nowrap'
  const dateBox = 'bg-mav-dark border border-mav-line rounded-md px-2 py-1.5 text-sm text-mav-fg [color-scheme:dark]'
  const lbl = 'font-mono text-[10.5px] uppercase tracking-[0.1em] text-mav-muted'
  const dash = loading ? '…' : null

  // How the two windows are counted. Was a paragraph above the cards; it sits behind the
  // ⓘ on the service table now, word for word.
  const basis = (
    <>
      <b>{thisLabel}</b> against <b>{prevLabel}</b> — the month before, stopping at today&rsquo;s date while this month is
      still running, so the two are worth putting side by side.
      {w?.whole_month
        ? <> A whole month is counted by the web revenue sheet&rsquo;s <b>Month</b> column,
            so this page and the Dashboard report the same figure the sheet does.</>
        : <> A range narrower than a month is counted on <b>Start Date</b>, because a
            month column cannot tell you about the 12th. The two agree row for row, so this adds up to the
            whole-month figure.</>}
      {' '}Won money and quoted money are shown apart and never added together.
    </>
  )

  return (
    <div>
      <Header title="Business Numbers"
        subtitle="How each service is doing, against the same point of the month before"
        chip={thisLabel || undefined} />

      {/* Silent when the sheet is clean, which is nearly always. A row here makes the
          whole-month and part-month figures differ by its own value, and it is invisible
          in the sheet itself — the one that got through was found by holding two pages
          side by side, which is not a process. */}
      {mismatch.length > 0 && (
        <div className="mb-4 text-xs rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
            {mismatch.length === 1 ? 'One row has' : `${mismatch.length} rows have`} a Month column and a Start Date in
            different months, worth {fmtUsd(mismatch.reduce((a, r) => a + (Number(r.amount_usd) || 0), 0))} — fix them in the sheet
            <InfoTip text="Whole months are counted by the Month column and shorter ranges by the Start Date, so these rows change the answer depending on the dates you pick." />
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {mismatch.slice(0, 5).map(r => (
              <li key={r.row_key} className="text-mav-muted">
                <span className="text-mav-fg">{r.company_name || '—'}</span>
                {r.project_name ? ` · ${r.project_name}` : ''} — month {monLabel(r.booking_month)},
                starts {dayLabel(r.start_date) || '—'} · {fmtUsd(Number(r.amount_usd) || 0)}
              </li>
            ))}
            {mismatch.length > 5 && <li className="text-mav-muted">…and {mismatch.length - 5} more</li>}
          </ul>
        </div>
      )}

      {/* The four numbers a leader checks first. */}
      <KPIRow cols={4}>
        {[
          { label: 'Revenue', value: fmtUsd(t.this_revenue), now: t.this_revenue, before: t.prev_revenue,
            sub: tTarget ? `${Math.round((t.this_revenue / tTarget) * 100)}% of the ${fmtUsd(tTarget)} target · ${fmtUsd(t.prev_revenue)} in ${prevLabel}` : `${fmtUsd(t.prev_revenue)} in ${prevLabel}`, tone: 'accent' as const },
          { label: 'Projects started', value: String(t.this_deals), now: t.this_deals, before: t.prev_deals, sub: `${t.prev_deals} in ${prevLabel}`, tone: 'green' as const },
          { label: 'Quotes raised', value: String(t.this_quotes), now: t.this_quotes, before: t.prev_quotes, sub: `${fmtUsd(t.this_quotes_usd)} quoted · ${t.prev_quotes} in ${prevLabel}`, tone: 'default' as const },
          { label: 'Open pipeline', value: fmtUsd(t.open_quotes_usd), now: 0, before: 0, sub: `${t.open_quotes} quotes still in play, all time`, tone: 'amber' as const },
        ].map(c => (
          <KPICard key={c.label} tone={c.tone} label={c.label} value={dash ?? c.value}
            details={loading ? undefined : cardDetails[c.label]}
            sub={loading ? undefined : <>
              {(c.now || c.before) ? <><Delta now={c.now} before={c.before} /><br /></> : null}
              <span className="text-[11px]">{c.sub}</span>
            </>} />
        ))}
      </KPIRow>

      {/* The window is the page's main split. Outside the loading gate on purpose:
          changing a date refetches, and controls that vanish while the numbers reload are
          controls you cannot correct a typo in. */}
      <Segments<string>
        value={activeRange}
        onChange={k => { const r = ranges.find(x => x.key === k); if (r) { setFrom(r.from); setTo(r.to) } }}
        items={[
          ...ranges.map(r => ({ id: r.key, label: r.label })),
          ...(activeRange ? [] : [{ id: '', label: 'Custom range' }]),
        ]} />

      <FilterBar right={w?.prev_capped ? (
        <span className="flex items-center gap-1.5 text-xs text-mav-muted">
          Compared with <span className="text-mav-fg">{prevLabel}</span>, same days
          <InfoTip align="right" text={<>The month is still running, so the comparison stops at the same date last month: <b>{thisLabel}</b> against <b>{prevLabel}</b>. Holding it against a finished month instead would show every service collapsing, every month, until the 30th.</>} />
        </span>) : undefined}>
        <span className={lbl}>From</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className={dateBox} aria-label="From" />
        <span className="text-xs text-mav-muted">→</span>
        <span className={lbl}>To</span>
        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={dateBox} aria-label="To" />
        {from > to && <span className="text-xs text-red-400">From is after To.</span>}
      </FilterBar>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p> : (
        <>
          <Panel flush className="mb-6" title="By service" info={basis}
            right={<span className="text-[11px] text-mav-muted">{thisLabel} vs {prevLabel}</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                <tr>
                  <th className={th}>Service</th>
                  <th className={`${th} text-right`}>Revenue</th>
                  <th className={`${th} text-right`}>vs last month</th>
                  <th className={th}>
                    <span className="inline-flex items-center gap-1">
                      Target
                      <InfoTip text={<>The month&rsquo;s booking target per service, set in Settings → Targets. {partMonth ? <>The window is narrower than a month, so this is the whole month&rsquo;s target against part of a month&rsquo;s revenue.</> : <>A range across several months adds their targets together.</>}</>} />
                    </span>
                  </th>
                  <th className={th}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-sm bg-mav-yellow" />this
                      <span className="inline-block w-2 h-2 rounded-sm bg-mav-fg/25 ml-2" />last
                    </span>
                  </th>
                  <th className={`${th} text-right`}>Projects</th>
                  <th className={`${th} text-right`}>Clients</th>
                  <th className={`${th} text-right`}>Quotes raised</th>
                  <th className={`${th} text-right`}>Open pipeline</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.bucket} className="border-b border-mav-line/60 last:border-0">
                    <td className={`${td} font-medium`}>{r.bucket}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtUsd(r.this_revenue)}
                      <div className="text-[11px] text-mav-muted">{fmtUsd(r.prev_revenue)} last</div>
                    </td>
                    <td className={`${td} text-right`}><Delta now={r.this_revenue} before={r.prev_revenue} /></td>
                    <td className={td}><Against now={r.this_revenue} target={targetFor(r.bucket)} /></td>
                    <td className={td}><Bars now={r.this_revenue} before={r.prev_revenue} max={maxRev} /></td>
                    <td className={`${td} text-right tabular-nums`}>{r.this_deals}
                      <div className="text-[11px] text-mav-muted">{r.prev_deals} last</div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.this_clients}
                      <div className="text-[11px] text-mav-muted">{r.prev_clients} last</div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.this_quotes}
                      <div className="text-[11px] text-mav-muted">{r.prev_quotes} last · {fmtUsd(r.this_quotes_usd)}</div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtUsd(r.open_quotes_usd)}
                      <div className="text-[11px] text-mav-muted">{r.open_quotes} quotes</div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-mav-dark/40">
                  {/* Under a department it is that department's total, so it says so. */}
                  <td className={`${td} font-semibold`}>{unit === 'all' ? 'All of Web' : 'Total'}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{fmtUsd(t.this_revenue)}
                    <div className="text-[11px] text-mav-muted font-normal">{fmtUsd(t.prev_revenue)} last</div>
                  </td>
                  <td className={`${td} text-right`}><Delta now={t.this_revenue} before={t.prev_revenue} /></td>
                  <td className={`${td} font-semibold`}><Against now={t.this_revenue} target={tTarget} /></td>
                  <td className={td} />
                  <td className={`${td} text-right tabular-nums font-semibold`}>{t.this_deals}</td>
                  <td className={td} />
                  <td className={`${td} text-right tabular-nums font-semibold`}>{t.this_quotes}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{fmtUsd(t.open_quotes_usd)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          </Panel>

          {/* Business the delivery side opened. Silent when there is none in the window:
              an empty panel on a leadership page reads as a failure rather than as a
              month nobody has written up yet.

              THE COLUMNS ARE THE TRACKER'S COLUMNS, in the tracker's order, so a copy
              lands in the right cells with nothing to rearrange. Table, clipboard and CSV
              all read XSELL_COLS, so what is on screen is exactly what gets pasted. */}
          {xsell.length > 0 && (
          <Panel flush className="mb-6" title="Cross-sell"
            info={<>Work a <b>PM</b> opened from their own mailbox, not the account manager &mdash; a proposal, a health check or a security advisory sent to a client who had not asked. <b>Done and closed</b> means the client said yes and the revenue is booked, so every figure here is also a line in the project ledger. Attribution is written down by hand, not derived: it is kept only where a booked line names the work the mail pitched, because &ldquo;mailed, then bought something&rdquo; credits a campaign with retainers that were already running.</>}
            right={
              <span className="flex flex-wrap items-center gap-3 text-xs text-mav-muted">
                <span>
                  {fmtUsd(xsellTotal)} closed &middot; {xsellClosed.length} {xsellClosed.length === 1 ? 'line' : 'lines'} across {xsellClients} {xsellClients === 1 ? 'client' : 'clients'}
                  {xsellOpen.length > 0 && <> &middot; {xsellOpen.length} still open</>}
                </span>
                <button onClick={copyXsell} disabled={xsellClosed.length === 0}
                  className="rounded-md border border-mav-line px-2 py-1 hover:bg-mav-dark disabled:opacity-40">
                  {copied || 'Copy rows'}
                </button>
                <button onClick={exportXsell} disabled={xsellClosed.length === 0}
                  className="rounded-md border border-mav-line px-2 py-1 hover:bg-mav-dark disabled:opacity-40">
                  CSV
                </button>
              </span>}>
          {/* Per PM, since the rows themselves are flat — grouping headers inside the
              table would be copied along with the data and land in the sheet as junk. */}
          {xsellByPm.length > 0 && (
            <div className="px-4 pt-3 text-xs text-mav-muted">
              {xsellByPm.map((g, i) => (
                <span key={g.pm}>
                  {i > 0 && <span className="mx-1.5">&middot;</span>}
                  <span className="text-mav-fg">{g.pm}</span> {fmtUsd(g.usd)}
                  {xsellTotal > 0 && <span className="opacity-70"> ({Math.round((g.usd / xsellTotal) * 100)}%)</span>}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                <tr>
                  {XSELL_COLS.map(c => (
                    <th key={c.label} className={`${th} ${c.num ? 'text-right' : ''}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {xsellClosed.map(r => (
                  <tr key={r.id} className="border-b border-mav-line/60 last:border-0 align-top">
                    {XSELL_COLS.map(c => (
                      <td key={c.label}
                        className={c.wide ? 'px-3 py-3' : `${td} ${c.num ? 'text-right tabular-nums' : ''}`}>
                        {c.wide
                          ? <div className="max-w-sm break-words">{c.get(r)}</div>
                          : c.get(r) || <span className="text-mav-muted">&mdash;</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {xsellClosed.length === 0 && (
                  <tr><td colSpan={XSELL_COLS.length} className="px-3 py-6 text-center text-mav-muted">Nothing closed in this window.</td></tr>
                )}
                {xsellClosed.length > 0 && (
                  <tr className="bg-mav-dark/40">
                    <td className={`${td} font-semibold`} colSpan={XSELL_COLS.length - 1}>Total</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{fmtUsd(xsellTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Proposals a PM sent that nobody has answered. Kept beside the closed ones
              because an unanswered cross-sell is the thing worth chasing, and on its own
              panel it would never be looked at. Deliberately outside the table: they have
              no billable figure, so they must not be pasted into the tracker. */}
          {xsellOpen.length > 0 && (
            <div className="border-t border-mav-line px-4 py-3 text-xs">
              <div className="text-mav-fg/80 font-medium mb-1">
                Sent, no answer yet &mdash; {xsellOpen.length}. Not in the copy: there is nothing to bill yet.
              </div>
              <ul className="space-y-0.5">
                {xsellOpen.map(r => (
                  <li key={r.id} className="text-mav-muted">
                    <span className="text-mav-fg">{r.client}</span> &middot; {r.project} &mdash; {r.pm}, &ldquo;{r.mail_subject}&rdquo; {dayLabel(r.mail_date)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </Panel>
          )}

          {/* Where the next month comes from. Open, priced, biggest first. */}
          <Panel flush title="Biggest open opportunities"
            info="Still in play — not won, not lost, not marked unlikely. Ranked by quoted value. A deal with no figure is not a small deal, it is an unpriced one, so those are counted separately rather than ranked at zero. Click one to open it."
            right={
              <span className="text-xs text-mav-muted">
                {deals.length} shown of {fmtUsd(deals.reduce((s, d) => s + (d.est_value || 0), 0))}
                {unpriced > 0 && <> · {unpriced} more open with no price on them yet{unit !== 'all' ? ' (all departments)' : ''}</>}
              </span>}>
          {/* The unpriced count comes back from the database as one number for every
              department; the rows behind it are never fetched, so it cannot be split here. */}
          {unpriced > 0 && <NotSplitNote className="px-4 pt-2" what="The count of unpriced open deals" reason="arrives as a single company-wide number" />}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                <tr>
                  <th className={th}>Client</th>
                  <th className={th}>What it is</th>
                  <th className={`${th} text-right`}>Value</th>
                  <th className={th}>Owner</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Raised</th>
                </tr>
              </thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id} className="border-b border-mav-line/60 last:border-0 align-top">
                    <td className={td}>
                      <Link href={`/opportunities?deal=${d.id}`} className="text-mav-yellow hover:underline underline-offset-2">
                        {d.company_name || '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-3"><div className="max-w-md break-words">{d.source_subject || d.gist || '—'}</div></td>
                    <td className={`${td} text-right tabular-nums`}>{fmtUsd(d.est_value)}
                      {d.currency && d.currency !== 'USD' && d.local_value
                        ? <div className="text-[11px] text-mav-muted">{d.currency} {Number(d.local_value).toLocaleString()}</div> : null}
                    </td>
                    <td className={`${td} text-mav-muted`}>{d.pm_owner || '—'}</td>
                    <td className={`${td} text-mav-muted`}>{d.rfq_status || d.status || 'Open'}</td>
                    <td className={`${td} text-mav-muted`}>{(d.source_date || '').slice(0, 10) || '—'}</td>
                  </tr>
                ))}
                {deals.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-mav-muted">Nothing open with a price on it.</td></tr>}
              </tbody>
            </table>
          </div>
          </Panel>
        </>
      )}
    </div>
  )
}
