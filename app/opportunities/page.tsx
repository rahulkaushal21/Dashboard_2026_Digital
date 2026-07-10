'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getOpportunities, serviceOf, type Opportunity } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const badge = (s?: string) => {
const map: Record<string, string> = { pending: 'bg-amber-500/15 text-amber-400', received: 'bg-blue-500/15 text-blue-400', quoted: 'bg-purple-500/15 text-purple-300', won: 'bg-green-500/15 text-green-400', lost: 'bg-red-500/15 text-red-400' }
return map[(s || '').toLowerCase()] || 'bg-mav-line text-mav-muted'
}
const SRC_ORDER = ['spreadsheet', 'email']
const srcTag = (s: string) => s === 'email' ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400'
const srcLabel = (s: string) => s === 'email' ? 'Email' : 'Sheet'
const probColor = (p?: number) => p == null ? 'bg-mav-line text-mav-muted' : p >= 60 ? 'bg-green-500/15 text-green-400' : p >= 45 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
const probBar = (p?: number) => p == null ? 'bg-mav-line' : p >= 60 ? 'bg-green-500' : p >= 45 ? 'bg-amber-500' : 'bg-red-500'
const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const oppStatus = (x: Opportunity) => {
if (x.won) return 'Won'
const s = (x.status || '').toLowerCase()
if (s.includes('cancel') || s === 'lost') return 'Lost'
if (s.includes('hold')) return 'On Hold'
return 'Open'
}
const statusTone = (s: string) => s === 'Won' ? 'bg-green-500/15 text-green-400' : s === 'Lost' ? 'bg-red-500/15 text-red-400' : s === 'On Hold' ? 'bg-orange-500/15 text-orange-300' : 'bg-mav-line text-mav-muted'
const svcOf = (x: Opportunity) => x.service || serviceOf(x.technology)

type SortKey = 'company' | 'value' | 'win' | 'status' | 'source' | 'type' | 'owner' | 'geo' | 'tech' | 'date' | 'flag'
const COLS: { key: SortKey; label: string }[] = [
{ key: 'company', label: 'Client' }, { key: 'value', label: 'Value' }, { key: 'win', label: 'Win %' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' },
{ key: 'type', label: 'Type' }, { key: 'owner', label: 'Owner' }, { key: 'geo', label: 'GEO' }, { key: 'tech', label: 'Tech' },
{ key: 'date', label: 'Date' }, { key: 'flag', label: 'Review' },
]
const sortVal = (x: Opportunity, k: SortKey): string | number => {
switch (k) {
case 'company': return (x.company_name || '').toLowerCase()
case 'value': return x.value ?? -1
case 'win': return x.win_probability ?? -1
case 'status': return oppStatus(x)
case 'source': return (x.sources || []).join(',')
case 'type': return x.is_new_client ? 'New' : 'Repeat'
case 'owner': return (x.sales_person || '').toLowerCase()
case 'geo': return x.geo || ''
case 'tech': return (x.technology || '').toLowerCase()
case 'date': return x.first_date || x.source_date || ''
case 'flag': return x.flag ? 0 : 1
}
}

// Count + total open value grouped by a dimension, sorted by value desc.
const breakdown = (rows: Opportunity[], dim: (x: Opportunity) => string) => {
const m: Record<string, { count: number; value: number }> = {}
rows.forEach(x => { const k = dim(x) || '—'; const e = m[k] || (m[k] = { count: 0, value: 0 }); e.count++; e.value += x.value || 0 })
return Object.entries(m).sort((a, b) => b[1].value - a[1].value || b[1].count - a[1].count)
}

export default function Opportunities() {
const [all, setAll] = useState<Opportunity[]>([])
const [search, setSearch] = useState(''); const [fType, setFType] = useState(''); const [fGeo, setFGeo] = useState('')
const [fOwner, setFOwner] = useState(''); const [fStatus, setFStatus] = useState('Open'); const [fSvc, setFSvc] = useState(''); const [fTech, setFTech] = useState('')
const [from, setFrom] = useState('2026-04-01'); const [to, setTo] = useState('')
const [flagOnly, setFlagOnly] = useState(false)
const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 })
const [sel, setSel] = useState<Opportunity | null>(null)

// getOpportunities() merges email leads + the sheet Quotes tab (value + status).
useEffect(() => { getOpportunities().then(setAll) }, [])
// Default the "To" date to today (set on the client to avoid a hydration mismatch).
useEffect(() => { setTo(new Date().toISOString().slice(0, 10)) }, [])

// Undated rows always show; otherwise honour the From/To range.
const inRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return true; if (from && v < from) return false; if (to && v > to) return false; return true }
const toggleSort = (k: SortKey) => setSort(s => s.key === k ? { key: k, dir: (s.dir === 1 ? -1 : 1) } : { key: k, dir: k === 'date' || k === 'win' || k === 'value' ? -1 : 1 })

const o = useMemo(() => {
const rows = all
.filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
.filter(x => !fType || (x.is_new_client ? 'New' : 'Repeat') === fType)
.filter(x => !fGeo || (x.geo || '') === fGeo)
.filter(x => !fOwner || (x.sales_person || '') === fOwner)
.filter(x => !fStatus || oppStatus(x) === fStatus)
.filter(x => !fSvc || svcOf(x) === fSvc)
.filter(x => !fTech || (x.technology || '') === fTech)
.filter(x => !flagOnly || x.flag)
.filter(x => inRange(x.source_date))
return rows.sort((a, b) => {
const av = sortVal(a, sort.key), bv = sortVal(b, sort.key)
if (av < bv) return -1 * sort.dir
if (av > bv) return 1 * sort.dir
return 0
})
}, [all, search, fType, fGeo, fOwner, fStatus, fSvc, fTech, flagOnly, from, to, sort])

const reset = () => { setSearch(''); setFType(''); setFGeo(''); setFOwner(''); setFStatus(''); setFSvc(''); setFTech(''); setFrom('2026-04-01'); setTo(new Date().toISOString().slice(0, 10)); setFlagOnly(false) }
const flagged = all.filter(x => x.flag).length

// Headline numbers follow the DATE range (independent of the other dropdowns so
// the breakdown panels stay stable for click-to-filter).
const dated = useMemo(() => all.filter(x => inRange(x.source_date)), [all, from, to])
const open = useMemo(() => dated.filter(x => oppStatus(x) === 'Open'), [dated])
const openValue = open.reduce((s, x) => s + (x.value || 0), 0)
const onHold = useMemo(() => dated.filter(x => oppStatus(x) === 'On Hold'), [dated])
const won = useMemo(() => dated.filter(x => oppStatus(x) === 'Won'), [dated])
const wonValue = won.reduce((s, x) => s + (x.value || x.won_amount || 0), 0)
const byGeo = useMemo(() => breakdown(open, x => x.geo || '—'), [open])
const bySvc = useMemo(() => breakdown(open, svcOf), [open])
const byTech = useMemo(() => breakdown(open, x => x.technology || '—'), [open])

const Panel = ({ title, rows, active, onPick }: { title: string; rows: [string, { count: number; value: number }][]; active: string; onPick: (k: string) => void }) => (
<div className="bg-mav-panel border border-mav-line rounded-xl p-4">
<div className="text-sm font-medium mb-3">{title} <span className="text-xs text-mav-muted font-normal">· open pipeline</span></div>
<div className="space-y-1.5 max-h-64 overflow-y-auto">{rows.map(([k, v]) => (
<button key={k} onClick={() => onPick(active === k ? '' : k)}
className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${active === k ? 'bg-mav-yellow/15 text-mav-yellow' : 'hover:bg-mav-dark/50'}`}>
<span className="truncate">{k}</span>
<span className="whitespace-nowrap text-xs"><span className="text-mav-muted">{v.count} ·</span> {money(v.value)}</span>
</button>
))}{!rows.length && <div className="text-xs text-mav-muted">None</div>}</div>
</div>
)

return (
<div>
<Header title="Opportunities" subtitle="One row per deal from the Quotes sheet (price, status, AM, PC, GEO) + email-only opportunities — with a brief, next step and % confidence." />

<div className="text-xs text-mav-muted mb-2">Headline numbers &amp; breakdowns below reflect the date range <span className="text-white">{from || '…'} → {to || 'today'}</span> (change it in the filter bar).</div>
<div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
<KPICard label="Open opportunities" value={String(open.length)} />
<KPICard label="Open pipeline value" value={money(openValue)} />
<KPICard label="On Hold" value={String(onHold.length)} />
<KPICard label="Won" value={String(won.length)} />
<KPICard label="Won value" value={money(wonValue)} />
</div>

<div className="grid md:grid-cols-3 gap-4 mb-6">
<Panel title="By GEO" rows={byGeo} active={fGeo} onPick={k => { setFStatus('Open'); setFGeo(k === '—' ? '' : k) }} />
<Panel title="By Service" rows={bySvc} active={fSvc} onPick={k => { setFStatus('Open'); setFSvc(k) }} />
<Panel title="By Technology" rows={byTech} active={fTech} onPick={k => { setFStatus('Open'); setFTech(k === '—' ? '' : k) }} />
</div>

<div className="flex flex-wrap items-center gap-2 mb-4">
<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client…" className={`${selCls} w-44`} />
<select value={fStatus} onChange={e => setFStatus(e.target.value)} className={selCls}><option value="">All status</option><option value="Open">Open</option><option value="On Hold">On Hold</option><option value="Won">Won</option><option value="Lost">Lost</option></select>
<select value={fType} onChange={e => setFType(e.target.value)} className={selCls}><option value="">All types</option><option value="New">New</option><option value="Repeat">Repeat</option></select>
<select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(all.map(x => x.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
<select value={fSvc} onChange={e => setFSvc(e.target.value)} className={selCls}><option value="">All services</option>{uniq(all.map(svcOf)).map(s => <option key={s} value={s}>{s}</option>)}</select>
<select value={fTech} onChange={e => setFTech(e.target.value)} className={selCls}><option value="">All tech</option>{uniq(all.map(x => x.technology)).map(t => <option key={t} value={t}>{t}</option>)}</select>
<select value={fOwner} onChange={e => setFOwner(e.target.value)} className={selCls}><option value="">All owners</option>{uniq(all.map(x => x.sales_person)).map(ow => <option key={ow} value={ow}>{ow}</option>)}</select>
<button onClick={() => setFlagOnly(v => !v)} className={`text-sm px-3 py-2 rounded-md border transition-colors ${flagOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>⚠ Needs review{flagged ? ` (${flagged})` : ''}</button>
<span className="text-xs text-mav-muted ml-1">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
<span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
<button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
<span className="text-xs text-mav-muted ml-auto">{o.length} shown · {money(o.reduce((s, x) => s + (x.value || 0), 0))}</span>
</div>

<div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
<div className="overflow-x-auto">
<table className="w-full text-sm">
<thead className="text-left text-mav-muted border-b border-mav-line"><tr>{COLS.map(c => (
<th key={c.key} onClick={() => toggleSort(c.key)} className="px-4 py-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white">
{c.label}<span className="ml-1 text-[10px]">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
</th>
))}</tr></thead>
<tbody>{o.map(x => {
const st = oppStatus(x)
return (
<tr key={x.id} onClick={() => setSel(x)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${st === 'Lost' ? 'bg-red-500/5' : x.flag ? 'bg-amber-500/5' : ''}`}>
<td className="px-4 py-3">{x.company_name}{x.summary && <div className="text-xs text-mav-muted">{x.summary.slice(0, 80)}</div>}</td>
<td className="px-4 py-3 whitespace-nowrap font-medium">{x.value ? money(x.value) : <span className="text-mav-muted font-normal">—</span>}</td>
<td className="px-4 py-3">{x.win_probability != null ? <span className={`text-xs font-semibold px-2 py-1 rounded-full ${probColor(x.win_probability)}`}>{x.win_probability}%</span> : <span className="text-xs text-mav-muted">—</span>}</td>
<td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusTone(st)}`}>{st === 'Won' ? `✓ Won${x.won_amount ? ' · ' + money(x.won_amount) : ''}` : st === 'Lost' ? '✗ Lost' : st}</span></td>
<td className="px-4 py-3 whitespace-nowrap">{(x.sources || (x.source ? [x.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full mr-1 ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}</td>
<td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${x.is_new_client ? 'bg-blue-500/15 text-blue-400' : 'bg-mav-line text-mav-muted'}`}>{x.is_new_client ? 'New' : 'Repeat'}</span></td>
<td className="px-4 py-3 text-mav-muted">{x.sales_person ? <span title="Account Manager">AM: {x.sales_person}</span> : '—'}{x.pm_owner && <div className="text-xs text-mav-yellow mt-0.5" title="Project Coordinator">PC: {x.pm_owner}</div>}</td>
<td className="px-4 py-3 text-mav-muted">{x.geo}</td>
<td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.technology || '—'}</td>
<td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.first_date || x.source_date || '').slice(0, 10)}</td>
<td className="px-4 py-3">{x.flag ? <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 font-semibold whitespace-nowrap" title={x.flag}>⚠ Review</span> : <span className="text-xs text-mav-muted">—</span>}</td>
</tr>
)
})}</tbody>
</table>
</div>
</div>

{sel && (
<div className="fixed inset-0 z-40" onClick={() => setSel(null)}>
<div className="absolute inset-0 bg-black/50" />
<aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
<div className="flex items-start justify-between gap-3 mb-4">
<div>
<h2 className="text-xl font-semibold">{sel.company_name}</h2>
<div className="mt-1 flex flex-wrap gap-1">
<span className={`text-xs px-2 py-1 rounded-full ${statusTone(oppStatus(sel))}`}>{oppStatus(sel)}</span>
<span className={`text-xs px-2 py-1 rounded-full ${sel.is_new_client ? 'bg-blue-500/15 text-blue-400' : 'bg-mav-line text-mav-muted'}`}>{sel.is_new_client ? 'New business' : 'Repeat client'}</span>
{(sel.sources || (sel.source ? [sel.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}
</div>
</div>
<button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
</div>

<div className="mb-4 flex items-center justify-between rounded-lg border border-mav-line bg-mav-dark/40 px-4 py-3">
<span className="text-xs uppercase tracking-wide text-mav-muted">Value</span>
<span className="text-2xl font-bold">{sel.value ? money(sel.value) : '—'}</span>
</div>

{sel.flag && <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"><span className="font-semibold">⚠ Possible data issue:</span> {sel.flag}</div>}
{oppStatus(sel) === 'Won' && <div className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-400 font-semibold">✓ Won — {money(sel.won_amount || sel.value)} confirmed (booked in the revenue sheet)</div>}
{oppStatus(sel) === 'Lost' && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400 font-semibold">✗ Lost — marked from an explicit decline in email. Won always overrides if the client later books.</div>}

<div className="mb-5">
<div className="flex items-baseline justify-between mb-1">
<span className="text-xs uppercase tracking-wide text-mav-muted">Close likelihood</span>
<span className={`text-2xl font-bold ${sel.win_probability == null ? 'text-mav-muted' : sel.win_probability >= 60 ? 'text-green-400' : sel.win_probability >= 45 ? 'text-amber-400' : 'text-red-400'}`}>{sel.win_probability != null ? sel.win_probability + '%' : '—'}</span>
</div>
<div className="h-2 w-full rounded-full bg-mav-dark overflow-hidden"><div className={`h-full ${probBar(sel.win_probability)}`} style={{ width: (sel.win_probability ?? 0) + '%' }} /></div>
</div>

{sel.win_reason && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Will it close?</div><p className="text-sm leading-relaxed text-mav-muted">{sel.win_reason}</p></div>}
{(() => {
  // The Brief should carry the FULL story — the request, the quote/price shared, and
  // where the discussion stands. `summary` holds that detailed narrative; `gist` is a
  // shorter one-liner. Show both, longest-first, dropping either if it's already
  // contained in the other so we never repeat a sentence.
  const g = (sel.gist || '').trim(), s = (sel.summary || '').trim()
  const brief = g && s ? (s.includes(g) ? s : g.includes(s) ? g : `${s}\n\n${g}`) : (s || g)
  return brief
    ? <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Brief — what's happening</div><p className="text-sm leading-relaxed whitespace-pre-line">{brief}</p></div>
    : <p className="text-sm text-mav-muted mb-5">No email brief yet for this lead — it comes from an open quote in the sheet.</p>
})()}
{sel.next_step && <div className="mb-5 rounded-lg border border-mav-yellow/30 bg-mav-yellow/5 px-3 py-2"><div className="text-xs uppercase tracking-wide text-mav-yellow mb-1">▶ Next step</div><p className="text-sm leading-relaxed">{sel.next_step}</p></div>}
{sel.journey && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Journey</div><p className="text-sm leading-relaxed text-mav-muted whitespace-pre-line">{sel.journey}</p></div>}
{sel.company_note && <div className="mb-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Company</div><p className="text-sm leading-relaxed italic text-mav-muted">{sel.company_note}</p></div>}

<div className="border-t border-mav-line pt-4 grid grid-cols-2 gap-y-3 text-sm">
<div><div className="text-xs text-mav-muted">AM (account manager)</div>{sel.sales_person || '—'}</div>
<div><div className="text-xs text-mav-muted">PC (project coordinator)</div>{sel.pm_owner || '—'}</div>
<div><div className="text-xs text-mav-muted">Service</div>{svcOf(sel)}</div>
<div><div className="text-xs text-mav-muted">Technology</div>{sel.technology || '—'}</div>
<div><div className="text-xs text-mav-muted">Type</div>{sel.is_new_client ? 'New' : 'Repeat'}</div>
<div><div className="text-xs text-mav-muted">RFQ / quote status</div><span className={`text-xs px-2 py-1 rounded-full ${badge(sel.rfq_status)}`}>{sel.status || sel.rfq_status || (sel.rfq ? 'RFQ' : '—')}</span></div>
<div><div className="text-xs text-mav-muted">GEO</div>{sel.geo || '—'}</div>
<div><div className="text-xs text-mav-muted">Date</div>{(sel.first_date || sel.source_date || '').slice(0, 10) || '—'}</div>
<div className="col-span-2"><div className="text-xs text-mav-muted">{sel.quote_ref ? 'Quote / subject' : 'Subject'}</div>{sel.source_subject || '—'}</div>
</div>
</aside>
</div>
)}
</div>
)
}
