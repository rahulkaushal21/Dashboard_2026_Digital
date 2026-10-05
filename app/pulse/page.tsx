'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, X, ArrowUpRight } from 'lucide-react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import DateCell from '@/components/DateCell'
import { fmtDay, type CardDetails } from '@/components/CardDetail'
import { KPIRow, Segments, Panel } from '@/components/PageParts'
import { useUnit } from '@/components/BusinessUnitProvider'
import { useActionCount } from '@/lib/use-action-count'
import { inUnit, unitLabel } from '@/lib/business-unit'
import {
  getOpportunities, getOpportunityDepts, getCriticalEscalations, getDelights, getEmailSignals,
  getClientDepts, clientKey, getLastSyncStatus, getRefreshRuns, getOpportunityEvents, clearReadCache,
  type SyncStatus,
} from '@/lib/supabase'

// Daily Pulse
// -----------
// What came out of the mailbox, the sheets and the last refresh since you last looked, for
// the department picked in the rail — one screen, read top to bottom in a minute, without
// opening an email. Every row opens in a side panel here; nothing navigates away.
//
// Four kinds, in this order everywhere (owner's call, 5 Oct 2026): Deals, Escalations,
// Feedback, Other info. "Other info" is client email that is neither, and each finding
// from the refresh routine's own summary — what it moved, what it could not make stick.

type Group = 'deals' | 'esc' | 'fb' | 'info'
type Tab = Group | 'all'
type Win = '24' | '72' | '168'
type Kind = 'won' | 'new' | 'update' | 'lost' | 'escalation' | 'feedback' | 'email' | 'refresh'

interface Item {
  key: string; kind: Kind; at: string; client: string; title: string; detail?: string
  dept?: string; owner?: string; value?: number; href: string; hrefLabel: string
  facts?: [string, string][]
}

const GROUP_OF: Record<Kind, Group> = {
  won: 'deals', new: 'deals', update: 'deals', lost: 'deals',
  escalation: 'esc', feedback: 'fb', email: 'info', refresh: 'info',
}
const GROUPS: { id: Group; label: string }[] = [
  { id: 'deals', label: 'Deals' }, { id: 'esc', label: 'Escalations' },
  { id: 'fb', label: 'Feedback' }, { id: 'info', label: 'Other info' },
]
const ORDER: Group[] = ['deals', 'esc', 'fb', 'info']
// Inside Deals: money first.
const SUB: Record<Kind, number> = { won: 0, new: 1, update: 2, lost: 3, escalation: 0, feedback: 0, email: 1, refresh: 0 }
const KIND: Record<Kind, { label: string; cls: string }> = {
  won: { label: 'Won', cls: 'bg-green-500/15 text-green-400' },
  new: { label: 'New deal', cls: 'bg-mav-yellow/15 text-mav-yellow' },
  update: { label: 'Deal update', cls: 'bg-amber-500/15 text-amber-300' },
  lost: { label: 'Lost', cls: 'bg-mav-fg/10 text-mav-muted' },
  escalation: { label: 'Escalation', cls: 'bg-red-500/15 text-red-400' },
  feedback: { label: 'Feedback', cls: 'bg-sky-500/15 text-sky-400' },
  email: { label: 'Client email', cls: 'bg-violet-500/15 text-violet-300' },
  refresh: { label: 'Refresh note', cls: 'bg-mav-fg/10 text-mav-fg' },
}

// The feeds whose last run decides how fresh this page is.
const SOURCES: { id: string; label: string }[] = [
  { id: 'gmail-ingest', label: 'Email' },
  { id: 'email-opportunities-scan', label: 'Refresh' },
  { id: 'quote-sync', label: 'Quotes' },
  { id: 'sheet-sync', label: 'Sheets' },
]

const usd = (n?: number) => (n ? `$${Math.round(n).toLocaleString()}` : '')
// A date with no time of day (escalations, feedback) would print as 05:30 — UTC midnight
// in IST — which reads like a real time. Only show one when the source has it.
const hasTime = (d?: string) => /T\d{2}:\d{2}/.test(d || '') && !/T00:00(:00(\.0+)?)?(Z|\+00(:00)?)?$/.test(d || '')
const time = (d?: string | null) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
const stamp = (d?: string | null) => d ? (hasTime(d) ? `${fmtDay(d)}, ${time(d)}` : fmtDay(d)) : '—'
const ago = (d?: string | null) => {
  const t = Date.parse(d || ''); if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const one = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim()
const who = (email?: string) => (email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// "refresh: 68 threads triaged; BOLT … -> Lost; +1 email opp …" → its findings. The first
// part is the run's own housekeeping (how much it read) and stays as the run's headline.
function findings(message: string): { head: string; parts: string[] } {
  const body = message.replace(/^refresh:\s*/i, '')
  const parts = body.split(/;\s+|\.\s+(?=[A-Z+])/).map(one).filter(p => p.length > 3)
  return { head: parts[0] || body, parts: parts.slice(1) }
}

export default function PulsePage() {
  const { unit } = useUnit()
  const actionCount = useActionCount(true)
  // Monday morning wants the weekend too.
  const [win, setWin] = useState<Win>(() => (typeof window !== 'undefined' && new Date().getDay() === 1 ? '72' : '24'))
  const [tab, setTab] = useState<Tab>('deals')
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [openEsc, setOpenEsc] = useState<{ client: string; dept?: string }[]>([])
  const [syncs, setSyncs] = useState<Record<string, SyncStatus | null>>({})
  const [sel, setSel] = useState<Item | null>(null)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    if (fresh) clearReadCache()
    const [opps, oppDepts, escs, delights, signals, clientDepts, runs, events, ...sync] = await Promise.all([
      getOpportunities(), getOpportunityDepts(), getCriticalEscalations(), getDelights(), getEmailSignals(),
      getClientDepts(), getRefreshRuns(8), getOpportunityEvents(8),
      ...SOURCES.map(s => getLastSyncStatus(s.id)),
    ])
    const deptOf = (company?: string) => clientDepts.get(clientKey(company))
    const out: Item[] = []
    const oppById = new Map(opps.map(o => [Number(o.id), o]))

    // ── Deals ────────────────────────────────────────────────────────────────────
    for (const o of opps) {
      if (o.rolled_into != null) continue
      const x = o as any
      const base = {
        client: o.company_name || '—', title: one(o.source_subject) || 'Untitled deal',
        dept: oppDepts.get(Number(o.id)), owner: o.pm_owner || o.sales_person || '',
        value: o.won_amount || o.est_value || 0, href: `/opportunities?deal=${o.id}`, hrefLabel: 'Opportunities',
        facts: [
          ['PM', o.pm_owner || '—'], ['AM', o.sales_person || '—'], ['Status', o.status || '—'],
          ['Win chance', o.win_probability != null ? `${o.win_probability}%` : '—'], ['Next step', one(o.next_step) || '—'],
        ] as [string, string][],
      }
      const seen = o.first_date || o.source_date || o.created_at
      if (seen) out.push({ ...base, key: `o${o.id}`, kind: 'new', at: seen, detail: one(o.gist || o.summary) })
      if (o.won && o.confirmed_at) out.push({ ...base, key: `w${o.id}`, kind: 'won', at: o.confirmed_at, detail: o.confirmed_by ? `Confirmed by ${who(o.confirmed_by)}` : one(o.gist) })
      const lostAt = x.email_lost_at || (o.unlikely ? x.unlikely_at : null)
      if (!o.won && lostAt) out.push({ ...base, key: `l${o.id}`, kind: 'lost', at: lostAt, detail: one(x.email_lost_reason || x.unlikely_reason) })
    }
    // Edits and reassignments made on the dashboard (confirmations are already "Won").
    for (const e of events) {
      if (e.event === 'confirmed' || e.event === 'created') continue
      const o = oppById.get(Number(e.opportunity_id))
      if (!o) continue
      const changed = Object.keys(e.detail || {}).filter(k => !['note', 'from', 'raw_id'].includes(k))
      out.push({
        key: `ev${e.id}`, kind: 'update', at: e.at, client: o.company_name || '—', title: one(o.source_subject) || 'Deal',
        detail: `${e.event === 'reassigned' ? 'Reassigned' : 'Edited'} by ${who(e.actor)}${changed.length ? ` — ${changed.join(', ').replace(/_/g, ' ')}` : ''}`,
        dept: oppDepts.get(Number(o.id)), owner: o.pm_owner || '', value: o.est_value || 0,
        href: `/opportunities?deal=${o.id}`, hrefLabel: 'Opportunities',
      })
    }

    // ── Escalations ──────────────────────────────────────────────────────────────
    const escThreads = new Set<string>()
    const stillOpen: { client: string; dept?: string }[] = []
    for (const e of escs) {
      const dept = e.service_dept || deptOf(e.company_name)
      if (e.status !== 'resolved') stillOpen.push({ client: e.company_name, dept })
      for (const it of e.items) {
        escThreads.add(it.thread_id)
        if (!it.first_flagged_date) continue
        out.push({
          key: `e${it.thread_id}`, kind: 'escalation', at: it.first_flagged_date, client: e.company_name,
          title: one(it.source_subject) || 'Escalation', detail: one(it.escalation_summary),
          dept, owner: e.pm_owner, href: '/critical-escalations', hrefLabel: 'Critical Escalations',
          facts: [
            ['Status', it.status || e.status], ['Client email', it.client_email || e.client_email || '—'],
            ['Latest', one(it.latest_summary) || '—'], ['Latest mood', it.latest_sentiment || '—'],
          ],
        })
      }
    }

    // ── Feedback ─────────────────────────────────────────────────────────────────
    for (const d of delights) {
      d.items.forEach((it, i) => {
        if (!it.date) return
        out.push({
          key: `f${clientKey(d.company_name)}${i}`, kind: 'feedback', at: it.date, client: d.company_name,
          title: one(it.project || it.subject) || 'Feedback', detail: one(it.quote), dept: deptOf(d.company_name),
          href: '/delights', hrefLabel: 'Feedback',
          facts: [['From', it.source === 'email' ? 'Email' : 'Feedback sheet'], ['Type', it.type || '—']],
        })
      })
    }

    // ── Other info ───────────────────────────────────────────────────────────────
    // Classified client email that is not already an escalation above.
    for (const s of signals) {
      if (!s.source_date || (s.thread_id && escThreads.has(s.thread_id))) continue
      out.push({
        key: `s${s.id}`, kind: 'email', at: s.source_date, client: s.company_name || '—',
        title: one(s.source_subject) || one(s.signal_type) || 'Email', detail: one(s.summary),
        dept: deptOf(s.company_name), href: '/clients', hrefLabel: 'Client 360',
        facts: [['Mood', s.sentiment || '—'], ['Kind', s.signal_type || '—'], ['From', s.client_email || '—']],
      })
    }
    // Each finding from a refresh run's own summary. Placed by the first client it names,
    // when it names one we know; otherwise it is company-wide and shows in every view.
    // Known names: clients with booked work, then companies on deals (their deal's
    // department), longest first so "kerrygroup" wins over "kerry".
    const names = new Map<string, { dept: string; name: string }>()
    for (const o of opps) {
      const k = clientKey(o.company_name), d = oppDepts.get(Number(o.id))
      if (k.length >= 4 && d && !names.has(k)) names.set(k, { dept: d, name: o.company_name || '' })
    }
    clientDepts.forEach((d, k) => { if (k.length >= 5) names.set(k, { dept: d, name: names.get(k)?.name || '' }) })
    const known = [...names.entries()].sort((a, b) => b[0].length - a[0].length)
    for (const r of runs) {
      if (!r.message) continue
      const { head, parts } = findings(r.message)
      const list = parts.length ? parts : [head]
      list.forEach((p, i) => {
        const k = clientKey(p)
        const hit = known.find(([ck]) => k.includes(ck))
        out.push({
          key: `r${r.ran_at}${i}`, kind: 'refresh', at: r.ran_at, client: hit ? (hit[1].name || 'Client') : 'Refresh run',
          title: p, detail: r.ok ? `From the ${time(r.ran_at)} refresh — ${head}` : `The ${time(r.ran_at)} refresh did not complete`,
          dept: hit?.[1].dept, href: '/', hrefLabel: 'Dashboard',
          facts: [['Run', stamp(r.ran_at)], ['Result', r.ok ? 'Completed' : 'Failed'], ['Run summary', head]],
        })
      })
    }

    setItems(out); setOpenEsc(stillOpen)
    setSyncs(Object.fromEntries(SOURCES.map((s, i) => [s.id, sync[i] as SyncStatus | null])))
    setLoadedAt(new Date()); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const since = useMemo(() => (loadedAt ? loadedAt.getTime() : Date.now()) - Number(win) * 3600_000, [loadedAt, win])
  // Bounded at now as well: recurring deals are filed under future months (a retainer's
  // November instalment exists in October), and those are not news.
  const until = loadedAt ? loadedAt.getTime() : Date.now()
  // A refresh note that names no client is company-wide: it shows in every department.
  const inDept = useMemo(() => items.filter(i => (i.kind === 'refresh' && !i.dept) || inUnit(i.dept, unit)), [items, unit])
  const recent = useMemo(() => inDept.filter(i => { const t = Date.parse(i.at); return t >= since && t <= until })
    .sort((a, b) => ORDER.indexOf(GROUP_OF[a.kind]) - ORDER.indexOf(GROUP_OF[b.kind]) || SUB[a.kind] - SUB[b.kind] || b.at.localeCompare(a.at)),
    [inDept, since, until])
  const byGroup = (g: Group) => recent.filter(i => GROUP_OF[i.kind] === g)
  const deals = byGroup('deals'), esc = byGroup('esc'), fb = byGroup('fb'), info = byGroup('info')
  const shown = tab === 'all' ? recent : byGroup(tab)
  const openInDept = openEsc.filter(e => inUnit(e.dept, unit))
  const count = (xs: Item[], k: Kind) => xs.filter(i => i.kind === k).length
  const quoted = deals.filter(i => i.kind === 'new').reduce((s, i) => s + (i.value || 0), 0)
  const winLabel = win === '24' ? 'last 24 hours' : win === '72' ? 'last 3 days' : 'last 7 days'

  // Freshest successful pull across the feeds — what "as of" means on this page.
  const asOf = Object.values(syncs).filter((s): s is SyncStatus => !!s && s.ok).map(s => s.ran_at).sort().slice(-1)[0]
  const anyFailed = Object.values(syncs).some(s => s && !s.ok)

  const details = (rows: Item[], subtitle: string): CardDetails<Item> | undefined => rows.length ? {
    subtitle, rows, rowKey: r => r.key, groupBy: r => KIND[r.kind].label, onRowClick: setSel,
    columns: [
      { key: 'at', label: 'When', value: r => stamp(r.at), sort: r => r.at },
      { key: 'c', label: 'Client', value: r => r.client, wide: true },
      { key: 't', label: 'What', value: r => r.title, wide: true },
      { key: 'v', label: 'Value', value: r => usd(r.value) || '—', align: 'right', sort: r => r.value || 0 },
    ],
  } : undefined

  return (
    <div>
      <Header title="Daily Pulse"
        subtitle="Everything new from the mailbox, quotes, sheets and the last refresh in one list, for the department picked in the sidebar — read it instead of the inbox."
        actions={
          <button onClick={() => load(true)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm hover:brightness-95 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>} />

      {/* When this was pulled — the first thing on the page, so nobody acts on stale news. */}
      <div className="mb-5 rounded-xl border border-mav-line bg-mav-panel px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mav-muted">Data last pulled</div>
          <div className="text-lg font-semibold tabular-nums">{loading && !asOf ? '…' : stamp(asOf)}
            {asOf && <span className="ml-2 text-xs font-normal text-mav-muted">{ago(asOf)}</span>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map(s => {
            const st = syncs[s.id]
            const tone = !st ? 'border-mav-line text-mav-muted' : st.ok ? 'border-green-500/30 text-green-400' : 'border-red-500/40 text-red-400'
            return (
              <span key={s.id} title={st?.message || ''} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tone}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${!st ? 'bg-mav-muted' : st.ok ? 'bg-green-400' : 'bg-red-400'}`} />
                {s.label} {st ? `${fmtDay(st.ran_at).slice(0, 6)} ${time(st.ran_at)}` : '—'}{st && !st.ok ? ' · failed' : ''}
              </span>
            )
          })}
        </div>
        <div className="ml-auto text-xs text-mav-muted">Page refreshed {loadedAt ? time(loadedAt.toISOString()) : '…'}</div>
        {anyFailed && <p className="w-full text-xs text-red-400">A feed&apos;s last run failed — what it carries may be behind. Hover its chip for the reason.</p>}
      </div>

      <Segments<Win> value={win} onChange={setWin} items={[
        { id: '24', label: 'Last 24 hours' }, { id: '72', label: 'Last 3 days' }, { id: '168', label: 'Last 7 days' },
      ]} />

      <KPIRow cols={5}>
        <KPICard tone="yellow" label="Deals" value={loading ? '…' : String(deals.length)}
          sub={`${count(deals, 'new')} new · ${usd(quoted) || '$0'} · ${count(deals, 'won')} won · ${count(deals, 'lost')} lost`}
          info="New opportunities from email or the Quotes tab, deals confirmed won, edited or reassigned on the dashboard, and deals marked lost."
          details={details(deals, `Deals in the ${winLabel}`)} />
        <KPICard tone={esc.length ? 'red' : 'default'} label="Escalations" value={loading ? '…' : String(esc.length)}
          sub={`new · ${openInDept.length} client${openInDept.length === 1 ? '' : 's'} still open`}
          info="New client escalations flagged from email, and how many clients still have one not marked fixed."
          details={details(esc, `Flagged in the ${winLabel}`)} />
        <KPICard tone={fb.length ? 'green' : 'default'} label="Feedback" value={loading ? '…' : String(fb.length)}
          sub="from the sheet and email" info="Client feedback added in this window."
          details={details(fb, `Feedback in the ${winLabel}`)} />
        <KPICard tone="blue" label="Other info" value={loading ? '…' : String(info.length)}
          sub={`${count(info, 'refresh')} refresh notes · ${count(info, 'email')} client emails`}
          info="Everything else worth knowing: each finding the refresh routine reported (what it moved, what it could not make stick, figures it converted) and client email that is neither a deal nor an escalation."
          details={details(info, `Other information in the ${winLabel}`)} />
        <Link href="/actions" className="block">
          <KPICard tone={actionCount ? 'amber' : 'default'} label="Your actions" value={actionCount == null ? '…' : String(actionCount)}
            sub="open on the Actions page →" info="Projects due and quotes waiting on a decision, for you in this department. Opens Actions." />
        </Link>
      </KPIRow>

      <Segments<Tab> value={tab} onChange={setTab} items={[
        { id: 'deals', label: 'Deals', count: deals.length },
        { id: 'esc', label: 'Escalations', count: esc.length },
        { id: 'fb', label: 'Feedback', count: fb.length },
        { id: 'info', label: 'Other info', count: info.length },
        { id: 'all', label: 'Everything', count: recent.length },
      ]} />

      <Panel flush title={<>{tab === 'all' ? 'Everything' : GROUPS.find(g => g.id === tab)?.label} · {winLabel}</>}
        info="Click a row for the full detail. Order: Deals (won, new, updated, lost), Escalations, Feedback, Other info.">
        <div className="max-md:overflow-x-auto">
          <table className="w-full table-fixed text-sm max-md:min-w-[720px]">
            <colgroup>
              <col className="w-[124px]" /><col className="w-[112px]" /><col /><col className="w-[110px]" /><col className="w-[140px]" /><col className="w-[96px]" />
            </colgroup>
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2.5">When</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Client · what</th>
                <th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Owner</th>
                <th className="px-3 py-2.5 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-mav-muted">Reading the latest…</td></tr>}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-mav-muted">
                  Nothing here in the {winLabel}{unit !== 'all' ? ` for ${unitLabel(unit)}` : ''}. {win !== '168' && 'Try a longer window above.'}
                </td></tr>
              )}
              {!loading && shown.map(i => (
                <tr key={i.key} onClick={() => setSel(i)} className="border-b border-mav-line/60 hover:bg-mav-fg/[0.04] cursor-pointer align-top">
                  <td className="px-3 py-2">
                    <DateCell d={i.at} />
                    {hasTime(i.at) && <div className="text-[11px] text-mav-muted">{time(i.at)}</div>}
                  </td>
                  <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span></td>
                  <td className="px-3 py-2 min-w-0">
                    <div className="truncate"><span className="font-semibold">{i.client}</span> <span className="text-mav-muted">·</span> {i.title}</div>
                    {i.detail && <div className="truncate text-xs text-mav-muted">{i.detail}</div>}
                  </td>
                  <td className="px-3 py-2 truncate text-mav-muted">{i.dept || (i.kind === 'refresh' ? 'All' : '—')}</td>
                  <td className="px-3 py-2 truncate">{i.owner || <span className="text-mav-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(i.value) || <span className="text-mav-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {sel && <ItemPanel item={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

// The whole item, read in place. A link to its own page is there for acting on it, but
// reading never takes you off the pulse.
function ItemPanel({ item, onClose }: { item: Item; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const facts: [string, string][] = [
    ['When', stamp(item.at)], ['Department', item.dept || (item.kind === 'refresh' ? 'All departments' : '—')],
    ['Owner', item.owner || '—'], ...(item.value ? [['Value', usd(item.value)] as [string, string]] : []), ...(item.facts || []),
  ]
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[520px] bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-mav-panel border-b border-mav-line px-5 py-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${KIND[item.kind].cls}`}>{KIND[item.kind].label}</span>
            <h2 className="mt-2 text-lg font-bold leading-snug">{item.client}</h2>
            <p className="text-sm text-mav-muted mt-0.5">{item.title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-mav-muted hover:text-mav-fg hover:bg-mav-dark"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {item.detail && <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.detail}</p>}
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-mav-muted">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <Link href={item.href} className="inline-flex items-center gap-1.5 rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 px-3 py-1.5 text-xs">
            Act on it in {item.hrefLabel} <ArrowUpRight size={13} />
          </Link>
        </div>
      </aside>
    </div>
  )
}
