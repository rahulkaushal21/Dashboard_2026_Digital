'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import ClientLink from '@/components/ClientLink'
import { getProjectLedger, getOpportunities, type LedgerRow, type Opportunity } from '@/lib/supabase'
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

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

/** A headline figure. Square, equal, and never carrying magnitude in its size. */
const Box = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl p-4 border-t-2" style={{ borderTopColor: 'var(--section)' }}>
    <div className="text-[11px] uppercase tracking-wide text-mav-muted truncate" title={label}>{label}</div>
    <div className={`text-2xl font-semibold mt-1.5 tabular-nums ${tone || ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-mav-muted mt-1 leading-snug">{sub}</div>}
  </div>
)

/** name · bar · money. One component, because six panels here are the same shape. */
const Breakdown = ({ title, note, rows, total, empty = 'Nothing matches those filters.' }:
  { title: string; note?: string; rows: { name: string; usd: number; n?: number }[]; total: number; empty?: string }) => {
  const max = rows.length ? rows[0].usd : 0
  return (
    <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
      <div className="text-sm font-medium mb-1">{title}</div>
      {note && <p className="text-xs text-mav-muted mb-4">{note}</p>}
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
    </div>
  )
}

export default function Reports() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [fAm, setFAm] = useState('')
  const [fPm, setFPm] = useState('')
  const [fEng, setFEng] = useState('')
  const [fTech, setFTech] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [fAgency, setFAgency] = useState('')
  const [fDept, setFDept] = useState('')

  useEffect(() => {
    Promise.all([getProjectLedger(), getOpportunities()])
      .then(([l, o]) => { setRows(l); setOpps(o) })
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
    if (fAm && (r.sales_person || '') !== fAm) return false
    if (fPm && (r.pm_owner || '') !== fPm) return false
    if (fEng && engOf(r) !== fEng) return false
    if (fTech && (r.technology || '') !== fTech) return false
    if (fGeo && (r.geo || '') !== fGeo) return false
    if (fAgency && (r.company_name || '') !== fAgency) return false
    if (fDept && deptOf(r.service_dept) !== fDept) return false
    return true
  }), [base, from, to, fAm, fPm, fEng, fTech, fGeo, fAgency, fDept])

  const total = shown.reduce((s, r) => s + (r.amount_usd || 0), 0)
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
    const out = Object.values(m).sort((a, b) => b.usd - a.usd)
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
    const list = [...DEPT_ORDER]
    if (byDept['Other']) list.push('Other')
    return list.sort((a, b) => (byDept[b]?.usd || 0) - (byDept[a]?.usd || 0))
  }, [byDept])

  const byTech = useMemo(() => groupBy(r => r.technology || '', 10), [shown])
  const byGeo = useMemo(() => groupBy(r => r.geo || ''), [shown])
  const byPm = useMemo(() => groupBy(r => r.pm_owner || '', 10), [shown])
  const byAm = useMemo(() => groupBy(r => r.sales_person || '', 10), [shown])
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
    return { n: withBoth.length, planned, actual, rev, over, coverage: shown.length ? withBoth.length / shown.length : 0 }
  }, [shown])

  // Concentration: how much of this rests on the largest few clients. A CEO risk figure,
  // not a vanity one — 60% in three names is a different business from 60% in thirty.
  const top5Share = useMemo(() => {
    const t = topAgencies.slice(0, 5).reduce((s, a) => s + a.usd, 0)
    return total > 0 ? Math.round((t / total) * 100) : 0
  }, [topAgencies, total])

  // Forward view. Open deals are NOT filtered by the date range — a range of past months
  // would show an empty pipeline, which is the opposite of the truth.
  const pipeline = useMemo(() => {
    const open = opps.filter(o => /^open$/i.test((o.status || '').trim()))
    return {
      usd: open.reduce((s, o) => s + (o.est_value || 0), 0),
      n: open.length,
      unpriced: open.filter(o => !o.est_value).length,
    }
  }, [opps])

  const anyFilter = !!(fAm || fPm || fEng || fTech || fGeo || fAgency || fDept)
  const reset = () => {
    const n = new Date()
    setFrom(ymd(monthStart(n))); setTo(ymd(monthEnd(n)))
    setFAm(''); setFPm(''); setFEng(''); setFTech(''); setFGeo(''); setFAgency(''); setFDept('')
  }

  const monthValue = months.includes((from || '').slice(0, 7)) && from.slice(8) === '01'
    && to === ymd(monthEnd(new Date(from + 'T00:00:00'))) ? from.slice(0, 7) : ''

  return (
    <div>
      <Header title="Reports"
        subtitle="The whole business through one set of filters — what the revenue is made of, which stack earns it, and whether it was delivered in the hours it was sold on." />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">Start date</span>
        <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={`${sel} [color-scheme:dark]`} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={`${sel} [color-scheme:dark]`} />

        {/* A month is the unit people ask in, and typing two dates to get one is work. */}
        <select value={monthValue} onChange={e => {
          if (!e.target.value) return
          const d = new Date(e.target.value + '-01T00:00:00')
          setFrom(ymd(monthStart(d))); setTo(ymd(monthEnd(d)))
        }} className={sel} aria-label="Start date month">
          <option value="">Month…</option>
          {months.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
        </select>

        <select value={fDept} onChange={e => setFDept(e.target.value)} className={sel} aria-label="Service department">
          <option value="">All services</option>
          {DEPT_ORDER.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fAm} onChange={e => setFAm(e.target.value)} className={sel} aria-label="Account manager">
          <option value="">All AMs</option>{ams.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fPm} onChange={e => setFPm(e.target.value)} className={sel} aria-label="Project manager">
          <option value="">All PMs</option>{pms.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fEng} onChange={e => setFEng(e.target.value)} className={sel} aria-label="Engagement">
          <option value="">P2P &amp; Dedicated</option>
          <option value="Dedicated">Dedicated only</option>
          <option value="P2P">P2P only</option>
        </select>
        <select value={fTech} onChange={e => setFTech(e.target.value)} className={sel} aria-label="Technology">
          <option value="">All technologies</option>{techs.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={sel} aria-label="Geo">
          <option value="">All geos</option>{geos.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fAgency} onChange={e => setFAgency(e.target.value)} className={`${sel} max-w-[13rem]`} aria-label="Agency">
          <option value="">All agencies</option>{agencies.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {anyFilter && <button onClick={reset} className="text-xs px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg transition-colors">Reset</button>}
      </div>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p> : (
        <>
          <p className="text-xs text-mav-muted mb-4 max-w-4xl">
            Dated on <span className="text-mav-fg">Start Date</span>, the same basis as Business Numbers and the
            Business Overview sheet. Awaiting Information is excluded, as everywhere else. Open pipeline ignores the
            date range on purpose &mdash; a past month would otherwise show no pipeline at all.
          </p>

          {/* The eight figures a leader checks before asking anything else. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Box label="Revenue" value={fmtUsd(total)} sub={`${shown.length.toLocaleString()} project lines`} />
            <Box label="Clients" value={String(clients)} sub={clients ? `${fmtUsd(Math.round(total / clients))} average each` : undefined} />
            <Box label="Average project" value={shown.length ? fmtUsd(Math.round(total / shown.length)) : '—'}
              sub={`largest ${topAgencies.length ? fmtUsd(Math.max(...shown.map(r => r.amount_usd || 0))) : '—'}`} />
            <Box label="Dedicated" value={`${pctOf(dedicated)}%`} sub={`${fmtUsd(dedicated)} committed · ${fmtUsd(total - dedicated)} won project by project`} />
            <Box label="New business" value={`${pctOf(newBiz)}%`} sub={`${fmtUsd(newBiz)} new · ${fmtUsd(total - newBiz)} repeat`} />
            <Box label="Top 5 clients" value={`${top5Share}%`} sub="of revenue in this view — concentration risk" />
            <Box label="Open pipeline" value={fmtUsd(pipeline.usd)}
              sub={`${pipeline.n} deals${pipeline.unpriced ? ` · ${pipeline.unpriced} unpriced` : ''} · all dates`} />
            <Box label="Hours delivered" value={hours.planned ? `${Math.round((hours.actual / hours.planned - 1) * 100) > 0 ? '+' : ''}${Math.round((hours.actual / hours.planned - 1) * 100)}%` : '—'}
              tone={hours.planned && hours.actual > hours.planned ? 'text-red-400' : hours.planned ? 'text-green-400' : ''}
              sub={hours.planned ? `${Math.round(hours.actual).toLocaleString()} actual vs ${Math.round(hours.planned).toLocaleString()} planned` : 'no hours recorded'} />
          </div>

          {/* A box per service department. Equal size on purpose: the eye should compare
              the figures, and a box cannot carry relative size without lying about area,
              so the bar underneath does that job. */}
          <div className="text-sm font-medium mb-3">By service department</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {depts.map(d => {
              const v = byDept[d] || { usd: 0, lines: 0, clients: new Set<string>(), p2p: 0, ded: 0 }
              return (
                <div key={d} className="bg-mav-panel border border-mav-line rounded-xl p-4 border-t-2 flex flex-col"
                  style={{ borderTopColor: 'var(--section)' }}>
                  <div className="text-xs uppercase tracking-wide text-mav-muted truncate" title={d}>{d}</div>
                  <div className="text-2xl font-semibold mt-2 tabular-nums">{fmtUsd(v.usd)}</div>
                  <div className="text-[11px] text-mav-muted mt-1">
                    {v.lines} line{v.lines === 1 ? '' : 's'} · {v.clients.size} client{v.clients.size === 1 ? '' : 's'} · {pctOf(v.usd)}% of total
                  </div>
                  <div className="mt-3 h-1.5 rounded-sm bg-mav-dark overflow-hidden flex">
                    <div className="h-full bg-mav-yellow" style={{ width: `${v.usd > 0 ? (v.ded / v.usd) * 100 : 0}%` }} title={`Dedicated ${fmtUsd(v.ded)}`} />
                    <div className="h-full bg-mav-fg/25" style={{ width: `${v.usd > 0 ? (v.p2p / v.usd) * 100 : 0}%` }} title={`P2P ${fmtUsd(v.p2p)}`} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-mav-muted tabular-nums">
                    <span><span className="inline-block w-2 h-2 rounded-sm bg-mav-yellow mr-1" />{fmtUsd(v.ded)}</span>
                    <span><span className="inline-block w-2 h-2 rounded-sm bg-mav-fg/25 mr-1" />{fmtUsd(v.p2p)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Month by month, inside whatever is filtered. */}
          {byMonth.length > 1 && (
            <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
              <div className="text-sm font-medium mb-1">Month by month</div>
              <p className="text-xs text-mav-muted mb-4">Start-date month, inside the current filters.</p>
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
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <Breakdown title="By technology" note="What the stack actually earns — the Head of Technology's version of the revenue question. Top 10." rows={byTech} total={total} />
            <Breakdown title="By geo" rows={byGeo} total={total} />
            <Breakdown title="By engagement model" note="The raw sheet values behind the Dedicated / P2P split above." rows={byModel} total={total} />
            <Breakdown title="Agency or direct" note="Who we contract with, not who the end client is." rows={byClientType} total={total} />
            <Breakdown title="By project manager" note="Revenue on lines they own. Top 10." rows={byPm} total={total} />
            <Breakdown title="By account manager" note="Revenue on accounts they hold. Top 10." rows={byAm} total={total} />
          </div>

          <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
            <div className="text-sm font-medium mb-1">Top agencies</div>
            <p className="text-xs text-mav-muted mb-4">
              Under the filters above &mdash; the top five are {top5Share}% of this view. Click one to open it in Client 360.
            </p>
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
          </div>

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
