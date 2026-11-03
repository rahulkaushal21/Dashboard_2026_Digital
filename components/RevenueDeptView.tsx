'use client'
import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { useThemeInk } from '@/lib/use-theme-ink'
import KPICard from '@/components/KPICard'
import { KPIRow, Panel, SectionTitle, Segments } from '@/components/PageParts'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import { fmtUsd } from '@/lib/metrics'
import {
  type Row, type Dept, DEPTS, DEPT_COLOR, deptGroup, isUnplacedDept, fyOf, fyLabel, monLabel, thisYm,
  fyStats, bridge, pctChange, fmtPct, pctTone,
} from '@/lib/revenue-history'

// Colours for the engagement-model split, shared with the client tab.
const MODEL_COLOR: Record<string, string> = {
  'Dedicated': '#FFDB2D', 'Partial Dedicated': '#f59e0b', 'New Development': '#3b82f6',
  'Maintanance': '#10b981', 'Ad-hoc': '#a855f7', 'Additional Pages': '#0284c7', 'Change Request': '#f43f5e',
}
const colorFor = (m: string) => MODEL_COLOR[m] || '#9ca3af'

const MONTH_COLS: ColumnDef[] = [
  { key: 'month', label: 'Month', locked: true },
  { key: 'fy', label: 'Financial year' },
  { key: 'web', label: 'WEB', default: true },
  { key: 'lphub', label: 'LP/HUB', default: true },
  { key: 'total', label: 'Total', default: true },
  { key: 'share', label: 'LP/HUB share of total' },
  { key: 'mom', label: 'Total vs last month' },
  { key: 'yoy', label: 'Total vs same month last year', default: true },
  { key: 'webYoy', label: 'WEB vs same month last year' },
  { key: 'lphubYoy', label: 'LP/HUB vs same month last year' },
  { key: 'clients', label: 'Clients billed' },
]

type Slice = 'ALL' | Dept

export default function RevenueDeptView({ every }: { every: Row[] }) {
  const ink = useThemeInk()
  const now = thisYm()
  const rows = useMemo(() => every.map(r => ({ ...r, group: deptGroup(r.dept) })), [every])
  const unplaced = useMemo(() => every.filter(r => isUnplacedDept(r.dept)).length, [every])
  const by = (d: Dept | 'ALL') => (d === 'ALL' ? rows : rows.filter(r => r.group === d))

  const years = useMemo(() => [...new Set(rows.map(r => fyOf(r.month)))].sort((a, b) => a - b), [rows])
  const stats = useMemo(() => ({
    ALL: fyStats(rows, rows, years),
    WEB: fyStats(by('WEB'), rows, years),
    'LP/HUB': fyStats(by('LP/HUB'), rows, years),
  }), [rows, years]) // eslint-disable-line react-hooks/exhaustive-deps

  const [selFy, setSelFy] = useState<number | null>(null)
  const [modelDept, setModelDept] = useState<Slice>('ALL')
  const cur = selFy != null && years.includes(selFy) ? selFy : years[years.length - 1]
  const curStat = (k: 'ALL' | Dept) => stats[k].find(s => s.fy === cur)!
  const hasPrev = years.includes(cur - 1)

  const total = rows.reduce((s, r) => s + r.amount, 0)
  const sumDept = (d: Dept) => by(d).reduce((s, r) => s + r.amount, 0)

  // ── Chart data ─────────────────────────────────────────────────────────────────────
  const fyChart = years.map(fy => ({
    label: fyLabel(fy) + (stats.ALL.find(s => s.fy === fy)!.partial ? '*' : ''),
    WEB: Math.round(stats.WEB.find(s => s.fy === fy)!.total),
    'LP/HUB': Math.round(stats['LP/HUB'].find(s => s.fy === fy)!.total),
  }))
  const yoyChart = years.filter(fy => years.includes(fy - 1)).map(fy => ({
    label: fyLabel(fy) + (stats.ALL.find(s => s.fy === fy)!.partial ? '*' : ''),
    Total: stats.ALL.find(s => s.fy === fy)!.pct,
    WEB: stats.WEB.find(s => s.fy === fy)!.pct,
    'LP/HUB': stats['LP/HUB'].find(s => s.fy === fy)!.pct,
  }))

  const months = useMemo(() => {
    const m = new Map<string, { key: string; WEB: number; 'LP/HUB': number; clients: Set<string> }>()
    for (const r of rows) {
      const c = m.get(r.month) || { key: r.month, WEB: 0, 'LP/HUB': 0, clients: new Set<string>() }
      c[r.group] += r.amount; c.clients.add(r.client.toLowerCase()); m.set(r.month, c)
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [rows])
  const monthChart = months.map(m => ({ label: monLabel(m.key), key: m.key, WEB: Math.round(m.WEB), 'LP/HUB': Math.round(m['LP/HUB']) }))

  const cols = useColumns('revenue-history-dept-months', MONTH_COLS)
  const monthTable = [...months].reverse().map(m => {
    const i = months.findIndex(x => x.key === m.key)
    const prevM = i > 0 ? months[i - 1] : null
    const yago = months.find(x => x.key === `${+m.key.slice(0, 4) - 1}${m.key.slice(4)}`)
    const t = m.WEB + m['LP/HUB']
    const yt = yago ? yago.WEB + yago['LP/HUB'] : 0
    return {
      ...m, total: t, inProgress: m.key === now,
      share: t ? (m['LP/HUB'] / t) * 100 : null,
      mom: prevM ? pctChange(t, prevM.WEB + prevM['LP/HUB']) : null,
      yoy: yago ? pctChange(t, yt) : null,
      webYoy: yago ? pctChange(m.WEB, yago.WEB) : null,
      lphubYoy: yago ? pctChange(m['LP/HUB'], yago['LP/HUB']) : null,
    }
  })
  const [showAllMonths, setShowAllMonths] = useState(false)
  const monthsShown = showAllMonths ? monthTable : monthTable.slice(0, 14)

  // ── Engagement model, by year, for the chosen department ───────────────────────────
  const modelRows = by(modelDept)
  const modelNames = [...new Set(modelRows.map(r => r.model))]
    .sort((a, b) => modelRows.filter(r => r.model === b).reduce((s, r) => s + r.amount, 0) - modelRows.filter(r => r.model === a).reduce((s, r) => s + r.amount, 0))
  const modelFy = (name: string) => fyStats(modelRows.filter(r => r.model === name), rows, years)
  const modelChart = years.map(fy => {
    const o: Record<string, number | string> = { label: fyLabel(fy) + (stats.ALL.find(s => s.fy === fy)!.partial ? '*' : '') }
    for (const n of modelNames) o[n] = Math.round(modelRows.filter(r => r.model === n && fyOf(r.month) === fy).reduce((s, r) => s + r.amount, 0))
    return o
  })
  const modelTotals = fyStats(modelRows, rows, years)

  // Department x model for the selected year: where each business earns.
  const matrix = useMemo(() => {
    const names = [...new Set(rows.map(r => r.model))]
    const sum = (d: Dept | 'ALL', n: string) => by(d).filter(r => fyOf(r.month) === cur && r.model === n).reduce((s, r) => s + r.amount, 0)
    const out = names.map(n => ({ name: n, WEB: sum('WEB', n), 'LP/HUB': sum('LP/HUB', n), all: sum('ALL', n) })).filter(x => x.all > 0)
    return out.sort((a, b) => b.all - a.all)
  }, [rows, cur]) // eslint-disable-line react-hooks/exhaustive-deps
  const matrixTot = { WEB: matrix.reduce((s, x) => s + x.WEB, 0), 'LP/HUB': matrix.reduce((s, x) => s + x['LP/HUB'], 0), all: matrix.reduce((s, x) => s + x.all, 0) }

  // Geography by department, selected year.
  const geoRows = useMemo(() => {
    const names = [...new Set(rows.map(r => r.geo))]
    const sum = (d: Dept | 'ALL', n: string) => by(d).filter(r => fyOf(r.month) === cur && r.geo === n).reduce((s, r) => s + r.amount, 0)
    return names.map(n => ({ name: n, WEB: sum('WEB', n), 'LP/HUB': sum('LP/HUB', n), all: sum('ALL', n) })).filter(x => x.all > 0).sort((a, b) => b.all - a.all)
  }, [rows, cur]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge by department for the selected year (same window as the stats).
  const wnd = useMemo(() => {
    const s = new Set<number>()
    for (const r of rows) if (fyOf(r.month) === cur && r.month !== now) s.add(+r.month.slice(5, 7))
    if (!s.size) for (const r of rows) if (fyOf(r.month) === cur) s.add(+r.month.slice(5, 7))
    return s
  }, [rows, cur, now])
  const bridges = (['ALL', ...DEPTS] as const).map(k => ({ k, name: k === 'ALL' ? 'Total' : k, b: bridge(by(k), cur, wnd) }))

  const tip = { contentStyle: { background: ink.tip, border: `1px solid ${ink.grid}`, borderRadius: 8, fontSize: 12 }, labelStyle: { color: ink.axis, marginBottom: 2 }, itemStyle: { color: ink.fg } }
  const usdK = (v: number) => `$${Math.round(v / 1000)}k`
  const latest = curStat('ALL')

  return (
    <div className="space-y-5">
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Total billed" value={fmtUsd(total)} sub={`${months.length} months, both departments`} />
        {DEPTS.map(d => {
          const s = curStat(d)
          return (
            <KPICard key={d} label={d} value={fmtUsd(sumDept(d))}
              sub={`${total ? Math.round((sumDept(d) / total) * 100) : 0}% of all billing · ${fyLabel(cur)} ${fmtPct(s.pct)}`} />
          )
        })}
        <KPICard label={`${fyLabel(cur)} vs ${fyLabel(cur - 1)}`} value={hasPrev ? fmtPct(latest.pct, 1) : '—'}
          sub={latest.partial ? `${latest.windowLabel} like-for-like` : 'full year'} />
      </KPIRow>

      <p className="text-xs text-mav-muted -mt-2">
        LP and HUB are one department here; every other line is WEB.
        {unplaced > 0 && ` ${unplaced.toLocaleString()} sheet ${unplaced === 1 ? 'row has' : 'rows have'} no department and ${unplaced === 1 ? 'is' : 'are'} counted under WEB.`}
        {' '}This view shows both departments side by side, so the sidebar department switch does not apply to it.
      </p>

      <SectionTitle info="Each year is Apr–Mar. A year marked * is still running: its percentage compares the completed months so far with the same months last year, and the month in progress is left out of both sides.">
        Year by year
      </SectionTitle>
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Billed each year" right={<span className="text-[11px] text-mav-muted">WEB and LP/HUB stacked</span>}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={fyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              <XAxis dataKey="label" stroke={ink.axis} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip cursor={{ fill: '#ffffff14' }} {...tip} formatter={(v: number, n: string) => [fmtUsd(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="WEB" stackId="a" fill={DEPT_COLOR.WEB} />
              <Bar dataKey="LP/HUB" stackId="a" fill={DEPT_COLOR['LP/HUB']} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Up or down on the year" right={<span className="text-[11px] text-mav-muted">% vs previous year</span>}>
          {yoyChart.length === 0 ? <p className="text-sm text-mav-muted">Needs two years of data.</p> : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={yoyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="label" stroke={ink.axis} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} />
                <ReferenceLine y={0} stroke={ink.axis} />
                <Tooltip cursor={{ fill: '#ffffff14' }} {...tip} formatter={(v: number, n: string) => [fmtPct(v, 1), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Total" fill="#9ca3af" radius={[3, 3, 0, 0]} />
                <Bar dataKey="WEB" fill={DEPT_COLOR.WEB} radius={[3, 3, 0, 0]} />
                <Bar dataKey="LP/HUB" fill={DEPT_COLOR['LP/HUB']} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <Panel title="Totals and year-on-year" flush right={<span className="text-[11px] text-mav-muted">* year still running</span>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2">Department</th>
                {years.map(fy => {
                  const s = stats.ALL.find(x => x.fy === fy)!
                  return <th key={fy} className="text-right px-3 py-2 whitespace-nowrap">{fyLabel(fy)}{s.partial && <span className="text-mav-muted"> *</span>}</th>
                })}
                <th className="text-right px-4 py-2">All years</th>
              </tr>
            </thead>
            <tbody>
              {(['ALL', ...DEPTS] as const).map(k => (
                <tr key={k} className={`border-t border-mav-line/60 ${k === 'ALL' ? 'font-semibold' : ''}`}>
                  <td className="py-2 px-4">
                    <span className="inline-flex items-center gap-2">
                      {k !== 'ALL' && <span className="w-2 h-2 rounded-sm" style={{ background: DEPT_COLOR[k] }} />}
                      {k === 'ALL' ? 'Total' : k}
                    </span>
                  </td>
                  {stats[k].map(s => (
                    <td key={s.fy} className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                      {s.total > 0 ? fmtUsd(s.total) : <span className="text-mav-muted">{'—'}</span>}
                      <span className={`block text-[10px] font-normal ${pctTone(s.pct)}`}>{fmtPct(s.pct)}</span>
                    </td>
                  ))}
                  <td className="py-2 px-4 text-right tabular-nums">{fmtUsd(k === 'ALL' ? total : sumDept(k))}</td>
                </tr>
              ))}
              <tr className="border-t border-mav-line/60 text-mav-muted">
                <td className="py-2 px-4">LP/HUB share of total</td>
                {years.map(fy => {
                  const t = stats.ALL.find(x => x.fy === fy)!.total
                  const l = stats['LP/HUB'].find(x => x.fy === fy)!.total
                  return <td key={fy} className="py-2 px-3 text-right tabular-nums">{t ? `${Math.round((l / t) * 100)}%` : '—'}</td>
                })}
                <td className="py-2 px-4 text-right tabular-nums">{total ? `${Math.round((sumDept('LP/HUB') / total) * 100)}%` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Monthly billing by department" right={<span className="text-[11px] text-mav-muted">the month in progress is part-billed</span>}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis dataKey="label" stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} interval={1} />
            <YAxis stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} width={48} tickFormatter={usdK} />
            <Tooltip cursor={{ fill: '#ffffff14' }} {...tip} formatter={(v: number, n: string) => [fmtUsd(v), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="WEB" stackId="a" fill={DEPT_COLOR.WEB} />
            <Bar dataKey="LP/HUB" stackId="a" fill={DEPT_COLOR['LP/HUB']} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Month by month" flush right={<ColumnPicker cols={cols} />}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2">Month</th>
                {cols.on('fy') && <th className="text-left px-3 py-2">Year</th>}
                {cols.on('web') && <th className="text-right px-3 py-2">WEB</th>}
                {cols.on('lphub') && <th className="text-right px-3 py-2">LP/HUB</th>}
                {cols.on('total') && <th className="text-right px-3 py-2">Total</th>}
                {cols.on('share') && <th className="text-right px-3 py-2 whitespace-nowrap">LP/HUB share</th>}
                {cols.on('mom') && <th className="text-right px-3 py-2 whitespace-nowrap">vs last month</th>}
                {cols.on('yoy') && <th className="text-right px-3 py-2 whitespace-nowrap">Total vs a year ago</th>}
                {cols.on('webYoy') && <th className="text-right px-3 py-2 whitespace-nowrap">WEB vs a year ago</th>}
                {cols.on('lphubYoy') && <th className="text-right px-3 py-2 whitespace-nowrap">LP/HUB vs a year ago</th>}
                {cols.on('clients') && <th className="text-right px-4 py-2">Clients</th>}
              </tr>
            </thead>
            <tbody>
              {monthsShown.map(m => (
                <tr key={m.key} className="border-t border-mav-line/60">
                  <td className="py-2 px-4 whitespace-nowrap font-medium">
                    {monLabel(m.key)}
                    {m.inProgress && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-mav-line text-mav-muted">in progress</span>}
                  </td>
                  {cols.on('fy') && <td className="py-2 px-3 text-mav-muted whitespace-nowrap">{fyLabel(fyOf(m.key))}</td>}
                  {cols.on('web') && <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(m.WEB)}</td>}
                  {cols.on('lphub') && <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(m['LP/HUB'])}</td>}
                  {cols.on('total') && <td className="py-2 px-3 text-right tabular-nums font-medium">{fmtUsd(m.total)}</td>}
                  {cols.on('share') && <td className="py-2 px-3 text-right tabular-nums">{m.share == null ? '—' : `${m.share.toFixed(0)}%`}</td>}
                  {cols.on('mom') && <td className={`py-2 px-3 text-right tabular-nums ${m.inProgress ? 'text-mav-muted' : pctTone(m.mom)}`}>{fmtPct(m.mom)}</td>}
                  {cols.on('yoy') && <td className={`py-2 px-3 text-right tabular-nums ${m.inProgress ? 'text-mav-muted' : pctTone(m.yoy)}`}>{fmtPct(m.yoy)}</td>}
                  {cols.on('webYoy') && <td className={`py-2 px-3 text-right tabular-nums ${m.inProgress ? 'text-mav-muted' : pctTone(m.webYoy)}`}>{fmtPct(m.webYoy)}</td>}
                  {cols.on('lphubYoy') && <td className={`py-2 px-3 text-right tabular-nums ${m.inProgress ? 'text-mav-muted' : pctTone(m.lphubYoy)}`}>{fmtPct(m.lphubYoy)}</td>}
                  {cols.on('clients') && <td className="py-2 px-4 text-right tabular-nums">{m.clients.size}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {monthTable.length > 14 && (
          <button onClick={() => setShowAllMonths(v => !v)} className="w-full py-2 text-xs text-mav-muted border-t border-mav-line hover:text-mav-fg">
            {showAllMonths ? 'Show the latest 14 months' : `Show all ${monthTable.length} months`}
          </button>
        )}
      </Panel>

      <SectionTitle info="Models are reproduced as the source spreadsheet spells them. The percentage under each figure is that model's change on the previous year, over the same months when the year is still running.">
        By engagement model
      </SectionTitle>
      <Segments<Slice>
        items={[{ id: 'ALL', label: 'Both departments' }, { id: 'WEB', label: 'WEB' }, { id: 'LP/HUB', label: 'LP/HUB' }]}
        value={modelDept} onChange={setModelDept} />
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Model mix per year" right={<span className="text-[11px] text-mav-muted">{modelDept === 'ALL' ? 'WEB + LP/HUB' : modelDept}</span>}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={modelChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              <XAxis dataKey="label" stroke={ink.axis} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip cursor={{ fill: '#ffffff14' }} {...tip} formatter={(v: number, n: string) => [fmtUsd(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {modelNames.map(n => <Bar key={n} dataKey={n} stackId="m" fill={colorFor(n)} />)}
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={`Model by department, ${fyLabel(cur)}`} flush>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2">Model</th>
                  <th className="text-right px-3 py-2">WEB</th>
                  <th className="text-right px-3 py-2">LP/HUB</th>
                  <th className="text-right px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(x => (
                  <tr key={x.name} className="border-t border-mav-line/60">
                    <td className="py-2 px-4"><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: colorFor(x.name) }} />{x.name}</span></td>
                    <td className="py-2 px-3 text-right tabular-nums">{x.WEB > 0 ? fmtUsd(x.WEB) : <span className="text-mav-muted">{'—'}</span>}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{x['LP/HUB'] > 0 ? fmtUsd(x['LP/HUB']) : <span className="text-mav-muted">{'—'}</span>}</td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {fmtUsd(x.all)}
                      <span className="block text-[10px] text-mav-muted">{matrixTot.all ? Math.round((x.all / matrixTot.all) * 100) : 0}%</span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-mav-line font-semibold">
                  <td className="py-2 px-4">Total</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(matrixTot.WEB)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(matrixTot['LP/HUB'])}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmtUsd(matrixTot.all)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title={`Model by year — ${modelDept === 'ALL' ? 'both departments' : modelDept}`} flush right={<span className="text-[11px] text-mav-muted">* year still running</span>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2">Model</th>
                {years.map(fy => (
                  <th key={fy} className="text-right px-3 py-2 whitespace-nowrap">{fyLabel(fy)}{stats.ALL.find(s => s.fy === fy)!.partial && <span className="text-mav-muted"> *</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelNames.map(n => {
                const st = modelFy(n)
                return (
                  <tr key={n} className="border-t border-mav-line/60">
                    <td className="py-2 px-4"><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: colorFor(n) }} />{n}</span></td>
                    {st.map(s => (
                      <td key={s.fy} className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                        {s.total > 0 ? fmtUsd(s.total) : <span className="text-mav-muted">{'—'}</span>}
                        <span className={`block text-[10px] ${pctTone(s.pct)}`}>{fmtPct(s.pct)}</span>
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr className="border-t border-mav-line font-semibold">
                <td className="py-2 px-4">Total</td>
                {modelTotals.map(s => (
                  <td key={s.fy} className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                    {fmtUsd(s.total)}
                    <span className={`block text-[10px] font-normal ${pctTone(s.pct)}`}>{fmtPct(s.pct)}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <SectionTitle info="The four movements add up exactly to the change in each department's total. A client counts as new when it billed nothing in the same months last year, and as stopped when it billed nothing this year; over a part-year window that can mean quiet rather than lost.">
        What moved the year, by department
      </SectionTitle>
      {years.filter(y => years.includes(y - 1)).length > 0 && (
        <Segments items={years.filter(y => years.includes(y - 1)).map(y => ({ id: String(y), label: fyLabel(y) }))}
          value={String(cur)} onChange={id => setSelFy(Number(id))} />
      )}
      {!hasPrev ? (
        <Panel><p className="text-sm text-mav-muted">No prior year to compare against.</p></Panel>
      ) : (
        <Panel title={`${fyLabel(cur)} against ${fyLabel(cur - 1)}`} flush right={<span className="text-[11px] text-mav-muted">{latest.partial ? `${latest.windowLabel} like-for-like` : 'full year'}</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm min-w-[760px]">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2">Department</th>
                  <th className="text-right px-3 py-2">Last year</th>
                  <th className="text-right px-3 py-2">This year</th>
                  <th className="text-right px-3 py-2">Change</th>
                  <th className="text-right px-3 py-2">New clients</th>
                  <th className="text-right px-3 py-2">Grew</th>
                  <th className="text-right px-3 py-2">Shrank</th>
                  <th className="text-right px-3 py-2">Stopped</th>
                  <th className="text-right px-3 py-2">Net retention</th>
                  <th className="text-right px-4 py-2">Clients</th>
                </tr>
              </thead>
              <tbody>
                {bridges.map(({ k, name, b }) => {
                  const pc = pctChange(b.cur, b.prev)
                  const mv = (v: number, n: number) => (
                    <td className={`py-2 px-3 text-right tabular-nums ${v >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {v >= 0 ? '+' : '−'}{fmtUsd(Math.abs(v))}<span className="block text-[10px] text-mav-muted">{n} {n === 1 ? 'client' : 'clients'}</span>
                    </td>
                  )
                  return (
                    <tr key={k} className={`border-t border-mav-line/60 ${k === 'ALL' ? 'font-semibold' : ''}`}>
                      <td className="py-2 px-4">{name}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(b.prev)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtUsd(b.cur)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${pctTone(pc)}`}>{fmtPct(pc, 1)}<span className="block text-[10px] text-mav-muted">{b.cur - b.prev >= 0 ? '+' : '−'}{fmtUsd(Math.abs(b.cur - b.prev))}</span></td>
                      {mv(b.nw, b.nwN)}{mv(b.ex, b.exN)}{mv(b.co, b.coN)}{mv(b.ch, b.chN)}
                      <td className={`py-2 px-3 text-right tabular-nums ${b.nrr == null ? 'text-mav-muted' : b.nrr >= 100 ? 'text-green-400' : 'text-red-400'}`}>{b.nrr == null ? '—' : `${b.nrr.toFixed(0)}%`}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{b.clients}<span className="block text-[10px] text-mav-muted">was {b.prevClients}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={`Geography by department, ${fyLabel(cur)}`} flush>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2">Geography</th>
                <th className="text-right px-3 py-2">WEB</th>
                <th className="text-right px-3 py-2">LP/HUB</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {geoRows.map(g => (
                <tr key={g.name} className="border-t border-mav-line/60">
                  <td className="py-2 px-4">{g.name}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{g.WEB > 0 ? fmtUsd(g.WEB) : <span className="text-mav-muted">{'—'}</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{g['LP/HUB'] > 0 ? fmtUsd(g['LP/HUB']) : <span className="text-mav-muted">{'—'}</span>}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmtUsd(g.all)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
