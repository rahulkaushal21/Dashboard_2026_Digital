'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getOpportunities, serviceOf, setOpportunityConfirmed, setOpportunityLost, setOpportunityUnlikely, type Opportunity } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'
import { NBD_TEAM } from '@/lib/nbd'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
// Owner cells can hold several names ("Rahul Kaushal, Maitri Shah"); split so each
// individual AM/PM is its own selectable dropdown option and filters by "contains".
const splitNames = (s?: string) => (s || '').split(/[,/&]/).map(x => x.trim()).filter(Boolean)
const uniqNames = (arr: (string | undefined)[]) => Array.from(new Set(arr.flatMap(splitNames))).sort((a, b) => a.localeCompare(b))
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const badge = (s?: string) => {
const map: Record<string, string> = { pending: 'bg-amber-500/15 text-amber-400', received: 'bg-blue-500/15 text-blue-400', quoted: 'bg-purple-500/15 text-purple-300', won: 'bg-green-500/15 text-green-400', lost: 'bg-red-500/15 text-red-400' }
return map[(s || '').toLowerCase()] || 'bg-mav-line text-mav-muted'
}
const SRC_ORDER = ['sheet', 'email']
const srcTag = (s: string) => s === 'email' ? 'bg-blue-500/15 text-blue-400' : 'bg-green-500/15 text-green-400'
const srcLabel = (s: string) => s === 'email' ? 'Email' : 'Sheet'
const probColor = (p?: number) => p == null ? 'bg-mav-line text-mav-muted' : p >= 60 ? 'bg-green-500/15 text-green-400' : p >= 45 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
const probBar = (p?: number) => p == null ? 'bg-mav-line' : p >= 60 ? 'bg-green-500' : p >= 45 ? 'bg-amber-500' : 'bg-red-500'
const money = (n?: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const oppStatus = (x: Opportunity) => {
if (x.won) return 'Won'                       // a booking always wins
if (x.email_won) return 'Won'                 // confirmed here; the sheet may not know yet
if (x.booked_month) return 'Won'              // already invoiced in the revenue sheet
const s = (x.status || '').toLowerCase()
if (s.includes('cancel') || s === 'lost') return 'Lost'
if (x.email_lost) return 'Lost'               // marked Lost here; likewise ahead of the sheet
if (s.includes('hold')) return 'On Hold'
return 'Open'
}
// A call made on the dashboard that the Quotes sheet hasn't caught up with yet. Only
// sheet-origin deals can drift like this, and only until someone edits the sheet.
const lostLag = (x: Opportunity) => !!x.email_lost && !x.won && x.origin === 'sheet' && !/lost|cancel/i.test(x.status || '')
const confirmLag = (x: Opportunity) => !!x.email_won && !x.won && x.origin === 'sheet' && !/won|confirm/i.test(x.status || '')
// Delivered and invoiced — the revenue sheet has the money, the Quotes row still says
// Open. Same fix as a confirm-lag (set the row to Confirmed), but nobody made a call
// here: the revenue sheet did. Kept out of the pipeline until the sheet catches up.
const bookedLag = (x: Opportunity) => !!x.booked_month && !x.won && x.origin === 'sheet' && !/won|confirm/i.test(x.status || '')
const sheetLag = (x: Opportunity) => lostLag(x) || confirmLag(x) || bookedLag(x)
// Every manual call, whatever its verdict — the set you'd look through to change your mind.
const markedByHand = (x: Opportunity) => !!(x.email_won || x.email_lost || x.unlikely)
const statusTone = (s: string) => s === 'Won' ? 'bg-green-500/15 text-green-400' : s === 'Lost' ? 'bg-red-500/15 text-red-400' : s === 'On Hold' ? 'bg-orange-500/15 text-orange-300' : 'bg-mav-line text-mav-muted'
const svcOf = (x: Opportunity) => x.service || serviceOf(x.technology)

type SortKey = 'company' | 'value' | 'win' | 'status' | 'source' | 'type' | 'owner' | 'geo' | 'tech' | 'date' | 'flag'
const COLS: { key: SortKey; label: string }[] = [
{ key: 'company', label: 'Client' }, { key: 'value', label: 'Value' }, { key: 'win', label: 'Win %' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' },
{ key: 'type', label: 'Type' }, { key: 'owner', label: 'AM / PM' }, { key: 'geo', label: 'GEO' }, { key: 'tech', label: 'Tech' },
{ key: 'date', label: 'Date' }, { key: 'flag', label: 'Review' },
]
// Type label from the Quotes tab Business Type (col P). A booked client can send
// fresh work — that's "New + Repeat", legitimate repeat business, not a data error.
const typeLabel = (x: Opportunity): string => {
const bt = (x.business_type || '').trim().toLowerCase()
// New business belongs to the NBD team only (lib/nbd.ts). Anyone else's quote is an
// account manager working an existing client, so it reads Repeat whatever col P says.
if (!x.nbd_owner) return 'Repeat'
if (bt === 'new repeat' || bt === 'repeat new') return 'New + Repeat'
return x.is_new_client ? 'New' : 'Repeat'
}
const sortVal = (x: Opportunity, k: SortKey): string | number => {
switch (k) {
case 'company': return (x.company_name || '').toLowerCase()
case 'value': return x.value ?? -1
case 'win': return x.win_probability ?? -1
case 'status': return oppStatus(x)
case 'source': return (x.sources || []).join(',')
case 'type': return typeLabel(x)
case 'owner': return (x.sales_person || '').toLowerCase()
case 'geo': return x.geo || ''
case 'tech': return (x.technology || '').toLowerCase()
case 'date': return x.source_date || x.first_date || ''
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
// Rows the Quotes sheet tags "New" under an owner who isn't on the NBD team.
const [misTagOnly, setMisTagOnly] = useState(false)
const [fAM, setFAM] = useState(''); const [fPM, setFPM] = useState(''); const [fStatus, setFStatus] = useState('Open'); const [fSvc, setFSvc] = useState(''); const [fTech, setFTech] = useState('')
const [from, setFrom] = useState('2026-04-01'); const [to, setTo] = useState('')
// Today's date, resolved on the client. Drives the fixed "last 2 months" window,
// which must not move when the user edits the From/To filter.
const [today, setToday] = useState('')
const [flagOnly, setFlagOnly] = useState(false)
// "Might not come" — filter + in-flight save state for the toggle.
const [unlikelyOnly, setUnlikelyOnly] = useState(false)
const [savingUnlikely, setSavingUnlikely] = useState(false)
// "Called here, still Open in the sheet" — the mismatch alert filter + its save state.
const [lagOnly, setLagOnly] = useState(false)
const [savingLost, setSavingLost] = useState(false)
const [savingWon, setSavingWon] = useState(false)
// Every deal someone marked by hand, so a call can always be found again and reversed.
const [markedOnly, setMarkedOnly] = useState(false)
const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 })
const [sel, setSel] = useState<Opportunity | null>(null)
const [page, setPage] = useState(0); const [perPage, setPerPage] = useState(50)

// getOpportunities() merges email leads + the sheet Quotes tab (value + status).
useEffect(() => { getOpportunities().then(setAll) }, [])
// Default the "To" date to today (set on the client to avoid a hydration mismatch).
useEffect(() => { const d = new Date().toISOString().slice(0, 10); setTo(d); setToday(d) }, [])

// Undated rows always show; otherwise honour the From/To range.
const inRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return true; if (from && v < from) return false; if (to && v > to) return false; return true }
const toggleSort = (k: SortKey) => setSort(s => s.key === k ? { key: k, dir: (s.dir === 1 ? -1 : 1) } : { key: k, dir: k === 'date' || k === 'win' || k === 'value' ? -1 : 1 })

const o = useMemo(() => {
const rows = all
.filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
.filter(x => !fType || typeLabel(x).includes(fType))
.filter(x => !fGeo || (x.geo || '') === fGeo)
.filter(x => !fAM || splitNames(x.sales_person).includes(fAM))
.filter(x => !fPM || splitNames(x.pm_owner).includes(fPM))
.filter(x => !fStatus || oppStatus(x) === fStatus)
.filter(x => !fSvc || svcOf(x) === fSvc)
.filter(x => !fTech || (x.technology || '') === fTech)
.filter(x => !flagOnly || x.flag)
.filter(x => !unlikelyOnly || x.unlikely)
.filter(x => !lagOnly || sheetLag(x))
.filter(x => !markedOnly || markedByHand(x))
.filter(x => !misTagOnly || x.mis_tagged_new)
.filter(x => inRange(x.source_date || x.first_date))
return rows.sort((a, b) => {
const av = sortVal(a, sort.key), bv = sortVal(b, sort.key)
if (av < bv) return -1 * sort.dir
if (av > bv) return 1 * sort.dir
return 0
})
}, [all, search, fType, fGeo, fAM, fPM, fStatus, fSvc, fTech, flagOnly, unlikelyOnly, lagOnly, markedOnly, misTagOnly, from, to, sort])

// Toggle "might not come" on a deal. Optimistic: patch local state, then persist.
const toggleUnlikely = async (x: Opportunity) => {
const turningOn = !x.unlikely
const reason = turningOn
? (window.prompt(`Flag "${x.company_name}" as unlikely to convert?\n\nThe deal stays Open — this only discounts it from the realistic pipeline view.\n\nWhy? (optional)`) ?? undefined)
: undefined
if (turningOn && reason === undefined) return   // cancelled the prompt
setSavingUnlikely(true)
const patch = turningOn
? { unlikely: true, unlikely_reason: reason || undefined, unlikely_at: new Date().toISOString(), unlikely_by: currentEmail() || undefined }
: { unlikely: false, unlikely_reason: undefined, unlikely_at: undefined, unlikely_by: undefined }
setAll(prev => prev.map(r => r.id === x.id ? { ...r, ...patch } : r))
setSel(s => s && s.id === x.id ? { ...s, ...patch } : s)
const ok = await setOpportunityUnlikely(x.id, turningOn, { actor: currentEmail() || undefined, reason })
setSavingUnlikely(false)
if (!ok) {   // roll back so the UI never claims a save that didn't happen
setAll(prev => prev.map(r => r.id === x.id ? { ...r, unlikely: x.unlikely, unlikely_reason: x.unlikely_reason, unlikely_at: x.unlikely_at, unlikely_by: x.unlikely_by } : r))
setSel(s => s && s.id === x.id ? { ...s, unlikely: x.unlikely, unlikely_reason: x.unlikely_reason } : s)
window.alert('Could not save that flag — please try again.')
}
}

// Mark a deal Lost (or undo). Optimistic like the unlikely toggle. This does NOT edit
// the Quotes sheet — the sheet stays the master record, so the deal keeps showing the
// "still Open in the sheet" alert until someone updates that row by hand.
const toggleLost = async (x: Opportunity) => {
const turningOn = !x.email_lost
const reason = turningOn
? (window.prompt(`Mark "${x.company_name}" as Lost?\n\nThis records the loss here immediately. The Quotes sheet is not edited — the deal will stay flagged until you set its sheet row to Cancelled.\n\nWhy was it lost? (optional)`) ?? undefined)
: undefined
if (turningOn && reason === undefined) return   // cancelled the prompt
setSavingLost(true)
// Lost supersedes "might not come" — the RPC clears it, so the UI must too.
const patch: Partial<Opportunity> = turningOn
? { email_lost: true, email_lost_reason: reason || undefined, email_lost_at: new Date().toISOString(), email_lost_by: currentEmail() || undefined, unlikely: false, unlikely_reason: undefined, unlikely_at: undefined, unlikely_by: undefined }
: { email_lost: false, email_lost_reason: undefined, email_lost_at: undefined, email_lost_by: undefined }
setAll(prev => prev.map(r => r.id === x.id ? { ...r, ...patch } : r))
setSel(s => s && s.id === x.id ? { ...s, ...patch } : s)
const ok = await setOpportunityLost(x.id, turningOn, { actor: currentEmail() || undefined, reason })
setSavingLost(false)
if (!ok) {   // roll the row back rather than show a loss that never saved
setAll(prev => prev.map(r => r.id === x.id ? x : r))
setSel(s => s && s.id === x.id ? x : s)
window.alert('Could not save that — please try again.')
}
}

// Confirm a deal as Won (or undo). Like Lost, this does NOT edit the Quotes sheet — the
// deal keeps its "confirm it in the sheet" alert until that row is set to Confirmed.
const toggleConfirmed = async (x: Opportunity) => {
const turningOn = !x.email_won
const reason = turningOn
? (window.prompt(`Mark "${x.company_name}" as Confirmed (Won)?\n\nIt counts as Won here straight away. The Quotes sheet is not edited — the deal stays flagged until you set its sheet row to Confirmed so it books as revenue.\n\nNote? (optional)`) ?? undefined)
: undefined
if (turningOn && reason === undefined) return   // cancelled the prompt
setSavingWon(true)
// Confirming supersedes Lost and "might not come" — the RPC clears both, so the UI must too.
const patch: Partial<Opportunity> = turningOn
? { email_won: true, email_won_reason: reason || undefined, email_won_at: new Date().toISOString(), email_won_by: currentEmail() || undefined,
    email_lost: false, email_lost_reason: undefined, email_lost_at: undefined, email_lost_by: undefined,
    unlikely: false, unlikely_reason: undefined, unlikely_at: undefined, unlikely_by: undefined }
: { email_won: false, email_won_reason: undefined, email_won_at: undefined, email_won_by: undefined }
setAll(prev => prev.map(r => r.id === x.id ? { ...r, ...patch } : r))
setSel(s => s && s.id === x.id ? { ...s, ...patch } : s)
const ok = await setOpportunityConfirmed(x.id, turningOn, { actor: currentEmail() || undefined, reason })
setSavingWon(false)
if (!ok) {   // roll the row back rather than show a win that never saved
setAll(prev => prev.map(r => r.id === x.id ? x : r))
setSel(s => s && s.id === x.id ? x : s)
window.alert('Could not save that — please try again.')
}
}

const reset = () => { setSearch(''); setFType(''); setFGeo(''); setFAM(''); setFPM(''); setFStatus(''); setFSvc(''); setFTech(''); setFrom('2026-04-01'); setTo(new Date().toISOString().slice(0, 10)); setFlagOnly(false); setUnlikelyOnly(false); setLagOnly(false); setMarkedOnly(false) }

// Pagination — reset to first page whenever the filtered/sorted set changes.
useEffect(() => { setPage(0) }, [search, fType, fGeo, fAM, fPM, fStatus, fSvc, fTech, flagOnly, unlikelyOnly, lagOnly, markedOnly, misTagOnly, from, to, sort, perPage])
const pageCount = Math.max(1, Math.ceil(o.length / perPage))
const curPage = Math.min(page, pageCount - 1)
const pageRows = o.slice(curPage * perPage, curPage * perPage + perPage)
const flagged = all.filter(x => x.flag).length
// Quotes rows tagged New Business under an owner who isn't on the NBD team. Counted
// across every status, not just open deals — a mis-tagged Won deal still misreports
// how much new business the team actually landed.
const misTagged = useMemo(() => all.filter(x => x.mis_tagged_new), [all])
// Deals whose Lost call hasn't reached the Quotes sheet yet — computed over ALL rows,
// not the date-filtered set, so the alert can't hide behind a narrow From/To window.
const lagRows = useMemo(() => all.filter(sheetLag), [all])
const lagWon = lagRows.filter(x => confirmLag(x) || bookedLag(x))
const lagLost = lagRows.filter(lostLag)
const markedRows = useMemo(() => all.filter(markedByHand), [all])

// Headline numbers follow the DATE range (independent of the other dropdowns so
// the breakdown panels stay stable for click-to-filter).
const dated = useMemo(() => all.filter(x => inRange(x.source_date || x.first_date)), [all, from, to])
const open = useMemo(() => dated.filter(x => oppStatus(x) === 'Open'), [dated])
const openValue = open.reduce((s, x) => s + (x.value || 0), 0)
// Realistic view = open pipeline minus everything a human flagged "might not come".
const unlikelyOpen = useMemo(() => open.filter(x => x.unlikely), [open])
const unlikelyValue = unlikelyOpen.reduce((s, x) => s + (x.value || 0), 0)
const likelyValue = openValue - unlikelyValue
const onHold = useMemo(() => dated.filter(x => oppStatus(x) === 'On Hold'), [dated])
const onHoldValue = onHold.reduce((s, x) => s + (x.value || 0), 0)
// Open + On Hold = everything still undecided. This is what the month cards call
// "Pending"; the Open KPI beside it is the narrower Open-only figure. Both are shown
// so the two panels can be reconciled instead of appearing to contradict each other.
const pendingValue = openValue + onHoldValue
const won = useMemo(() => dated.filter(x => oppStatus(x) === 'Won'), [dated])
const wonValue = won.reduce((s, x) => s + (x.value || x.won_amount || 0), 0)
const byGeo = useMemo(() => breakdown(open, x => x.geo || '—'), [open])
const bySvc = useMemo(() => breakdown(open, svcOf), [open])
const byTech = useMemo(() => breakdown(open, x => x.technology || '—'), [open])

// ── Last 2 months ────────────────────────────────────────────────────────────
// Deliberately IGNORES the From/To filter — "last 2 months" is a fixed window so
// the quote-to-win picture stays comparable run to run. A deal counts in the month
// it was quoted (source_date, else first_date); Pending = still Open or On Hold.
const monthsAgg = useMemo(() => {
if (!today) return []                                    // wait for the client date (no SSR mismatch)
const base = new Date(today + 'T00:00:00')
return [1, 0].map(i => {
const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const rows = all.filter(x => (x.source_date || x.first_date || '').slice(0, 7) === key)
const sum = (a: Opportunity[]) => a.reduce((s, x) => s + (x.value || x.won_amount || 0), 0)
const wonR = rows.filter(x => oppStatus(x) === 'Won')
// Pending = Open + On Hold, i.e. everything not yet decided. It HAS to include On Hold,
// otherwise shared ≠ pending + won + lost and the card stops reconciling. The On Hold
// slice is surfaced separately below so this never looks like it disagrees with the
// Open-only KPI further down the page.
const openR = rows.filter(x => oppStatus(x) === 'Open')
const holdR = rows.filter(x => oppStatus(x) === 'On Hold')
const pendR = [...openR, ...holdR]
const lostR = rows.filter(x => oppStatus(x) === 'Lost')
const unlikelyR = pendR.filter(x => x.unlikely)
return {
key, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
shared: rows.length, sharedValue: sum(rows),
pending: pendR.length, pendingValue: sum(pendR),
openOnly: openR.length, openOnlyValue: sum(openR),
hold: holdR.length, holdValue: sum(holdR),
won: wonR.length, wonValue: sum(wonR),
lost: lostR.length, lostValue: sum(lostR),
unlikely: unlikelyR.length, unlikelyValue: sum(unlikelyR),
// Win rate over ALL quotes shared that month — won ÷ everything quoted. Recent
// months read low by design because their quotes are still in play; `decidedRate`
// is kept alongside so a month can also be judged on what has actually closed.
winRate: rows.length ? Math.round(wonR.length / rows.length * 100) : null,
decidedRate: (wonR.length + lostR.length) ? Math.round(wonR.length / (wonR.length + lostR.length) * 100) : null,
}
})
}, [all, today])

const MonthCard = ({ m }: { m: typeof monthsAgg[number] }) => {
// Money leads, count supports: the dollar figure is the headline number and the
// deal count sits under it as context.
const Stat = ({ label, n, v, tone, title }: { label: string; n: number; v: number; tone: string; title?: string }) => (
<div className="flex-1 min-w-0" title={title}>
<div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">{label}</div>
{/* steps down on narrower cards so four 6-figure sums never wrap or clip */}
<div className={`text-lg lg:text-xl xl:text-2xl font-bold leading-tight tracking-tight whitespace-nowrap ${tone}`}>{money(v)}</div>
<div className="text-xs text-mav-muted mt-0.5">{n} {n === 1 ? 'quote' : 'quotes'}</div>
</div>
)
const pct = m.shared ? Math.round(m.won / m.shared * 100) : 0
return (
<div className="bg-mav-panel border border-mav-line rounded-xl p-4">
<div className="flex items-baseline justify-between mb-3">
<div className="text-sm font-medium">{m.label}</div>
<div className="text-xs text-mav-muted">
{m.winRate == null ? 'no quotes' : <>win rate <span className="text-white font-semibold">{m.winRate}%</span> <span className="opacity-60">of all quotes</span>{m.decidedRate != null && <span className="opacity-60"> · {m.decidedRate}% of decided</span>}</>}
</div>
</div>
<div className="flex gap-2 xl:gap-3">
<Stat label="Quotes shared" n={m.shared} v={m.sharedValue} tone="text-white" title="Every quote dated in this month. Equals Pending + Won + Lost." />
<Stat label="Pending" n={m.pending} v={m.pendingValue} tone="text-amber-400"
  title={`Not yet decided = Open + On Hold. Open ${money(m.openOnlyValue)} (${m.openOnly}) + On Hold ${money(m.holdValue)} (${m.hold}). The "Open pipeline value" KPI below counts Open ONLY, so it is the smaller number.`} />
<Stat label="Won" n={m.won} v={m.wonValue} tone="text-green-400" />
<Stat label="Lost" n={m.lost} v={m.lostValue} tone="text-red-400" />
</div>
{/* Spells out the Open/On-Hold split so Pending can never look like it contradicts
    the Open-only KPI further down the page. */}
{m.hold > 0 && (
<div className="mt-2 text-xs text-mav-muted">
pending = <span className="text-amber-300 font-semibold">{money(m.openOnlyValue)}</span> open
 + <span className="text-orange-300 font-semibold">{money(m.holdValue)}</span> on hold
 <span className="opacity-60"> ({m.openOnly} + {m.hold} quotes)</span>
</div>
)}
{m.unlikely > 0 && (
<div className="mt-2 text-xs text-mav-muted">
of which <span className="text-orange-300 font-semibold">{money(m.unlikelyValue)}</span> flagged “might not come” · {m.unlikely} {m.unlikely === 1 ? 'quote' : 'quotes'}
</div>
)}
{/* share-of-quotes bar: won / pending / lost */}
<div className="mt-3 h-1.5 w-full rounded-full bg-mav-line overflow-hidden flex">
<div className="bg-green-500 h-full" style={{ width: `${pct}%` }} />
<div className="bg-amber-500 h-full" style={{ width: `${m.shared ? (m.pending / m.shared) * 100 : 0}%` }} />
<div className="bg-red-500 h-full" style={{ width: `${m.shared ? (m.lost / m.shared) * 100 : 0}%` }} />
</div>
</div>
)
}

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
<Header title="Opportunities" subtitle="One row per deal from the Quotes sheet (price, status, AM, PM, GEO) + email-only opportunities — with a brief, next step and % confidence." />

{/* Sheet-mismatch alert: a Won/Lost call made here that the Quotes sheet hasn't caught
    up with. Sits above everything — it's the one thing on this page needing action
    elsewhere. Won and Lost are listed separately because the fix differs for each. */}
{lagRows.length > 0 && (
<div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
<div className="flex flex-wrap items-center justify-between gap-3">
<div>
<div className="text-sm font-semibold text-amber-300">⚠ {lagRows.length} deal{lagRows.length > 1 ? 's' : ''} already decided or invoiced {lagRows.length > 1 ? 'are' : 'is'} still Open in the Quotes sheet</div>
<div className="text-xs text-mav-muted mt-0.5">The sheet is the master record, so nothing books or drops out of pipeline until you update it there. This alert clears itself on the next sync.</div>
</div>
<button onClick={() => { setLagOnly(true); setFStatus(''); setFlagOnly(false); setUnlikelyOnly(false); setMarkedOnly(false); setSearch('') }}
className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-amber-500/50 text-amber-300 hover:bg-amber-500/15 transition-colors">Show {lagRows.length > 1 ? 'them' : 'it'}</button>
</div>
{lagWon.length > 0 && (
<div className="mt-2.5">
<div className="text-xs text-green-300 font-medium mb-1">Set to <span className="underline">Confirmed</span> in the sheet so {lagWon.length > 1 ? 'they book' : 'it books'} as revenue:</div>
<div className="flex flex-wrap gap-1.5">
{lagWon.slice(0, 12).map(x => (
<button key={x.id} onClick={() => setSel(x)} className="text-xs px-2 py-1 rounded-md bg-green-500/15 text-green-200 hover:bg-green-500/25 transition-colors">
✓ {x.company_name}{x.value ? ` · ${money(x.value)}` : ''}
</button>
))}
{lagWon.length > 12 && <span className="text-xs text-mav-muted self-center">+{lagWon.length - 12} more</span>}
</div>
</div>
)}
{lagLost.length > 0 && (
<div className="mt-2.5">
<div className="text-xs text-red-300 font-medium mb-1">Set to <span className="underline">Cancelled</span> in the sheet so {lagLost.length > 1 ? 'they stop' : 'it stops'} counting as live pipeline:</div>
<div className="flex flex-wrap gap-1.5">
{lagLost.slice(0, 12).map(x => (
<button key={x.id} onClick={() => setSel(x)} className="text-xs px-2 py-1 rounded-md bg-red-500/15 text-red-200 hover:bg-red-500/25 transition-colors">
✗ {x.company_name}{x.value ? ` · ${money(x.value)}` : ''}
</button>
))}
{lagLost.length > 12 && <span className="text-xs text-mav-muted self-center">+{lagLost.length - 12} more</span>}
</div>
</div>
)}
</div>
)}

{monthsAgg.length > 0 && (
<div className="mb-6">
<div className="flex items-baseline gap-2 mb-2">
<h2 className="text-sm font-medium">Last 2 months</h2>
<span className="text-xs text-mav-muted">· quotes shared, still pending, and won — counted in the month the quote went out (fixed window, ignores the date filter below)</span>
</div>
<div className="grid md:grid-cols-2 gap-4">{monthsAgg.map(m => <MonthCard key={m.key} m={m} />)}</div>
</div>
)}

<div className="text-xs text-mav-muted mb-2">Headline numbers &amp; breakdowns below reflect the date range <span className="text-white">{from || '…'} → {to || 'today'}</span> (change it in the filter bar).
{onHold.length > 0 && <> Open pipeline here excludes On Hold; the cards above count both as pending — <span className="text-white">{money(openValue)} + {money(onHoldValue)} = {money(pendingValue)}</span> still undecided.</>}</div>
<div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
<KPICard label="Open opportunities" value={String(open.length)} />
<KPICard label={unlikelyOpen.length ? `Open pipeline, excl. On Hold (${money(likelyValue)} likely)` : 'Open pipeline value (excl. On Hold)'} value={money(openValue)} />
<KPICard label={`On Hold value (${onHold.length})`} value={money(onHoldValue)} />
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
<select value={fType} onChange={e => setFType(e.target.value)} className={selCls}><option value="">All types</option><option value="New">New (NBD)</option><option value="Repeat">Repeat</option></select>
<select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(all.map(x => x.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
<select value={fSvc} onChange={e => setFSvc(e.target.value)} className={selCls}><option value="">All services</option>{uniq(all.map(svcOf)).map(s => <option key={s} value={s}>{s}</option>)}</select>
<select value={fTech} onChange={e => setFTech(e.target.value)} className={selCls}><option value="">All tech</option>{uniq(all.map(x => x.technology)).map(t => <option key={t} value={t}>{t}</option>)}</select>
<select value={fAM} onChange={e => setFAM(e.target.value)} className={selCls}><option value="">All AMs</option>{uniqNames(all.map(x => x.sales_person)).map(ow => <option key={ow} value={ow}>{ow}</option>)}</select>
<select value={fPM} onChange={e => setFPM(e.target.value)} className={selCls}><option value="">All PMs</option>{uniqNames(all.map(x => x.pm_owner)).map(pm => <option key={pm} value={pm}>{pm}</option>)}</select>
<button onClick={() => setFlagOnly(v => !v)} className={`text-sm px-3 py-2 rounded-md border transition-colors ${flagOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>⚠ Needs review{flagged ? ` (${flagged})` : ''}</button>
<button onClick={() => setUnlikelyOnly(v => !v)} title="Deals someone flagged as unlikely to convert" className={`text-sm px-3 py-2 rounded-md border transition-colors ${unlikelyOnly ? 'bg-orange-500/20 text-orange-300 border-orange-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>🚫 Might not come{unlikelyOpen.length ? ` (${unlikelyOpen.length})` : ''}</button>
{misTagged.length > 0 && (
<button onClick={() => { setMisTagOnly(v => !v); setFStatus('') }} title={`Tagged "New" in the Quotes sheet (Business Type, col P) but the owner is not on the NBD team — ${NBD_TEAM.map(m => m.name).join(', ')}. These are shown as Repeat until the sheet is corrected.`} className={`text-sm px-3 py-2 rounded-md border transition-colors ${misTagOnly ? 'bg-red-500/20 text-red-300 border-red-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>⚠ Tagged New, not NBD ({misTagged.length})</button>
)}
{lagRows.length > 0 && (
<button onClick={() => { setLagOnly(v => !v); setFStatus('') }} title="Decided Won or Lost on the dashboard, but the Quotes sheet still shows the deal Open" className={`text-sm px-3 py-2 rounded-md border transition-colors ${lagOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>⚠ Sheet not updated ({lagRows.length})</button>
)}
{markedRows.length > 0 && (
<button onClick={() => { setMarkedOnly(v => !v); setFStatus('') }} title="Every deal someone marked by hand — Confirmed, Lost or 'might not come'. Open one to change or undo the call." className={`text-sm px-3 py-2 rounded-md border transition-colors ${markedOnly ? 'bg-mav-yellow/20 text-mav-yellow border-mav-yellow/50 font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>✎ Marked by hand ({markedRows.length})</button>
)}
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
<tbody>{pageRows.map(x => {
const st = oppStatus(x)
return (
<tr key={x.id} onClick={() => setSel(x)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${st === 'Lost' ? 'bg-red-500/5' : x.unlikely ? 'bg-orange-500/[0.07]' : x.flag ? 'bg-amber-500/5' : ''}`}>
<td className="px-4 py-3">{x.unlikely && <span className="mr-1.5 text-orange-300" title={x.unlikely_reason ? `Might not come — ${x.unlikely_reason}` : 'Flagged: might not come'}>🚫</span>}{x.email_won && <span className="mr-1.5 text-green-400" title={x.email_won_reason ? `Confirmed here — ${x.email_won_reason}` : 'Confirmed on the dashboard'}>✓</span>}{x.company_name}{x.summary && <div className="text-xs text-mav-muted">{x.summary.slice(0, 80)}</div>}</td>
<td className={`px-4 py-3 whitespace-nowrap font-medium ${x.unlikely ? 'line-through text-mav-muted' : ''}`}>{x.value ? money(x.value) : <span className="text-mav-muted font-normal">—</span>}</td>
<td className="px-4 py-3">{x.win_probability != null ? <span className={`text-xs font-semibold px-2 py-1 rounded-full ${probColor(x.win_probability)}`}>{x.win_probability}%</span> : <span className="text-xs text-mav-muted">—</span>}</td>
<td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusTone(st)}`}>{st === 'Won' ? (bookedLag(x) ? '✓ Booked · sheet open' : confirmLag(x) ? '✓ Won · sheet open' : `✓ Won${x.won_amount ? ' · ' + money(x.won_amount) : ''}`) : st === 'Lost' ? (lostLag(x) ? '✗ Lost · sheet open' : '✗ Lost') : st}</span></td>
<td className="px-4 py-3 whitespace-nowrap">{(x.sources || (x.source ? [x.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full mr-1 ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}</td>
<td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${typeLabel(x) === 'New + Repeat' ? 'bg-purple-500/15 text-purple-300' : x.is_new_client ? 'bg-blue-500/15 text-blue-400' : 'bg-mav-line text-mav-muted'}`}>{typeLabel(x)}</span>{x.mis_tagged_new && <span className="ml-1 text-xs text-red-400" title={`Sheet says New, but ${x.sales_person || 'no owner'} is not on the NBD team — counted as Repeat.`}>⚠</span>}</td>
<td className="px-4 py-3 text-mav-muted">{x.sales_person ? <span title="Account Manager (AM / NBD)">AM: {x.sales_person}</span> : <span className="text-mav-muted">AM: —</span>}{x.pm_owner && <div className="text-xs text-mav-yellow mt-0.5" title="Project Manager">PM: {x.pm_owner}</div>}</td>
<td className="px-4 py-3 text-mav-muted">{x.geo}</td>
<td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.technology || '—'}</td>
<td className="px-4 py-3 text-mav-muted whitespace-nowrap">{(x.source_date || x.first_date || '').slice(0, 10)}</td>
{/* lostLag is checked directly, not just via x.flag: flag comes from the last data
    load, so a deal marked Lost in this session must still show the alert instantly. */}
<td className="px-4 py-3">{(x.flag || sheetLag(x)) ? <span className={`text-xs px-2 py-1 rounded-full font-semibold whitespace-nowrap ${sheetLag(x) ? 'bg-amber-500/25 text-amber-200' : 'bg-amber-500/20 text-amber-300'}`} title={bookedLag(x) ? 'Already invoiced in the revenue sheet — the Quotes sheet still shows it Open. Set that row to Confirmed.' : confirmLag(x) ? 'Confirmed here — the Quotes sheet still shows it Open. Set that row to Confirmed.' : lostLag(x) ? 'Marked Lost here — the Quotes sheet still shows it Open. Set that row to Cancelled.' : x.flag}>{sheetLag(x) ? '⚠ Update sheet' : '⚠ Review'}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
</tr>
)
})}</tbody>
</table>
</div>
{o.length > 0 && (
<div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-mav-line text-sm">
<span className="text-mav-muted">Showing <span className="text-white">{curPage * perPage + 1}–{Math.min((curPage + 1) * perPage, o.length)}</span> of <span className="text-white">{o.length}</span></span>
<div className="flex items-center gap-1 ml-auto">
<button onClick={() => setPage(0)} disabled={curPage === 0} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-white disabled:opacity-40">« First</button>
<button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={curPage === 0} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-white disabled:opacity-40">‹ Prev</button>
<span className="px-2 text-mav-muted">Page <span className="text-white">{curPage + 1}</span> / {pageCount}</span>
<button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={curPage >= pageCount - 1} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-white disabled:opacity-40">Next ›</button>
<button onClick={() => setPage(pageCount - 1)} disabled={curPage >= pageCount - 1} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-white disabled:opacity-40">Last »</button>
</div>
<select value={perPage} onChange={e => setPerPage(Number(e.target.value))} className={selCls} title="Rows per page">
{[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} / page</option>)}
<option value={100000}>Show all</option>
</select>
</div>
)}
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
<span className={`text-xs px-2 py-1 rounded-full ${typeLabel(sel) === 'New + Repeat' ? 'bg-purple-500/15 text-purple-300' : sel.is_new_client ? 'bg-blue-500/15 text-blue-400' : 'bg-mav-line text-mav-muted'}`}>{typeLabel(sel) === 'New + Repeat' ? 'New + repeat work' : sel.is_new_client ? 'New business' : 'Repeat client'}</span>
{(sel.sources || (sel.source ? [sel.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}
</div>
</div>
<button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
</div>

<div className="mb-4 flex items-center justify-between rounded-lg border border-mav-line bg-mav-dark/40 px-4 py-3">
<span className="text-xs uppercase tracking-wide text-mav-muted">Value</span>
<span className="text-2xl font-bold">{sel.value ? money(sel.value) : '—'}</span>
</div>

{/* ── Your call ─────────────────────────────────────────────────────────────
    The three manual verdicts in one place: Confirmed, Lost, might-not-come.
    They're mutually exclusive (the RPCs enforce it), and every one of them is
    reversible from here — pick a different verdict, or Undo to hand the deal
    back to the sheet. Offered on live deals and on anything already marked by
    hand; a deal the SHEET settled has no buttons, because the sheet owns it. */}
{(oppStatus(sel) === 'Open' || oppStatus(sel) === 'On Hold' || markedByHand(sel)) && (
<div className={`mb-4 rounded-lg border px-3 py-2.5 ${sel.email_won ? 'border-green-500/40 bg-green-500/10' : sel.email_lost ? 'border-red-500/40 bg-red-500/10' : sel.unlikely ? 'border-orange-500/40 bg-orange-500/10' : 'border-mav-line bg-mav-dark/40'}`}>
<div className="text-sm font-medium mb-0.5">
{sel.email_won ? <span className="text-green-300">✓ Confirmed — Won</span>
 : sel.email_lost ? <span className="text-red-300">✗ Marked Lost</span>
 : sel.unlikely ? <span className="text-orange-300">🚫 Flagged: might not come</span>
 : 'Your call on this deal'}
</div>
<div className="text-xs text-mav-muted mb-2.5">
{markedByHand(sel)
 ? 'Recorded on the dashboard only — the Quotes sheet is never edited automatically. Change it any time; nothing here is final.'
 : 'Record the outcome here the moment you know it. The Quotes sheet still needs updating by hand afterwards.'}
</div>
<div className="flex flex-wrap gap-2">
<button disabled={savingWon} onClick={() => toggleConfirmed(sel)}
className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${sel.email_won ? 'border-mav-line text-mav-muted hover:text-white' : 'border-green-500/50 text-green-300 hover:bg-green-500/15'}`}>
{savingWon ? 'Saving…' : sel.email_won ? 'Undo confirm' : '✓ Mark Confirmed'}
</button>
<button disabled={savingLost} onClick={() => toggleLost(sel)}
className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${sel.email_lost ? 'border-mav-line text-mav-muted hover:text-white' : 'border-red-500/50 text-red-300 hover:bg-red-500/15'}`}>
{savingLost ? 'Saving…' : sel.email_lost ? 'Undo Lost' : '✗ Mark Lost'}
</button>
{/* "Might not come" is a pipeline-confidence call, so it only applies while the deal is still live. */}
{(oppStatus(sel) === 'Open' || oppStatus(sel) === 'On Hold' || sel.unlikely) && (
<button disabled={savingUnlikely} onClick={() => toggleUnlikely(sel)}
className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${sel.unlikely ? 'border-mav-line text-mav-muted hover:text-white' : 'border-orange-500/50 text-orange-300 hover:bg-orange-500/15'}`}>
{savingUnlikely ? 'Saving…' : sel.unlikely ? 'Undo unlikely' : '🚫 Might not come'}
</button>
)}
</div>
{sel.email_won && (sel.email_won_reason || sel.email_won_by) && (
<div className="mt-2.5 pt-2 border-t border-green-500/20 text-xs text-mav-muted">
{sel.email_won_reason && <div className="text-green-200/80">“{sel.email_won_reason}”</div>}
{sel.email_won_by && <div className="mt-0.5">confirmed by {sel.email_won_by}{sel.email_won_at ? ` · ${sel.email_won_at.slice(0, 10)}` : ''}</div>}
</div>
)}
{sel.email_lost && (sel.email_lost_reason || sel.email_lost_by) && (
<div className="mt-2.5 pt-2 border-t border-red-500/20 text-xs text-mav-muted">
{sel.email_lost_reason && <div className="text-red-200/80">“{sel.email_lost_reason}”</div>}
{sel.email_lost_by && <div className="mt-0.5">marked by {sel.email_lost_by}{sel.email_lost_at ? ` · ${sel.email_lost_at.slice(0, 10)}` : ''}</div>}
</div>
)}
{sel.unlikely && (sel.unlikely_reason || sel.unlikely_by) && (
<div className="mt-2.5 pt-2 border-t border-orange-500/20 text-xs text-mav-muted">
{sel.unlikely_reason && <div className="text-orange-200/80">“{sel.unlikely_reason}”</div>}
{sel.unlikely_by && <div className="mt-0.5">flagged by {sel.unlikely_by}{sel.unlikely_at ? ` · ${sel.unlikely_at.slice(0, 10)}` : ''}</div>}
</div>
)}
{sheetLag(sel) && (
<div className="mt-2.5 pt-2 border-t border-amber-500/30 text-xs text-amber-300">
⚠ The Quotes sheet still shows this Open — set that row to <span className="font-semibold">{confirmLag(sel) || bookedLag(sel) ? 'Confirmed' : 'Cancelled'}</span>.
{bookedLag(sel) ? ` It is already invoiced in the revenue sheet (${money(sel.booked_amount)}${sel.booked_month ? ' · ' + sel.booked_month.slice(0, 7) : ''}), so until you do it is counted twice — once as revenue, once as live pipeline.`
: confirmLag(sel) ? ' Until you do, it will not book as revenue.' : ' Until you do, it keeps counting as live pipeline in every sheet-driven report.'}
</div>
)}
</div>
)}

{sel.flag && !sheetLag(sel) && <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"><span className="font-semibold">⚠ Possible data issue:</span> {sel.flag}</div>}
{oppStatus(sel) === 'Won' && !sel.email_won && !bookedLag(sel) && <div className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-400 font-semibold">✓ Won — {money(sel.won_amount || sel.value)} confirmed (booked in the revenue sheet)</div>}
{oppStatus(sel) === 'Lost' && !sel.email_lost && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400 font-semibold">✗ Lost — cancelled in the Quotes sheet. Won always overrides if the client later books.</div>}

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
<div><div className="text-xs text-mav-muted">AM (account manager / NBD)</div>{sel.sales_person || '—'}</div>
<div><div className="text-xs text-mav-muted">PM (project manager)</div>{sel.pm_owner || '—'}</div>
<div><div className="text-xs text-mav-muted">Service</div>{svcOf(sel)}</div>
<div><div className="text-xs text-mav-muted">Technology</div>{sel.technology || '—'}</div>
<div><div className="text-xs text-mav-muted">Type</div>{typeLabel(sel)}{sel.mis_tagged_new && <div className="text-xs text-red-400 mt-0.5">Sheet says “New”, but {sel.sales_person || 'no owner'} is not NBD — counted as Repeat.</div>}</div>
<div><div className="text-xs text-mav-muted">RFQ / quote status</div><span className={`text-xs px-2 py-1 rounded-full ${badge(sel.rfq_status)}`}>{sel.status || sel.rfq_status || (sel.rfq ? 'RFQ' : '—')}</span></div>
<div><div className="text-xs text-mav-muted">GEO</div>{sel.geo || '—'}</div>
<div><div className="text-xs text-mav-muted">Date</div>{(sel.source_date || sel.first_date || '').slice(0, 10) || '—'}</div>
<div className="col-span-2"><div className="text-xs text-mav-muted">{sel.quote_ref ? 'Quote / subject' : 'Subject'}</div>{sel.source_subject || '—'}</div>
</div>
</aside>
</div>
)}
</div>
)
}
