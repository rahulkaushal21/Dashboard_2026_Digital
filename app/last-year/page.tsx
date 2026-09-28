'use client'
import { useEffect, useMemo, useState } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import MultiSelect from '@/components/MultiSelect'
import KPICard from '@/components/KPICard'
import type { CardDetails, DetailCol } from '@/components/CardDetail'
import { KPIRow, Segments, FilterBar, Panel } from '@/components/PageParts'
import { getBookingsFull, type BookingRow } from '@/lib/supabase'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit } from '@/lib/business-unit'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'

// Who a booking belongs to, with the same known-wrong SME cells corrected as on
// the PM pages — otherwise the two screens name a different owner for the same
// client, and whichever one you looked at last wins the argument.
const pmOfBooking = (r: BookingRow) =>
  (r.sme || '').trim()

const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const pad = (n: number) => String(n).padStart(2, '0')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
const curM = now.getMonth() + 1
const curMM = pad(curM)
// fiscal year (Apr–Mar) that the current month falls in
const tyStart = curM >= 4 ? now.getFullYear() : now.getFullYear() - 1
const lyStart = tyStart - 1
const curMonthKey = `${now.getFullYear()}-${curMM}`   // cap "to date" at the current calendar month
const spLabel = (yr: number) => `Apr–${SHORT[curM]} '${String(yr).slice(2)}`

// --- fiscal quarters (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar) ---------
type FQ = { fy: number; q: number }
const fqOf = (y: number, m: number): FQ =>
  m >= 4 && m <= 6 ? { fy: y, q: 1 } : m >= 7 && m <= 9 ? { fy: y, q: 2 } : m >= 10 ? { fy: y, q: 3 } : { fy: y - 1, q: 4 }
const decQ = (f: FQ): FQ => f.q > 1 ? { fy: f.fy, q: f.q - 1 } : { fy: f.fy - 1, q: 4 }
const qStartMonth = (q: number) => q === 1 ? 4 : q === 2 ? 7 : q === 3 ? 10 : 1
const qCalYear = (f: FQ) => f.q === 4 ? f.fy + 1 : f.fy
const qRange = (f: FQ): [string, string] => {
  const sm = qStartMonth(f.q); const y = qCalYear(f)
  return [`${y}-${pad(sm)}`, `${y}-${pad(sm + 2)}`]
}
const qLabel = (f: FQ) => { const sm = qStartMonth(f.q); const y = qCalYear(f); return `${SHORT[sm]}–${SHORT[sm + 2]} '${String(y).slice(2)}` }
const incQ = (f: FQ): FQ => f.q < 4 ? { fy: f.fy, q: f.q + 1 } : { fy: f.fy + 1, q: 1 }
const sameQ = (a: FQ, b: FQ) => a.fy === b.fy && a.q === b.q
// every fiscal quarter from when web-revenue data starts (Apr 2025) → current,
// oldest → newest. The user picks any two of these to compare.
const QS: FQ[] = (() => {
  const start = fqOf(2025, 4); const end = fqOf(now.getFullYear(), curM)
  const a = [start]; let guard = 0
  while (!sameQ(a[a.length - 1], end) && guard++ < 40) a.push(incQ(a[a.length - 1]))
  return a
})()
const CUR_I = QS.length - 1                       // current (still in-progress) quarter
// default compare = last COMPLETE quarter vs the one before it (both finished)
const DEF_CUR = Math.max(0, QS.length - 2)
const DEF_BASE = Math.max(0, QS.length - 3)

type Row = {
  client: string; fyLast: number; fyTd: number; spLy: number; spTy: number; qv: number[]; upcoming: number
  // PM on the client's most recent booking, plus everyone who has held it. A
  // client can change hands mid-year (Pointb ran under three), so showing only
  // one name would quietly misattribute the older revenue.
  pm: string; pmLatest: string; pmAll: Set<string>
}

// An empty selection means "all", exactly as the old "All …" option did.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())

// The two quarters being compared are always on; every other quarter is one tick away,
// so the table fits a laptop without scrolling sideways.
const COLS: ColumnDef[] = [
  { key: 'client', label: 'Client', locked: true },
  { key: 'pm', label: 'PM', default: true },
  { key: 'fyLast', label: 'Last FY', default: true },
  { key: 'fyTd', label: 'This FY to date', default: true },
  { key: 'quarters', label: 'Other quarters' },
  { key: 'delta', label: 'QoQ Δ', default: true },
  { key: 'trend', label: 'Qtr trend', default: true },
]

export default function LastYearReview() {
  const cols = useColumns('last-year', COLS)
  const [rowsAll, setRows] = useState<BookingRow[]>([])
  // ── Business unit ───────────────────────────────────────────────────────────
  // Scoped at the source: every count, total and chart below reads the filtered rows,
  // so the headline can never disagree with the table under it.
  const { unit } = useUnit()
  const rows = useMemo(() => rowsAll.filter(r => inUnit(r.service_name, unit)), [rowsAll, unit])

  const [q, setQ] = useState('')
  const [mv, setMv] = useState('')      // quarter movement filter
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')   // 'YYYY-MM' month range
  const [fGeo, setFGeo] = useState<string[]>([]); const [fService, setFService] = useState<string[]>([]); const [fPm, setFPm] = useState<string[]>([])
  const [qCur, setQCur] = useState(DEF_CUR)     // index of the quarter being compared
  const [qBase, setQBase] = useState(DEF_BASE)  // index of the quarter compared against
  // A quarter column shows when it is one of the pair being compared, or when every
  // quarter has been asked for.
  const showQ = (i: number) => i === qCur || i === qBase || cols.on('quarters')
  useEffect(() => { getBookingsFull().then(setRows) }, [])

  const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])
  const services = useMemo(() => uniq(rows.map(r => r.service_name)), [rows])
  const pms = useMemo(() => uniq(rows.map(pmOfBooking)), [rows])

  const data = useMemo(() => {
    const m = new Map<string, Row>()
    const between = (k: string, a: string, b: string) => k >= a && k <= b
    rows.forEach(r => {
      const c = (r.company_name || '').trim()
      if (!c) return
      if (!keeps(fGeo, r.geo)) return                    // GEO filter
      if (!keeps(fService, r.service_name)) return       // Service filter
      if (!keeps(fPm, pmOfBooking(r))) return            // PM filter
      const k = (r.booking_month || '').slice(0, 7)
      if (from && k < from) return        // From/To month range narrows the whole analysis
      if (to && k > to) return
      const amt = r.booking_amount || 0
      const cur = m.get(c) || { client: c, fyLast: 0, fyTd: 0, spLy: 0, spTy: 0, qv: QS.map(() => 0), upcoming: 0, pm: '', pmLatest: '', pmAll: new Set<string>() }
      const who = pmOfBooking(r)
      if (who) {
        cur.pmAll.add(who)
        // Latest booking wins, so the PM column says who holds the account now.
        if (k >= cur.pmLatest) { cur.pmLatest = k; cur.pm = who }
      }
      if (between(k, `${lyStart}-04`, `${tyStart}-03`)) cur.fyLast += amt
      // "to date" = current fiscal year up to (and including) the current month only
      if (k >= `${tyStart}-04` && k <= curMonthKey) cur.fyTd += amt
      else if (k > curMonthKey) cur.upcoming += amt   // future-dated/scheduled bookings, shown separately
      if (between(k, `${lyStart}-04`, `${lyStart}-${curMM}`)) cur.spLy += amt
      if (between(k, `${tyStart}-04`, `${tyStart}-${curMM}`)) cur.spTy += amt
      QS.forEach((fq, i) => { const [a, b] = qRange(fq); if (between(k, a, b)) cur.qv[i] += amt })
      m.set(c, cur)
    })
    return [...m.values()]
  }, [rows, from, to, fGeo, fService, fPm])

  // compare the two user-selected quarters (qCur vs qBase)
  const qStatus = (r: Row) => {
    const tq = r.qv[qCur], lq = r.qv[qBase]
    if (lq > 0 && tq <= 0) return 'Dropped'
    if (lq <= 0 && tq > 0) return 'New'
    if (tq > lq) return 'Up'
    if (tq < lq) return 'Down'
    return 'Flat'
  }
  const qDelta = (r: Row) => r.qv[qCur] - r.qv[qBase]
  const qPct = (r: Row) => r.qv[qBase] > 0 ? Math.round((qDelta(r) / r.qv[qBase]) * 100) : null

  // Every filter except the movement. The movement tabs count against this, so each tab
  // says how many clients it would show under the search as it stands.
  const scoped = useMemo(() => data
    .filter(r => r.client.toLowerCase().includes(q.toLowerCase()))
    .filter(r => r.fyLast || r.fyTd || r.qv.some(v => v)), [data, q])
  const view = useMemo(() => scoped
    .filter(r => !mv || qStatus(r) === mv)
    .sort((a, b) => b.fyTd - a.fyTd || b.fyLast - a.fyLast), [scoped, mv, qCur, qBase])
  const mvCount = (s: string) => scoped.filter(r => qStatus(r) === s).length

  const tot = (sel: (r: Row) => number) => view.reduce((s, r) => s + sel(r), 0)
  const aggTq = data.reduce((s, r) => s + r.qv[qCur], 0)
  const aggLq = data.reduce((s, r) => s + r.qv[qBase], 0)
  const qoqPct = aggLq > 0 ? Math.round(((aggTq - aggLq) / aggLq) * 100) : null
  const dropped = data.filter(r => qStatus(r) === 'Dropped').length
  const newq = data.filter(r => qStatus(r) === 'New').length
  const upcoming = data.reduce((s, r) => s + r.upcoming, 0)

  // ── What sits behind each card ────────────────────────────────────────────────
  // The rows are the clients each figure adds up, under the same filters. A client's
  // GEO is the one on its latest booking, so for Web the panel splits into the pods.
  const geoOf = useMemo(() => {
    const m = new Map<string, { k: string; geo: string }>()
    rows.forEach(r => {
      const c = (r.company_name || '').trim(), g = (r.geo || '').trim(), k = (r.booking_month || '').slice(0, 7)
      if (!c || !g) return
      const cur = m.get(c)
      if (!cur || k >= cur.k) m.set(c, { k, geo: g })
    })
    return m
  }, [rows])
  const cardDetails = useMemo(() => {
    const byGeo = (r: Row) => geoOf.get(r.client)?.geo || 'No GEO'
    const sum = (rs: Row[], f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0)
    const client: DetailCol<Row> = { key: 'client', label: 'Client / agency', value: r => <ClientLink name={r.client} />, wide: true, sort: r => r.client }
    const amt = (key: string, label: string, f: (r: Row) => number): DetailCol<Row> =>
      ({ key, label, value: r => money(f(r)), align: 'right', sort: f, total: rs => money(sum(rs, f)) })
    const pm: DetailCol<Row> = { key: 'pm', label: 'PM', value: r => r.pm || '—', sort: r => r.pm }
    const move: DetailCol<Row> = { key: 'mv', label: 'Movement', value: r => qStatus(r), sort: r => qStatus(r) }
    const lq = amt('lq', qLabel(QS[qBase]), r => r.qv[qBase]), tq = amt('tq', qLabel(QS[qCur]), r => r.qv[qCur])
    const delta: DetailCol<Row> = { key: 'd', label: 'Change', align: 'right', sort: qDelta,
      value: r => `${qDelta(r) >= 0 ? '+' : '-'}${money(Math.abs(qDelta(r)))}`,
      total: rs => { const d = sum(rs, qDelta); return `${d >= 0 ? '+' : '-'}${money(Math.abs(d))}` } }
    const gt = (f: (r: Row) => number) => (rs: Row[]) => money(sum(rs, f))
    const fyLast: CardDetails<Row> = {
      subtitle: `Clients with bookings Apr ${lyStart} – Mar ${tyStart}, under the filters and movement tab in use`,
      rows: view.filter(r => r.fyLast), rowKey: r => r.client, groupBy: byGeo, groupTotal: gt(r => r.fyLast), defaultSort: 'fyLast',
      columns: [client, amt('fyLast', 'Last FY', r => r.fyLast), amt('fyTd', 'This FY to date', r => r.fyTd), move, pm],
    }
    const fyTd: CardDetails<Row> = {
      subtitle: `Clients with bookings Apr ${tyStart} – ${SHORT[curM]} ${now.getFullYear()}, under the filters and movement tab in use`,
      rows: view.filter(r => r.fyTd), rowKey: r => r.client, groupBy: byGeo, groupTotal: gt(r => r.fyTd), defaultSort: 'fyTd',
      columns: [client, amt('fyTd', 'This FY to date', r => r.fyTd), amt('fyLast', 'Last FY', r => r.fyLast), move, pm],
    }
    // The percentage is total against total; the rows are every client billed in
    // either quarter, and the two amount footers are the two totals it divides.
    const inEither = data.filter(r => r.qv[qCur] || r.qv[qBase])
    const qoq: CardDetails<Row> = {
      subtitle: `${money(aggTq)} in ${qLabel(QS[qCur])} against ${money(aggLq)} in ${qLabel(QS[qBase])} — every client billed in either`,
      rows: inEither, rowKey: r => r.client, groupBy: r => qStatus(r), groupTotal: gt(qDelta), defaultSort: 'd',
      columns: [client, lq, tq, delta, pm],
    }
    const dn: CardDetails<Row> = {
      subtitle: `Dropped = billed in ${qLabel(QS[qBase])}, nothing in ${qLabel(QS[qCur])}; New = the reverse`,
      rows: data.filter(r => ['Dropped', 'New'].includes(qStatus(r))), rowKey: r => r.client,
      groupBy: r => qStatus(r), defaultSort: 'lq',
      columns: [client, lq, tq, pm, { key: 'geo', label: 'GEO', value: byGeo, sort: byGeo }],
    }
    return { fyLast, fyTd, qoq, dn }
  // qStatus/qDelta read qCur/qBase, which are in the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, data, geoOf, qCur, qBase, aggTq, aggLq])

  const badge = (s: string) => ({
    Up: 'bg-green-500/15 text-green-400', New: 'bg-green-500/15 text-green-400',
    Down: 'bg-amber-500/15 text-amber-400', Dropped: 'bg-red-500/15 text-red-400',
    Flat: 'bg-mav-line text-mav-muted',
  } as Record<string, string>)[s] || 'bg-mav-line text-mav-muted'
  const sel = 'bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'

  return (
    <div>
      <Header title="Quarter over Quarter Review" subtitle={`Quarter against quarter and year against year — who’s growing, slipping or dropped off`}
        chip={`${qLabel(QS[qCur])} vs ${qLabel(QS[qBase])}`} />

      <KPIRow cols={4}>
        <KPICard tone="accent" label={`FY ${lyStart}-${String(tyStart).slice(2)} (Apr–Mar)`} value={money(tot(r => r.fyLast))} details={cardDetails.fyLast} />
        <KPICard label={`FY ${tyStart}-${String(tyStart + 1).slice(2)} to date`} value={money(tot(r => r.fyTd))} details={cardDetails.fyTd}
          note={upcoming > 0 ? `Excludes ${money(upcoming)} future-dated` : undefined}
          info={<>&ldquo;To date&rdquo; counts Apr&nbsp;{tyStart}–{SHORT[curM]}&nbsp;{tyStart}.{upcoming > 0 && <> It excludes {money(upcoming)} in future-dated/scheduled bookings beyond {SHORT[curM]}&nbsp;{tyStart}.</>}</>} />
        <KPICard tone={qoqPct == null ? 'default' : qoqPct >= 0 ? 'green' : 'red'} label={`${qLabel(QS[qBase])} → ${qLabel(QS[qCur])}`} value={(qoqPct == null ? '—' : (qoqPct >= 0 ? '+' : '') + qoqPct + '%')} change={qoqPct} details={cardDetails.qoq}
          info={`Pick any two quarters with the Compare / vs selectors — use two completed quarters (e.g. ${qLabel(QS[Math.max(0, CUR_I - 1)])}) to avoid the current quarter being incomplete.`} />
        <KPICard tone={dropped ? 'red' : 'default'} label="Dropped / New" value={`${dropped} / ${newq}`} details={cardDetails.dn}
          info={`Dropped = had revenue in ${qLabel(QS[qBase])} but none in ${qLabel(QS[qCur])}; New = the reverse.`} />
      </KPIRow>

      {/* The movement between the two chosen quarters is the page's main split. */}
      <Segments<string>
        value={mv}
        onChange={setMv}
        items={[
          { id: '', label: 'All movements', count: scoped.length },
          { id: 'Dropped', label: 'Dropped', count: mvCount('Dropped'), title: 'Had baseline, not compared' },
          { id: 'New', label: 'New', count: mvCount('New'), title: 'Compared only' },
          { id: 'Up', label: 'Up', count: mvCount('Up'), title: 'Up vs baseline' },
          { id: 'Down', label: 'Down', count: mvCount('Down'), title: 'Down vs baseline' },
          { id: 'Flat', label: 'Flat', count: mvCount('Flat') },
        ]} />

      {/* Row 1: which quarters and who; row 2: the month range that narrows everything. */}
      <FilterBar right={<span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{view.length} clients</span>}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client…" className={`${sel} w-56`} />
        <span className="text-xs text-mav-muted ml-1">Compare</span>
        <select value={qCur} onChange={e => setQCur(+e.target.value)} className={sel} title="Quarter to compare">
          {QS.map((f, i) => <option key={i} value={i}>{qLabel(f)}{i === CUR_I ? ' · current' : ''}</option>)}
        </select>
        <span className="text-xs text-mav-muted">vs</span>
        <select value={qBase} onChange={e => setQBase(+e.target.value)} className={sel} title="Quarter to compare against">
          {QS.map((f, i) => <option key={i} value={i}>{qLabel(f)}{i === CUR_I ? ' · current' : ''}</option>)}
        </select>
        <div className="basis-full h-0" />
        <MultiSelect label="All GEO" options={geos} selected={fGeo} onChange={setFGeo} className="w-36" />
        <MultiSelect label="All services" options={services} selected={fService} onChange={setFService} className="w-44" />
        <MultiSelect label="All PMs" options={pms} selected={fPm} onChange={setFPm} className="w-40" />
        <span className="text-xs text-mav-muted ml-1">From</span>
        <input type="month" value={from} onChange={e => setFrom(e.target.value)} className={sel} aria-label="From month" />
        <span className="text-xs text-mav-muted">To</span>
        <input type="month" value={to} onChange={e => setTo(e.target.value)} className={sel} aria-label="To month" />
        {(from || to || fGeo.length > 0 || fService.length > 0 || fPm.length > 0) && <button onClick={() => { setFrom(''); setTo(''); setFGeo([]); setFService([]); setFPm([]) }} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">Reset</button>}
      </FilterBar>

      <Panel flush title="Clients by quarter"
        info={<><span className="font-semibold">PM</span> is whoever is on the client&rsquo;s most recent booking; a <span className="font-semibold">+n</span> beside it means the account changed hands during the period — hover to see everyone who held it. Filtering by PM narrows every figure on the page to that PM&rsquo;s bookings only.</>}
        right={<ColumnPicker cols={cols} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-5 py-3 font-medium sticky left-0 bg-mav-panel">Client</th>
                {cols.on('pm') && <th className="px-4 py-3 font-medium whitespace-nowrap">PM</th>}
                {cols.on('fyLast') && <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY {String(lyStart).slice(2)}-{String(tyStart).slice(2)}</th>}
                {cols.on('fyTd') && <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FY {String(tyStart).slice(2)} TD</th>}
                {QS.map((f, i) => showQ(i) && <th key={i} className={`px-4 py-3 font-medium text-right whitespace-nowrap ${i === qCur ? 'text-mav-yellow' : i === qBase ? 'text-mav-fg' : ''}`}>{qLabel(f)}{i === qCur ? ' (compare)' : i === qBase ? ' (vs)' : ''}</th>)}
                {cols.on('delta') && <th className="px-4 py-3 font-medium text-right whitespace-nowrap">QoQ Δ</th>}
                {cols.on('trend') && <th className="px-5 py-3 font-medium">Qtr trend</th>}
              </tr>
            </thead>
            <tbody>
              {view.map(r => {
                const st = qStatus(r); const p = qPct(r); const d = qDelta(r)
                return (
                  <tr key={r.client} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-3 font-medium whitespace-nowrap sticky left-0 bg-mav-panel"><ClientLink name={r.client} /></td>
                    {cols.on('pm') && <td className="px-4 py-3 whitespace-nowrap">
                      {r.pm
                        ? <>
                            <span>{r.pm}</span>
                            {r.pmAll.size > 1 && (
                              <span className="text-xs text-mav-muted ml-1.5" title={`Held by ${[...r.pmAll].join(', ')} over this period`}>
                                +{r.pmAll.size - 1}
                              </span>
                            )}
                          </>
                        : <span className="text-mav-muted">—</span>}
                    </td>}
                    {cols.on('fyLast') && <td className="px-4 py-3 text-right text-mav-muted">{r.fyLast ? money(r.fyLast) : '—'}</td>}
                    {cols.on('fyTd') && <td className="px-4 py-3 text-right">{r.fyTd ? money(r.fyTd) : '—'}</td>}
                    {r.qv.map((v, i) => showQ(i) && <td key={i} className={`px-4 py-3 text-right whitespace-nowrap ${i === qCur ? 'text-mav-yellow font-medium' : i === qBase ? '' : 'text-mav-muted'}`}>{v ? money(v) : '—'}</td>)}
                    {cols.on('delta') && <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${d > 0 ? 'text-green-400' : d < 0 ? 'text-red-400' : 'text-mav-muted'}`}>
                      {d === 0 ? '—' : (d > 0 ? '+' : '') + money(d)}{p != null && <span className="text-xs text-mav-muted ml-1">({p >= 0 ? '+' : ''}{p}%)</span>}
                    </td>}
                    {cols.on('trend') && <td className="px-5 py-3"><span className={`text-xs px-2 py-1 rounded-full ${badge(st)}`}>{st}</span></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
