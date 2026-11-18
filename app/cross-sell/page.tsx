'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { KPIRow, Segments, Panel, FilterBar } from '@/components/PageParts'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit } from '@/lib/business-unit'
import { getCrossSells, type CrossSell } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

// Cross Sell — business a PM opened from their own mailbox.
//
// Its own page rather than a panel on Business Numbers, because the two are read for
// different reasons. Business Numbers answers "how did the month go"; this answers "who
// is selling", and it is the page the cross-sell tracker is filled from — a job that
// wants the whole list in front of you, not a block you scroll past on the way to the
// pipeline.
//
// WHAT COUNTS. A mail a PM sent first, to a client who had not asked, that a booked line
// can be traced to. The attribution is hand-written in the cross_sells table, not derived:
// no column anywhere says "a PM sold this", and a join on "mailed, then bought something"
// credits a campaign with every retainer that was already running. See migration 176.
//
// THE COLUMNS ARE THE TRACKER'S COLUMNS, in the tracker's order, so a copy lands in A-K
// with nothing to rearrange. Table, clipboard and CSV all read XSELL_COLS, so what is on
// screen is exactly what gets pasted — and the FILTERS narrow all three together, so a
// filtered view copies the filtered rows and nothing else.

const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 1st, 2nd, 3rd, 4th … 21st. The teens are all "th", which is what the 11-13 case is for. */
const ord = (n: number) => {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}

/** 2026-10-01 → "1st Oct 2026". The format the tracker is kept in. */
const pretty = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${ord(+m[3])} ${MON[+m[2] - 1]} ${m[1]}` : ''
}
const monLabel = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})/.exec(v || '')
  return m ? `${MON[+m[2] - 1]} ${m[1]}` : '—'
}

/** The financial year runs April to March, so April decides which year you are in. */
const fyStart = (d: Date) => new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1)

const RANGES = (n: Date) => [
  { key: 'm', label: 'This month', from: monthKey(n), to: monthKey(n) },
  { key: 'q', label: 'Last 3 months', from: monthKey(new Date(n.getFullYear(), n.getMonth() - 2, 1)), to: monthKey(n) },
  { key: 'fy', label: 'This FY', from: monthKey(fyStart(n)), to: monthKey(n) },
  // Far enough back to cover anything anyone writes down; the table is small.
  { key: 'all', label: 'All', from: '2020-01-01', to: monthKey(new Date(n.getFullYear() + 1, n.getMonth(), 1)) },
]

/**
 * The cross-sell tracker's columns, in its order.
 *
 * Defined once and read by the table, the clipboard and the CSV, so what is on screen is
 * exactly what gets pasted. A separate export builder is how an export quietly drifts
 * from the page it claims to export.
 *
 * Closed date is column K, after the billable figure, so adding it cannot shift any of
 * the ten columns the tracker already has — an existing sheet keeps working and gains a
 * column on the end rather than having its values move sideways.
 */
const XSELL_COLS: { label: string; get: (r: CrossSell) => string; num?: boolean; wide?: boolean }[] = [
  { label: 'Month', get: r => pretty(r.booking_month) },
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
  { label: 'Closed date', get: r => pretty(r.confirmed_on) },
]

const ALL = '__all__'

export default function CrossSellPage() {
  const { unit } = useUnit()
  const [all, setAll] = useState<CrossSell[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')

  const now = useMemo(() => new Date(), [])
  const ranges = useMemo(() => RANGES(now), [now])
  // Opens on the last three months: a single month is usually three or four rows, which
  // is too little to tell you anything about who is selling.
  const [from, setFrom] = useState(() => monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 1)))
  const [to, setTo] = useState(() => monthKey(now))

  // Column filters. ALL rather than '' so an empty string stays a real, selectable value.
  const [q, setQ] = useState('')
  const [fPm, setFPm] = useState(ALL)
  const [fBu, setFBu] = useState(ALL)
  const [fType, setFType] = useState(ALL)
  const [fClient, setFClient] = useState(ALL)

  useEffect(() => {
    if (from > to) return
    let live = true
    setLoading(true)
    getCrossSells(from, to)
      .then(r => { if (live) setAll(r) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [from, to])


  // Each row carries its own department, so the business-unit switch applies the same way
  // it does to a booked line.
  const inScope = useMemo(() => all.filter(r => inUnit(r.service_dept, unit)), [all, unit])

  // The dropdowns are built from what is in the window, not from a fixed list, so they
  // never offer a PM or a BU with nothing behind it.
  const opts = useMemo(() => {
    const uniq = (xs: (string | null | undefined)[]) =>
      [...new Set(xs.map(x => (x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return {
      pm: uniq(inScope.map(r => r.pm)),
      bu: uniq(inScope.map(r => r.service_dept)),
      type: uniq(inScope.map(r => r.client_type)),
      client: uniq(inScope.map(r => r.client)),
    }
  }, [inScope])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inScope.filter(r => {
      if (fPm !== ALL && r.pm !== fPm) return false
      if (fBu !== ALL && (r.service_dept || '') !== fBu) return false
      if (fType !== ALL && (r.client_type || '') !== fType) return false
      if (fClient !== ALL && r.client !== fClient) return false
      if (!needle) return true
      // Search spans every column the tracker carries, so a subject line or an address
      // finds its row as readily as a company name does.
      return XSELL_COLS.some(c => c.get(r).toLowerCase().includes(needle))
    })
  }, [inScope, q, fPm, fBu, fType, fClient])

  const closed = useMemo(() => rows.filter(r => r.status === 'closed'), [rows])
  const open = useMemo(() => rows.filter(r => r.status === 'open'), [rows])
  const total = useMemo(() => closed.reduce((a, r) => a + r.amount_usd, 0), [closed])
  const clients = useMemo(() => new Set(closed.map(r => r.client)).size, [closed])
  const filtered = rows.length !== inScope.length

  // Per PM, biggest first: whose mailbox it came from is the question this page is read
  // for. Kept above the table rather than as group headers inside it — a header row would
  // be copied along with the data and land in the sheet as junk.
  const byPm = useMemo(() => {
    const m = new Map<string, { pm: string; usd: number; lines: number; clients: Set<string> }>()
    for (const r of closed) {
      const e = m.get(r.pm) || { pm: r.pm, usd: 0, lines: 0, clients: new Set<string>() }
      e.usd += r.amount_usd
      e.lines += 1
      e.clients.add(r.client)
      m.set(r.pm, e)
    }
    return [...m.values()].sort((a, b) => b.usd - a.usd)
  }, [closed])

  const activeRange = ranges.find(r => r.from === from && r.to === to)?.key || ''
  const clearAll = () => { setQ(''); setFPm(ALL); setFBu(ALL); setFType(ALL); setFClient(ALL) }

  // Copy pastes the ROWS ONLY, tab-separated — the tracker already has its header, and a
  // header pasted under one becomes a data row somebody has to delete. Tabs rather than
  // commas because a paste into Sheets or Excel splits on tabs without an import step,
  // and two of these columns (service name, subject) routinely contain a comma.
  const copy = async () => {
    const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim()
    const tsv = closed.map(r => XSELL_COLS.map(c => clean(c.get(r))).join('\t')).join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(`${closed.length} copied`)
    } catch {
      // Clipboard is blocked without https or a user gesture in some browsers; say so
      // rather than leaving a button that silently does nothing.
      setCopied('Blocked — use CSV')
    }
    setTimeout(() => setCopied(''), 2500)
  }

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const head = XSELL_COLS.map(c => esc(c.label)).join(',')
    const body = closed.map(r => XSELL_COLS.map(c => esc(c.get(r))).join(','))
    // The BOM is what makes Excel read the em dashes and accented names as UTF-8 rather
    // than as mojibake.
    const blob = new Blob(['﻿' + [head, ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cross-sell-${from.slice(0, 7)}-to-${to.slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const td = 'px-3 py-3 whitespace-nowrap'
  const th = 'px-3 py-2 font-medium whitespace-nowrap'
  const btn = 'rounded-md border border-mav-line px-2.5 py-1 text-xs hover:bg-mav-dark disabled:opacity-40'
  const ctl = 'bg-mav-dark border border-mav-line rounded-md px-2 py-1.5 text-sm text-mav-fg [color-scheme:dark]'
  const lbl = 'font-mono text-[10.5px] uppercase tracking-[0.1em] text-mav-muted'

  const basis = (
    <>
      Work a <b>PM</b> opened from their own mailbox, not the account manager — a proposal, a health check or a
      security advisory sent to a client who had not asked. <b>Done and closed</b> means the client said yes and the
      revenue is booked, so every figure here is also a line in the project ledger. Attribution is written down by
      hand, not derived: a row is kept only where a booked line names the work the mail pitched,
      because &ldquo;mailed, then bought something&rdquo; credits a campaign with retainers that were already running.
    </>
  )

  const Pick = ({ label, value, onChange, options }: {
    label: string; value: string; onChange: (v: string) => void; options: string[]
  }) => (
    <>
      <span className={lbl}>{label}</span>
      <select className={ctl} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
        <option value={ALL}>All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </>
  )

  return (
    <div>
      <Header title="Cross Sell"
        subtitle="Business a PM opened from their own mailbox"
        chip={ranges.find(r => r.key === activeRange)?.label || `${monLabel(from)} – ${monLabel(to)}`} />

      <KPIRow cols={4}>
        <KPICard tone="accent" label="Closed" value={loading ? '…' : fmtUsd(total)}
          sub={loading ? undefined : <span className="text-[11px]">booked and in the ledger</span>} />
        <KPICard tone="green" label="Lines" value={loading ? '…' : String(closed.length)}
          sub={loading ? undefined : <span className="text-[11px]">across {clients} {clients === 1 ? 'client' : 'clients'}</span>} />
        <KPICard tone="default" label="PMs selling" value={loading ? '…' : String(byPm.length)}
          sub={loading ? undefined : <span className="text-[11px]">{byPm[0] ? `${byPm[0].pm} leads with ${fmtUsd(byPm[0].usd)}` : 'nobody yet'}</span>} />
        <KPICard tone="amber" label="Pitched, not bought" value={loading ? '…' : String(open.length)}
          sub={loading ? undefined : <span className="text-[11px]">offered, no sale yet</span>} />
      </KPIRow>

      {/* Outside the loading gate on purpose: changing a date refetches, and controls that
          vanish while the numbers reload are controls you cannot correct a typo in. */}
      <Segments<string>
        value={activeRange}
        onChange={k => { const r = ranges.find(x => x.key === k); if (r) { setFrom(r.from); setTo(r.to) } }}
        items={[
          ...ranges.map(r => ({ id: r.key, label: r.label })),
          ...(activeRange ? [] : [{ id: '', label: 'Custom range' }]),
        ]} />

      <FilterBar right={
        <>
          <span className="text-xs text-mav-muted">
            {filtered ? `${rows.length} of ${inScope.length}` : `${inScope.length} rows`}
          </span>
          {(filtered || q) && <button onClick={clearAll} className={btn}>Clear all</button>}
        </>}>
        {/* Months, not days: a cross-sell is dated by the month its revenue lands in, and
            a day picker would promise a precision the row does not have. */}
        <span className={lbl}>From</span>
        <input type="month" value={from.slice(0, 7)} max={to.slice(0, 7)}
          onChange={e => e.target.value && setFrom(`${e.target.value}-01`)} className={ctl} aria-label="From month" />
        <span className="text-xs text-mav-muted">→</span>
        <span className={lbl}>To</span>
        <input type="month" value={to.slice(0, 7)} min={from.slice(0, 7)}
          onChange={e => e.target.value && setTo(`${e.target.value}-01`)} className={ctl} aria-label="To month" />
        {from > to && <span className="text-xs text-red-400">From is after To.</span>}

        <Pick label="PM" value={fPm} onChange={setFPm} options={opts.pm} />
        <Pick label="BU" value={fBu} onChange={setFBu} options={opts.bu} />
        <Pick label="Type" value={fType} onChange={setFType} options={opts.type} />
        <Pick label="Client" value={fClient} onChange={setFClient} options={opts.client} />

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any column…"
          className={`${ctl} min-w-[12rem]`} aria-label="Search" />
      </FilterBar>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p> : (
        <>
          {byPm.length > 0 && (
            <Panel flush className="mb-6" title="By PM"
              info="Who opened the business. A PM with nothing here did not fail to sell — they may simply have nothing written down yet; this table only knows what has been attributed. It follows the filters above, so narrowing to one BU shows that BU's picture.">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                    <tr>
                      <th className={th}>PM</th>
                      <th className={`${th} text-right`}>Closed</th>
                      <th className={`${th} text-right`}>Share</th>
                      <th className={`${th} text-right`}>Lines</th>
                      <th className={`${th} text-right`}>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPm.map(g => (
                      <tr key={g.pm} className="border-b border-mav-line/60 last:border-0">
                        <td className={`${td} font-medium`}>{g.pm}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtUsd(g.usd)}</td>
                        <td className={`${td} text-right tabular-nums text-mav-muted`}>
                          {total > 0 ? `${Math.round((g.usd / total) * 100)}%` : '—'}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{g.lines}</td>
                        <td className={`${td} text-right tabular-nums`}>{g.clients.size}</td>
                      </tr>
                    ))}
                    <tr className="bg-mav-dark/40">
                      <td className={`${td} font-semibold`}>Total</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{fmtUsd(total)}</td>
                      <td className={td} />
                      <td className={`${td} text-right tabular-nums font-semibold`}>{closed.length}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{clients}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel flush title="For the tracker" info={basis}
            right={
              <span className="flex flex-wrap items-center gap-3 text-xs text-mav-muted">
                <span>{filtered ? 'Copies the filtered rows only' : 'Copy pastes rows only, under your existing header'}</span>
                <button onClick={copy} disabled={closed.length === 0} className={btn}>{copied || 'Copy rows'}</button>
                <button onClick={exportCsv} disabled={closed.length === 0} className={btn}>CSV</button>
              </span>}>
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
                  {closed.map(r => (
                    <tr key={r.id} className="border-b border-mav-line/60 last:border-0 align-top">
                      {XSELL_COLS.map(c => (
                        <td key={c.label}
                          className={c.wide ? 'px-3 py-3' : `${td} ${c.num ? 'text-right tabular-nums' : ''}`}>
                          {c.wide
                            ? <div className="max-w-sm break-words">{c.get(r)}</div>
                            : c.get(r) || <span className="text-mav-muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {closed.length === 0 && (
                    <tr><td colSpan={XSELL_COLS.length} className="px-3 py-6 text-center text-mav-muted">
                      {filtered ? 'Nothing matches these filters.' : 'Nothing closed in this window.'}
                    </td></tr>
                  )}
                  {closed.length > 0 && (
                    <tr className="bg-mav-dark/40">
                      <td className={`${td} font-semibold`} colSpan={XSELL_COLS.length - 2}>Total</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{fmtUsd(total)}</td>
                      <td className={td} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* A cross-sell that was made and did not land. Kept beside the ones that
                did, because the effort was the same and an unsold pitch is the thing
                worth chasing; on a page of its own it would never be looked at. Outside
                the table on purpose: there is nothing to bill, so it must not reach the
                tracker. */}
            {open.length > 0 && (
              <div className="border-t border-mav-line px-4 py-3 text-xs">
                <div className="text-mav-fg/80 font-medium mb-1.5">
                  Pitched, not bought — {open.length}. Not in the copy: there is nothing to bill yet.
                </div>
                <ul className="space-y-1.5">
                  {open.map(r => (
                    <li key={r.id} className="text-mav-muted">
                      <span className="text-mav-fg">{r.pm}</span> → <span className="text-mav-fg">{r.client}</span>
                      {' · '}{r.project}
                      {' — '}&ldquo;{r.mail_subject}&rdquo; {pretty(r.mail_date)}
                      {r.note ? <div className="opacity-70">{r.note}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

        </>
      )}
    </div>
  )
}
