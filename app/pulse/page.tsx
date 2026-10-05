'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ArrowUpRight } from 'lucide-react'
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
  getClientDepts, clientKey, getLastSyncStatus, clearReadCache, type SyncStatus,
} from '@/lib/supabase'

// Daily Pulse
// -----------
// What came out of the mailbox and the sheets since you last looked, for the department
// picked in the rail — one screen, read top to bottom in a minute, without opening an
// email. Every row says what it is, whose it is, and where to act on it.
//
// Nothing here is stored or summarised by hand: it is the same opportunities, escalations,
// feedback and email signals the other pages show, cut to a time window and put in one
// list in the order somebody should deal with them.

type Kind = 'escalation' | 'won' | 'opportunity' | 'lost' | 'feedback' | 'signal'
type Tab = 'all' | 'opps' | 'esc' | 'fb' | 'other'
type Win = '24' | '72' | '168'

interface Item {
  key: string; kind: Kind; at: string; client: string; title: string; detail?: string
  dept?: string; owner?: string; value?: number; href: string
}

// Order of the list: what can hurt first, then money, then the rest.
const RANK: Record<Kind, number> = { escalation: 0, won: 1, opportunity: 2, lost: 3, feedback: 4, signal: 5 }
const KIND: Record<Kind, { label: string; cls: string }> = {
  escalation: { label: 'Escalation', cls: 'bg-red-500/15 text-red-400' },
  won: { label: 'Won', cls: 'bg-green-500/15 text-green-400' },
  opportunity: { label: 'New deal', cls: 'bg-mav-yellow/15 text-mav-yellow' },
  lost: { label: 'Lost', cls: 'bg-mav-fg/10 text-mav-muted' },
  feedback: { label: 'Feedback', cls: 'bg-sky-500/15 text-sky-400' },
  signal: { label: 'Email', cls: 'bg-violet-500/15 text-violet-300' },
}
const TAB_KINDS: Record<Tab, Kind[]> = {
  all: ['escalation', 'won', 'opportunity', 'lost', 'feedback', 'signal'],
  opps: ['won', 'opportunity', 'lost'], esc: ['escalation'], fb: ['feedback'], other: ['signal'],
}

// The feeds whose last run decides how fresh this page is.
const SOURCES: { id: string; label: string }[] = [
  { id: 'gmail-ingest', label: 'Email' },
  { id: 'email-opportunities-scan', label: 'Deal scan' },
  { id: 'quote-sync', label: 'Quotes' },
  { id: 'sheet-sync', label: 'Sheets' },
]

const usd = (n?: number) => (n ? `$${Math.round(n).toLocaleString()}` : '')
const time = (d?: string | null) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
const stamp = (d?: string | null) => d ? (hasTime(d) ? `${fmtDay(d)}, ${time(d)}` : fmtDay(d)) : '—'
const ago = (d?: string | null) => {
  const t = Date.parse(d || ''); if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
// A date with no time of day (escalations, feedback) would print as 05:30 — UTC midnight
// in IST — which reads like a real time. Only show one when the source has it.
const hasTime = (d?: string) => /T\d{2}:\d{2}/.test(d || '') && !/T00:00(:00(\.0+)?)?(Z|\+00(:00)?)?$/.test(d || '')
const one = (s?: string) => (s || '').replace(/\s+/g, ' ').trim()

export default function PulsePage() {
  const { unit } = useUnit()
  const actionCount = useActionCount(true)
  // Monday morning wants the weekend too.
  const [win, setWin] = useState<Win>(() => (typeof window !== 'undefined' && new Date().getDay() === 1 ? '72' : '24'))
  const [tab, setTab] = useState<Tab>('all')
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [openEsc, setOpenEsc] = useState<{ client: string; dept?: string }[]>([])
  const [syncs, setSyncs] = useState<Record<string, SyncStatus | null>>({})

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    if (fresh) clearReadCache()
    const [opps, oppDepts, escs, delights, signals, clientDepts, ...sync] = await Promise.all([
      getOpportunities(), getOpportunityDepts(), getCriticalEscalations(), getDelights(), getEmailSignals(), getClientDepts(),
      ...SOURCES.map(s => getLastSyncStatus(s.id)),
    ])
    const deptOf = (company?: string) => clientDepts.get(clientKey(company))
    const out: Item[] = []

    for (const o of opps) {
      if (o.rolled_into != null) continue
      const base = {
        client: o.company_name || '—', title: one(o.source_subject) || 'Untitled deal',
        dept: oppDepts.get(Number(o.id)), owner: o.pm_owner || o.sales_person || '',
        value: o.won_amount || o.est_value || 0, href: `/opportunities?deal=${o.id}`,
      }
      const seen = o.first_date || o.source_date || o.created_at
      if (seen) out.push({ ...base, key: `o${o.id}`, kind: 'opportunity', at: seen, detail: one(o.gist || o.summary) })
      if (o.won && o.confirmed_at) out.push({ ...base, key: `w${o.id}`, kind: 'won', at: o.confirmed_at, detail: o.confirmed_by ? `Confirmed by ${o.confirmed_by}` : undefined })
      const lostAt = (o as any).email_lost_at || (o.unlikely ? (o as any).unlikely_at : null)
      if (!o.won && lostAt) out.push({ ...base, key: `l${o.id}`, kind: 'lost', at: lostAt, detail: one((o as any).email_lost_reason || (o as any).unlikely_reason) })
    }

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
          dept, owner: e.pm_owner, href: '/critical-escalations',
        })
      }
    }

    for (const d of delights) {
      d.items.forEach((it, i) => {
        if (!it.date) return
        out.push({
          key: `f${clientKey(d.company_name)}${i}`, kind: 'feedback', at: it.date, client: d.company_name,
          title: one(it.project || it.subject) || 'Feedback', detail: one(it.quote), dept: deptOf(d.company_name), href: '/delights',
        })
      })
    }

    // Email the classifier read that is not already an escalation above.
    for (const s of signals) {
      if (!s.source_date || (s.thread_id && escThreads.has(s.thread_id))) continue
      out.push({
        key: `s${s.id}`, kind: 'signal', at: s.source_date, client: s.company_name || '—',
        title: one(s.source_subject) || one(s.signal_type) || 'Email', detail: [s.sentiment, one(s.summary)].filter(Boolean).join(' · '),
        dept: deptOf(s.company_name), href: '/clients',
      })
    }

    setItems(out); setOpenEsc(stillOpen)
    setSyncs(Object.fromEntries(SOURCES.map((s, i) => [s.id, sync[i] as SyncStatus | null])))
    setLoadedAt(new Date()); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const since = useMemo(() => (loadedAt ? loadedAt.getTime() : Date.now()) - Number(win) * 3600_000, [loadedAt, win])
  const inDept = useMemo(() => items.filter(i => inUnit(i.dept, unit)), [items, unit])
  // Bounded at now as well: recurring deals are filed under future months (a retainer's
  // November instalment exists in October), and those are not news.
  const until = loadedAt ? loadedAt.getTime() : Date.now()
  const recent = useMemo(() => inDept.filter(i => { const t = Date.parse(i.at); return t >= since && t <= until })
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.at.localeCompare(a.at)), [inDept, since, until])
  const of = (...k: Kind[]) => recent.filter(i => k.includes(i.kind))
  const shown = recent.filter(i => TAB_KINDS[tab].includes(i.kind))
  const openInDept = openEsc.filter(e => inUnit(e.dept, unit))

  const newDeals = of('opportunity'), won = of('won'), lost = of('lost'), esc = of('escalation'), fb = of('feedback'), sig = of('signal')
  const sum = (xs: Item[]) => xs.reduce((s, i) => s + (i.value || 0), 0)
  const winLabel = win === '24' ? 'last 24 hours' : win === '72' ? 'last 3 days' : 'last 7 days'

  // Freshest successful pull across the feeds — what "as of" means on this page.
  const okTimes = Object.values(syncs).filter((s): s is SyncStatus => !!s && s.ok).map(s => s.ran_at)
  const asOf = okTimes.sort().slice(-1)[0]
  const anyFailed = Object.values(syncs).some(s => s && !s.ok)

  const details = (rows: Item[], subtitle: string): CardDetails<Item> | undefined => rows.length ? {
    subtitle, rows, rowKey: r => r.key, groupBy: r => KIND[r.kind].label,
    columns: [
      { key: 'at', label: 'When', value: r => stamp(r.at), sort: r => r.at },
      { key: 'c', label: 'Client', value: r => r.client, wide: true },
      { key: 't', label: 'What', value: r => r.title, wide: true },
      { key: 'o', label: 'Owner', value: r => r.owner || '—' },
      { key: 'v', label: 'Value', value: r => usd(r.value) || '—', align: 'right', sort: r => r.value || 0 },
    ],
  } : undefined

  return (
    <div>
      <Header title="Daily Pulse"
        subtitle="Everything new from the mailbox, quotes and sheets in one list, for the department picked in the sidebar — read it instead of the inbox."
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
                {s.label} {st ? time(st.ran_at) : '—'}{st && !st.ok ? ' · failed' : ''}
              </span>
            )
          })}
        </div>
        <div className="ml-auto text-xs text-mav-muted">Page refreshed {loadedAt ? time(loadedAt.toISOString()) : '…'}</div>
        {anyFailed && <p className="w-full text-xs text-red-400">A feed's last run failed — what it carries may be behind. Hover its chip for the reason.</p>}
      </div>

      <Segments<Win> value={win} onChange={setWin} items={[
        { id: '24', label: 'Last 24 hours' }, { id: '72', label: 'Last 3 days' }, { id: '168', label: 'Last 7 days' },
      ]} />

      <KPIRow cols={4}>
        <KPICard tone={esc.length ? 'red' : 'default'} label="Escalations" value={loading ? '…' : String(esc.length)}
          sub={`new · ${openInDept.length} client${openInDept.length === 1 ? '' : 's'} still open`}
          info="New client escalations flagged from email in this window, and how many clients still have one not marked fixed."
          details={details(esc, `Flagged in the ${winLabel}`)} />
        <KPICard tone="yellow" label="New deals" value={loading ? '…' : String(newDeals.length)}
          sub={`${usd(sum(newDeals)) || '$0'} quoted · ${won.length} won · ${lost.length} lost`}
          info="Opportunities first seen in email or the Quotes tab in this window, plus deals confirmed won or marked lost in it."
          details={details([...won, ...newDeals, ...lost], `Deals in the ${winLabel}`)} />
        <KPICard tone={fb.length ? 'green' : 'default'} label="Feedback" value={loading ? '…' : String(fb.length)}
          sub={`${sig.length} other client email${sig.length === 1 ? '' : 's'}`}
          info="Client feedback (sheet and email) and other classified client email in this window."
          details={details([...fb, ...sig], `Feedback and client email in the ${winLabel}`)} />
        <Link href="/actions" className="block">
          <KPICard tone={actionCount ? 'amber' : 'default'} label="Your actions" value={actionCount == null ? '…' : String(actionCount)}
            sub="open on the Actions page →" info="Projects due and quotes waiting on a decision, for you in this department. Opens Actions." />
        </Link>
      </KPIRow>

      <Segments<Tab> value={tab} onChange={setTab} items={[
        { id: 'all', label: 'Everything', count: recent.length },
        { id: 'esc', label: 'Escalations', count: esc.length },
        { id: 'opps', label: 'Deals', count: newDeals.length + won.length + lost.length },
        { id: 'fb', label: 'Feedback', count: fb.length },
        { id: 'other', label: 'Other email', count: sig.length },
      ]} />

      <Panel flush title={<>What happened · {winLabel}</>}
        info="Worst first: escalations, then deals won, new deals by value, deals lost, feedback, and other client email. Each row opens the page where it is handled.">
        <div className="max-md:overflow-x-auto">
          <table className="w-full table-fixed text-sm max-md:min-w-[760px]">
            <colgroup>
              <col className="w-[124px]" /><col className="w-[104px]" /><col /><col className="w-[110px]" /><col className="w-[140px]" /><col className="w-[96px]" /><col className="w-[48px]" />
            </colgroup>
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2.5">When</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Client · what</th>
                <th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Owner</th>
                <th className="px-3 py-2.5 text-right">Value</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-mav-muted">Reading the latest…</td></tr>}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-mav-muted">
                  Nothing new in the {winLabel}{unit !== 'all' ? ` for ${unitLabel(unit)}` : ''}. {win !== '168' && 'Try a longer window above.'}
                </td></tr>
              )}
              {!loading && shown.map(i => (
                <tr key={i.key} className="border-b border-mav-line/60 hover:bg-mav-fg/[0.03] align-top">
                  <td className="px-3 py-2">
                    <DateCell d={i.at} />
                    {hasTime(i.at) && <div className="text-[11px] text-mav-muted">{time(i.at)}</div>}
                  </td>
                  <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span></td>
                  <td className="px-3 py-2 min-w-0" title={i.detail || ''}>
                    <div className="truncate"><span className="font-semibold">{i.client}</span> <span className="text-mav-muted">·</span> {i.title}</div>
                    {i.detail && <div className="truncate text-xs text-mav-muted">{i.detail}</div>}
                  </td>
                  <td className="px-3 py-2 truncate text-mav-muted">{i.dept || '—'}</td>
                  <td className="px-3 py-2 truncate">{i.owner || <span className="text-mav-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(i.value) || <span className="text-mav-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={i.href} title="Open where this is handled" className="inline-flex items-center justify-center rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 h-7 w-7">
                      <ArrowUpRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
