'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import { useUnit } from '@/components/BusinessUnitProvider'
import { UnplacedNote } from '@/components/UnitToggle'
import KPICard from '@/components/KPICard'
import { daysSince, fmtDay, type CardDetails, type DetailCol } from '@/components/CardDetail'
import { KPIRow, Segments, FilterBar, SectionTitle, Panel } from '@/components/PageParts'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import { inUnit, unitOf } from '@/lib/business-unit'

import { askReason } from '@/lib/ask'
import MultiSelect from '@/components/MultiSelect'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import { getDelights, getManualFeedback, decideManualFeedback, getFeedbackApprovers,
  type Delight, type ManualFeedback, type FeedbackApprover, getClientDepts, clientKey } from '@/lib/supabase'
import AddFeedbackDialog from '@/components/AddFeedbackDialog'
import { currentEmail, getStoredProfile } from '@/lib/access'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'

const sel = 'bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)

// An empty selection means "all", exactly as the old "All GEOs" option did.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())

// One row per client. The defaults are what a glance needs — who, where, which source,
// what they said, how often, when; the rest of what the old cards carried is a tick away
// in Columns, and every quote in full is in the drawer.
const COLS: ColumnDef[] = [
  { key: 'client', label: 'Client', locked: true },
  { key: 'geo', label: 'GEO', default: true },
  { key: 'source', label: 'Source', default: true },
  { key: 'quote', label: 'Feedback', default: true },
  { key: 'project', label: 'Project' },
  { key: 'count', label: 'Testimonials', default: true },
  { key: 'date', label: 'Date', default: true },
  { key: 'email', label: 'Client email' },
  { key: 'evidence', label: 'Evidence (screenshot)' },
  { key: 'action', label: 'Action', locked: true },
]

export default function Delights() {
  const [rowsAll, setRows] = useState<Delight[]>([])
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
  const [q, setQ] = useState(''); const [geo, setGeo] = useState<string[]>([]); const [src, setSrc] = useState<'' | 'sheet' | 'email'>('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<Delight | null>(null)
  const cols = useColumns('feedback', COLS)

  // Manually entered praise, and whether this person is the one who signs it off.
  const [manual, setManual] = useState<ManualFeedback[]>([])
  const [approvers, setApprovers] = useState<FeedbackApprover[]>([])
  const [adding, setAdding] = useState(false)
  const [me, setMe] = useState('')
  const [iAmAdmin, setIAmAdmin] = useState(false)
  const loadManual = () => { getManualFeedback().then(setManual).catch(() => {}) }
  useEffect(() => {
    setMe(currentEmail() || '')
    setIAmAdmin(!!getStoredProfile()?.is_admin)
    getFeedbackApprovers().then(setApprovers).catch(() => {})
    loadManual()
  }, [])
  const approverFor = (dept?: string) =>
    approvers.find(a => a.dept_pattern.toUpperCase() === (dept || '').toUpperCase())
  // Waiting on THIS person. Admins see everything waiting, because chasing it is theirs.
  const pending = useMemo(() => manual.filter(m => m.status === 'pending'), [manual])
  const mineAnyUnit = useMemo(
    () => pending.filter(m => iAmAdmin || approverFor(m.service_dept)?.email === me),
    [pending, iAmAdmin, me, approvers])
  // Manual feedback carries its own service department, so the queue follows the
  // department switch like everything else. What it hides is counted underneath — an
  // approval must never vanish just because the switch is on the other unit.
  const minePending = useMemo(() => mineAnyUnit.filter(m => inUnit(m.service_dept, unit)), [mineAnyUnit, unit])
  const pendingElsewhere = mineAnyUnit.length - minePending.length
  // Starts on this person's own clients. A PM opens Delights to see their own accounts
  // being praised; everybody's is a nice read and not the job. One click shows the lot.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])
  // Using the sidebar closes this drawer — including a click on the section you are
  // already on, which is not a route change and so re-renders nothing by itself.
  useCloseOnNav(useCallback(() => setSel(null), []))

  useEffect(() => { getDelights().then(r => { setRows(r); setLoading(false) }) }, [])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])

  const srcCounts = useMemo(() => ({
    sheet: rows.filter(r => (r.sheet_count || 0) > 0).length,
    email: rows.filter(r => (r.email_count || 0) > 0).length,
  }), [rows])

  // ── Card drill-downs ──────────────────────────────────────────────────────────
  // The cards count the department's board before the filters, so the panels list the
  // same clients: all of them, those with sheet praise, those with email praise. A row
  // opens the client's drawer.
  const srcRows = useMemo(() => ({
    sheet: rows.filter(r => (r.sheet_count || 0) > 0),
    email: rows.filter(r => (r.email_count || 0) > 0),
  }), [rows])
  const delightCols: DetailCol<Delight>[] = [
    { key: 'client', label: 'Client', value: r => r.company_name, wide: true, sort: r => (r.company_name || '').toLowerCase() },
    { key: 'quote', label: 'Feedback', value: r => r.headline || '—', wide: true },
    { key: 'count', label: 'Testimonials', value: r => r.count, align: 'right', sort: r => r.count, total: rs => rs.reduce((s, r) => s + r.count, 0) },
    { key: 'date', label: 'Date', value: r => fmtDay(r.date), sort: r => r.date || '' },
    { key: 'age', label: 'Days since', value: r => daysSince(r.date) ?? '—', align: 'right', sort: r => daysSince(r.date) ?? -1 },
  ]
  const delightDetails = (list: Delight[], subtitle: string): CardDetails<Delight> => ({
    subtitle, rows: list, columns: delightCols, defaultSort: 'date',
    groupBy: r => (r.geo || '').trim() || 'No GEO',
    rowKey: r => r.company_name, onRowClick: r => setSel(r),
  })
  // The approval queue: manual feedback waiting on this person, in this department.
  // Approving stays in the queue panel below the cards; the drill-down is for reading.
  const pendingDetails: CardDetails<ManualFeedback> = {
    subtitle: 'Manual feedback waiting for your sign-off — days counted from when it was submitted',
    rows: minePending, defaultSort: 'age', rowKey: m => m.id,
    groupBy: m => m.service_dept || 'No department',
    columns: [
      { key: 'client', label: 'Client', value: m => m.company_name, wide: true, sort: m => (m.company_name || '').toLowerCase() },
      { key: 'quote', label: 'Feedback', value: m => m.quote, wide: true },
      { key: 'channel', label: 'Channel', value: m => m.channel || '—', sort: m => m.channel || '' },
      { key: 'from', label: 'From', value: m => m.submitted_by, wide: true, sort: m => m.submitted_by || '' },
      { key: 'age', label: 'Days waiting', value: m => daysSince(m.submitted_at) ?? '—', align: 'right', sort: m => daysSince(m.submitted_at) ?? -1 },
    ],
  }

  // Every filter except the source. The source tabs count against this, so each tab
  // says how many clients it would show under the other filters as they stand.
  const scoped = useMemo(() => rows.filter(r => {
    if (justMine && !mine.ownsClient(r.company_name)) return false
    if (!keeps(geo, r.geo)) return false
    if (q) { const hay = `${r.company_name} ${r.headline || ''} ${r.items.map(i => `${i.quote || ''} ${i.project || ''}`).join(' ')}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, from, to, justMine, mine])
  const filtered = useMemo(() => scoped.filter(r => {
    if (src === 'sheet' && !(r.sheet_count || 0)) return false
    if (src === 'email' && !(r.email_count || 0)) return false
    return true
  }), [scoped, src])

  // Anything behind "More filters" that is set. The row opens itself when one is, so a
  // live filter is never hidden behind a closed toggle.
  const hiddenActive = (from ? 1 : 0) + (to ? 1 : 0)
  const [more, setMore] = useState(false)
  useEffect(() => { if (hiddenActive) setMore(true) }, [hiddenActive])
  const anyFilter = !!(q || geo.length > 0 || src || from || to)

  const badge = 'text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap'
  const cta = 'rounded-full bg-mav-fill text-black text-xs font-semibold px-3 py-1 hover:brightness-95 whitespace-nowrap'

  return (
    <div>
      {adding && <AddFeedbackDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadManual() }} />}
      <Header title="Feedback" subtitle="What clients actually said — the standout praise from the feedback sheet, plus anything logged by hand once its approver signs it off."
        actions={
          <button onClick={() => setAdding(true)} className="rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm hover:brightness-95 transition whitespace-nowrap">
            + Add feedback
          </button>
        } />
      <UnplacedNote n={unplaced} noun="clients" className="-mt-3 mb-4" />

      {/* Department totals, before the filters below. A client can be praised on both the
          sheet and email, so the two source cards overlap and need not add up. */}
      <KPIRow cols={4}>
        <KPICard tone="accent" label="Happy clients" value={String(rows.length)} sub="one row per client"
          details={delightDetails(rows, 'Every praised client in this department')} />
        <KPICard tone="green" label="From sheet" value={String(srcCounts.sheet)} sub="feedback sheet"
          details={delightDetails(srcRows.sheet, 'Clients with praise on the feedback sheet')} />
        <KPICard tone="blue" label="From email" value={String(srcCounts.email)} sub="email review"
          details={delightDetails(srcRows.email, 'Clients with praise found in the email review')} />
        <KPICard tone={minePending.length ? 'amber' : 'default'} label="Waiting for you" value={String(minePending.length)} sub="manual feedback to approve"
          details={pendingDetails} />
      </KPIRow>

      {/* Waiting on somebody. Above the board on purpose: an approval queue nobody sees
          is an approval queue nobody clears, and the feedback sits invisible meanwhile. */}
      {minePending.length === 0 && pendingElsewhere > 0 && (
        <p className="mb-4 text-[11px] text-mav-muted">{pendingElsewhere} piece{pendingElsewhere > 1 ? 's' : ''} of feedback waiting for you in the other department — switch it in the sidebar.</p>
      )}
      {minePending.length > 0 && (
        <Panel flush className="mb-5 !border-mav-yellow/60"
          title={<span className="text-mav-fg">{minePending.length} piece{minePending.length > 1 ? 's' : ''} of feedback waiting for you</span>}
          right={pendingElsewhere > 0 ? <span className="text-[11px] text-mav-muted">+{pendingElsewhere} more in the other department — switch it in the sidebar.</span> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left border-b border-mav-line"><tr>
                <th className="px-3 py-2.5">Client</th>
                <th className="px-3 py-2.5">Channel</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Feedback</th>
                <th className="px-3 py-2.5">About</th>
                <th className="px-3 py-2.5">From</th>
                <th className="px-3 py-2.5 sticky-action">Action</th>
              </tr></thead>
              <tbody>
                {minePending.map(m => (
                  <tr key={m.id} className="border-b border-mav-line/60 last:border-0 align-top">
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{m.company_name}</td>
                    <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{m.channel}</td>
                    <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{(m.happened_on || '').slice(0, 10)}</td>
                    <td className="px-3 py-2.5"><p className="max-w-[420px] truncate italic text-mav-fg/80" title={m.quote}>&ldquo;{m.quote}&rdquo;</p></td>
                    <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{m.pm_owner || '—'}</td>
                    <td className="px-3 py-2.5 text-mav-muted max-w-[180px] truncate" title={m.submitted_by}>{m.submitted_by}</td>
                    <td className="px-3 py-2.5 sticky-action">
                      <div className="flex items-center gap-2">
                        <button onClick={async () => {
                          const res = await decideManualFeedback(m.id, true)
                          if (!res.ok) { window.alert(res.error); return }
                          loadManual(); getDelights().then(setRows)
                        }} className={cta}>
                          Approve
                        </button>
                        <button onClick={async () => {
                          // Cancel abandons the rejection; an empty note is allowed, because
                          // the submitter is told who declined it either way.
                          const why = askReason({ question: 'Why is it not going on the board? (optional)' })
                          if (why === null) return
                          const res = await decideManualFeedback(m.id, false, why || undefined)
                          if (!res.ok) { window.alert(res.error); return }
                          loadManual()
                        }} className="text-xs text-mav-muted hover:text-mav-fg whitespace-nowrap">Not this one</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <SectionTitle info={<>Three sources — testimonials from the feedback sheet, praise found in the email review (the <span className="text-sky-400">Email</span> badge), and anything said on Slack or a call that somebody typed in and an approver signed off. The first two are scored on what the text does: unprompted, praising the work, the people or the effect it had. A thanks that stops inside a line, a delivery note and a pricing thread with a compliment in it all stay out, however warm they read.</>}>
        Real appreciation only
      </SectionTitle>

      {/* Source is the page's main split. The two overlap: a client praised in both
          places is under each tab. */}
      <Segments<'' | 'sheet' | 'email'>
        value={src}
        onChange={setSrc}
        items={[
          { id: '', label: 'All', count: scoped.length },
          { id: 'sheet', label: 'From sheet', count: scoped.filter(r => (r.sheet_count || 0) > 0).length },
          { id: 'email', label: 'From email', count: scoped.filter(r => (r.email_count || 0) > 0).length },
        ]} />

      <FilterBar right={<>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">{filtered.length} happy clients</span>
        {anyFilter && <button onClick={() => { setQ(''); setGeo([]); setSrc(''); setFrom(''); setTo('') }} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">✕ Clear all</button>}
      </>}>
        {mine.canScope && (
          <MineFilter on={justMine} onChange={setJustMine} label="My clients"
            hidden={rows.filter(r => !mine.ownsClient(r.company_name)).length} />
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or quote…" className={`${sel} w-64`} />
        <MultiSelect label="All GEOs" options={geos} selected={geo} onChange={setGeo} className="w-40" />
        <button onClick={() => setMore(v => !v)} aria-expanded={more}
          className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">
          More filters{hiddenActive ? ` (${hiddenActive})` : ''}
        </button>
        {more && <>
          <div className="basis-full h-0" />
          <span className="text-xs text-mav-muted">From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} aria-label="From" />
          <span className="text-xs text-mav-muted">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} aria-label="To" />
        </>}
      </FilterBar>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p>
        : !rows.length ? <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">No client delights captured yet.</div>
        : !filtered.length ? <p className="text-sm text-mav-muted">No delights match these filters.</p>
        : (
        <Panel flush title={<>Happy clients · {filtered.length}</>} right={<ColumnPicker cols={cols} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left border-b border-mav-line"><tr>
                <th className="px-3 py-2.5">Client</th>
                {cols.on('geo') && <th className="px-3 py-2.5">GEO</th>}
                {cols.on('source') && <th className="px-3 py-2.5">Source</th>}
                {cols.on('quote') && <th className="px-3 py-2.5">Feedback</th>}
                {cols.on('project') && <th className="px-3 py-2.5">Project</th>}
                {cols.on('count') && <th className="px-3 py-2.5 text-right">Testimonials</th>}
                {cols.on('date') && <th className="px-3 py-2.5">Date</th>}
                {cols.on('email') && <th className="px-3 py-2.5">Client email</th>}
                {cols.on('evidence') && <th className="px-3 py-2.5">Evidence</th>}
                <th className="px-3 py-2.5 sticky-action">Action</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => {
                  // No quote on the headline: say what IS on record instead of an empty cell.
                  const fallback = `${r.headline_evidence ? 'Great feedback captured as a screenshot' : 'Positive feedback on record'}${r.headline_project ? ` — ${r.headline_project}` : ''}.`
                  return (
                  <tr key={r.company_name} onClick={() => setSel(r)} className="border-b border-mav-line/60 last:border-0 hover:bg-mav-dark/40 cursor-pointer">
                    <td className="px-3 py-2.5 font-semibold max-w-[220px] truncate" title={r.company_name}>{r.company_name}</td>
                    {cols.on('geo') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{r.geo || '—'}</td>}
                    {cols.on('source') && <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {!!r.sheet_count && <span title={`${r.sheet_count} logged in the feedback sheet`} className={`${badge} bg-green-500/15 text-green-400`}>Sheet</span>}
                        {!!r.email_count && <span title={`${r.email_count} picked up in the email review`} className={`${badge} bg-sky-500/15 text-sky-300`}>Email{r.email_count > 1 ? ` ${r.email_count}` : ''}</span>}
                      </div>
                    </td>}
                    {cols.on('quote') && <td className="px-3 py-2.5">
                      {r.headline
                        ? <p className="max-w-[440px] truncate text-mav-fg/90" title={r.headline}>&ldquo;{r.headline}&rdquo;</p>
                        : <p className="max-w-[440px] truncate text-mav-muted italic" title={fallback}>{fallback}</p>}
                    </td>}
                    {cols.on('project') && <td className="px-3 py-2.5 text-mav-muted max-w-[180px] truncate" title={r.headline_project}>{r.headline_project || '—'}</td>}
                    {cols.on('count') && <td className="px-3 py-2.5 text-right tabular-nums">{r.count}</td>}
                    {cols.on('date') && <td className="px-3 py-2.5 text-mav-muted whitespace-nowrap">{day(r.date) || '—'}</td>}
                    {cols.on('email') && <td className="px-3 py-2.5 text-mav-muted max-w-[200px] truncate" title={r.client_email}>{r.client_email || '—'}</td>}
                    {cols.on('evidence') && <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.headline_evidence
                        ? <a href={r.headline_evidence} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-green-400 hover:underline text-xs">View feedback</a>
                        : <span className="text-mav-muted">—</span>}
                    </td>}
                    <td className="px-3 py-2.5 sticky-action">
                      <button onClick={e => { e.stopPropagation(); setSel(r) }} className={cta}>Open</button>
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
                  {sel_.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.geo}</span>}
                  {sel_.count > 1 && <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-400">{sel_.count} testimonials</span>}
                  {sel_.client_email && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.client_email}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
            </div>

            <div className="text-xs uppercase tracking-wide text-green-300/80 mb-2">What the client said</div>
            <div className="space-y-3">
              {sel_.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((it, i) => (
                <div key={i} className="rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3">
                  {it.quote
                    ? <p className="text-sm leading-relaxed">&ldquo;{it.quote}&rdquo;</p>
                    : <p className="text-sm text-mav-muted italic">{it.evidence ? 'Feedback captured as a screenshot.' : 'Positive feedback on record.'}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-mav-muted">
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${it.source === 'email' ? 'bg-sky-500/15 text-sky-300' : 'bg-green-500/15 text-green-400'}`} title={it.source === 'email' ? `From the email review${it.subject ? ` — “${it.subject}”` : ''}` : 'Logged in the feedback sheet'}>{it.source === 'email' ? 'Email' : 'Sheet'}</span>
                    {it.project && <span className="px-1.5 py-0.5 rounded-full bg-mav-line">{it.project}</span>}
                    {it.type && <span>{it.type}</span>}
                    {it.date && <span>· {it.date}</span>}
                    {it.evidence && <a href={it.evidence} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">View feedback</a>}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
