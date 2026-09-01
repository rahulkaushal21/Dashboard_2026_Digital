'use client'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import Header from '@/components/Header'
import { getRevenueHistory, getRevenueSources, getBookingsFull, type RevenueHistoryRow, type RevenueSource, type BookingRow } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

// Re-reads the yearly spreadsheets on demand, the same pattern the L&D page uses.
const SYNC_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '') + '/functions/v1/sync-revenue-history'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ym = (s?: string) => (s || '').slice(0, 7)
const monLabel = (k: string) => { const p = k.split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0].slice(2)}` : k }
// The financial year runs April-March, matching FY_TARGET on the other pages.
// Labelling these as calendar years would make every YoY read against the wrong
// boundary the moment this is compared with Business Trend or Forecast.
const fyOf = (k: string) => { const [y, m] = k.split('-').map(Number); return m >= 4 ? y : y - 1 }
const fyLabel = (fy: number) => `FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`
// The month we are currently in is only part-billed, so it is never a fair
// half of a like-for-like comparison — on the 1st it is a rounding error against
// a full month last year. It stays in the chart, and out of the year-on-year.
const thisYm = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }

const MODEL_COLOR: Record<string, string> = {
  'Dedicated': '#FFDB2D', 'Partial Dedicated': '#f59e0b', 'New Development': '#3b82f6',
  'Maintanance': '#10b981', 'Ad-hoc': '#a855f7', 'Additional Pages': '#0284c7', 'Change Request': '#f43f5e',
}
const colorFor = (m: string) => MODEL_COLOR[m] || '#333333'

// The history table owns everything up to its last month; web_revenue owns
// everything after. web_revenue holds 13 stray rows in Jan and Mar 2025 that the
// history sheet also covers, so the cut has to be applied to the live side or
// those two months double-count.
type Row = { month: string; amount: number; client: string; model: string; dept: string; geo: string; era: 'history' | 'live' }
// web_revenue records the department as WEB-US / WEB-AU / WEB-UK / LP / HUB;
// revenue_history stores it already reduced to Web / HUB / LP.
const deptOfService = (s?: string) => {
  const v = (s || '').toUpperCase()
  if (v.startsWith('HUB')) return 'HUB'
  if (v.startsWith('LP')) return 'LP'
  return 'Web'
}

const Panel = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
    <div className="flex items-baseline justify-between gap-3 mb-4">
      <div className="text-sm font-medium">{title}</div>
      {right}
    </div>
    {children}
  </div>
)

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
    <div className="text-xs text-mav-muted">{label}</div>
    <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
    {sub && <div className="text-[11px] text-mav-muted mt-1">{sub}</div>}
  </div>
)

// A labelled share bar + legend, reused for engagement model and geo.
const Split = ({ rows, total, color }: { rows: { name: string; amount: number }[]; total: number; color: (n: string) => string }) => (
  <>
    <div className="flex h-2 rounded-full overflow-hidden bg-mav-line mb-4">
      {rows.map(r => (
        <div key={r.name} style={{ width: `${total ? (r.amount / total) * 100 : 0}%`, background: color(r.name) }}
          title={`${r.name} — ${fmtUsd(r.amount)}`} />
      ))}
    </div>
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.name} className="flex items-center gap-2.5 text-sm">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color(r.name) }} />
          <span className="flex-1 truncate">{r.name}</span>
          <span className="tabular-nums">{fmtUsd(r.amount)}</span>
          <span className="w-10 text-right text-xs text-mav-muted tabular-nums">
            {total ? Math.round((r.amount / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  </>
)

// One movement in the revenue bridge, as a signed bar scaled against the largest
// of the four — so which force actually moved the year reads at a glance.
const Move = ({ label, amount, n, max }: { label: string; amount: number; n: number; max: number }) => {
  const up = amount >= 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-xs text-mav-muted">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-mav-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${max ? (Math.abs(amount) / max) * 100 : 0}%`, background: up ? '#10b981' : '#f43f5e' }} />
      </div>
      <span className={`w-24 text-right tabular-nums ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '+' : '\u2212'}{fmtUsd(Math.abs(amount))}
      </span>
      <span className="w-20 text-right text-xs text-mav-muted tabular-nums">{n} {n === 1 ? 'client' : 'clients'}</span>
    </div>
  )
}

export default function RevenueHistory() {
  const [rows, setRows] = useState<RevenueHistoryRow[]>([])
  const [live, setLive] = useState<BookingRow[]>([])
  const [sources, setSources] = useState<RevenueSource[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const load = () => Promise.all([getRevenueHistory(), getRevenueSources(), getBookingsFull()])
    .then(([r, s, w]) => { setRows(r); setSources(s); setLive(w) }).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const resync = async () => {
    setSyncing(true); setNote('')
    try {
      const res = await fetch(SYNC_URL, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } })
      const j = await res.json()
      setNote(j.ok ? `Reloaded ${j.sources?.map((x: any) => `${x.source}: ${x.rows} rows`).join(' · ')}` : `Failed: ${j.error}`)
      await load()
    } catch (e) { setNote('Failed: ' + String(e)) } finally { setSyncing(false) }
  }

  // One combined series: the history sheet up to its last month, the live
  // revenue table from the month after. Nothing is written to web_revenue and
  // nothing about it changes — it is read here exactly as the other pages read it.
  const all = useMemo<Row[]>(() => {
    const cut = rows.reduce((mx, r) => (ym(r.booking_month) > mx ? ym(r.booking_month) : mx), '')
    const hist: Row[] = rows.map(r => ({
      month: ym(r.booking_month), amount: Number(r.booking_amount || 0), client: r.company_name,
      model: r.engagement_model || 'Unspecified', dept: r.service_dept || 'Unspecified',
      geo: r.geo || 'Unspecified', era: 'history',
    }))
    const liveRows: Row[] = live
      .filter(b => !!b.booking_month && (!cut || ym(b.booking_month) > cut))
      .map(b => ({
        month: ym(b.booking_month), amount: Number(b.booking_amount || 0), client: b.company_name || '—',
        model: b.engagement_model || 'Unspecified', dept: deptOfService(b.service_name),
        geo: b.geo || 'Unspecified', era: 'live',
      }))
    return [...hist, ...liveRows]
  }, [rows, live])

  const d = useMemo(() => {
    const total = all.reduce((s, r) => s + r.amount, 0)
    const byMonth = new Map<string, number>()
    const eraOf = new Map<string, Row['era']>()
    const byModel = new Map<string, number>()
    const byGeo = new Map<string, number>()
    const byDept = new Map<string, number>()
    const byClient = new Map<string, number>()
    const byFy = new Map<number, { amount: number; clients: Set<string> }>()
    for (const r of all) {
      byMonth.set(r.month, (byMonth.get(r.month) || 0) + r.amount)
      eraOf.set(r.month, r.era)
      byModel.set(r.model, (byModel.get(r.model) || 0) + r.amount)
      byGeo.set(r.geo, (byGeo.get(r.geo) || 0) + r.amount)
      byDept.set(r.dept, (byDept.get(r.dept) || 0) + r.amount)
      byClient.set(r.client, (byClient.get(r.client) || 0) + r.amount)
      const fy = fyOf(r.month)
      const cur = byFy.get(fy) || { amount: 0, clients: new Set<string>() }
      cur.amount += r.amount; cur.clients.add(r.client.toLowerCase()); byFy.set(fy, cur)
    }
    const months = [...byMonth.keys()].sort()
    const series = months.map(k => ({
      key: k, label: monLabel(k), fy: fyOf(k), era: eraOf.get(k), amount: Math.round(byMonth.get(k) || 0),
    }))
    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    return {
      total, series, months,
      models: sortDesc(byModel), geos: sortDesc(byGeo), depts: sortDesc(byDept), clients: sortDesc(byClient),
      fys: [...byFy.entries()].map(([fy, v]) => ({
        fy, amount: Math.round(v.amount), clients: v.clients.size,
        // Complete only if the data actually spans Apr(fy) -> Mar(fy+1).
        complete: months[0] <= `${fy}-04` && months[months.length - 1] >= `${fy + 1}-03`,
      })).sort((a, b) => a.fy - b.fy),
      clientCount: byClient.size,
      histMonths: [...new Set(all.filter(r => r.era === 'history').map(r => r.month))].sort(),
      liveMonths: [...new Set(all.filter(r => r.era === 'live').map(r => r.month))].sort(),
    }
  }, [all])

  // ---------------------------------------------------------------------------
  // Year-on-year. Every comparison here is WINDOW-MATCHED: the selected year's
  // covered months are the window, and the prior year is restricted to the same
  // months. For a finished year that is all twelve and changes nothing; for the
  // year in progress it is the only honest comparison — Apr-Aug against Apr-Aug,
  // not five months against twelve.
  // ---------------------------------------------------------------------------
  const [selFy, setSelFy] = useState<number | null>(null)

  const ya = useMemo(() => {
    const years = [...new Set(all.map(r => fyOf(r.month)))].sort((a, b) => a - b)
    const cur = selFy != null && years.includes(selFy) ? selFy : years[years.length - 1]
    const prev = cur - 1
    // Window-match on completed months only. Dropping the month in progress is
    // what keeps the comparison honest: with it in, the current year is measured
    // on a part-month against a whole one and reads far worse than it is.
    const now = thisYm()
    const curMonths = all.filter(r => fyOf(r.month) === cur).map(r => r.month)
    const done = curMonths.filter(m => m !== now)
    const wnd = new Set((done.length ? done : curMonths).map(m => +m.slice(5, 7)))
    const droppedNow = done.length > 0 && curMonths.some(m => m === now)
    const partial = wnd.size < 12

    const key = (n: string) => n.trim().toLowerCase()
    const label = new Map<string, string>()
    const sum = (fy: number) => {
      const clients = new Map<string, number>()
      let total = 0
      for (const r of all) {
        if (fyOf(r.month) !== fy || !wnd.has(+r.month.slice(5, 7))) continue
        const k = key(r.client)
        if (!label.has(k)) label.set(k, r.client)
        clients.set(k, (clients.get(k) || 0) + r.amount)
        total += r.amount
      }
      return { clients, total }
    }
    const a = sum(cur), b = sum(prev)

    // Split the change into the four movements that actually explain it. They
    // sum exactly to (this year - last year), which is what makes it a bridge
    // and not four unrelated numbers.
    let nw = 0, nwN = 0, ch = 0, chN = 0, ex = 0, exN = 0, co = 0, coN = 0
    let retainedPrev = 0, retainedCur = 0
    const moves: { name: string; prev: number; cur: number; delta: number }[] = []
    for (const k of new Set([...a.clients.keys(), ...b.clients.keys()])) {
      const c = a.clients.get(k) || 0, p = b.clients.get(k) || 0
      moves.push({ name: label.get(k) || k, prev: p, cur: c, delta: c - p })
      if (p <= 0) { nw += c; nwN++; continue }
      retainedPrev += p; retainedCur += c
      if (c <= 0) { ch -= p; chN++ }
      else if (c > p) { ex += c - p; exN++ }
      else if (c < p) { co += c - p; coN++ }
    }
    moves.sort((x, y) => y.delta - x.delta)

    // Concentration and mix, per full financial year.
    const mix = years.map(fy => {
      const byClient = new Map<string, number>()
      let total = 0
      for (const r of all) {
        if (fyOf(r.month) !== fy) continue
        byClient.set(key(r.client), (byClient.get(key(r.client)) || 0) + r.amount)
        total += r.amount
      }
      const amts = [...byClient.values()].sort((x, y) => y - x)
      const top10 = amts.slice(0, 10).reduce((s, v) => s + v, 0)
      return {
        fy, total, clients: byClient.size,
        perClient: byClient.size ? total / byClient.size : 0,
        top10Pct: total ? (top10 / total) * 100 : 0,
        big: amts.filter(v => v >= 50000).length,
        complete: d.fys.find(f => f.fy === fy)?.complete ?? false,
      }
    })

    // Engagement model across every year, so a shift in mix is visible as a row.
    const modelNames = [...new Set(all.map(r => r.model))]
    const byModel = modelNames.map(name => ({
      name,
      cells: years.map(fy => all.reduce((s, r) => s + (fyOf(r.month) === fy && r.model === name ? r.amount : 0), 0)),
    })).sort((x, y) => y.cells.reduce((s, v) => s + v, 0) - x.cells.reduce((s, v) => s + v, 0))

    return {
      years, cur, prev, partial, droppedNow, nowLabel: monLabel(thisYm()), windowLabel: (() => {
        // Order by position in the financial year (Apr = 0), then name the span.
        const o = [...wnd].sort((x, y) => ((x + 8) % 12) - ((y + 8) % 12))
        return o.length ? (o.length === 1 ? SHORT[o[0]] : `${SHORT[o[0]]}–${SHORT[o[o.length - 1]]}`) : ''
      })(),
      curTotal: a.total, prevTotal: b.total, hasPrev: years.includes(prev),
      nw, nwN, ch, chN, ex, exN, co, coN,
      nrr: retainedPrev ? (retainedCur / retainedPrev) * 100 : 0,
      logoRet: b.clients.size ? ((b.clients.size - chN) / b.clients.size) * 100 : 0,
      curClients: a.clients.size, prevClients: b.clients.size,
      gains: moves.filter(m => m.delta > 0).slice(0, 6),
      losses: moves.filter(m => m.delta < 0).slice(-6).reverse(),
      mix, byModel, modelYears: years,
    }
  }, [all, selFy, d.fys])

  const src = sources[0]

  return (
    <div>
      <Header title="Revenue history" subtitle="April 2023 to current. Earlier months come from the historical spreadsheet; from April 2025 the live revenue table takes over, read exactly as the other pages read it." />

      {loading ? <p className="text-mav-muted text-sm">Loading…</p> : rows.length === 0 ? (
        <p className="text-mav-muted text-sm">No historical revenue loaded yet.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Total billed" value={fmtUsd(d.total)} sub={`${d.months.length} months`} />
            <Kpi label="Period" value={`${monLabel(d.months[0])} → ${monLabel(d.months[d.months.length - 1])}`} sub="by confirmation month" />
            <Kpi label="Clients" value={String(d.clientCount)} sub="distinct agencies" />
            <Kpi label="Rows" value={all.length.toLocaleString()} sub={`${rows.length.toLocaleString()} sheet · ${(all.length - rows.length).toLocaleString()} live`} />
          </div>

          <Panel title="Monthly billing" right={
            <span className="text-[11px] text-mav-muted flex items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#b99a1f' }} />spreadsheet</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#FFDB2D' }} />live table</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#5c5015' }} />month in progress</span>
            </span>
          }>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="label" stroke="#9a9a9a" fontSize={10} tickLine={false} axisLine={false} interval={1} />
                <YAxis stroke="#9a9a9a" fontSize={10} tickLine={false} axisLine={false} width={48}
                  tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                {/* The bars get their colour from <Cell>, so the Bar itself has no
                    `fill` — and recharts then falls back to #000 for the tooltip
                    item text, which is unreadable on the dark panel. Set the text
                    colours explicitly rather than relying on the series colour. */}
                <Tooltip cursor={{ fill: '#ffffff14' }}
                  contentStyle={{ background: '#2e2e2e', border: '1px solid #4a4a4a', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#9a9a9a', marginBottom: 2 }}
                  itemStyle={{ color: '#f2f2f2' }}
                  formatter={(v: number) => [fmtUsd(v), 'Billed']} />
                <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                  {/* The current month is only part-billed; dim it so the last bar
                      is not read as a collapse. */}
                  {d.series.map(p => (
                    <Cell key={p.key} fill={p.key === thisYm() ? '#5c5015' : p.era === 'live' ? '#FFDB2D' : '#b99a1f'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <div className="flex flex-wrap items-baseline justify-between gap-3 pt-2">
            <div>
              <h2 className="text-base font-medium">Year on year</h2>
              <p className="text-xs text-mav-muted mt-0.5">
                {ya.partial
                  ? `${fyLabel(ya.cur)} is still running, so every figure below compares ${ya.windowLabel} against ${ya.windowLabel} of ${fyLabel(ya.prev)}${ya.droppedNow ? `, leaving out ${ya.nowLabel} while it is still being billed` : ''}.`
                  : `${fyLabel(ya.cur)} against ${fyLabel(ya.prev)}, full year against full year.`}
              </p>
            </div>
            <div className="flex gap-1.5">
              {ya.years.filter(y => ya.years.includes(y - 1)).map(y => (
                <button key={y} onClick={() => setSelFy(y)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    y === ya.cur ? 'bg-mav-yellow text-black border-mav-yellow font-medium'
                                 : 'border-mav-line text-mav-muted hover:text-white'}`}>
                  {fyLabel(y)}
                </button>
              ))}
            </div>
          </div>

          {!ya.hasPrev ? (
            <Panel title="What moved the year"><p className="text-sm text-mav-muted">No prior year to compare against.</p></Panel>
          ) : (
          <Panel title="What moved the year" right={
            <span className="text-[11px] text-mav-muted">
              {ya.partial ? `${ya.windowLabel} like-for-like` : 'full year'}
            </span>
          }>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-5">
              <span className="text-mav-muted text-sm tabular-nums">{fyLabel(ya.prev)} {fmtUsd(ya.prevTotal)}</span>
              <span className="text-mav-muted">&rarr;</span>
              <span className="text-2xl font-semibold tabular-nums">{fmtUsd(ya.curTotal)}</span>
              {ya.prevTotal > 0 && (() => {
                const pc = ((ya.curTotal - ya.prevTotal) / ya.prevTotal) * 100
                return <span className={`text-sm font-medium tabular-nums ${pc >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pc >= 0 ? '+' : ''}{pc.toFixed(1)}%
                </span>
              })()}
            </div>

            <div className="space-y-2.5">
              {(() => {
                const max = Math.max(Math.abs(ya.nw), Math.abs(ya.ex), Math.abs(ya.co), Math.abs(ya.ch))
                return <>
                  <Move label="New clients" amount={ya.nw} n={ya.nwN} max={max} />
                  <Move label="Grew" amount={ya.ex} n={ya.exN} max={max} />
                  <Move label="Shrank" amount={ya.co} n={ya.coN} max={max} />
                  <Move label="Stopped billing" amount={ya.ch} n={ya.chN} max={max} />
                </>
              })()}
            </div>

            <div className="mt-5 pt-4 border-t border-mav-line grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] text-mav-muted">Net revenue retention</div>
                <div className={`text-lg font-semibold tabular-nums ${ya.nrr >= 100 ? 'text-green-400' : 'text-red-400'}`}>
                  {ya.nrr.toFixed(0)}%
                </div>
                <div className="text-[10px] text-mav-muted">last year's clients, this year</div>
              </div>
              <div>
                <div className="text-[11px] text-mav-muted">Client retention</div>
                <div className="text-lg font-semibold tabular-nums">{ya.logoRet.toFixed(0)}%</div>
                <div className="text-[10px] text-mav-muted">{ya.prevClients - ya.chN} of {ya.prevClients} came back</div>
              </div>
              <div>
                <div className="text-[11px] text-mav-muted">Billing clients</div>
                <div className="text-lg font-semibold tabular-nums">{ya.curClients}</div>
                <div className="text-[10px] text-mav-muted">was {ya.prevClients}</div>
              </div>
              <div>
                <div className="text-[11px] text-mav-muted">New this year</div>
                <div className="text-lg font-semibold tabular-nums">{ya.nwN}</div>
                <div className="text-[10px] text-mav-muted">{fmtUsd(ya.nw)} billed</div>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-mav-muted leading-relaxed">
              The four movements add up exactly to the change in the total, so they explain it rather than merely
              describe it. A client counts as <span className="text-mav-muted">new</span> when it billed nothing in the
              comparison window last year, and as <span className="text-mav-muted">stopped billing</span> when it billed
              nothing in it this year — over a part-year window that can mean quiet rather than lost.
            </p>
            {ya.droppedNow && (
              <p className="mt-2 text-[11px] text-mav-muted leading-relaxed">
                {ya.nowLabel} is excluded on both sides. It is still being billed, so measuring a part-month against a
                whole one would show a fall that is only the calendar.
              </p>
            )}
          </Panel>
          )}

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Grew the most" right={<span className="text-[11px] text-mav-muted">vs {fyLabel(ya.prev)}</span>}>
              <div className="space-y-1.5">
                {ya.gains.length === 0 && <p className="text-sm text-mav-muted">Nothing grew in this window.</p>}
                {ya.gains.map(m => (
                  <div key={m.name} className="flex items-center gap-3 text-sm py-1">
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-mav-muted tabular-nums w-32 text-right">
                      {fmtUsd(m.prev)} &rarr; {fmtUsd(m.cur)}
                    </span>
                    <span className="w-24 text-right tabular-nums text-green-400">+{fmtUsd(m.delta)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Fell the most" right={<span className="text-[11px] text-mav-muted">vs {fyLabel(ya.prev)}</span>}>
              <div className="space-y-1.5">
                {ya.losses.length === 0 && <p className="text-sm text-mav-muted">Nothing fell in this window.</p>}
                {ya.losses.map(m => (
                  <div key={m.name} className="flex items-center gap-3 text-sm py-1">
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-mav-muted tabular-nums w-32 text-right">
                      {fmtUsd(m.prev)} &rarr; {fmtUsd(m.cur)}
                    </span>
                    <span className="w-24 text-right tabular-nums text-red-400">&minus;{fmtUsd(-m.delta)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Engagement model by year" right={<span className="text-[11px] text-mav-muted">full financial years</span>}>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-mav-muted">
                    <th className="text-left font-medium pb-2">Model</th>
                    {ya.modelYears.map(y => (
                      <th key={y} className="text-right font-medium pb-2 px-3 whitespace-nowrap">
                        {fyLabel(y)}
                        {!(d.fys.find(f => f.fy === y)?.complete) && <span className="text-mav-muted"> *</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ya.byModel.map(m => (
                    <tr key={m.name} className="border-t border-mav-line/60">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: colorFor(m.name) }} />
                          {m.name}
                        </span>
                      </td>
                      {m.cells.map((v, i) => {
                        const prev = i > 0 ? m.cells[i - 1] : null
                        const complete = d.fys.find(f => f.fy === ya.modelYears[i])?.complete
                        const prevComplete = i > 0 && d.fys.find(f => f.fy === ya.modelYears[i - 1])?.complete
                        const pc = prev && prev > 0 && complete && prevComplete ? ((v - prev) / prev) * 100 : null
                        return (
                          <td key={i} className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                            {v > 0 ? fmtUsd(v) : <span className="text-mav-muted">—</span>}
                            {pc != null && (
                              <span className={`block text-[10px] ${pc >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {pc >= 0 ? '+' : ''}{pc.toFixed(0)}%
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
              Years marked <span className="text-mav-muted">*</span> do not cover a full Apr–Mar span, so no percentage is
              shown into or out of them. Model names are reproduced as the source spreadsheet spells them.
            </p>
          </Panel>

          <Panel title="Client mix" right={<span className="text-[11px] text-mav-muted">full financial years</span>}>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-mav-muted">
                    <th className="text-left font-medium pb-2">Year</th>
                    <th className="text-right font-medium pb-2 px-3">Billed</th>
                    <th className="text-right font-medium pb-2 px-3">Clients</th>
                    <th className="text-right font-medium pb-2 px-3">Per client</th>
                    <th className="text-right font-medium pb-2 px-3 whitespace-nowrap">Top 10 share</th>
                    <th className="text-right font-medium pb-2 pl-3 whitespace-nowrap">Clients &ge; $50k</th>
                  </tr>
                </thead>
                <tbody>
                  {ya.mix.map(m => (
                    <tr key={m.fy} className="border-t border-mav-line/60">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">
                        {fyLabel(m.fy)}
                        {!m.complete && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-mav-line text-mav-muted">partial</span>}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(m.total)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{m.clients}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(m.perClient)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{m.top10Pct.toFixed(0)}%</td>
                      <td className="py-2 pl-3 text-right tabular-nums">{m.big}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
              Top-10 share is the concentration risk: the higher it climbs, the more of the year rests on a handful of
              accounts, and the harder a single one leaving lands.
            </p>
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="By engagement model">
              <Split rows={d.models} total={d.total} color={colorFor} />
            </Panel>
            <Panel title="By financial year" right={<span className="text-[11px] text-mav-muted">Apr–Mar</span>}>
              <div className="space-y-2">
                {d.fys.map((f, i) => {
                  const prev = i > 0 ? d.fys[i - 1] : null
                  // Only compare complete year against complete year. Against a
                  // partial FY22-23 the next year reads +196%, which is an
                  // artefact of the window, not growth.
                  const comparable = !!prev && prev.complete && f.complete && prev.amount > 0
                  const delta = comparable ? ((f.amount - prev!.amount) / prev!.amount) * 100 : null
                  return (
                    <div key={f.fy} className="flex items-center gap-3 text-sm border-b border-mav-line/60 last:border-0 py-2">
                      <span className="w-20 shrink-0 font-medium">{fyLabel(f.fy)}</span>
                      <span className="flex-1 text-mav-muted text-xs">{f.clients} clients</span>
                      <span className="tabular-nums">{fmtUsd(f.amount)}</span>
                      <span className={`w-16 text-right text-xs tabular-nums ${delta == null ? 'text-mav-muted' : delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`}
                      </span>
                      {!f.complete && <span className="text-[10px] px-1.5 py-0.5 rounded bg-mav-line text-mav-muted shrink-0">partial</span>}
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
                A year is marked <span className="text-mav-muted">partial</span> when the data does not cover its full
                Apr–Mar span — FY26-27 is still in progress. Year-on-year is shown only between two complete years, so a
                part-finished year never produces a growth figure that is really just a shorter window.
              </p>
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="By service" right={<span className="text-[11px] text-mav-muted">Web / HUB / LP</span>}>
              <Split rows={d.depts} total={d.total}
                color={(n) => ({ Web: '#FFDB2D', HUB: '#3b82f6', LP: '#10b981' } as any)[n] || '#333'} />
              <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
                From April 2025 this comes straight from the live table's Service Department (WEB-US / WEB-AU / WEB-UK
                roll up to Web). The earlier spreadsheet has no such column, so those months are derived from Technology:
                Hubspot &rarr; HUB, LP or Banner &rarr; LP, everything else &rarr; Web. Banner counts as LP — against the
                reported FY24-25 figures that derivation puts HUB within $3 and LP within $42.
              </p>
            </Panel>
            <Panel title="By geography">
              <Split rows={d.geos} total={d.total}
                color={(n) => ({ 'US/Canada': '#FFDB2D', 'UK/EU': '#3b82f6', 'AU/NZ': '#10b981', 'Others': '#a855f7' } as any)[n] || '#333'} />
            </Panel>
            <Panel title="Top clients" right={<span className="text-[11px] text-mav-muted">by total billed</span>}>
              <div className="space-y-1.5">
                {d.clients.slice(0, 10).map(c => (
                  <div key={c.name} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="tabular-nums">{fmtUsd(c.amount)}</span>
                    <span className="w-10 text-right text-xs text-mav-muted tabular-nums">
                      {Math.round((c.amount / d.total) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Source" right={
            <button onClick={resync} disabled={syncing}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-mav-yellow text-black font-medium disabled:opacity-60">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Reloading…' : 'Reload from sheets'}
            </button>
          }>
            {src ? (
              <div className="text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{src.label}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-mav-line text-mav-muted">{src.key}</span>
                  {src.immutable && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">frozen</span>}
                </div>
                <div className="text-xs text-mav-muted">
                  {src.last_rows?.toLocaleString()} rows · {fmtUsd(Number(src.last_total || 0))}
                  {src.last_synced_at && <> · loaded {String(src.last_synced_at).slice(0, 10)}</>}
                </div>
                {src.last_message && <div className="text-[11px] text-mav-muted">{src.last_message}</div>}
              </div>
            ) : <p className="text-sm text-mav-muted">No source registered.</p>}
            <div className="mt-4 pt-3 border-t border-mav-line">
              <div className="text-xs uppercase tracking-wide text-mav-muted mb-1.5">Basis, and a known variance</div>
              <p className="text-[11px] text-mav-muted leading-relaxed">
                Projects marked <span className="text-mav-muted">Pending</span>,{' '}
                <span className="text-mav-muted">On Hold</span>, <span className="text-mav-muted">Cancelled</span> or{' '}
                <span className="text-mav-muted">Awaiting Information</span> are excluded, matching the live revenue sync
                so both sides of the April-2025 seam mean the same thing.
              </p>
              <p className="mt-2 text-[11px] text-mav-muted leading-relaxed">
                The separately reported FY24-25 figures count all of those except On Hold, so they read higher here:
                Web <span className="tabular-nums">$2,457,588</span> against a reported{' '}
                <span className="tabular-nums">$2,481,187</span> — a{' '}
                <span className="tabular-nums">$23,599</span> difference that is entirely those statuses, not the
                Web/HUB/LP classification. On the same basis HUB and LP reconcile to within $3 and $42. This is a
                deliberate choice of basis, not a gap in the data.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-mav-line">
              <div className="text-xs uppercase tracking-wide text-mav-muted mb-1.5">From April 2025: the live table</div>
              <p className="text-[11px] text-mav-muted leading-relaxed">
                Months after {d.histMonths.length ? monLabel(d.histMonths[d.histMonths.length - 1]) : '—'} come from{' '}
                <code className="text-mav-yellow">web_revenue</code>, unchanged and read the same way the Dashboard,
                Business Trend and Forecast pages read it. Each month is taken from exactly one source, so the handover
                cannot double-count — the live table holds a few stray Jan and Mar 2025 rows that the spreadsheet also
                covers, and those are ignored here in favour of the spreadsheet.
              </p>
            </div>
            <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
              Add another year by inserting a row into <code className="text-mav-yellow">revenue_sources</code> with its
              published CSV URL and a column map — no code change needed. Rows are replaced per source, so reloading one
              year never touches another.
            </p>
            {note && <p className="mt-2 text-xs">{note}</p>}
          </Panel>
        </div>
      )}
    </div>
  )
}
