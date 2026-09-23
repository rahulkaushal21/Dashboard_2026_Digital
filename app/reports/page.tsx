'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import ClientLink from '@/components/ClientLink'
import { getProjectLedger, type LedgerRow } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

// Reports — the ledger, pivoted.
//
// Every other page answers one fixed question: Business Numbers asks "how is each service
// doing this month", the Dashboard asks "how are we doing". This one asks whatever you
// point it at — one AM's dedicated work in Shopify across the last quarter, or one
// agency's whole history by geo. The filters compose, and every box below re-reads them.
//
// IT RUNS ON THE SAME LINE ITEMS AS EVERYTHING ELSE. Same ledger, same Start Date basis,
// same rule that Awaiting Information is not revenue. A reporting page that quietly used
// a different basis would be worse than no reporting page — it would give two defensible
// answers to one question, which is how the $21,357/$21,057 split happened.

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monLabel = (k: string) => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y}` }

// Start Date, falling back the same way the Project sheet falls back, so a line sits in
// the same month wherever you look at it.
const rowDate = (r: LedgerRow) =>
  (r.start_date || '').slice(0, 10) || (r.confirmed_at || '').slice(0, 10) || (r.booking_month || '').slice(0, 10)

// Mirrors counts_as_revenue() in the database. Awaiting Information is a quote, not money.
const isRevenue = (r: LedgerRow) => !/awaiting/i.test(r.delivery_status || '')

// Dedicated against pay-per-project. There is no 'P2P' value in the data — it is
// everything that is not a retainer — so the test matches on 'dedicated' and anything new
// lands in P2P by default. Partial Dedicated counts as Dedicated.
const engOf = (r: LedgerRow) => /dedicated/i.test(r.engagement_model || '') ? 'Dedicated' : 'P2P'

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

export default function Reports() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [fAm, setFAm] = useState('')
  const [fPm, setFPm] = useState('')
  const [fEng, setFEng] = useState('')
  const [fTech, setFTech] = useState('')
  const [fGeo, setFGeo] = useState('')
  const [fAgency, setFAgency] = useState('')

  useEffect(() => { getProjectLedger().then(r => { setRows(r); setLoading(false) }) }, [])
  // Opens on the current month. Set after mount, because working out "now" during render
  // makes the static export's prerendered HTML disagree with the browser.
  useEffect(() => { const n = new Date(); setFrom(ymd(monthStart(n))); setTo(ymd(monthEnd(n))) }, [])

  // Only revenue-bearing lines ever reach the filters, so every dropdown lists what can
  // actually appear in a box below it.
  const base = useMemo(() => rows.filter(isRevenue), [rows])

  const months = useMemo(
    () => uniq(base.map(r => rowDate(r).slice(0, 7))).reverse(), [base])
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
    return true
  }), [base, from, to, fAm, fPm, fEng, fTech, fGeo, fAgency])

  // One pass, every box.
  const byDept = useMemo(() => {
    const m: Record<string, { usd: number; lines: number; clients: Set<string>; p2p: number; ded: number }> = {}
    shown.forEach(r => {
      const k = deptOf(r.service_dept)
      m[k] = m[k] || { usd: 0, lines: 0, clients: new Set(), p2p: 0, ded: 0 }
      const amt = r.amount_usd || 0
      m[k].usd += amt
      m[k].lines++
      if (r.company_name) m[k].clients.add(r.company_name.trim().toLowerCase())
      if (engOf(r) === 'Dedicated') m[k].ded += amt; else m[k].p2p += amt
    })
    return m
  }, [shown])

  const depts = useMemo(() => {
    const list = [...DEPT_ORDER]
    if (byDept['Other']) list.push('Other')
    // Biggest first, but a department with nothing still shows — an absent box reads as
    // "I forgot to include it", a zero reads as "nothing happened", and they differ.
    return list.sort((a, b) => (byDept[b]?.usd || 0) - (byDept[a]?.usd || 0))
  }, [byDept])

  const total = shown.reduce((s, r) => s + (r.amount_usd || 0), 0)
  const totalClients = new Set(shown.map(r => (r.company_name || '').trim().toLowerCase()).filter(Boolean)).size
  const totalDed = shown.filter(r => engOf(r) === 'Dedicated').reduce((s, r) => s + (r.amount_usd || 0), 0)

  const anyFilter = !!(fAm || fPm || fEng || fTech || fGeo || fAgency)
  const reset = () => {
    const n = new Date()
    setFrom(ymd(monthStart(n))); setTo(ymd(monthEnd(n)))
    setFAm(''); setFPm(''); setFEng(''); setFTech(''); setFGeo(''); setFAgency('')
  }

  // Top agencies under whatever is filtered — the question "who is that made of" follows
  // every one of these numbers, and without it the page can only ever show a total.
  const topAgencies = useMemo(() => {
    const m: Record<string, { name: string; usd: number }> = {}
    shown.forEach(r => {
      const k = (r.company_name || '').trim().toLowerCase()
      if (!k) return
      m[k] = m[k] || { name: (r.company_name || '').trim(), usd: 0 }
      m[k].usd += r.amount_usd || 0
    })
    return Object.values(m).sort((a, b) => b.usd - a.usd).slice(0, 12)
  }, [shown])

  const pctOf = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0

  return (
    <div>
      <Header title="Reports"
        subtitle="The ledger, pivoted. Filter it however you need — every box below reads the same lines." />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-mav-muted">Start date</span>
        <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={`${sel} [color-scheme:dark]`} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={`${sel} [color-scheme:dark]`} />

        {/* A month is the unit people ask in, and typing two dates to get one is work. */}
        <select value={months.includes((from || '').slice(0, 7)) && from.slice(8) === '01' && to === ymd(monthEnd(new Date(from + 'T00:00:00'))) ? from.slice(0, 7) : ''}
          onChange={e => {
            if (!e.target.value) return
            const d = new Date(e.target.value + '-01T00:00:00')
            setFrom(ymd(monthStart(d))); setTo(ymd(monthEnd(d)))
          }} className={sel} aria-label="Start date month">
          <option value="">Month…</option>
          {months.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
        </select>

        <select value={fAm} onChange={e => setFAm(e.target.value)} className={sel} aria-label="Account manager">
          <option value="">All AMs</option>
          {ams.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fPm} onChange={e => setFPm(e.target.value)} className={sel} aria-label="Project manager">
          <option value="">All PMs</option>
          {pms.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fEng} onChange={e => setFEng(e.target.value)} className={sel} aria-label="Engagement">
          <option value="">P2P &amp; Dedicated</option>
          <option value="Dedicated">Dedicated only</option>
          <option value="P2P">P2P only</option>
        </select>
        <select value={fTech} onChange={e => setFTech(e.target.value)} className={sel} aria-label="Technology">
          <option value="">All technologies</option>
          {techs.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={sel} aria-label="Geo">
          <option value="">All geos</option>
          {geos.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fAgency} onChange={e => setFAgency(e.target.value)} className={`${sel} max-w-[14rem]`} aria-label="Agency">
          <option value="">All agencies</option>
          {agencies.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {anyFilter && <button onClick={reset} className="text-xs px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg transition-colors">Reset</button>}
      </div>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p> : (
        <>
          <div className="text-sm text-mav-muted mb-5">
            <span className="text-mav-fg font-medium">{fmtUsd(total)}</span> · {shown.length.toLocaleString()} line{shown.length === 1 ? '' : 's'} · {totalClients} client{totalClients === 1 ? '' : 's'}
            {total > 0 && <> · {pctOf(totalDed)}% dedicated</>}
            <span className="ml-2 text-mav-muted/80">Dated on Start Date. Awaiting Information is excluded, as everywhere else.</span>
          </div>

          {/* A box per service department. Square-ish and equal, so the eye compares the
              figures rather than the shapes — the bar underneath carries the relative
              size, which a box cannot do without lying about area. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-3 mb-8">
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

          <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
            <div className="text-sm font-medium mb-1">Top agencies</div>
            <p className="text-xs text-mav-muted mb-4">Under the filters above. Click one to open it in Client 360.</p>
            {topAgencies.length === 0 ? (
              <p className="text-sm text-mav-muted">Nothing matches those filters.</p>
            ) : (
              <ul className="space-y-2">
                {topAgencies.map((a, i) => (
                  <li key={a.name} className="flex items-center gap-3 text-sm">
                    <span className="text-mav-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <ClientLink name={a.name} className="truncate" />
                    <span className="flex-1 h-1.5 rounded-sm bg-mav-dark overflow-hidden mx-2 min-w-[2rem]">
                      <span className="block h-full bg-mav-yellow" style={{ width: `${topAgencies[0].usd > 0 ? (a.usd / topAgencies[0].usd) * 100 : 0}%` }} />
                    </span>
                    <span className="font-medium tabular-nums shrink-0">{fmtUsd(a.usd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
