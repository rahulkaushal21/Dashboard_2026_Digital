'use client'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import Header from '@/components/Header'
import { getRevenueHistory, getRevenueSources, type RevenueHistoryRow, type RevenueSource } from '@/lib/supabase'
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

const MODEL_COLOR: Record<string, string> = {
  'Dedicated': '#FFDB2D', 'Partial Dedicated': '#f59e0b', 'New Development': '#3b82f6',
  'Maintanance': '#10b981', 'Ad-hoc': '#a855f7', 'Additional Pages': '#0284c7', 'Change Request': '#f43f5e',
}
const colorFor = (m: string) => MODEL_COLOR[m] || '#333333'

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

export default function RevenueHistory() {
  const [rows, setRows] = useState<RevenueHistoryRow[]>([])
  const [sources, setSources] = useState<RevenueSource[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')

  const load = () => Promise.all([getRevenueHistory(), getRevenueSources()])
    .then(([r, s]) => { setRows(r); setSources(s) }).finally(() => setLoading(false))
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

  const d = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.booking_amount || 0), 0)
    const byMonth = new Map<string, number>()
    const byModel = new Map<string, number>()
    const byGeo = new Map<string, number>()
    const byDept = new Map<string, number>()
    const byClient = new Map<string, number>()
    const byFy = new Map<number, { amount: number; clients: Set<string> }>()
    for (const r of rows) {
      const k = ym(r.booking_month), amt = Number(r.booking_amount || 0)
      byMonth.set(k, (byMonth.get(k) || 0) + amt)
      byModel.set(r.engagement_model || 'Unspecified', (byModel.get(r.engagement_model || 'Unspecified') || 0) + amt)
      byGeo.set(r.geo || 'Unspecified', (byGeo.get(r.geo || 'Unspecified') || 0) + amt)
      byDept.set(r.service_dept || 'Unspecified', (byDept.get(r.service_dept || 'Unspecified') || 0) + amt)
      byClient.set(r.company_name, (byClient.get(r.company_name) || 0) + amt)
      const fy = fyOf(k)
      const cur = byFy.get(fy) || { amount: 0, clients: new Set<string>() }
      cur.amount += amt; cur.clients.add(r.company_name.toLowerCase()); byFy.set(fy, cur)
    }
    const months = [...byMonth.keys()].sort()
    const series = months.map(k => ({ key: k, label: monLabel(k), fy: fyOf(k), amount: Math.round(byMonth.get(k) || 0) }))
    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    return {
      total, series, months,
      models: sortDesc(byModel), geos: sortDesc(byGeo), depts: sortDesc(byDept), clients: sortDesc(byClient),
      fys: [...byFy.entries()].map(([fy, v]) => ({
        fy, amount: Math.round(v.amount), clients: v.clients.size,
        // Complete only if the data actually spans Apr(fy) → Mar(fy+1). Flagging
        // by position instead would have called FY24-25 partial when it ends
        // exactly on the FY boundary, and its +14% is a real comparison.
        complete: months[0] <= `${fy}-04` && months[months.length - 1] >= `${fy + 1}-03`,
      })).sort((a, b) => a.fy - b.fy),
      clientCount: byClient.size,
    }
  }, [rows])

  const src = sources[0]

  return (
    <div>
      <Header title="Revenue history" subtitle="Earlier years loaded from the yearly revenue spreadsheets. Held separately from the live revenue table, so nothing on the other pages moves." />

      {loading ? <p className="text-mav-muted text-sm">Loading…</p> : rows.length === 0 ? (
        <p className="text-mav-muted text-sm">No historical revenue loaded yet.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Total billed" value={fmtUsd(d.total)} sub={`${d.months.length} months`} />
            <Kpi label="Period" value={`${monLabel(d.months[0])} → ${monLabel(d.months[d.months.length - 1])}`} sub="by confirmation month" />
            <Kpi label="Clients" value={String(d.clientCount)} sub="distinct agencies" />
            <Kpi label="Rows" value={rows.length.toLocaleString()} sub="project lines" />
          </div>

          <Panel title="Monthly billing" right={<span className="text-[11px] text-mav-muted">bars tinted by financial year (Apr–Mar)</span>}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="label" stroke="#9a9a9a" fontSize={10} tickLine={false} axisLine={false} interval={1} />
                <YAxis stroke="#9a9a9a" fontSize={10} tickLine={false} axisLine={false} width={48}
                  tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ fill: '#ffffff08' }}
                  contentStyle={{ background: '#1B1B1B', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [fmtUsd(v), 'Billed']} />
                <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                  {d.series.map(p => <Cell key={p.key} fill={p.fy % 2 === 0 ? '#FFDB2D' : '#b99a1f'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
                A year is marked <span className="text-mav-muted">partial</span> when this source does not cover its full
                Apr–Mar span; FY22-23 starts at Sep 2022. Year-on-year is shown only where both years are complete, so a
                partial year never produces a growth figure that is really just a shorter window.
              </p>
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="By service" right={<span className="text-[11px] text-mav-muted">derived from Technology</span>}>
              <Split rows={d.depts} total={d.total}
                color={(n) => ({ Web: '#FFDB2D', HUB: '#3b82f6', LP: '#10b981' } as any)[n] || '#333'} />
              <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
                This sheet has no Service Department column, so the split is derived: Hubspot &rarr; HUB, LP or Banner
                &rarr; LP, everything else &rarr; Web. Banner work counts as LP — reconciled against the reported FY24-25
                figures, HUB lands within $3 and LP within $42.
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
