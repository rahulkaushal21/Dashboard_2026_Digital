'use client'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import { useUnit } from '@/components/BusinessUnitProvider'
import { UnplacedNote } from '@/components/UnitToggle'
import KPICard from '@/components/KPICard'
import { KPIRow, Segments, FilterBar, SectionTitle, Panel } from '@/components/PageParts'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import { inUnit, unitOf } from '@/lib/business-unit'

import MultiSelect from '@/components/MultiSelect'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import { getCriticalEscalations, markEscalationStatus, dismissEscalation, type CriticalEscalation, getClientDepts, clientKey } from '@/lib/supabase'
import { askReason } from '@/lib/ask'
import { currentEmail } from '@/lib/access'

const sel = 'bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)
// open = nobody has triaged it · unresolved = looked at, still broken · resolved = done
const statusLabel = (s: string) => s === 'resolved' ? 'Resolved' : s === 'unresolved' ? 'Unresolved' : 'Open'
// Amber, not red and not green: an Unresolved escalation is still live — it stays in the
// list and keeps counting — but someone has already worked it, so it should never be
// mistaken at a glance for one nobody has touched.
const statusTone = (s: string) => s === 'resolved' ? 'bg-green-500/20 text-green-300' : s === 'unresolved' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'
const sentBucket = (s?: string) => { const v = (s || '').toLowerCase(); if (/posit|happy|great|delight/.test(v)) return 'Positive'; if (/negat|risk|churn|frustrat/.test(v)) return 'Negative'; if (/neutral|stable|mixed/.test(v)) return 'Neutral'; return '' }
const kindTone = (t?: string) => { const v = (t || '').toLowerCase(); if (/complaint|churn/.test(v)) return 'bg-red-500/15 text-red-400'; if (/risk|escalat/.test(v)) return 'bg-orange-500/15 text-orange-300'; return 'bg-mav-line text-mav-muted' }
const kindLabel = (t?: string) => { const v = (t || '').toLowerCase(); if (/complaint/.test(v)) return 'Complaint'; if (/churn/.test(v)) return 'Churn risk'; if (/risk|escalat/.test(v)) return 'At risk'; return t || 'Negative' }

// An empty selection means "all", exactly as the old "All GEOs" option did.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())

// One row per client. The defaults are what decides whether a row is yours and how bad it
// is — status, kind, where, what happened, whose client, when. Service and technology, the
// latest reply and the resolution trail are a tick away in Columns; every thread in full
// is in the drawer.
const COLS: ColumnDef[] = [
  { key: 'client', label: 'Client', locked: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'kind', label: 'Type', default: true },
  { key: 'geo', label: 'GEO', default: true },
  { key: 'what', label: 'What happened', default: true },
  { key: 'pm', label: 'PM', default: true },
  { key: 'last', label: 'Last flagged', default: true },
  { key: 'first', label: 'First flagged' },
  { key: 'count', label: 'Escalations' },
  { key: 'latest', label: 'Latest update' },
  { key: 'service', label: 'Service' },
  { key: 'tech', label: 'Technology' },
  { key: 'resolved', label: 'Resolved on / by' },
  { key: 'email', label: 'Client email' },
  { key: 'action', label: 'Action', locked: true },
]

const badge = 'text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap'
const cta = 'rounded-full bg-mav-fill text-black text-xs font-semibold px-3 py-1 hover:brightness-95 whitespace-nowrap disabled:opacity-50'

// The row's other status moves, behind "More" so the sticky Action column stays one
// button wide. Each is the same call the drawer makes.
function RowMenu({ items, disabled }: { items: { label: string; title?: string; tone?: string; run: () => void }[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div className="relative" ref={box} onClick={e => e.stopPropagation()}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-2.5 py-1 text-xs whitespace-nowrap disabled:opacity-50">More</button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-mav-line bg-mav-panel shadow-xl p-1">
          {items.map(it => (
            <button key={it.label} type="button" title={it.title} onClick={() => { setOpen(false); it.run() }}
              className={`w-full text-left text-sm px-2 py-1.5 rounded hover:bg-mav-fg/5 ${it.tone || ''}`}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CriticalEscalations() {
  const [rowsAll, setRows] = useState<CriticalEscalation[]>([])
  // ── Business unit ───────────────────────────────────────────────────────────
  // These rows are about a CLIENT, not a booking, so they carry no department of their
  // own. The client's booked history is the only honest answer; 399 of 401 resolve, and
  // the rest are counted rather than dropped.
  const [clientDepts, setClientDepts] = useState<Map<string, string>>(new Map())
  const { unit } = useUnit()
  useEffect(() => { getClientDepts().then(setClientDepts).catch(() => {}) }, [])
  const rows = useMemo(
    () => rowsAll.filter(r => inUnit(clientDepts.get(clientKey(r.company_name)), unit)), [rowsAll, clientDepts, unit])
  const unplaced = useMemo(
    () => unit === 'all' ? 0 : rowsAll.filter(r => unitOf(clientDepts.get(clientKey(r.company_name))) === null).length,
    [rowsAll, clientDepts, unit])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(''); const [geo, setGeo] = useState<string[]>([]); const [status, setStatus] = useState<'all' | 'open' | 'unresolved' | 'resolved'>('all')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<CriticalEscalation | null>(null)
  // Starts on this person's own clients. These are the ones they have to act on; the
  // rest is somebody else's queue. One click shows the whole board.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])
  // Using the sidebar closes this drawer — including a click on the section you are
  // already on, which is not a route change and so re-renders nothing by itself.
  useCloseOnNav(useCallback(() => setSel(null), []))
  const [busy, setBusy] = useState<string | null>(null)
  const cols = useColumns('critical-escalations', COLS)
  // Dates live behind "More filters", which opens itself when one is set so a live
  // filter is never hidden behind a closed toggle.
  const [more, setMore] = useState(false)

  useEffect(() => { getCriticalEscalations().then(r => { setRows(r); setLoading(false) }) }, [])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])
  const openCount = rows.filter(r => r.status === 'open').length
  const unresolvedCount = rows.filter(r => r.status === 'unresolved').length

  const resolvedCount = rows.filter(r => r.status === 'resolved').length

  // Every filter except status. The status tabs count against this, so each tab says how
  // many rows it would show under the other filters as they stand.
  const scoped = useMemo(() => rows.filter(r => {
    if (justMine && !mine.ownsClient(r.company_name)) return false
    if (!keeps(geo, r.geo)) return false
    if (q) { const hay = `${r.company_name} ${r.headline || ''} ${r.items.map(i => i.escalation_summary).join(' ')}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.last_flagged_date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, from, to, justMine, mine])
  const filtered = useMemo(() => status === 'all' ? scoped : scoped.filter(r => r.status === status), [scoped, status])
  const tabCount = (s: string) => scoped.filter(r => r.status === s).length
  const hiddenActive = (from ? 1 : 0) + (to ? 1 : 0)

  const key = (r: CriticalEscalation) => r.threadIds.join(',')
  const patch = (r: CriticalEscalation, fields: Partial<CriticalEscalation>) => {
    setRows(prev => prev.map(x => key(x) === key(r) ? { ...x, ...fields } : x))
    setSel(prev => prev && key(prev) === key(r) ? { ...prev, ...fields } : prev)
  }

  async function setStatusOf(r: CriticalEscalation, st: 'open' | 'unresolved' | 'fixed' | 'positive') {
    setBusy(key(r))
    const ok = await markEscalationStatus(r.threadIds, st, { actor: currentEmail() || undefined })
    setBusy(null)
    if (!ok) { alert('Could not update — please try again.'); return }
    const settled = st === 'fixed' || st === 'positive'
    patch(r, { status: settled ? 'resolved' : st, resolved_at: settled ? new Date().toISOString() : undefined, resolved_by: settled ? (currentEmail() || undefined) : undefined })
  }

  async function remove(r: CriticalEscalation) {
    const many = r.count > 1 ? ` (${r.count} threads)` : ''
    if (!window.confirm(`Remove ${r.company_name}${many} from Critical Escalations?\n\nUse this when it isn't really our escalation — e.g. the client is frustrated for external reasons, not a problem from our side. It's removed from the list (the email signals are preserved). To mark a genuine one as resolved instead, use “Mark fixed / positive” — that keeps it in the list.`)) return
    // REQUIRED, and Cancel means cancel. This is the only record of why a client's
    // escalation left the board — the signals stay in the database, but nothing else
    // ever says why somebody decided it was not ours. It also feeds what the review
    // learns: "quote decline, not a critical escalation" is how the next one gets
    // classified correctly in the first place.
    const reason = askReason({
      question: `Why isn't ${r.company_name} our escalation?\n\ne.g. "external frustration, not our issue" or "quote decline, not an escalation".`,
      required: true,
    })
    if (reason === null) return
    setBusy(key(r))
    const done = await dismissEscalation(r.threadIds, { actor: currentEmail() || undefined, reason })
    setBusy(null)
    if (!done) { alert('Could not remove it — please try again.'); return }
    setRows(prev => prev.filter(x => key(x) !== key(r))); setSel(null)
  }

  return (
    <div>
      <Header title="Critical Escalations" subtitle="Major negative feedback raised by clients over email — one row per client. Escalations stay here even after they're resolved; mark them Fixed or Positive yourself." />
      <UnplacedNote n={unplaced} noun="clients" className="-mt-3 mb-4" />

      {/* The four states as cards. Counts are the whole board in this department — the
          filters below narrow the list, not these. */}
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Clients escalated" value={String(rows.length)} sub="one row per client" />
        <KPICard tone="red" label="Open" value={String(openCount)} sub="nobody has triaged it" />
        <KPICard tone="amber" label="Unresolved" value={String(unresolvedCount)} sub="looked at, still broken"
          info="Amber, not red and not green: an Unresolved escalation is still live — it stays in the list and keeps counting, here and on the Clients board — but someone has already worked it." />
        <KPICard tone="green" label="Resolved" value={String(resolvedCount)} sub="marked fixed / positive" />
      </KPIRow>

      <SectionTitle info={<>One entry per client (all their escalation threads roll up together). Every escalation is captured automatically and <span className="font-semibold">kept</span> — it never disappears on its own. When the client comes back positive, click <span className="text-green-400">Mark fixed / positive</span> so the &ldquo;was escalated → now solved&rdquo; history stays visible. Mark it <span className="text-amber-400">Unresolved</span> when you have looked and it is still broken — that keeps it as live risk here <em>and</em> on the Clients board, and separates it from the ones nobody has picked up yet. Use <span className="font-semibold">Not an issue</span> only for a false alarm; a removed or resolved escalation also stops counting against the client on the Clients page.</>}>
        How this works
      </SectionTitle>

      {/* Status is the page's main split. Each count is what that tab would show under
          every other filter as it stands. */}
      <Segments<'all' | 'open' | 'unresolved' | 'resolved'>
        value={status}
        onChange={setStatus}
        items={[
          { id: 'open', label: 'Open', count: tabCount('open') },
          { id: 'unresolved', label: 'Unresolved', count: tabCount('unresolved') },
          { id: 'resolved', label: 'Resolved', count: tabCount('resolved') },
          { id: 'all', label: 'All', count: scoped.length },
        ]} />

      <FilterBar right={<>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{filtered.length} clients · {openCount} open · {unresolvedCount} unresolved</span>
        {(q || geo.length > 0 || from || to || status !== 'all') && <button onClick={() => { setQ(''); setGeo([]); setFrom(''); setTo(''); setStatus('all') }} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">✕ Clear all</button>}
      </>}>
        {mine.canScope && (
          <MineFilter on={justMine} onChange={setJustMine} label="My clients"
            hidden={rows.filter(r => !mine.ownsClient(r.company_name)).length} />
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or detail…" className={`${sel} w-64`} />
        <MultiSelect label="All GEOs" options={geos} selected={geo} onChange={setGeo} className="w-40" />
        <button onClick={() => setMore(v => !v)} aria-expanded={more || hiddenActive > 0}
          className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">
          More filters{hiddenActive ? ` (${hiddenActive})` : ''}
        </button>
        {(more || hiddenActive > 0) && <>
          <div className="basis-full h-0" />
          <span className="text-xs text-mav-muted">From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} aria-label="From" />
          <span className="text-xs text-mav-muted">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} aria-label="To" />
        </>}
      </FilterBar>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p>
        : !rows.length ? <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">No client escalations captured yet.</div>
        : !filtered.length ? <p className="text-sm text-mav-muted">No escalations match these filters.</p>
        : (
        <Panel flush title={<>Escalated clients · {filtered.length}</>} right={<ColumnPicker cols={cols} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left border-b border-mav-line"><tr>
                <th className="px-3 py-2.5">Client</th>
                {cols.on('status') && <th className="px-3 py-2.5">Status</th>}
                {cols.on('kind') && <th className="px-3 py-2.5">Type</th>}
                {cols.on('geo') && <th className="px-3 py-2.5">GEO</th>}
                {cols.on('what') && <th className="px-3 py-2.5">What happened</th>}
                {cols.on('pm') && <th className="px-3 py-2.5">PM</th>}
                {cols.on('last') && <th className="px-3 py-2.5">Last flagged</th>}
                {cols.on('first') && <th className="px-3 py-2.5">First flagged</th>}
                {cols.on('count') && <th className="px-3 py-2.5 text-right">Escalations</th>}
                {cols.on('latest') && <th className="px-3 py-2.5">Latest update</th>}
                {cols.on('service') && <th className="px-3 py-2.5">Service</th>}
                {cols.on('tech') && <th className="px-3 py-2.5">Technology</th>}
                {cols.on('resolved') && <th className="px-3 py-2.5">Resolved</th>}
                {cols.on('email') && <th className="px-3 py-2.5">Client email</th>}
                <th className="px-3 py-2.5 sticky-action">Action</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => {
                  const resolved = r.status === 'resolved'; const turnedPositive = !resolved && sentBucket(r.latest_sentiment) === 'Positive'
                  const b = busy === key(r)
                  const sb = sentBucket(r.latest_sentiment)
                  return (
                  <tr key={key(r)} onClick={() => setSel(r)} className="border-b border-mav-line/60 last:border-0 hover:bg-mav-dark/40 cursor-pointer">
                    <td className="px-3 py-2.5 font-semibold max-w-[200px] truncate" title={r.company_name}>{r.company_name}</td>
                    {cols.on('status') && <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <span className={`${badge} ${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
                        {turnedPositive && <span className={`${badge} bg-green-500/15 text-green-400`} title="The client's latest reply reads positive — it may be ready to mark fixed">Now positive</span>}
                      </div>
                    </td>}
                    {cols.on('kind') && <td className="px-3 py-2.5"><span className={`${badge} ${kindTone(r.signal_type)}`}>{kindLabel(r.signal_type)}</span></td>}
                    {cols.on('geo') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{r.geo || '—'}</td>}
                    {cols.on('what') && <td className="px-3 py-2.5"><p className="max-w-[380px] truncate text-mav-fg/90" title={r.headline || ''}>{r.headline || '(no detail)'}</p></td>}
                    {/* The PM is a default column — it is the one thing that decides
                        whether a row is yours. */}
                    {cols.on('pm') && <td className="px-3 py-2.5 whitespace-nowrap">{r.pm_owner || '—'}</td>}
                    {cols.on('last') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{day(r.last_flagged_date) || '—'}</td>}
                    {cols.on('first') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{day(r.first_flagged_date) || '—'}</td>}
                    {cols.on('count') && <td className="px-3 py-2.5 text-right tabular-nums">{r.count}</td>}
                    {cols.on('latest') && <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 max-w-[320px]">
                        {sb && <span className={`${badge} ${sb === 'Positive' ? 'bg-green-500/15 text-green-400' : sb === 'Negative' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{sb}</span>}
                        <span className="truncate text-mav-muted" title={r.latest_summary || ''}>{r.latest_summary || '—'}</span>
                      </div>
                    </td>}
                    {cols.on('service') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{r.service_dept || '—'}</td>}
                    {cols.on('tech') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{r.technology || '—'}</td>}
                    {cols.on('resolved') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{r.resolved_at ? `${day(r.resolved_at)}${r.resolved_by ? ` · ${r.resolved_by}` : ''}` : '—'}</td>}
                    {cols.on('email') && <td className="px-3 py-2.5 text-mav-muted max-w-[200px] truncate" title={r.client_email}>{r.client_email || '—'}</td>}
                    <td className="px-3 py-2.5 sticky-action" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {!resolved
                          ? <button onClick={() => setStatusOf(r, 'fixed')} disabled={b} className={cta}>Mark fixed</button>
                          : <button onClick={() => setStatusOf(r, 'open')} disabled={b} className={cta}>Reopen</button>}
                        <RowMenu disabled={b} items={[
                          ...(!resolved ? [
                            { label: 'Positive', tone: 'text-green-400', run: () => setStatusOf(r, 'positive') },
                            ...(r.status !== 'unresolved' ? [{ label: 'Unresolved', tone: 'text-amber-300', title: 'Looked at, still broken — keeps it as live risk here and on Clients', run: () => setStatusOf(r, 'unresolved') }] : []),
                          ] : [
                            { label: 'Unresolved', tone: 'text-amber-300', title: 'Closed too early — it is still broken', run: () => setStatusOf(r, 'unresolved') },
                          ]),
                          { label: 'Not an issue', tone: 'text-mav-muted hover:text-red-300', title: 'Not really our escalation — e.g. client frustrated for external reasons. Removes it from the list.', run: () => remove(r) },
                          { label: 'Open details', run: () => setSel(r) },
                        ]} />
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {sel_ && (
        <div className="fixed inset-0 lg:left-60 z-40" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6 lg:p-8">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold"><ClientLink name={sel_.company_name} /></h2>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusTone(sel_.status)}`}>{statusLabel(sel_.status)}</span>
                  {sel_.count > 1 && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.count} escalations</span>}
                  {sel_.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.geo}</span>}
                  {/* Whose client, what service, what it is built in — the three things
                      you would otherwise open Client 360 to find out before acting. */}
                  {sel_.pm_owner && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-fg/80">{sel_.pm_owner}</span>}
                  {sel_.service_dept && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.service_dept}</span>}
                  {sel_.technology && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.technology}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
            </div>

            <div className="space-y-4">
              {sel_.items.map((it, i) => (
                <div key={it.thread_id} className="rounded-lg border border-mav-line bg-mav-dark/30 p-3">
                  {sel_.count > 1 && <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">Escalation {i + 1}{it.first_flagged_date ? ` · ${day(it.first_flagged_date)}` : ''}</div>}
                  <div className="text-xs uppercase tracking-wide text-red-300/80 mb-1">What happened</div>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{it.escalation_summary || it.source_subject || '(no detail)'}</p>
                  {it.latest_summary && it.latest_summary !== it.escalation_summary && (
                    <div className="mt-2 pt-2 border-t border-mav-line">
                      <div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Latest update {sentBucket(it.latest_sentiment) && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${sentBucket(it.latest_sentiment) === 'Positive' ? 'bg-green-500/15 text-green-400' : sentBucket(it.latest_sentiment) === 'Negative' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{sentBucket(it.latest_sentiment)}</span>}</div>
                      <p className="text-sm leading-relaxed whitespace-pre-line text-mav-muted">{it.latest_summary}</p>
                    </div>
                  )}
                  {it.source_subject && <div className="mt-2 text-[11px] text-mav-muted">Subject: {it.source_subject}{it.client_email ? ` · ${it.client_email}` : ''}</div>}
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-mav-line pt-4 space-y-3">
              {sel_.status !== 'resolved' ? (
                <div className="flex gap-2">
                  <button onClick={() => setStatusOf(sel_, 'fixed')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-green-500/40 text-green-300 hover:bg-green-500/10 disabled:opacity-50">Mark fixed</button>
                  <button onClick={() => setStatusOf(sel_, 'positive')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50">Mark positive</button>
                  {sel_.status !== 'unresolved' && <button onClick={() => setStatusOf(sel_, 'unresolved')} disabled={busy === key(sel_)} title="Looked at, still broken — stays as live risk here and on Clients" className="text-sm px-3 py-2 rounded-md border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Unresolved</button>}
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setStatusOf(sel_, 'open')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-orange-300 disabled:opacity-50">Reopen</button>
                  <button onClick={() => setStatusOf(sel_, 'unresolved')} disabled={busy === key(sel_)} title="Closed too early — it is still broken" className="text-sm px-3 py-2 rounded-md border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Unresolved</button>
                </div>
              )}
              <div>
                <p className="text-xs text-mav-muted mb-2">Not really our escalation — client frustrated for external reasons, not a problem from our side? Remove it (the email signals are preserved).</p>
                <button onClick={() => remove(sel_)} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-red-300 hover:border-red-500/40 disabled:opacity-50">Not an escalation (remove)</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
