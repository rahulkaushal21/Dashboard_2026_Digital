'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit } from '@/lib/business-unit'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { fmtDay, type CardDetails, type DetailCol } from '@/components/CardDetail'
import DateCell from '@/components/DateCell'
import { KPIRow, Segments, FilterBar, Panel, SectionTitle } from '@/components/PageParts'
import MultiSelect from '@/components/MultiSelect'
import ColumnPicker, { useColumns, type ColumnDef } from '@/components/ColumnPicker'
import { askReason } from '@/lib/ask'
import { getStoredProfile, currentEmail } from '@/lib/access'
import {
  getProjectLedger, saveLedgerRow, canEditLedgerRow, getDirectoryMember, getOpportunities, getOpportunityDepts,
  setOpportunityUnlikely, setOpportunityLost, canConfirmLocally, ownerMatches, clearReadCache,
  type LedgerRow, type Opportunity, type DirectoryMember, type SheetRowEdits,
} from '@/lib/supabase'

// Actions — what needs somebody today, across projects and quotes.
//
// Web PM's Actions page, on this dashboard's data. Every other page answers "how are we
// doing"; this one answers "what do I do next", and each row carries the button that does
// it. The buckets are questions a PC/SME asks every morning — what ships today, what is due
// this week, what is past its date and still open, which quotes have gone quiet, which
// clients already said yes — and the write paths are the same ones the Project sheet and
// Opportunities use, so an action here is the same act as the one there.

// Lines started before April 2026 are the old sheet's backlog; a missing Project ID there
// is history, not a task. The overdue and quiet lists are NOT cut at this date: anything
// still open is still somebody's to close, however old it is.
const FROM = '2026-04-01'
const QUIET_DAYS = 14

type Bucket = 'today' | 'week' | 'past' | 'noid' | 'quiet' | 'yes'
const PROJECT_BUCKETS: Bucket[] = ['today', 'week', 'past', 'noid']

const money = (n?: number | null) => n == null ? '—' : `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Whole calendar days from a to b, both YYYY-MM-DD. Parsed as UTC so a clock change
// never turns one day into 0.96 of one.
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
const day = (d?: string | null) => { const v = (d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '' }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// A project is open until it is Delivered or Cancelled. On Hold stays in: a held job with
// a date in the past is exactly the one nobody is looking at.
const isOpenProject = (r: LedgerRow) => !/^(delivered|cancel)/i.test((r.delivery_status || '').trim())

// Same verdict the Opportunities page reaches, kept to the open case: anything won,
// booked, lost or on hold is not a quote waiting on anybody.
const isOpenDeal = (x: Opportunity) => {
  if (x.won || x.email_won || x.booked_month || x.email_lost || x.rolled_into) return false
  const s = (x.status || '').toLowerCase()
  return !(s.includes('cancel') || s === 'lost' || s.includes('hold') || s.includes('won') || s.includes('confirm'))
}
const dealDate = (x: Opportunity) => day(x.source_date || x.first_date)
// days_since_touch comes from email where it exists, which is the better answer; the
// quote's own date is the fallback.
const quietDays = (x: Opportunity, today: string): number | null => {
  if (x.days_since_touch != null && Number.isFinite(Number(x.days_since_touch))) return Number(x.days_since_touch)
  const d = dealDate(x)
  return d ? Math.max(0, dayDiff(d, today)) : null
}

// One cell can name several people ("Malav Modi / Kalgi Shah") — the same separators
// lib/supabase's ownerMatches splits on, so the dropdown lists people, not cells.
const people = (cell?: string) => (cell || '').split(/[,/&]|\band\b/i).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)

const TONE = {
  amber: 'text-amber-300',
  sky: 'text-sky-300',
  red: 'text-red-400',
  green: 'text-green-400',
} as const

const BUCKET_META: Record<Bucket, { label: string; info: string }> = {
  today: { label: 'Delivering today', info: 'Open projects whose delivery date is today.' },
  week: { label: 'Due this week', info: 'Open projects due in the next 1 to 7 days.' },
  past: { label: 'Past undelivered', info: 'Delivery date has passed and the project is still not Delivered or Cancelled (On Hold included). Not limited to April 2026 — anything still open is still somebody’s to close.' },
  noid: { label: 'Project ID to add', info: 'Lines started on or after 01-Apr-2026, not Cancelled, with no Project ID yet.' },
  quiet: { label: 'Quiet quotes', info: `Open quotes with no touch for ${QUIET_DAYS}+ days (from email where there is any, else the quote date). Quotes already marked “might not come” are left out.` },
  yes: { label: 'Client said yes', info: 'Still Open in the Quotes sheet, but the client has committed in writing. Confirm them on Opportunities so they count as won.' },
}

const statusTint = (s?: string) => {
  const v = (s || '').toLowerCase()
  if (v.startsWith('deliver')) return 'bg-green-500/10 text-green-400'
  if (v.includes('hold')) return 'bg-yellow-500/10 text-yellow-300'
  if (v.includes('cancel')) return 'bg-red-500/10 text-red-400'
  if (v.includes('await') || v.includes('review')) return 'bg-sky-500/10 text-sky-300'
  return 'bg-amber-500/10 text-amber-300'
}

const PCOLS: ColumnDef[] = [
  { key: 'when', label: 'When', locked: true },
  { key: 'project', label: 'Project', locked: true },
  { key: 'agency', label: 'Agency', default: true },
  { key: 'pm', label: 'PC/SME', default: true },
  { key: 'date', label: 'Delivery / start date', default: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'amount', label: 'Amount' },
  { key: 'geo', label: 'GEO' },
  { key: 'dept', label: 'Department' },
  { key: 'pid', label: 'Project ID' },
  { key: 'month', label: 'Booking month' },
]
const QCOLS: ColumnDef[] = [
  { key: 'when', label: 'When', locked: true },
  { key: 'quote', label: 'Quote', locked: true },
  { key: 'agency', label: 'Agency', default: true },
  { key: 'pm', label: 'PC/SME', default: true },
  { key: 'date', label: 'Quote date', default: true },
  { key: 'value', label: 'Value', default: true },
  { key: 'geo', label: 'GEO' },
  { key: 'am', label: 'AM' },
  { key: 'dept', label: 'Department' },
  { key: 'signal', label: 'Signal' },
]

export default function ActionsPage() {
  const { unit } = useUnit()
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [deals, setDeals] = useState<Opportunity[]>([])
  const [deptById, setDeptById] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [person, setPerson] = useState('')           // '' = Everyone
  const personTouched = useRef(false)
  const [bucket, setBucket] = useState<Bucket>('today')
  const [bucketTouched, setBucketTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [fGeo, setFGeo] = useState<string[]>([])
  const [fDept, setFDept] = useState<string[]>([])
  const [fStatus, setFStatus] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  // Per-row inline work: which row is busy, what it is typing, and what went wrong.
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ key: string; kind: 'date' | 'pid'; value: string } | null>(null)
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const today = localToday()

  const load = useCallback(async (fresh = false) => {
    if (fresh) clearReadCache()
    setLoading(true); setLoadError('')
    try {
      const [l, o, d] = await Promise.all([getProjectLedger(), getOpportunities(), getOpportunityDepts().catch(() => new Map<number, string>())])
      setLedger(l); setDeals(o); setDeptById(d)
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the data.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const admin = !!getStoredProfile()?.is_admin
    setIsAdmin(admin)
    getDirectoryMember(currentEmail()).then(m => {
      setMe(m)
      // A PM opens this page for their own list; an admin for everybody's. Only if nobody
      // has picked yet, so a deliberate choice is never overwritten.
      if (m?.name && !admin) setPerson(p => (p === '' && !personTouched.current ? m.name : p))
    })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dealDept = useCallback((x: Opportunity) => deptById.get(Number(x.id)) || '', [deptById])

  // Does a cell name the chosen person? For the signed-in PM, their directory aliases
  // count too — the sheet spells people several ways.
  const isPerson = useCallback((cell?: string) => {
    if (!person) return true
    const names = [person.toLowerCase()]
    if (me && me.name === person) names.push(...me.aliases)
    return ownerMatches(cell, names)
  }, [person, me])

  const personOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of ledger) if (inUnit(r.service_dept, unit)) people(r.pm_owner).forEach(p => s.add(p))
    for (const x of deals) if (inUnit(dealDept(x), unit)) people(x.pm_owner).forEach(p => s.add(p))
    if (person) s.add(person)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [ledger, deals, unit, dealDept, person])

  // ── The buckets: department + person only. Cards and segment counts use these, so the
  // headline never moves with the search box.
  const scopedLedger = useMemo(() => ledger.filter(r => inUnit(r.service_dept, unit) && isPerson(r.pm_owner)), [ledger, unit, isPerson])
  const scopedDeals = useMemo(() => deals.filter(x => inUnit(dealDept(x), unit) && isPerson(x.pm_owner)), [deals, unit, dealDept, isPerson])

  const pb = useMemo(() => {
    const out: Record<'today' | 'week' | 'past' | 'noid', LedgerRow[]> = { today: [], week: [], past: [], noid: [] }
    for (const r of scopedLedger) {
      const dd = day(r.delivery_date)
      if (isOpenProject(r) && dd) {
        const n = dayDiff(today, dd)
        if (n === 0) out.today.push(r)
        else if (n >= 1 && n <= 7) out.week.push(r)
        else if (n < 0) out.past.push(r)
      }
      if (!(r.project_id || '').trim() && !/^cancel/i.test(r.delivery_status || '') && day(r.start_date) >= FROM) out.noid.push(r)
    }
    out.week.sort((a, b) => day(a.delivery_date).localeCompare(day(b.delivery_date)))
    out.past.sort((a, b) => day(a.delivery_date).localeCompare(day(b.delivery_date)))   // longest overdue first
    out.noid.sort((a, b) => day(a.start_date).localeCompare(day(b.start_date)))
    return out
  }, [scopedLedger, today])

  const qb = useMemo(() => {
    const quiet: Opportunity[] = [], yes: Opportunity[] = []
    for (const x of scopedDeals) {
      if (!isOpenDeal(x)) continue
      if (x.flag_committed_in_email) yes.push(x)
      const q = quietDays(x, today)
      if (!x.unlikely && q != null && q >= QUIET_DAYS) quiet.push(x)
    }
    quiet.sort((a, b) => (quietDays(b, today) ?? 0) - (quietDays(a, today) ?? 0))
    yes.sort((a, b) => dealDate(b).localeCompare(dealDate(a)))
    return { quiet, yes }
  }, [scopedDeals, today])

  const counts: Record<Bucket, number> = {
    today: pb.today.length, week: pb.week.length, past: pb.past.length, noid: pb.noid.length,
    quiet: qb.quiet.length, yes: qb.yes.length,
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0)

  // Open on the first bucket that has something in it, unless someone has chosen.
  useEffect(() => {
    if (bucketTouched || loading) return
    const first = (Object.keys(counts) as Bucket[]).find(b => counts[b] > 0)
    if (first) setBucket(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, bucketTouched, total])

  // ── The WHEN cell: what makes each row worth acting on, in words and a colour.
  const projectWhen = (r: LedgerRow, b: Bucket): { text: string; tone: keyof typeof TONE } => {
    if (b === 'noid') {
      const n = Math.max(0, dayDiff(day(r.start_date), today))
      return { text: n === 0 ? 'Started today' : `Started ${plural(n, 'day')} ago`, tone: 'amber' }
    }
    const n = dayDiff(today, day(r.delivery_date))
    if (n === 0) return { text: 'Delivering today', tone: 'amber' }
    if (n > 0) return { text: `Due in ${plural(n, 'day')}`, tone: 'sky' }
    return { text: `${plural(-n, 'day')} past delivery`, tone: 'red' }
  }
  const dealWhen = (x: Opportunity, b: Bucket): { text: string; tone: keyof typeof TONE } => {
    if (b === 'yes') return { text: 'Client said yes', tone: 'green' }
    const q = quietDays(x, today) ?? 0
    return { text: `Quiet for ${plural(q, 'day')}`, tone: q >= 30 ? 'red' : 'amber' }
  }

  // ── Card side panels: exactly the rows each card counts.
  const projectDetails = (b: 'today' | 'week' | 'past' | 'noid'): CardDetails<LedgerRow> => {
    const cols: DetailCol<LedgerRow>[] = [
      { key: 'when', label: 'When', value: r => { const w = projectWhen(r, b); return <span className={TONE[w.tone]}>{w.text}</span> },
        sort: r => b === 'noid' ? day(r.start_date) : day(r.delivery_date) },
      { key: 'project', label: 'Project / agency', wide: true, value: r => r.project_name || r.company_name || '—', sort: r => r.project_name || r.company_name || '' },
      { key: 'agency', label: 'Agency', wide: true, value: r => r.company_name || '—', sort: r => r.company_name || '' },
      { key: 'amount', label: 'Amount', align: 'right', value: r => money(r.amount_usd), sort: r => r.amount_usd || 0,
        total: rs => money(rs.reduce((s, r) => s + (r.amount_usd || 0), 0)) },
      { key: 'pm', label: 'PC/SME', value: r => r.pm_owner || '—', sort: r => r.pm_owner || '' },
      { key: 'status', label: 'Status', value: r => r.delivery_status || '—', sort: r => r.delivery_status || '' },
    ]
    return {
      subtitle: BUCKET_META[b].info,
      rows: pb[b],
      groupBy: r => r.geo || 'No GEO',
      groupTotal: rs => money(rs.reduce((s, r) => s + (r.amount_usd || 0), 0)),
      rowKey: r => r.row_key,
      onRowClick: () => { setBucketTouched(true); setBucket(b) },
      defaultSort: 'amount',
      columns: cols,
    }
  }
  const dealDetails = (b: 'quiet' | 'yes'): CardDetails<Opportunity> => ({
    subtitle: BUCKET_META[b].info,
    rows: qb[b],
    groupBy: x => x.geo || 'No GEO',
    groupTotal: rs => money(rs.reduce((s, x) => s + (x.est_value || 0), 0)),
    rowKey: x => x.id,
    onRowClick: () => { setBucketTouched(true); setBucket(b) },
    defaultSort: b === 'quiet' ? 'when' : 'amount',
    columns: [
      { key: 'when', label: 'When', value: x => { const w = dealWhen(x, b); return <span className={TONE[w.tone]}>{w.text}</span> }, sort: x => quietDays(x, today) ?? 0 },
      { key: 'agency', label: 'Agency', wide: true, value: x => x.company_name || '—', sort: x => x.company_name || '' },
      { key: 'amount', label: 'Value', align: 'right', value: x => money(x.est_value), sort: x => x.est_value || 0,
        total: rs => money(rs.reduce((s, x) => s + (x.est_value || 0), 0)) },
      { key: 'date', label: 'Quote date', value: x => fmtDay(dealDate(x)), sort: x => dealDate(x) },
      { key: 'pm', label: 'PC/SME', value: x => x.pm_owner || '—', sort: x => x.pm_owner || '' },
    ],
  })

  // ── Table: the chosen bucket, narrowed by the filter box.
  const isProject = PROJECT_BUCKETS.includes(bucket)
  const q = search.trim().toLowerCase()
  const projRows = useMemo(() => !isProject ? [] : (pb[bucket as 'today'] || []).filter(r =>
    (!q || [r.project_name, r.company_name, r.pm_owner, r.project_id, r.client_name].some(v => (v || '').toLowerCase().includes(q)))
    && (!fGeo.length || fGeo.includes(r.geo || ''))
    && (!fDept.length || fDept.includes(r.service_dept || ''))
    && (!fStatus.length || fStatus.includes(r.delivery_status || ''))
  ), [isProject, pb, bucket, q, fGeo, fDept, fStatus])
  const dealRows = useMemo(() => isProject ? [] : qb[bucket as 'quiet'].filter(x =>
    (!q || [x.company_name, x.source_subject, x.summary, x.pm_owner, x.sales_person].some(v => (v || '').toLowerCase().includes(q)))
    && (!fGeo.length || fGeo.includes(x.geo || ''))
    && (!fDept.length || fDept.includes(dealDept(x)))
  ), [isProject, qb, bucket, q, fGeo, fDept, dealDept])

  const geoOpts = useMemo(() => Array.from(new Set([...scopedLedger.map(r => r.geo || ''), ...scopedDeals.map(x => x.geo || '')].filter(Boolean))).sort(), [scopedLedger, scopedDeals])
  const deptOpts = useMemo(() => Array.from(new Set([...scopedLedger.map(r => r.service_dept || ''), ...scopedDeals.map(dealDept)].filter(Boolean))).sort(), [scopedLedger, scopedDeals, dealDept])
  const statusOpts = useMemo(() => Array.from(new Set(scopedLedger.filter(isOpenProject).map(r => r.delivery_status || '').filter(Boolean))).sort(), [scopedLedger])
  const hiddenActive = (fDept.length ? 1 : 0) + (fStatus.length ? 1 : 0)
  useEffect(() => { if (hiddenActive > 0) setMoreOpen(true) }, [hiddenActive])
  const anyFilter = !!q || fGeo.length > 0 || hiddenActive > 0
  const clearAll = () => { setSearch(''); setFGeo([]); setFDept([]); setFStatus([]) }

  const pcols = useColumns('actions-projects', PCOLS)
  const qcols = useColumns('actions-quotes', QCOLS)

  // ── Writes. Optimistic: the row changes (and usually leaves its bucket) at once; a
  // refusal puts it back and says why, on the row itself.
  const setErr = (key: string, msg?: string) => setRowErr(prev => {
    const next = { ...prev }
    if (msg) next[key] = msg; else delete next[key]
    return next
  })
  const saveProject = async (r: LedgerRow, f: SheetRowEdits) => {
    setBusy(r.row_key); setErr(r.row_key)
    setLedger(prev => prev.map(x => x.row_key === r.row_key ? { ...x, ...f } as LedgerRow : x))
    const res = await saveLedgerRow(r, f)
    setBusy(null)
    if (!res.ok) {
      setLedger(prev => prev.map(x => x.row_key === r.row_key ? r : x))
      setErr(r.row_key, res.error || 'Could not save.')
      return false
    }
    setEditing(null)
    return true
  }
  const markUnlikely = async (x: Opportunity) => {
    const reason = askReason({ question: `Might "${x.company_name || 'this quote'}" not come?\n\nThe quote stays Open; it is discounted from the realistic view.\n\nWhy? (optional)` })
    if (reason === null) return
    const key = `q${x.id}`
    setBusy(key); setErr(key)
    setDeals(prev => prev.map(r => r.id === x.id ? { ...r, unlikely: true, unlikely_reason: reason || undefined } : r))
    const ok = await setOpportunityUnlikely(x.id, true, { actor: currentEmail() || undefined, reason: reason || undefined })
    setBusy(null)
    if (!ok) { setDeals(prev => prev.map(r => r.id === x.id ? x : r)); setErr(key, 'Could not save that flag.') }
  }
  const markLost = async (x: Opportunity) => {
    const reason = askReason({ question: `Mark "${x.company_name || 'this quote'}" as Lost?\n\nThis records the loss here immediately. The Quotes sheet is not edited — the deal stays flagged until its sheet row is set to Cancelled.\n\nWhy was it lost? (optional)` })
    if (reason === null) return
    const key = `q${x.id}`
    setBusy(key); setErr(key)
    setDeals(prev => prev.map(r => r.id === x.id ? { ...r, email_lost: true, email_lost_reason: reason || undefined, unlikely: false } : r))
    const ok = await setOpportunityLost(x.id, true, { actor: currentEmail() || undefined, reason: reason || undefined })
    setBusy(null)
    if (!ok) { setDeals(prev => prev.map(r => r.id === x.id ? x : r)); setErr(key, 'Could not mark it Lost.') }
  }

  // ── Styles (REVAMP-SPEC round 4)
  const primary = 'rounded-full bg-mav-fill text-black font-semibold px-3 py-1 text-xs hover:brightness-95 transition disabled:opacity-40'
  const secondary = 'rounded-full border border-mav-yellow/50 text-mav-yellow px-3 py-1 text-xs hover:bg-mav-yellow/10 transition-colors disabled:opacity-40'
  const destructive = 'rounded-full border border-red-500/50 text-red-400 px-3 py-1 text-xs hover:bg-red-500/10 transition-colors disabled:opacity-40'
  const toggleBtn = 'rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs transition-colors'
  const sel = 'bg-mav-panel border border-mav-line rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
  const th = 'px-3 py-2.5 font-medium whitespace-nowrap'
  const td = 'px-3 py-2.5 whitespace-nowrap'
  const inlineInput = 'bg-mav-dark border border-mav-yellow rounded px-1.5 py-0.5 text-xs text-mav-fg outline-none'

  const ownerNote = (owner?: string) => (
    <span className="text-xs text-mav-fg/30" title={`${owner || 'Nobody'} owns this row — only they or an admin can act on it`}>
      {owner ? owner.split(/[,/&]/)[0].trim() : 'Admin only'}
    </span>
  )

  const projectAction = (r: LedgerRow) => {
    if (!canEditLedgerRow(r, me, isAdmin)) return ownerNote(r.pm_owner)
    const b = busy === r.row_key
    const ed = editing?.key === r.row_key ? editing : null
    if (ed) {
      const commit = () => {
        const v = ed.value.trim()
        if (!v) { setErr(r.row_key, ed.kind === 'pid' ? 'Type the Project ID first.' : 'Pick a date first.'); return }
        saveProject(r, ed.kind === 'pid' ? { project_id: v } : { delivery_date: v })
      }
      return (
        <span className="inline-flex items-center gap-1.5">
          <input autoFocus type={ed.kind === 'date' ? 'date' : 'text'} value={ed.value} disabled={b}
            placeholder={ed.kind === 'pid' ? 'Project ID' : undefined}
            onChange={e => setEditing({ ...ed, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setErr(r.row_key) }
            }}
            className={`${inlineInput} ${ed.kind === 'pid' ? 'w-28' : 'w-36'}`} aria-label={ed.kind === 'pid' ? 'Project ID' : 'New delivery date'} />
          <button onClick={commit} disabled={b} className={primary}>{b ? 'Saving…' : 'Save'}</button>
          <button onClick={() => { setEditing(null); setErr(r.row_key) }} disabled={b} className={secondary}>Cancel</button>
        </span>
      )
    }
    if (bucket === 'noid') {
      return <button onClick={() => setEditing({ key: r.row_key, kind: 'pid', value: '' })} className={primary}>Add Project ID</button>
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <button onClick={() => setEditing({ key: r.row_key, kind: 'date', value: day(r.delivery_date) || today })} disabled={b} className={secondary}>Move date</button>
        <button onClick={() => saveProject(r, { delivery_status: 'Delivered' })} disabled={b} className={primary}>{b ? 'Saving…' : 'Mark delivered'}</button>
      </span>
    )
  }

  const dealAction = (x: Opportunity) => {
    const key = `q${x.id}`
    const b = busy === key
    const href = `/opportunities?deal=${encodeURIComponent(String(x.id))}`
    if (bucket === 'yes') {
      return canConfirmLocally(x, me, isAdmin)
        ? <Link href={href} className={`${primary} inline-block`}>Confirm</Link>
        : <span className="inline-flex items-center gap-2">{ownerNote(x.pm_owner)}<Link href={href} className={`${secondary} inline-block`}>Open</Link></span>
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <button onClick={() => markUnlikely(x)} disabled={b} className={secondary}>Might not come</button>
        <button onClick={() => markLost(x)} disabled={b} className={destructive}>Mark lost</button>
        <Link href={href} className={`${primary} inline-block`}>Open</Link>
      </span>
    )
  }

  const shownCount = isProject ? projRows.length : dealRows.length
  const cols = isProject ? pcols : qcols
  const colSpan = cols.columns.filter(c => cols.on(c.key)).length + 1

  return (
    <div>
      <Header title="Actions"
        subtitle="What needs somebody today: projects to deliver or re-date, Project IDs to add, and quotes that have gone quiet or that the client already said yes to. Every button writes through the same path as the Project sheet or Opportunities."
        chip="From 01-Apr-2026"
        actions={<>
          <select value={person} onChange={e => { personTouched.current = true; setPerson(e.target.value) }}
            className={`${sel} w-52`} aria-label="PC/SME" title="Whose actions to show">
            <option value="">PC/SME: Everyone</option>
            {personOptions.map(p => <option key={p} value={p}>PC/SME: {p}{me?.name === p ? ' (you)' : ''}</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading}
            className="rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 px-3 py-1.5 text-xs transition-colors disabled:opacity-40">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </>} />

      {loadError && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">{loadError}</div>}

      <SectionTitle info="Each card opens the rows behind its number. The tabs below switch the table to that list.">
        What needs you today — {loading ? '…' : `${total.toLocaleString()} thing${total === 1 ? '' : 's'} worth acting on`}
      </SectionTitle>
      <KPIRow cols={6}>
        <KPICard label="Delivering today" value={String(counts.today)} tone="amber" info={BUCKET_META.today.info}
          sub={money(pb.today.reduce((s, r) => s + (r.amount_usd || 0), 0))} details={projectDetails('today')} />
        <KPICard label="Due this week" value={String(counts.week)} tone="blue" info={BUCKET_META.week.info}
          sub={money(pb.week.reduce((s, r) => s + (r.amount_usd || 0), 0))} details={projectDetails('week')} />
        <KPICard label="Past undelivered" value={String(counts.past)} tone="red" info={BUCKET_META.past.info}
          sub={money(pb.past.reduce((s, r) => s + (r.amount_usd || 0), 0))} details={projectDetails('past')} />
        <KPICard label="Project ID to add" value={String(counts.noid)} tone="yellow" info={BUCKET_META.noid.info}
          sub="since 01-Apr-2026" details={projectDetails('noid')} />
        <KPICard label="Quiet quotes" value={String(counts.quiet)} tone="amber" info={BUCKET_META.quiet.info}
          sub={money(qb.quiet.reduce((s, x) => s + (x.est_value || 0), 0))} details={dealDetails('quiet')} />
        <KPICard label="Client said yes" value={String(counts.yes)} tone="green" info={BUCKET_META.yes.info}
          sub={money(qb.yes.reduce((s, x) => s + (x.est_value || 0), 0))} details={dealDetails('yes')} />
      </KPIRow>

      <Segments<Bucket> value={bucket} onChange={b => { setBucketTouched(true); setBucket(b); setEditing(null) }}
        items={(Object.keys(BUCKET_META) as Bucket[]).map(b => ({ id: b, label: BUCKET_META[b].label, count: counts[b], title: BUCKET_META[b].info }))} />

      <FilterBar right={<>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mav-muted">
          {loading ? 'Loading…' : `${shownCount.toLocaleString()} shown`}
        </span>
        {anyFilter && <button onClick={clearAll} className={secondary}>Clear all</button>}
      </>}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={isProject ? 'Project, agency or Project ID…' : 'Agency, subject or person…'} className={`${sel} w-64`} />
        <MultiSelect label="All GEOs" options={geoOpts} selected={fGeo} onChange={setFGeo} className="w-40" />
        <button onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen} className={toggleBtn}>
          More filters{hiddenActive > 0 ? ` · ${hiddenActive}` : ''}
        </button>
        {moreOpen && <>
          <div className="basis-full h-0" />
          <MultiSelect label="All depts" options={deptOpts} selected={fDept} onChange={setFDept} className="w-40" />
          {/* Delivery status is a project field; quotes have no such column. */}
          <MultiSelect label="All statuses" options={statusOpts} selected={fStatus} onChange={setFStatus} className="w-40" />
        </>}
      </FilterBar>

      <Panel flush title={<>{BUCKET_META[bucket].label} · {shownCount.toLocaleString()}</>} info={BUCKET_META[bucket].info}
        right={<ColumnPicker cols={cols} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-fg/70 border-b border-mav-line">
              {isProject ? (
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Project</th>
                  {pcols.on('agency') && <th className={th}>Agency</th>}
                  {pcols.on('pm') && <th className={th}>PC/SME</th>}
                  {pcols.on('date') && <th className={th}>{bucket === 'noid' ? 'Start date' : 'Delivery date'}</th>}
                  {pcols.on('status') && <th className={th}>Status</th>}
                  {pcols.on('amount') && <th className={`${th} text-right`}>Amount</th>}
                  {pcols.on('geo') && <th className={th}>GEO</th>}
                  {pcols.on('dept') && <th className={th}>Department</th>}
                  {pcols.on('pid') && <th className={th}>Project ID</th>}
                  {pcols.on('month') && <th className={th}>Booking month</th>}
                  <th className={`${th} sticky-action text-right`}>Action</th>
                </tr>
              ) : (
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Quote</th>
                  {qcols.on('agency') && <th className={th}>Agency</th>}
                  {qcols.on('pm') && <th className={th}>PC/SME</th>}
                  {qcols.on('date') && <th className={th}>Quote date</th>}
                  {qcols.on('value') && <th className={`${th} text-right`}>Value</th>}
                  {qcols.on('geo') && <th className={th}>GEO</th>}
                  {qcols.on('am') && <th className={th}>AM</th>}
                  {qcols.on('dept') && <th className={th}>Department</th>}
                  {qcols.on('signal') && <th className={th}>Signal</th>}
                  <th className={`${th} sticky-action text-right`}>Action</th>
                </tr>
              )}
            </thead>
            <tbody>
              {isProject && projRows.map(r => {
                const w = projectWhen(r, bucket)
                const err = rowErr[r.row_key]
                return (
                  <tr key={r.row_key} className="border-b border-mav-line/60">
                    <td className={`${td} font-semibold ${TONE[w.tone]}`}>{w.text}</td>
                    <td className={`${td} max-w-[16rem] truncate text-mav-fg`} title={r.project_name || ''}>{r.project_name || <span className="text-mav-muted">—</span>}</td>
                    {pcols.on('agency') && (
                      <td className={`${td} max-w-[12rem] truncate`} title={r.company_name || ''}>
                        {r.company_name
                          ? <Link href={`/clients?client=${encodeURIComponent(r.company_name)}`} className="text-mav-yellow hover:underline underline-offset-2">{r.company_name}</Link>
                          : <span className="text-mav-muted">—</span>}
                      </td>
                    )}
                    {pcols.on('pm') && <td className={`${td} max-w-[10rem] truncate text-mav-fg/80`} title={r.pm_owner || ''}>{r.pm_owner || '—'}</td>}
                    {pcols.on('date') && <td className={td}><DateCell d={bucket === 'noid' ? r.start_date : r.delivery_date} /></td>}
                    {pcols.on('status') && (
                      <td className={td}>
                        {r.delivery_status
                          ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusTint(r.delivery_status)}`}>{r.delivery_status}</span>
                          : <span className="text-mav-muted">—</span>}
                      </td>
                    )}
                    {pcols.on('amount') && <td className={`${td} text-right tabular-nums`}>{money(r.amount_usd)}</td>}
                    {pcols.on('geo') && <td className={td}>{r.geo || '—'}</td>}
                    {pcols.on('dept') && <td className={td}>{r.service_dept || '—'}</td>}
                    {pcols.on('pid') && <td className={td}>{r.project_id || '—'}</td>}
                    {pcols.on('month') && <td className={td}>{r.booking_month ? r.booking_month.slice(0, 7) : '—'}</td>}
                    <td className={`${td} sticky-action text-right`}>
                      {projectAction(r)}
                      {err && <div className="mt-1 text-[11px] text-red-400 whitespace-normal max-w-[18rem] ml-auto">{err}</div>}
                    </td>
                  </tr>
                )
              })}
              {!isProject && dealRows.map(x => {
                const w = dealWhen(x, bucket)
                const err = rowErr[`q${x.id}`]
                const subject = x.source_subject || x.summary || x.gist || ''
                return (
                  <tr key={x.id} className="border-b border-mav-line/60">
                    <td className={`${td} font-semibold ${TONE[w.tone]}`}>{w.text}</td>
                    <td className={`${td} max-w-[18rem] truncate text-mav-fg`} title={subject}>{subject || <span className="text-mav-muted">—</span>}</td>
                    {qcols.on('agency') && (
                      <td className={`${td} max-w-[12rem] truncate`} title={x.company_name || ''}>
                        {x.company_name
                          ? <Link href={`/clients?client=${encodeURIComponent(x.company_name)}`} className="text-mav-yellow hover:underline underline-offset-2">{x.company_name}</Link>
                          : <span className="text-mav-muted">—</span>}
                      </td>
                    )}
                    {qcols.on('pm') && <td className={`${td} max-w-[10rem] truncate text-mav-fg/80`} title={x.pm_owner || ''}>{x.pm_owner || '—'}</td>}
                    {qcols.on('date') && <td className={td}><DateCell d={dealDate(x)} /></td>}
                    {qcols.on('value') && <td className={`${td} text-right tabular-nums`}>{money(x.est_value)}</td>}
                    {qcols.on('geo') && <td className={td}>{x.geo || '—'}</td>}
                    {qcols.on('am') && <td className={td}>{x.sales_person || '—'}</td>}
                    {qcols.on('dept') && <td className={td}>{dealDept(x) || '—'}</td>}
                    {qcols.on('signal') && <td className={`${td} max-w-[12rem] truncate`} title={x.signal_label || ''}>{x.signal_label || '—'}</td>}
                    <td className={`${td} sticky-action text-right`}>
                      {dealAction(x)}
                      {err && <div className="mt-1 text-[11px] text-red-400 whitespace-normal max-w-[18rem] ml-auto">{err}</div>}
                    </td>
                  </tr>
                )
              })}
              {!loading && shownCount === 0 && (
                <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-mav-muted">
                  {counts[bucket] === 0 ? 'Nothing here — all clear.' : 'Nothing matches those filters.'}
                </td></tr>
              )}
              {loading && shownCount === 0 && (
                <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-mav-muted">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
