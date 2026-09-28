'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard, { type KPITone } from '@/components/KPICard'
import { daysSince, fmtDay, type CardDetails, type DetailCol } from '@/components/CardDetail'
import { KPIRow, FilterBar, Panel, SectionTitle } from '@/components/PageParts'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit } from '@/lib/business-unit'

import ClientLink from '@/components/ClientLink'
import MultiSelect from '@/components/MultiSelect'
import { getProjectLedger, getOpportunities, getOpportunityDepts, type LedgerRow, type Opportunity } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

// Reports — the ledger, pivoted, for somebody who runs the business.
//
// Every other page answers one fixed question. This one asks whatever you point it at,
// and then answers the follow-ups a CEO or a Head of Technology asks next: what is it
// made of, which stack earns it, is it new money or the same clients again, are we
// delivering in the hours we sold, and how concentrated is the risk.
//
// IT RUNS ON THE SAME LINE ITEMS AS EVERYTHING ELSE. Same ledger, same Start Date basis,
// same rule that Awaiting Information is not revenue. A reporting page on a quietly
// different basis would be worse than none — it would give two defensible answers to one
// question, which is exactly how the $21,357/$21,057 split happened.

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (k: string) => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y.slice(2)}` }

const rowDate = (r: LedgerRow) =>
  (r.start_date || '').slice(0, 10) || (r.confirmed_at || '').slice(0, 10) || (r.booking_month || '').slice(0, 10)

// Mirrors counts_as_revenue() in the database. Awaiting Information is a quote, not money.
const isRevenue = (r: LedgerRow) => !/awaiting/i.test(r.delivery_status || '')
const engOf = (r: LedgerRow) => /dedicated/i.test(r.engagement_model || '') ? 'Dedicated' : 'P2P'
const isNew = (r: LedgerRow) => /^new\b/i.test((r.business_type || '').trim()) && !/repeat/i.test(r.business_type || '')

const DEPT_ORDER = ['WEB-US', 'WEB-UK', 'WEB-AU', 'LP', 'HUB', 'AI & Automation']
const deptOf = (s?: string) => {
  const v = (s || '').trim()
  if (/^WEB-?US/i.test(v)) return 'WEB-US'
  if (/^WEB-?UK/i.test(v)) return 'WEB-UK'
  if (/^WEB-?AU/i.test(v)) return 'WEB-AU'
  if (/^LP/i.test(v)) return 'LP'
  if (/^HUB/i.test(v)) return 'HUB'
  if (/AI\s*&?\s*Auto/i.test(v)) return 'AI & Automation'
  return 'Other'
}

const uniq = (xs: (string | undefined)[]) =>
  Array.from(new Set(xs.map(x => (x || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))

// An empty selection means "all" — the same thing the old "All AMs" option meant.
const keeps = (picked: string[], v?: string) => picked.length === 0 || picked.includes((v || '').trim())

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

/** name · bar · money. One component, because six panels here are the same shape. */
const Breakdown = ({ title, note, rows, total, empty = 'Nothing matches those filters.' }:
  { title: string; note?: string; rows: { name: string; usd: number; n?: number }[]; total: number; empty?: string }) => {
  const max = rows.length ? rows[0].usd : 0
  return (
    <Panel title={title} info={note}>
      {rows.length === 0 ? <p className="text-sm text-mav-muted">{empty}</p> : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.name} className="flex items-center gap-3 text-sm">
              <span className="w-32 sm:w-40 shrink-0 truncate" title={r.name}>{r.name}</span>
              <span className="flex-1 h-1.5 rounded-sm bg-mav-dark overflow-hidden min-w-[2rem]">
                <span className="block h-full bg-mav-yellow" style={{ width: `${max > 0 ? (r.usd / max) * 100 : 0}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right text-[11px] text-mav-muted tabular-nums">
                {total > 0 ? Math.round((r.usd / total) * 100) : 0}%
              </span>
              <span className="w-24 shrink-0 text-right font-medium tabular-nums">{fmtUsd(r.usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export default function Reports() {
  const [rowsAll, setRows] = useState<LedgerRow[]>([])
  const [oppsAll, setOpps] = useState<Opportunity[]>([])
  const [oppDepts, setOppDepts] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)

  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source, so every count, total and chart below follows the switch.
  // Opportunities carry no usable department of their own (4 of 960), so they are
  // placed by opportunity_dept_mv — the PM's pod, then the client's booked history,
  // then geo. 957 of 960 resolve.
  const { unit } = useUnit()
  const rows = useMemo(() => rowsAll.filter(r => inUnit(r.service_dept, unit)), [rowsAll, unit])
  const opps = useMemo(() => oppsAll.filter(o => inUnit(oppDepts.get(Number(o.id)), unit)), [oppsAll, oppDepts, unit])

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Every one of these takes more than one answer. "WEB-UK and WEB-US, excluding AU" is a
  // question people were answering by exporting to a spreadsheet; an empty list still
  // means "all", so nothing about the default view changed.
  const [fAm, setFAm] = useState<string[]>([])
  const [fPm, setFPm] = useState<string[]>([])
  const [fEng, setFEng] = useState<string[]>([])
  const [fTech, setFTech] = useState<string[]>([])
  const [fGeo, setFGeo] = useState<string[]>([])
  const [fAgency, setFAgency] = useState<string[]>([])
  const [fDept, setFDept] = useState<string[]>([])

  // The service departments inside the selected unit. The filter offers only these and
  // the department boxes show only these — under LP/HUB, four Web boxes at $0 would read
  // as four departments that earned nothing. A pick from another unit is dropped when
  // the unit changes, or it would silently empty the page.
  const unitDepts = useMemo(() => DEPT_ORDER.filter(d => inUnit(d, unit)), [unit])
  useEffect(() => { setFDept(p => p.filter(d => unitDepts.includes(d))) }, [unitDepts])

  useEffect(() => {
    Promise.all([getProjectLedger(), getOpportunities(), getOpportunityDepts()])
      .then(([l, o, od]) => { setRows(l); setOpps(o); setOppDepts(od) })
      .finally(() => setLoading(false))
  }, [])
  // Opens on the current month. Set after mount, because working out "now" during render
  // makes the static export's prerendered HTML disagree with the browser.
  useEffect(() => { const n = new Date(); setFrom(ymd(monthStart(n))); setTo(ymd(monthEnd(n))) }, [])

  const base = useMemo(() => rows.filter(isRevenue), [rows])

  const months = useMemo(() => uniq(base.map(r => rowDate(r).slice(0, 7))).reverse(), [base])
  const ams = useMemo(() => uniq(base.map(r => r.sales_person)), [base])
  const pms = useMemo(() => uniq(base.map(r => r.pm_owner)), [base])
  const techs = useMemo(() => uniq(base.map(r => r.technology)), [base])
  const geos = useMemo(() => uniq(base.map(r => r.geo)), [base])
  const agencies = useMemo(() => uniq(base.map(r => r.company_name)), [base])

  const shown = useMemo(() => base.filter(r => {
    const d = rowDate(r)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    if (!keeps(fAm, r.sales_person)) return false
    if (!keeps(fPm, r.pm_owner)) return false
    if (fEng.length && !fEng.includes(engOf(r))) return false
    if (!keeps(fTech, r.technology)) return false
    if (!keeps(fGeo, r.geo)) return false
    if (!keeps(fAgency, r.company_name)) return false
    if (fDept.length && !fDept.includes(deptOf(r.service_dept))) return false
    return true
  }), [base, from, to, fAm, fPm, fEng, fTech, fGeo, fAgency, fDept])

  const total = shown.reduce((s, r) => s + (r.amount_usd || 0), 0)

  // The same range one month back, with the end never running past the same date of last
  // month — the rule Business Numbers uses. Held against a finished month instead, a
  // range that includes today reads as a collapse every time until the month is out.
  // Every filter except the dates applies to both sides, or it would not be a comparison.
  const prev = useMemo(() => {
    if (!from || !to) return { usd: 0, from: '', to: '' }
    const shift = (d: string) => {
      const x = new Date(d + 'T00:00:00')
      const day = x.getDate()
      const m = new Date(x.getFullYear(), x.getMonth() - 1, 1)
      // Clamped, so the 31st does not run off the end of a 30-day month.
      return ymd(new Date(m.getFullYear(), m.getMonth(), Math.min(day, monthEnd(m).getDate())))
    }
    const n = new Date()
    const pFrom = shift(from)
    const pTo = [shift(to), shift(ymd(n))].sort()[0]
    const usd = base.filter(r => {
      const d = rowDate(r)
      if (!d || d < pFrom || d > pTo) return false
      if (!keeps(fAm, r.sales_person)) return false
      if (!keeps(fPm, r.pm_owner)) return false
      if (fEng.length && !fEng.includes(engOf(r))) return false
      if (!keeps(fTech, r.technology)) return false
      if (!keeps(fGeo, r.geo)) return false
      if (!keeps(fAgency, r.company_name)) return false
      if (fDept.length && !fDept.includes(deptOf(r.service_dept))) return false
      return true
    }).reduce((s, r) => s + (r.amount_usd || 0), 0)
    return { usd, from: pFrom, to: pTo }
  }, [base, from, to, fAm, fPm, fEng, fTech, fGeo, fAgency, fDept])

  const momPct = prev.usd > 0 ? Math.round(((total - prev.usd) / prev.usd) * 100) : null
  const dayLabel = (d: string) => { const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]}` }
  const pctOf = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0

  /** Sum by any key, biggest first. Every breakdown panel is this. */
  const groupBy = (key: (r: LedgerRow) => string, limit?: number) => {
    const m: Record<string, { name: string; usd: number; n: number }> = {}
    shown.forEach(r => {
      const raw = key(r)
      const k = raw.trim().toLowerCase()
      if (!k) return
      m[k] = m[k] || { name: raw.trim(), usd: 0, n: 0 }
      m[k].usd += r.amount_usd || 0
      m[k].n++
    })
    // A group with no revenue is noise on a revenue page: a 0% bar of zero width,
    // taking a row and saying nothing. Dropped everywhere, not just for people.
    const out = Object.values(m).filter(x => x.usd > 0).sort((a, b) => b.usd - a.usd)
    return limit ? out.slice(0, limit) : out
  }

  const byDept = useMemo(() => {
    const m: Record<string, { usd: number; lines: number; clients: Set<string>; p2p: number; ded: number }> = {}
    shown.forEach(r => {
      const k = deptOf(r.service_dept)
      m[k] = m[k] || { usd: 0, lines: 0, clients: new Set(), p2p: 0, ded: 0 }
      const amt = r.amount_usd || 0
      m[k].usd += amt; m[k].lines++
      if (r.company_name) m[k].clients.add(r.company_name.trim().toLowerCase())
      if (engOf(r) === 'Dedicated') m[k].ded += amt; else m[k].p2p += amt
    })
    return m
  }, [shown])

  const depts = useMemo(() => {
    const list = [...unitDepts]
    if (byDept['Other']) list.push('Other')
    return list.sort((a, b) => (byDept[b]?.usd || 0) - (byDept[a]?.usd || 0))
  }, [byDept, unitDepts])

  const byTech = useMemo(() => groupBy(r => r.technology || '', 10), [shown])
  const byGeo = useMemo(() => groupBy(r => r.geo || ''), [shown])
  const byPm = useMemo(() => groupBy(r => r.pm_owner || ''), [shown])
  const byAm = useMemo(() => groupBy(r => r.sales_person || ''), [shown])
  const byModel = useMemo(() => groupBy(r => r.engagement_model || ''), [shown])
  const byClientType = useMemo(() => groupBy(r => r.client_type || ''), [shown])
  const topAgencies = useMemo(() => groupBy(r => r.company_name || '', 12), [shown])

  // Month by month, always in calendar order — a trend read out of order is not a trend.
  const byMonth = useMemo(() => {
    const m: Record<string, number> = {}
    shown.forEach(r => { const k = rowDate(r).slice(0, 7); if (k) m[k] = (m[k] || 0) + (r.amount_usd || 0) })
    return Object.keys(m).sort().map(k => ({ key: k, usd: m[k] }))
  }, [shown])

  const clients = useMemo(
    () => new Set(shown.map(r => (r.company_name || '').trim().toLowerCase()).filter(Boolean)).size, [shown])
  const dedicated = useMemo(
    () => shown.filter(r => engOf(r) === 'Dedicated').reduce((s, r) => s + (r.amount_usd || 0), 0), [shown])
  const newBiz = useMemo(
    () => shown.filter(isNew).reduce((s, r) => s + (r.amount_usd || 0), 0), [shown])

  // Delivery, for the Head of Technology: did the work fit the hours it was sold on?
  // Only lines carrying BOTH figures count, or a row missing one would read as a 100%
  // over-run. 96% of lines carry both, so this is close to the whole picture.
  const hours = useMemo(() => {
    const withBoth = shown.filter(r => (r.internal_hrs || 0) > 0 && (r.actual_hrs || 0) > 0)
    const planned = withBoth.reduce((s, r) => s + (r.internal_hrs || 0), 0)
    const actual = withBoth.reduce((s, r) => s + (r.actual_hrs || 0), 0)
    const rev = withBoth.reduce((s, r) => s + (r.amount_usd || 0), 0)
    const over = withBoth.filter(r => (r.actual_hrs || 0) > (r.internal_hrs || 0)).length
    return { rows: withBoth, n: withBoth.length, planned, actual, rev, over, coverage: shown.length ? withBoth.length / shown.length : 0 }
  }, [shown])

  // Concentration: how much of this rests on the largest few clients. A CEO risk figure,
  // not a vanity one — 60% in three names is a different business from 60% in thirty.
  const top5Share = useMemo(() => {
    const t = topAgencies.slice(0, 5).reduce((s, a) => s + a.usd, 0)
    return total > 0 ? Math.round((t / total) * 100) : 0
  }, [topAgencies, total])

  // Still-open deals RAISED in the selected window, under the filters that a deal also
  // carries. Technology and engagement are not among them: an open deal has neither
  // recorded, so filtering on those would empty the box for a reason nobody could see.
  //
  // A deal is dated on source_date — when it came in — falling back to confirmed_at.
  const pipeline = useMemo(() => {
    const open = opps.filter(o => {
      if (!/^open$/i.test((o.status || '').trim())) return false
      const d = (o.source_date || o.confirmed_at || '').slice(0, 10)
      if (from && (!d || d < from)) return false
      if (to && (!d || d > to)) return false
      if (!keeps(fAm, o.sales_person)) return false
      if (!keeps(fPm, o.pm_owner)) return false
      if (!keeps(fGeo, o.geo)) return false
      if (!keeps(fAgency, o.company_name)) return false
      if (fDept.length && !fDept.includes(deptOf(o.service_dept))) return false
      return true
    })
    return {
      rows: open,
      usd: open.reduce((s, o) => s + (o.est_value || 0), 0),
      n: open.length,
      unpriced: open.filter(o => !o.est_value).length,
    }
  }, [opps, from, to, fAm, fPm, fGeo, fAgency, fDept])

  // The two named ranges, so the button can show as chosen and so "is this the default"
  // has one definition instead of being re-derived in three places.
  const ranges = useMemo(() => {
    const n = new Date()
    const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    return {
      thisMonth: { from: ymd(monthStart(n)), to: ymd(monthEnd(n)) },
      lastSameDay: {
        from: ymd(monthStart(lm)),
        // Clamped, so the 31st does not run off the end of a 30-day month.
        to: ymd(new Date(lm.getFullYear(), lm.getMonth(), Math.min(n.getDate(), monthEnd(lm).getDate()))),
      },
    }
  }, [])
  const lastSameDayOn = from === ranges.lastSameDay.from && to === ranges.lastSameDay.to
  const datesChanged = !(from === ranges.thisMonth.from && to === ranges.thisMonth.to)

  const anyFilter = [fAm, fPm, fEng, fTech, fGeo, fAgency, fDept].some(x => x.length > 0)
  const reset = () => {
    setFrom(ranges.thisMonth.from); setTo(ranges.thisMonth.to)
    setFAm([]); setFPm([]); setFEng([]); setFTech([]); setFGeo([]); setFAgency([]); setFDept([])
  }
  // The fields reached for less often sit behind "More filters", which opens by itself
  // whenever one of them is set so a narrowed page always shows why.
  const hiddenN = [fAm, fEng, fTech, fGeo, fAgency].filter(x => x.length > 0).length + (lastSameDayOn ? 1 : 0)
  const [moreFilters, setMoreFilters] = useState(false)
  useEffect(() => { if (hiddenN > 0) setMoreFilters(true) }, [hiddenN])

  // The window in words, for the header chip.
  const rangeChip = useMemo(() => {
    if (!from || !to) return undefined
    const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00')
    if (from === ymd(monthStart(f)) && to === ymd(monthEnd(f))) return `${MON[f.getMonth()]} ${f.getFullYear()}`
    return `${dayLabel(from)} – ${dayLabel(to)} ${t.getFullYear()}`
  }, [from, to])

  const monthValue = months.includes((from || '').slice(0, 7)) && from.slice(8) === '01'
    && to === ymd(monthEnd(new Date(from + 'T00:00:00'))) ? from.slice(0, 7) : ''

  // ── Card drill-downs ─────────────────────────────────────────────────────────
  // Every card opens the ledger lines (or deals) its figure is made of, under the same
  // filters, so the panel's total is the card. Lines carry a GEO, so they tab by it —
  // for Web that is the AU / UK / US pods — except where the card is itself a split
  // (Dedicated, New business, a department box), which tabs by that split instead.
  const sumLines = (rs: LedgerRow[]) => fmtUsd(rs.reduce((s, r) => s + (r.amount_usd || 0), 0))
  const lineCols: DetailCol<LedgerRow>[] = [
    { key: 'agency', label: 'Agency', value: r => r.company_name || '—', wide: true, sort: r => r.company_name || '' },
    { key: 'project', label: 'Project', value: r => r.project_name || '—', wide: true, sort: r => r.project_name || '' },
    { key: 'amount', label: 'Amount', value: r => fmtUsd(r.amount_usd || 0), align: 'right', sort: r => r.amount_usd || 0, total: sumLines },
    { key: 'date', label: 'Start date', value: r => fmtDay(rowDate(r)), sort: r => rowDate(r) },
    { key: 'dept', label: 'Service', value: r => deptOf(r.service_dept), sort: r => deptOf(r.service_dept) },
    { key: 'pm', label: 'PM', value: r => r.pm_owner || '—', sort: r => r.pm_owner || '' },
  ]
  const engCol: DetailCol<LedgerRow> = { key: 'eng', label: 'Engagement', value: r => r.engagement_model || engOf(r), sort: r => r.engagement_model || '' }
  const typeCol: DetailCol<LedgerRow> = { key: 'type', label: 'Business type', value: r => r.business_type || '—', sort: r => r.business_type || '' }
  // Swaps the Service column for the one the card is about, keeping it at six columns.
  const withCol = (c: DetailCol<LedgerRow>) => lineCols.map(x => x.key === 'dept' ? c : x)
  const inView = rangeChip ? ` · ${rangeChip}` : ''
  const linesDetails = (over: Partial<CardDetails<LedgerRow>> = {}): CardDetails<LedgerRow> => ({
    subtitle: `Revenue lines under the current filters${inView}`,
    rows: shown,
    groupBy: r => (r.geo || '').trim() || 'No GEO',
    groupTotal: sumLines,
    rowKey: r => r.row_key,
    columns: lineCols,
    defaultSort: 'amount',
    ...over,
  })

  // One row per client, so the Clients count and the Top 5 share have something to list.
  type ClientAgg = { name: string; usd: number; lines: number; dept: string; geo: string }
  const clientRows = useMemo(() => {
    const m = new Map<string, { name: string; usd: number; lines: number; byDept: Record<string, number>; geo: string }>()
    shown.forEach(r => {
      const name = (r.company_name || '').trim()
      const k = name.toLowerCase()
      if (!k) return
      const a = m.get(k) || { name, usd: 0, lines: 0, byDept: {}, geo: '' }
      a.usd += r.amount_usd || 0; a.lines++
      const d = deptOf(r.service_dept); a.byDept[d] = (a.byDept[d] || 0) + (r.amount_usd || 0)
      if (!a.geo && r.geo) a.geo = r.geo.trim()
      m.set(k, a)
    })
    return Array.from(m.values()).map((a): ClientAgg => ({
      name: a.name, usd: a.usd, lines: a.lines, geo: a.geo || 'No GEO',
      dept: Object.entries(a.byDept).sort((x, y) => y[1] - x[1])[0]?.[0] || 'Other',
    }))
  }, [shown])
  const sumClients = (rs: ClientAgg[]) => fmtUsd(rs.reduce((s, c) => s + c.usd, 0))
  const clientCols: DetailCol<ClientAgg>[] = [
    { key: 'agency', label: 'Agency', value: c => c.name, wide: true, sort: c => c.name },
    { key: 'amount', label: 'Revenue', value: c => fmtUsd(c.usd), align: 'right', sort: c => c.usd, total: sumClients },
    { key: 'share', label: 'Share', value: c => `${pctOf(c.usd)}%`, align: 'right', sort: c => c.usd },
    { key: 'lines', label: 'Lines', value: c => c.lines, align: 'right', sort: c => c.lines },
    { key: 'dept', label: 'Main service', value: c => c.dept, sort: c => c.dept },
    { key: 'geo', label: 'GEO', value: c => c.geo, sort: c => c.geo },
  ]
  const clientsDetails: CardDetails<ClientAgg> = {
    subtitle: `Agencies with lines under the current filters${inView}`,
    rows: clientRows, groupBy: c => c.geo, groupTotal: sumClients, rowKey: c => c.name,
    columns: clientCols, defaultSort: 'amount',
  }
  // The same five names the Top agencies panel starts with.
  const top5Rows = useMemo(() => {
    const names = new Set(topAgencies.slice(0, 5).map(a => a.name.trim().toLowerCase()))
    return clientRows.filter(c => names.has(c.name.toLowerCase()))
  }, [topAgencies, clientRows])
  const top5Details: CardDetails<ClientAgg> = {
    subtitle: `The five largest agencies, of ${fmtUsd(total)} in this view${inView}`,
    rows: top5Rows, rowKey: c => c.name, columns: clientCols, defaultSort: 'amount',
  }

  const sumOpps = (rs: Opportunity[]) => fmtUsd(rs.reduce((s, o) => s + (o.est_value || 0), 0))
  const oppDate = (o: Opportunity) => (o.source_date || o.confirmed_at || '').slice(0, 10)
  const pipelineDetails: CardDetails<Opportunity> = {
    subtitle: `Deals raised${inView} and still open`,
    rows: pipeline.rows,
    groupBy: o => (o.geo || '').trim() || 'No GEO',
    groupTotal: sumOpps,
    rowKey: o => o.id,
    columns: [
      { key: 'agency', label: 'Agency', value: o => o.company_name || '—', wide: true, sort: o => o.company_name || '' },
      { key: 'amount', label: 'Value', value: o => o.est_value ? fmtUsd(o.est_value) : 'unpriced', align: 'right', sort: o => o.est_value || 0, total: sumOpps },
      { key: 'date', label: 'Raised', value: o => fmtDay(oppDate(o)), sort: o => oppDate(o) },
      { key: 'age', label: 'Days so far', value: o => daysSince(oppDate(o)) ?? '—', align: 'right', sort: o => daysSince(oppDate(o)) ?? -1 },
      { key: 'pm', label: 'PM', value: o => o.pm_owner || '—', sort: o => o.pm_owner || '' },
      { key: 'am', label: 'Account owner', value: o => o.sales_person || '—', sort: o => o.sales_person || '' },
    ],
    defaultSort: 'amount',
  }

  const hrs = (n: number) => Math.round(n).toLocaleString()
  const hoursDetails: CardDetails<LedgerRow> = {
    subtitle: `Lines carrying both a planned and an actual figure${inView}`,
    rows: hours.rows,
    groupBy: r => (r.actual_hrs || 0) > (r.internal_hrs || 0) ? 'Ran over' : 'Within hours',
    rowKey: r => r.row_key,
    columns: [
      { key: 'agency', label: 'Agency', value: r => r.company_name || '—', wide: true, sort: r => r.company_name || '' },
      { key: 'project', label: 'Project', value: r => r.project_name || '—', wide: true, sort: r => r.project_name || '' },
      { key: 'planned', label: 'Planned', value: r => hrs(r.internal_hrs || 0), align: 'right', sort: r => r.internal_hrs || 0,
        total: rs => hrs(rs.reduce((s, r) => s + (r.internal_hrs || 0), 0)) },
      { key: 'actual', label: 'Actual', value: r => hrs(r.actual_hrs || 0), align: 'right', sort: r => r.actual_hrs || 0,
        total: rs => hrs(rs.reduce((s, r) => s + (r.actual_hrs || 0), 0)) },
      { key: 'over', label: 'Over / under', align: 'right',
        value: r => { const p = r.internal_hrs ? Math.round(((r.actual_hrs || 0) / r.internal_hrs - 1) * 100) : 0; return `${p > 0 ? '+' : ''}${p}%` },
        sort: r => r.internal_hrs ? (r.actual_hrs || 0) / r.internal_hrs : 0 },
      { key: 'pm', label: 'PM', value: r => r.pm_owner || '—', sort: r => r.pm_owner || '' },
    ],
    defaultSort: 'over',
  }

  const deptRows = useMemo(() => {
    const m: Record<string, LedgerRow[]> = {}
    shown.forEach(r => { const k = deptOf(r.service_dept); (m[k] = m[k] || []).push(r) })
    return m
  }, [shown])

  const hoursPct = hours.planned ? Math.round((hours.actual / hours.planned - 1) * 100) : 0
  const label = 'font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted'

  return (
    <div>
      <Header title="KB report" chip={rangeChip}
        subtitle={<>
          The whole business through one set of filters — what the revenue is made of, which stack earns it, and
          whether it was delivered in the hours it was sold on.
          <br /><br />
          Dated on <b>Start Date</b>, the same basis as Business Numbers and the Business Overview sheet. Awaiting
          Information is excluded, as everywhere else. Open pipeline counts deals <b>raised</b> in this window that are
          still open, so a past month shows what was opened then and has not closed since &mdash; not today&rsquo;s
          whole pipeline.
        </>} />

      {/* The eight figures a leader checks before asking anything else. */}
      {loading ? <p className="text-sm text-mav-muted mb-5">Loading…</p> : (
        <KPIRow cols={4}>
          <KPICard tone="accent" label="Revenue" value={fmtUsd(total)}
            sub={prev.from
              ? `${shown.length.toLocaleString()} lines · ${fmtUsd(prev.usd)} in ${dayLabel(prev.from)}–${dayLabel(prev.to)}${momPct === null ? '' : ` (${momPct > 0 ? '+' : ''}${momPct}%)`}`
              : `${shown.length.toLocaleString()} project lines`}
            info="The comparison is the same range one month back, stopped on today's date last month, under every filter except the dates."
            details={linesDetails()} />
          <KPICard label="Clients" value={String(clients)} sub={clients ? `${fmtUsd(Math.round(total / clients))} average each` : undefined}
            details={clientsDetails} />
          <KPICard label="Average project" value={shown.length ? fmtUsd(Math.round(total / shown.length)) : '—'}
            sub={`largest ${topAgencies.length ? fmtUsd(Math.max(...shown.map(r => r.amount_usd || 0))) : '—'}`}
            details={linesDetails({ subtitle: `The ${shown.length.toLocaleString()} lines the average is taken over${inView}` })} />
          <KPICard label="Dedicated" value={`${pctOf(dedicated)}%`} sub={`${fmtUsd(dedicated)} committed · ${fmtUsd(total - dedicated)} won project by project`}
            details={linesDetails({ subtitle: `Every line, split Dedicated against P2P${inView}`, groupBy: engOf, columns: withCol(engCol) })} />
          <KPICard label="New business" value={`${pctOf(newBiz)}%`} sub={`${fmtUsd(newBiz)} new · ${fmtUsd(total - newBiz)} repeat`}
            details={linesDetails({ subtitle: `Every line, split new against repeat${inView}`, groupBy: r => isNew(r) ? 'New' : 'Repeat', columns: withCol(typeCol) })} />
          <KPICard tone="yellow" label="Top 5 clients" value={`${top5Share}%`} sub="of revenue in this view"
            info="Concentration risk: how much of this view rests on the five largest clients. 60% in three names is a different business from 60% in thirty."
            details={top5Details} />
          <KPICard tone="amber" label="Open pipeline" value={fmtUsd(pipeline.usd)}
            sub={`${pipeline.n} deal${pipeline.n === 1 ? '' : 's'} raised in this window, still open${pipeline.unpriced ? ` · ${pipeline.unpriced} unpriced` : ''}`}
            info="Technology and engagement filters do not apply: an open deal has neither recorded."
            details={pipelineDetails} />
          <KPICard label="Hours delivered"
            tone={hours.planned && hours.actual > hours.planned ? 'red' : hours.planned ? 'green' : 'default'}
            value={hours.planned ? `${hoursPct > 0 ? '+' : ''}${hoursPct}%` : '—'}
            sub={hours.planned ? `${Math.round(hours.actual).toLocaleString()} actual vs ${Math.round(hours.planned).toLocaleString()} planned` : 'no hours recorded'}
            info="Only lines carrying BOTH a planned and an actual figure count, or a row missing one would read as a 100% over-run."
            details={hours.n ? hoursDetails : undefined} />
        </KPIRow>
      )}

      {/* Every filter in one box: the window first, then the fields, then the quick range. */}
      <FilterBar right={
        // Shown whenever ANYTHING is off default, dates included. It used to appear only
        // for the dropdowns, so picking a range left no way back but a page reload.
        (anyFilter || datesChanged) && (
          <button onClick={reset} className="rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 px-3 py-1.5 text-xs">
            ✕ Clear all
          </button>
        )}>
        {/* A month is the unit people ask in, and typing two dates to get one is work. */}
        <select value={monthValue} onChange={e => {
          if (!e.target.value) return
          const d = new Date(e.target.value + '-01T00:00:00')
          setFrom(ymd(monthStart(d))); setTo(ymd(monthEnd(d)))
        }} className={`${sel} w-40`} aria-label="Start date month">
          <option value="">Month…</option>
          {months.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
        </select>

        <span className={label}>Start date</span>
        <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={`${sel} [color-scheme:dark]`} />
        <span className={label}>to</span>
        <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={`${sel} [color-scheme:dark]`} />

        <MultiSelect label="All services" options={unitDepts} selected={fDept} onChange={setFDept} className="w-40" />
        <MultiSelect label="All PMs" options={pms} selected={fPm} onChange={setFPm} className="w-40" />
        <button onClick={() => setMoreFilters(v => !v)} aria-expanded={moreFilters}
          className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">
          {moreFilters ? 'Fewer filters' : 'More filters'}{hiddenN > 0 ? ` (${hiddenN})` : ''}
        </button>
        {moreFilters && <>
          <div className="basis-full h-0" />
          {/* The range people ask for most after "this month": the month before, stopped on
              today's date, so the two are the same number of days. It toggles — clicking it
              again goes back to this month, so it is never a one-way door. */}
          <button onClick={() => {
            const r = lastSameDayOn ? ranges.thisMonth : ranges.lastSameDay
            setFrom(r.from); setTo(r.to)
          }} className={`text-xs px-3 py-2 rounded-md border transition-colors ${lastSameDayOn
            ? 'bg-mav-yellow/20 text-mav-yellow border-mav-yellow/50 font-medium'
            : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
            Last month, same day
          </button>
          <MultiSelect label="All AMs" options={ams} selected={fAm} onChange={setFAm} className="w-40" />
          <MultiSelect label="P2P &amp; Dedicated" options={['Dedicated', 'P2P']} selected={fEng} onChange={setFEng} className="w-40" />
          <MultiSelect label="All technologies" options={techs} selected={fTech} onChange={setFTech} className="w-40" />
          <MultiSelect label="All geos" options={geos} selected={fGeo} onChange={setFGeo} className="w-40" />
          <MultiSelect label="All agencies" options={agencies} selected={fAgency} onChange={setFAgency} className="w-40" />
        </>}
      </FilterBar>

      {!loading && (
        <>
          {/* A box per service department. Equal size on purpose: the eye should compare
              the figures, and a box cannot carry relative size without lying about area,
              so the bar underneath does that job. */}
          <SectionTitle
            // The split bar on each box is unlabelled otherwise, and a colour nobody
            // explained is a colour nobody reads.
            right={<span className="text-xs text-mav-muted">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-mav-yellow mr-1 align-middle" />Dedicated
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-mav-fg/25 ml-3 mr-1 align-middle" />P2P
            </span>}>
            By service department
          </SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {depts.map((d, i) => {
              const v = byDept[d] || { usd: 0, lines: 0, clients: new Set<string>(), p2p: 0, ded: 0 }
              const tone: KPITone = i === 0 ? 'accent' : 'default'
              return (
                <KPICard key={d} tone={tone} label={d} value={fmtUsd(v.usd)}
                  sub={<>
                    <span className="block text-[11px]">
                      {v.lines} line{v.lines === 1 ? '' : 's'} · {v.clients.size} client{v.clients.size === 1 ? '' : 's'} · {pctOf(v.usd)}% of total
                    </span>
                    <span className="mt-3 h-1.5 rounded-sm bg-mav-dark overflow-hidden flex">
                      <span className="h-full bg-mav-yellow" style={{ width: `${v.usd > 0 ? (v.ded / v.usd) * 100 : 0}%` }} title={`Dedicated ${fmtUsd(v.ded)}`} />
                      <span className="h-full bg-mav-fg/25" style={{ width: `${v.usd > 0 ? (v.p2p / v.usd) * 100 : 0}%` }} title={`P2P ${fmtUsd(v.p2p)}`} />
                    </span>
                    <span className="mt-1.5 flex justify-between text-[11px] tabular-nums">
                      <span><span className="inline-block w-2 h-2 rounded-sm bg-mav-yellow mr-1" />{fmtUsd(v.ded)}</span>
                      <span><span className="inline-block w-2 h-2 rounded-sm bg-mav-fg/25 mr-1" />{fmtUsd(v.p2p)}</span>
                    </span>
                  </>}
                  details={linesDetails({
                    subtitle: `${d} lines under the current filters${inView}`,
                    rows: deptRows[d] || [], groupBy: engOf, columns: withCol(engCol),
                  })} />
              )
            })}
          </div>

          {/* Month by month, inside whatever is filtered. */}
          {byMonth.length > 1 && (
            <Panel className="mb-6" title="Month by month" info="Start-date month, inside the current filters.">
              <div className="flex items-end gap-2 h-40">
                {byMonth.map(m => {
                  const max = Math.max(...byMonth.map(x => x.usd), 1)
                  return (
                    <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                      <span className="text-[10px] text-mav-muted tabular-nums whitespace-nowrap">{fmtUsd(m.usd)}</span>
                      <div className="w-full bg-mav-yellow rounded-t" style={{ height: `${(m.usd / max) * 100}%`, minHeight: m.usd > 0 ? 2 : 0 }} />
                      <span className="text-[10px] text-mav-muted whitespace-nowrap">{monLabel(m.key)}</span>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <Breakdown title="By technology" note="What the stack actually earns — the Head of Technology's version of the revenue question. Top 10." rows={byTech} total={total} />
            <Breakdown title="By geo" rows={byGeo} total={total} />
            <Breakdown title="By engagement model" note="The raw sheet values behind the Dedicated / P2P split above." rows={byModel} total={total} />
            <Breakdown title="Agency or direct" note="Who we contract with, not who the end client is." rows={byClientType} total={total} />
            <Breakdown title="By project manager" note="Revenue on lines they own. Everyone with revenue in this view." rows={byPm} total={total} />
            <Breakdown title="By account owner" note="Revenue on accounts they hold — account managers and the NBD team together. Everyone with revenue in this view." rows={byAm} total={total} />
          </div>

          <Panel title="Top agencies" info="Under the filters above. Click one to open it in Client 360."
            right={<span className="text-xs text-mav-muted">the top five are {top5Share}% of this view</span>}>
            {topAgencies.length === 0 ? <p className="text-sm text-mav-muted">Nothing matches those filters.</p> : (
              <ul className="space-y-2">
                {topAgencies.map((a, i) => (
                  <li key={a.name} className="flex items-center gap-3 text-sm">
                    <span className="text-mav-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <ClientLink name={a.name} className="truncate w-40 sm:w-56 shrink-0" />
                    <span className="flex-1 h-1.5 rounded-sm bg-mav-dark overflow-hidden min-w-[2rem]">
                      <span className="block h-full bg-mav-yellow" style={{ width: `${topAgencies[0].usd > 0 ? (a.usd / topAgencies[0].usd) * 100 : 0}%` }} />
                    </span>
                    <span className="w-12 shrink-0 text-right text-[11px] text-mav-muted tabular-nums">{pctOf(a.usd)}%</span>
                    <span className="w-24 shrink-0 text-right font-medium tabular-nums">{fmtUsd(a.usd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {hours.n > 0 && (
            <p className="text-xs text-mav-muted mt-4 max-w-4xl">
              <span className="text-mav-fg">Hours</span> cover {Math.round(hours.coverage * 100)}% of the lines in this
              view &mdash; {hours.n} of {shown.length} carry both a planned and an actual figure, and only those are
              counted. {hours.over} of them ran over. Revenue per actual hour is{' '}
              <span className="text-mav-fg">{hours.actual > 0 ? fmtUsd(Math.round(hours.rev / hours.actual)) : '—'}</span>.
            </p>
          )}
        </>
      )}
    </div>
  )
}
