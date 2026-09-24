'use client'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ClientLink from '@/components/ClientLink'
import Header from '@/components/Header'
import Link from 'next/link'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import { readDeepLink, clearDeepLink } from '@/lib/deep-link'
import KPICard from '@/components/KPICard'
import { getOpportunities, getOpportunityDepts, serviceOf, setOpportunityConfirmed, setOpportunityLost, setOpportunityUnlikely, canConfirmLocally, getDirectoryMember, type DirectoryMember, type Opportunity } from '@/lib/supabase'
import AddOpportunityDialog from '@/components/AddOpportunityDialog'
import ConfirmDealDialog from '@/components/ConfirmDealDialog'
import MultiSelect from '@/components/MultiSelect'
import { currentEmail, getStoredProfile } from '@/lib/access'
import { NBD_TEAM } from '@/lib/nbd'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
// Owner cells can hold several names ("Rahul Kaushal, Maitri Shah"); split so each
// individual AM/PM is its own selectable dropdown option and filters by "contains".
const splitNames = (s?: string) => (s || '').split(/[,/&]/).map(x => x.trim()).filter(Boolean)
const uniqNames = (arr: (string | undefined)[]) => Array.from(new Set(arr.flatMap(splitNames))).sort((a, b) => a.localeCompare(b))
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

// Quote-size bands, kept as strings because that is what the number inputs hold —
// so a preset and a typed value are the same state and the active highlight is a
// plain string compare. The cuts mirror the deal-size split on the home AI
// Insights card, where the big-quote conversion rate is the thing worth chasing.
// Quote-age buckets, for working the backlog down: pick a band, then mark each row
// Confirmed or Cancelled. Age is measured from the QUOTE DATE, which is what you are
// deciding about — but note the sheet logs a fifth of rows over a week late, so a
// deal can read older than it is. Sort by Intent inside a band to separate the
// genuinely dead from the merely old: a 90-day quote emailed yesterday is not the
// same as one nobody has touched since.
const AGE_BANDS: { label: string; min: number; max: number }[] = [
{ label: 'under 7 days', min: 0, max: 7 },
{ label: '7-15 days', min: 7, max: 15 },
{ label: '15-30 days', min: 15, max: 30 },
{ label: '30-45 days', min: 30, max: 45 },
{ label: '45-60 days', min: 45, max: 60 },
{ label: '60-90 days', min: 60, max: 90 },
{ label: 'over 90 days', min: 90, max: Infinity },
]
const quoteAge = (x: Opportunity): number | null => {
// Same precedence as lib/supabase.ts uses when it builds first_date. The two
// disagreed on 30 rows, which made this filter's ages differ from the Date column.
const t = Date.parse(x.first_date || x.source_date || '')
return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null
}
const inAgeBand = (x: Opportunity, label: string): boolean => {
if (!label) return true
const b = AGE_BANDS.find(v => v.label === label)
if (!b) return true
const a = quoteAge(x)
if (a === null) return false
return a >= b.min && a < b.max
}

const VALUE_BANDS = [
{ label: 'under $1k', min: '', max: '1000' },
{ label: '$1k–$5k', min: '1000', max: '5000' },
{ label: '$5k–$10k', min: '5000', max: '10000' },
{ label: '$10k+', min: '10000', max: '' },
]
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

type SortKey = 'company' | 'value' | 'win' | 'intent' | 'status' | 'source' | 'type' | 'owner' | 'geo' | 'tech' | 'date' | 'flag'
const COLS: { key: SortKey; label: string }[] = [
{ key: 'company', label: 'Client' }, { key: 'value', label: 'Value' }, { key: 'win', label: 'Win %' }, { key: 'intent', label: 'Intent' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' },
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
// Intent tiers. Deliberately a different visual language from Win % — that is a
// person's judgement of the deal, this is what the decided quotes of this year say
// about deals shaped like this one. They disagree often, and the disagreement is
// the useful part, so they must not look like the same number twice.
const TIER_STYLE: Record<string, string> = {
A: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
B: 'bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30',
C: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
D: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
E: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
}
const TIER_LABEL: Record<string, string> = {
A: 'near-certain', B: 'likely', C: 'coin-flip', D: 'unlikely', E: 'long shot',
}
// What each band actually means, in the terms a person would use to decide what to do
// about the deal. The score is a probability, so the bands are just ranges of it —
// saying so plainly stops "B" being read as a grade awarded to the deal.
// Ranges copied from the CASE in the quote_intent view (A >= .80, B >= .60,
// C >= .35, D >= .15, else E). They are written out here only so a person can read
// them; if the view's cut-offs ever move, these must move with them.
const TIER_MEANING: Record<string, { range: string; what: string }> = {
A: { range: '80% and above', what: 'Plan around it. Deals shaped like this almost always land.' },
B: { range: '60–79%', what: 'Likely, not certain. Worth forecasting, still worth chasing.' },
C: { range: '35–59%', what: 'A coin flip. The outcome is decided by what you do next.' },
D: { range: '15–34%', what: 'Unlikely on the evidence. Needs something to change.' },
E: { range: 'below 15%', what: 'A long shot. Do not plan revenue around it.' },
}
// The score is not the four factors multiplied together — three of them are first
// divided by the average quote's value for that factor, so what actually moves the
// number is how far ABOVE or BELOW typical this deal sits. Silence is the exception:
// it multiplies outright, which is why a quiet deal is punished so hard.
//
//   p = 0.8843 × (relationship/0.8597) × (value/0.8891) × (email/0.8840) × silence
//
// Those pivots are the cohort averages baked into the view. Without them a reader
// sees 0.942 and reasonably assumes it is dragging a 97% score DOWN, when it is in
// fact pushing it up — 0.942 is well above the 0.8597 average.
const BASE_RATE = 0.8843
const PIVOT = { relationship: 0.8597, value: 0.8891, email: 0.8840 }
/** How much a factor multiplies the score: >1 helps, <1 hurts. */
const effect = (v: number | undefined, pivot: number) =>
  v == null || !Number.isFinite(v) ? null : v / pivot

/**
 * The "×1.10" line under a factor. Colour carries the direction so the row can be
 * read at a glance without doing the comparison in your head; 1.00 stays neutral
 * grey because "no effect" is neither good nor bad.
 */
function Effect({ v }: { v: number | null }) {
  if (v == null) return <div className="mt-0.5 text-mav-muted/50">—</div>
  const up = v >= 1.005, down = v <= 0.995
  return (
    <div className={`mt-0.5 tabular-nums ${up ? 'text-emerald-300' : down ? 'text-orange-300' : 'text-mav-muted'}`}>
      ×{v.toFixed(2)}
    </div>
  )
}
// The cohort the score is fitted on: quotes DECIDED since the start of this financial
// year. Counted live rather than written into the copy, because it was hardcoded at
// 675 and had two problems — it went stale the moment another quote closed, and 675
// was the all-time figure, while the model is fitted only on FY-2026 onward. The
// business ran at 0–47% in the Jan–Mar era and 87% since April; quoting the all-time
// count next to an April-onward percentage described a population that never existed.
const MODEL_FROM = '2026-04-01'
const decidedCohort = (all: Opportunity[]) => {
  const decided = all.filter(x => {
    const d = (x.first_date || x.source_date || '').slice(0, 10)
    if (!d || d < MODEL_FROM) return false
    const s = oppStatus(x)
    return s === 'Won' || s === 'Lost'
  })
  const won = decided.filter(x => oppStatus(x) === 'Won').length
  return { n: decided.length, rate: decided.length ? Math.round((won / decided.length) * 100) : null }
}
// Why this deal scored what it did, in one hoverable line.
const intentWhy = (x: Opportunity): string => {
if (x.intent_score == null) return ''
const bits: string[] = []
if (x.client_decided_quotes != null) {
bits.push(`client has confirmed ${x.client_confirmed_quotes}/${x.client_decided_quotes} decided quotes`)
if (x.client_decided_quotes >= 20) bits.push('20+ quotes = reseller pattern, historically 25%')
} else bits.push('no decided quotes from this client yet')
const v = x.value
if (v != null) bits.push(v >= 10000 ? 'over $10k — only 1 of 15 has ever closed'
: v >= 2500 ? 'mid-value band, ~50-56%' : 'small-value band, 77-91%')
if (x.signal_label) bits.push(`email: ${x.signal_label}`)
if (x.days_since_touch != null) {
bits.push(`silent ${x.days_since_touch}d`)
bits.push(x.intent_basis === 'email' ? 'recency from email' : 'recency from the sheet date — may be logged late')
}
return bits.join(' · ')
}
const sortVal = (x: Opportunity, k: SortKey): string | number => {
switch (k) {
case 'company': return (x.company_name || '').toLowerCase()
case 'value': return x.value ?? -1
case 'win': return x.win_probability ?? -1
case 'intent': return x.intent_score ?? -1
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
// Counted from the data on every load, so the sentence under the intent score can
// never drift from the population it is describing.
const cohort = useMemo(() => decidedCohort(all), [all])
const [search, setSearch] = useState(''); const [fType, setFType] = useState(''); const [fGeo, setFGeo] = useState<string[]>([])
// Rows the Quotes sheet tags "New" under an owner who isn't on the NBD team.
const [misTagOnly, setMisTagOnly] = useState(false)
const [fAM, setFAM] = useState<string[]>([]); const [fPM, setFPM] = useState<string[]>([]); const pmTouched = useRef(false); const [fStatus, setFStatus] = useState('Open'); const [fSvc, setFSvc] = useState<string[]>([]); const [fTech, setFTech] = useState<string[]>([])
// Service Department is not on an opportunity — the column is blank on all 951 of them.
// PMs are assigned to departments, so the PM answers it; web_opportunity_dept resolves
// the chain (PM team, the PM's delivery history, the client's department, geo) in the
// database so this page and anything else asking get the same answer.
const [fDept, setFDept] = useState<string[]>([])
const [deptById, setDeptById] = useState<Map<number, string>>(new Map())
const [from, setFrom] = useState('2026-04-01'); const [to, setTo] = useState('')
// Quote-value band. Held as strings so "empty" is distinguishable from 0: an
// empty box means the bound is not set, while a typed 0 still switches the band
// on — and switching it on is what drops the value-less rows, so "min 0" is not
// the same as no filter at all.
const [vMin, setVMin] = useState(''); const [vMax, setVMax] = useState('')
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
// Deals still Open in the sheet where the client has already committed in writing —
// said "approved / please proceed", or started discussing the invoice. Threads like
// these confirmed 96% of the time, so each is likely a win nobody has logged yet.
const [committedOnly, setCommittedOnly] = useState(false)
const [fAge, setFAge] = useState('')
const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 })
const [sel, setSel] = useState<Opportunity | null>(null)
// Using the sidebar closes this drawer — including a click on the section you are
// already on, which is not a route change and so re-renders nothing by itself.
useCloseOnNav(useCallback(() => setSel(null), []))
const [page, setPage] = useState(0); const [perPage, setPerPage] = useState(50)

// getOpportunities() merges email leads + the sheet Quotes tab (value + status).
useEffect(() => {
  getOpportunities().then(rows => {
    setAll(rows)
    // Arriving from a client's open quotes on Client 360: ?deal=<id> opens that deal.
    // Matched on the row id, which is stable, rather than on a subject line that is not.
    const want = readDeepLink('deal')
    if (!want) return
    const hit = rows.find(o => String(o.id) === want)
    if (hit) setSel(hit)
    clearDeepLink('deal')
  })
}, [])
// Who is looking, and what they are allowed to change. A viewer sees the same page
// without the Add button and without a confirm action — the database refuses them
// either way, so this only avoids offering something that would bounce.
const [me, setMe] = useState<DirectoryMember | null>(null)
const [iAmAdmin, setIAmAdmin] = useState(false)
const [showAdd, setShowAdd] = useState(false)
const [confirming, setConfirming] = useState<Opportunity | null>(null)
useEffect(() => {
setIAmAdmin(!!getStoredProfile()?.is_admin)
getDirectoryMember(currentEmail()).then(m => {
  setMe(m)
  // A PM opens this page to work their own deals, so it starts on theirs rather than on
  // everybody's. Only on first load, and only if nobody has touched the filter — a deep
  // link that names a PM, or a filter already changed, is left exactly as it is.
  // Admins are not defaulted: they come here to see the whole board.
  if (m?.name) setFPM(prev => (prev.length === 0 && !pmTouched.current) ? [m.name] : prev)
})
}, [])
const canEnter = iAmAdmin || !!me
const reload = () => getOpportunities().then(setAll)
// Default the "To" date to today (set on the client to avoid a hydration mismatch).
useEffect(() => { const d = new Date().toISOString().slice(0, 10); setTo(d); setToday(d) }, [])
// Only for the Service Department filter, so a failure here costs that filter and
// nothing else on the page.
useEffect(() => { getOpportunityDepts().then(setDeptById).catch(() => { /* filter just lists nothing */ }) }, [])

// Undated rows always show; otherwise honour the From/To range.
const inRange = (d?: string) => { const v = (d || '').slice(0, 10); if (!v) return true; if (from && v < from) return false; if (to && v > to) return false; return true }

// Quote-value band. Unlike the date filter, a row with NO value is EXCLUDED the
// moment either bound is set: the question being asked is "which pending quotes
// sit between $X and $Y", and a deal we never put a number on cannot answer it.
// That exclusion is deliberate but invisible, so the count of dropped rows is
// surfaced next to the inputs rather than left for someone to discover.
const vMinN = vMin === '' ? null : Number(vMin)
const vMaxN = vMax === '' ? null : Number(vMax)
const bandOn = (vMinN !== null && !Number.isNaN(vMinN)) || (vMaxN !== null && !Number.isNaN(vMaxN))
const inBand = (v?: number | null) => {
if (!bandOn) return true
if (v === null || v === undefined || v === 0) return false
if (vMinN !== null && !Number.isNaN(vMinN) && v < vMinN) return false
if (vMaxN !== null && !Number.isNaN(vMaxN) && v > vMaxN) return false
return true
}
const toggleSort = (k: SortKey) => setSort(s => s.key === k ? { key: k, dir: (s.dir === 1 ? -1 : 1) } : { key: k, dir: k === 'date' || k === 'win' || k === 'value' ? -1 : 1 })

// Straight from web_opportunity_dept. No 'Other': a deal that cannot be placed returns
// nothing and is simply not matched by a department filter, rather than being filed under
// a bucket that means "we could not tell".
const deptOfOpp = (x: Opportunity): string => deptById.get(Number(x.id)) || ''

const o = useMemo(() => {
const rows = all
.filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
.filter(x => !fType || typeLabel(x).includes(fType))
.filter(x => !fGeo.length || fGeo.includes(x.geo || ''))
.filter(x => !fAM.length || splitNames(x.sales_person).some(n => fAM.includes(n)))
.filter(x => !fPM.length || splitNames(x.pm_owner).some(n => fPM.includes(n)))
.filter(x => !fStatus || oppStatus(x) === fStatus)
.filter(x => !fSvc.length || fSvc.includes(svcOf(x)))
.filter(x => !fTech.length || fTech.includes(x.technology || ''))
.filter(x => !fDept.length || fDept.includes(deptOfOpp(x)))
.filter(x => !flagOnly || x.flag)
.filter(x => !unlikelyOnly || x.unlikely)
.filter(x => !lagOnly || sheetLag(x))
.filter(x => !markedOnly || markedByHand(x))
.filter(x => !committedOnly || !!x.flag_committed_in_email)
.filter(x => inAgeBand(x, fAge))
.filter(x => !misTagOnly || x.mis_tagged_new)
.filter(x => inRange(x.source_date || x.first_date))
.filter(x => inBand(x.value))
return rows.sort((a, b) => {
const av = sortVal(a, sort.key), bv = sortVal(b, sort.key)
if (av < bv) return -1 * sort.dir
if (av > bv) return 1 * sort.dir
return 0
})
}, [all, deptById, search, fType, fGeo, fAM, fPM, fStatus, fSvc, fTech, fDept, flagOnly, unlikelyOnly, lagOnly, markedOnly, committedOnly, misTagOnly, fAge, from, to, vMin, vMax, sort])

// How many rows the band is hiding purely because they carry no quoted value.
// Counted against everything the OTHER filters already allow, so it answers
// "what am I not seeing" rather than "how many value-less deals exist".
const hiddenNoValue = useMemo(() => {
if (!bandOn) return 0
return all
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
.filter(x => !committedOnly || !!x.flag_committed_in_email)
.filter(x => inAgeBand(x, fAge))
.filter(x => !misTagOnly || x.mis_tagged_new)
.filter(x => inRange(x.source_date || x.first_date))
.filter(x => !x.value).length
}, [all, deptById, search, fType, fGeo, fAM, fPM, fStatus, fSvc, fTech, fDept, flagOnly, unlikelyOnly, lagOnly, markedOnly, committedOnly, misTagOnly, fAge, from, to, vMin, vMax])

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

const reset = () => { setSearch(''); setFType(''); setFGeo([]); setFAM([]); setFPM([]); setFStatus(''); setFSvc([]); setFTech([]); setFDept([]); setFrom('2026-04-01'); setTo(new Date().toISOString().slice(0, 10)); setFlagOnly(false); setUnlikelyOnly(false); setLagOnly(false); setMarkedOnly(false); setCommittedOnly(false); setMisTagOnly(false); setFAge(''); setVMin(''); setVMax('') }

// Pagination — reset to first page whenever the filtered/sorted set changes.
useEffect(() => { setPage(0) }, [search, fType, fGeo, fAM, fPM, fStatus, fSvc, fTech, fDept, flagOnly, unlikelyOnly, lagOnly, markedOnly, committedOnly, misTagOnly, fAge, from, to, vMin, vMax, sort, perPage])
const pageCount = Math.max(1, Math.ceil(o.length / perPage))
const curPage = Math.min(page, pageCount - 1)
const pageRows = o.slice(curPage * perPage, curPage * perPage + perPage)
const flagged = all.filter(x => x.flag).length
// Quotes rows tagged New Business under an owner who isn't on the NBD team. Counted
// across every status, not just open deals — a mis-tagged Won deal still misreports
// how much new business the team actually landed. Sheet rows only: an email deal has
// no Business Type cell to correct, so listing it here would be an errand with no end.
const misTagged = useMemo(() => all.filter(x => x.mis_tagged_new), [all])
// Deals whose Lost call hasn't reached the Quotes sheet yet — computed over ALL rows,
// not the date-filtered set, so the alert can't hide behind a narrow From/To window.
const lagRows = useMemo(() => all.filter(sheetLag), [all])
const lagWon = lagRows.filter(x => confirmLag(x) || bookedLag(x))
const lagLost = lagRows.filter(lostLag)
const markedRows = useMemo(() => all.filter(markedByHand), [all])
// Open in the sheet, client already committed in writing. Worth its own list: these
// are the likeliest wins nobody has logged, and the sheet is the thing that has to change.
const committedRows = useMemo(() => all.filter(x => x.flag_committed_in_email), [all])

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
// The share of Pending the decided-quote history says is actually coming. A and B
// are the two tiers above a coin flip (80%+ and 60-80%), so A+B is the part of the
// month you can plan around; everything below is hope. Deliberately EXCLUDES anything
// a human flagged "might not come" — a person who knows the deal outranks the model.
const bankable = pendR.filter(x => !x.unlikely && (x.intent_tier === 'A' || x.intent_tier === 'B'))
const tierA = bankable.filter(x => x.intent_tier === 'A')
const tierB = bankable.filter(x => x.intent_tier === 'B')
return {
key, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
shared: rows.length, sharedValue: sum(rows),
pending: pendR.length, pendingValue: sum(pendR),
openOnly: openR.length, openOnlyValue: sum(openR),
hold: holdR.length, holdValue: sum(holdR),
won: wonR.length, wonValue: sum(wonR),
lost: lostR.length, lostValue: sum(lostR),
unlikely: unlikelyR.length, unlikelyValue: sum(unlikelyR),
tierA: tierA.length, tierAValue: sum(tierA),
tierB: tierB.length, tierBValue: sum(tierB),
bankable: bankable.length, bankableValue: sum(bankable),
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
{m.winRate == null ? 'no quotes' : <>win rate <span className="text-mav-fg font-semibold">{m.winRate}%</span> <span className="opacity-60">of all quotes</span>{m.decidedRate != null && <span className="opacity-60"> · {m.decidedRate}% of decided</span>}</>}
</div>
</div>
<div className="flex gap-2 xl:gap-3">
<Stat label="Quotes shared" n={m.shared} v={m.sharedValue} tone="text-mav-fg" title="Every quote dated in this month. Equals Pending + Won + Lost." />
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
{/* How much of Pending the decided-quote history says is genuinely coming. Shown against
    Pending, because the gap between the two is the point — most of a month's pending
    value normally sits below a coin flip. */}
{m.pending > 0 && (
<div className="mt-2 text-xs text-mav-muted">
{m.bankable > 0 ? (<>
<span className="cursor-help underline decoration-dotted underline-offset-2" title="Pending deals scoring tier A or B (60%+ likely to confirm, based on how similar past quotes ended), excluding anything flagged “might not come”. Counted at full face value.">bankable</span> <span className="text-emerald-300 font-semibold">{money(m.bankableValue)}</span>
<span className="opacity-60"> of {money(m.pendingValue)} pending</span>
{' · '}
<span title="Tier A — 80%+. Deals shaped like these confirmed at least 4 times in 5." className="text-emerald-300">A {money(m.tierAValue)}</span>
<span className="opacity-60"> ({m.tierA})</span>
{' + '}
<span title="Tier B — 60-80%. Likely, not certain." className="text-teal-300">B {money(m.tierBValue)}</span>
<span className="opacity-60"> ({m.tierB})</span>
<div className="mt-1 text-[11px] opacity-60 leading-snug">
Bankable = pending deals likely to confirm (tier A 80%+ or B 60–80%), at full value.
</div>
</>) : (
<span className="text-amber-300">nothing in Pending scores above a coin flip — all {money(m.pendingValue)} is tier C or below</span>
)}
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

{/* Entering a deal the email scan did not catch. Hidden for anyone who is neither a
    registered PM nor an admin: the RPC refuses them, so offering the button would only
    produce a refusal they cannot act on. */}
{canEnter && (
<div className="-mt-2 mb-6 flex justify-end">
<button onClick={() => setShowAdd(true)}
className="text-xs px-3 py-1.5 rounded-md border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/15 transition-colors">
+ Add opportunity
</button>
</div>
)}
{showAdd && <AddOpportunityDialog onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); reload() }} />}
{confirming && <ConfirmDealDialog deal={confirming} onClose={() => setConfirming(null)} onConfirmed={() => { setConfirming(null); reload() }} />}

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

{/* ── Leadership summary: admins only ────────────────────────────────────────
    The month cards, the headline totals and the three breakdowns answer "how
    is the business doing". A PM opening this page is here to work their own
    list, and a wall of company-wide money above it is noise they scroll past
    every day. They get the list and the filters, which is the whole job.

    This hides it, it does not protect it — the data still loads with the anon
    key. It is a tidier page for PMs, not a permission boundary. */}
{iAmAdmin && monthsAgg.length > 0 && (
<div className="mb-6">
<div className="flex items-baseline gap-2 mb-2">
<h2 className="text-sm font-medium">Last 2 months</h2>
<span className="text-xs text-mav-muted">· quotes shared, still pending, and won — counted in the month the quote went out (fixed window, ignores the date filter below)</span>
</div>
<div className="grid md:grid-cols-2 gap-4">{monthsAgg.map(m => <MonthCard key={m.key} m={m} />)}</div>
</div>
)}

{iAmAdmin && (<>
<div className="text-xs text-mav-muted mb-2">Headline numbers &amp; breakdowns below reflect the date range <span className="text-mav-fg">{from || '…'} → {to || 'today'}</span> (change it in the filter bar).
{onHold.length > 0 && <> Open pipeline here excludes On Hold; the cards above count both as pending — <span className="text-mav-fg">{money(openValue)} + {money(onHoldValue)} = {money(pendingValue)}</span> still undecided.</>}</div>
<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
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
</>)}

<div className="flex flex-wrap items-center gap-2 mb-4">
<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client…" className={`${selCls} w-44`} />
<select value={fStatus} onChange={e => setFStatus(e.target.value)} className={selCls}><option value="">All status</option><option value="Open">Open</option><option value="On Hold">On Hold</option><option value="Won">Won</option><option value="Lost">Lost</option></select>
<select value={fAge} onChange={e => setFAge(e.target.value)} className={selCls} title="How long ago the quote was raised. Use it to work the backlog down — pick a band, then mark each row Confirmed or Cancelled.">
<option value="">Any age</option>
{AGE_BANDS.map(b => {
// Count under the status filter that is actually applied, so the number in the
// dropdown is the number of rows you get when you pick it. Counting all
// undecided deals here while the table showed Open only made the two disagree.
const n = all.filter(x => fStatus ? oppStatus(x) === fStatus
  : (oppStatus(x) === 'Open' || oppStatus(x) === 'On Hold')).filter(x => inAgeBand(x, b.label)).length
return <option key={b.label} value={b.label}>{b.label}{n ? ` (${n})` : ''}</option>
})}
</select>
<select value={fType} onChange={e => setFType(e.target.value)} className={selCls}><option value="">All types</option><option value="New">New (NBD)</option><option value="Repeat">Repeat</option></select>
<MultiSelect label="All departments" className="w-44" options={uniq(all.map(deptOfOpp))} selected={fDept} onChange={setFDept} />
<MultiSelect label="All GEO" className="w-36" options={uniq(all.map(x => x.geo))} selected={fGeo} onChange={setFGeo} />
<MultiSelect label="All services" className="w-44" options={uniq(all.map(svcOf))} selected={fSvc} onChange={setFSvc} />
<MultiSelect label="All tech" className="w-40" options={uniq(all.map(x => x.technology))} selected={fTech} onChange={setFTech} />
<MultiSelect label="All AMs" className="w-40" options={uniqNames(all.map(x => x.sales_person))} selected={fAM} onChange={setFAM} />
<MultiSelect label="All PMs" className="w-40" options={uniqNames(all.map(x => x.pm_owner))} selected={fPM} onChange={v => { pmTouched.current = true; setFPM(v) }} />
<button onClick={() => setFlagOnly(v => !v)} className={`text-sm px-3 py-2 rounded-md border transition-colors ${flagOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>⚠ Needs review{flagged ? ` (${flagged})` : ''}</button>
<button onClick={() => setUnlikelyOnly(v => !v)} title="Deals someone flagged as unlikely to convert" className={`text-sm px-3 py-2 rounded-md border transition-colors ${unlikelyOnly ? 'bg-orange-500/20 text-orange-300 border-orange-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>🚫 Might not come{unlikelyOpen.length ? ` (${unlikelyOpen.length})` : ''}</button>
{misTagged.length > 0 && (
<button onClick={() => { setMisTagOnly(v => !v); setFStatus('') }} title={`Quotes-sheet rows tagged "New" in Business Type (col P) whose owner is not on the NBD team — ${NBD_TEAM.map(m => m.name).join(', ')}. Each one is fixable in the sheet; they read as Repeat until it is. Email-only deals are not listed: they have no Business Type cell to correct.`} className={`text-sm px-3 py-2 rounded-md border transition-colors ${misTagOnly ? 'bg-red-500/20 text-red-300 border-red-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>⚠ Tagged New, not NBD ({misTagged.length})</button>
)}
{lagRows.length > 0 && (
<button onClick={() => { setLagOnly(v => !v); setFStatus('') }} title="Decided Won or Lost on the dashboard, but the Quotes sheet still shows the deal Open" className={`text-sm px-3 py-2 rounded-md border transition-colors ${lagOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>⚠ Sheet not updated ({lagRows.length})</button>
)}
{committedRows.length > 0 && (
<button onClick={() => { setCommittedOnly(v => !v); setFStatus('') }} title="Still Open in the Quotes sheet, but the client has already said approved / please proceed, or has started discussing the invoice. Threads like these confirmed 96% of the time — these are most likely wins nobody has logged yet." className={`text-sm px-3 py-2 rounded-md border transition-colors ${committedOnly ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>✍ Client said yes ({committedRows.length})</button>
)}
{markedRows.length > 0 && (
<button onClick={() => { setMarkedOnly(v => !v); setFStatus('') }} title="Every deal someone marked by hand — Confirmed, Lost or 'might not come'. Open one to change or undo the call." className={`text-sm px-3 py-2 rounded-md border transition-colors ${markedOnly ? 'bg-mav-yellow/20 text-mav-yellow border-mav-yellow/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>✎ Marked by hand ({markedRows.length})</button>
)}
<span className="text-xs text-mav-muted ml-1">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
<span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
<span className="text-xs text-mav-muted ml-1" title="Quoted value in USD. Deals with no quoted figure drop out while a band is set.">Value $</span>
<input type="number" min="0" step="100" inputMode="numeric" value={vMin} onChange={e => setVMin(e.target.value)} placeholder="min" aria-label="Minimum quoted value" className={`${selCls} w-24`} />
<span className="text-xs text-mav-muted">–</span>
<input type="number" min="0" step="100" inputMode="numeric" value={vMax} onChange={e => setVMax(e.target.value)} placeholder="max" aria-label="Maximum quoted value" className={`${selCls} w-24`} />
{/* Presets are always visible — hiding them until a bound is typed would mean
    you could never reach them by clicking, which is the whole point of a preset.
    The bands mirror the deal-size split on the home AI Insights card. */}
{VALUE_BANDS.map(b => {
const active = b.min === vMin && b.max === vMax
return (
<button key={b.label} onClick={() => { setVMin(active ? '' : b.min); setVMax(active ? '' : b.max) }}
className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? 'bg-mav-yellow/20 text-mav-yellow border-mav-yellow/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
{b.label}
</button>
)
})}
{bandOn && <button onClick={() => { setVMin(''); setVMax('') }} className="text-xs px-2 py-1 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">clear</button>}
<button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">Reset</button>
<span className="text-xs text-mav-muted ml-auto">
{o.length} shown · {money(o.reduce((s, x) => s + (x.value || 0), 0))}
{hiddenNoValue > 0 && <span className="text-amber-300/80" title="These match every other filter but carry no quoted figure, so a value band cannot place them. Clear the band to see them."> · {hiddenNoValue} hidden (no quoted value)</span>}
</span>
</div>

<div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
<div className="overflow-x-auto">
<table className="w-full text-sm min-w-[1180px]">
<thead className="text-left text-mav-muted border-b border-mav-line"><tr>
<th className="px-3 py-3 w-9" title="Mark a deal confirmed without opening it"></th>
{COLS.map(c => (
<th key={c.key} onClick={() => toggleSort(c.key)} className="px-4 py-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-mav-fg">
{c.label}<span className="ml-1 text-[10px]">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
</th>
))}</tr></thead>
<tbody>{pageRows.map(x => {
const st = oppStatus(x)
return (
<tr key={x.id} onClick={() => setSel(x)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${st === 'Lost' ? 'bg-red-500/5' : x.unlikely ? 'bg-orange-500/[0.07]' : x.flag ? 'bg-amber-500/5' : ''}`}>
{/* Confirm, without opening the deal first.
    Opens the same dialog the drawer's "Mark Confirmed" button does — a deal
    still needs its six fields checked before it books as revenue, so this is a
    shortcut to the dialog, never a silent write. stopPropagation because the
    row itself opens the drawer.
    Already-won deals show a filled tick that does nothing; deals somebody else
    owns show an empty one, because the confirm rule is enforced in the database
    and a button that always fails is worse than a button that is not offered. */}
<td className="px-3 py-3" onClick={e => e.stopPropagation()}>
{x.won || x.email_won ? (
  <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-green-500/60 bg-green-500/25 text-green-300 text-xs" title="Already confirmed">✓</span>
) : canConfirmLocally(x, me, iAmAdmin) ? (
  <button onClick={() => setConfirming(x)} aria-label={`Mark ${x.company_name || 'this deal'} confirmed`}
    title={`Mark ${x.company_name || 'this deal'} confirmed`}
    className="inline-flex items-center justify-center w-5 h-5 rounded border border-green-500/50 text-transparent hover:text-green-300 hover:bg-green-500/20 transition-colors text-xs">✓</button>
) : (
  <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-mav-line" title={`${x.pm_owner || 'Nobody'} owns this deal`} />
)}
</td>
<td className="px-4 py-3">{x.unlikely && <span className="mr-1.5 text-orange-300" title={x.unlikely_reason ? `Might not come — ${x.unlikely_reason}` : 'Flagged: might not come'}>🚫</span>}{x.email_won && <span className="mr-1.5 text-green-400" title={x.email_won_reason ? `Confirmed here — ${x.email_won_reason}` : 'Confirmed on the dashboard'}>✓</span>}<ClientLink name={x.company_name} />{x.summary && <div className="text-xs text-mav-muted">{x.summary.slice(0, 80)}</div>}</td>
<td className={`px-4 py-3 whitespace-nowrap font-medium ${x.unlikely ? 'line-through text-mav-muted' : ''}`}>{x.value ? money(x.value) : <span className="text-mav-muted font-normal">—</span>}</td>
<td className="px-4 py-3">{x.win_probability != null ? <span className={`text-xs font-semibold px-2 py-1 rounded-full ${probColor(x.win_probability)}`}>{x.win_probability}%</span> : <span className="text-xs text-mav-muted">—</span>}</td>
<td className="px-4 py-3">{x.intent_score != null && x.intent_tier ? (
<span title={intentWhy(x)} className={`inline-flex items-baseline gap-1 text-xs font-semibold px-2 py-1 rounded ${TIER_STYLE[x.intent_tier]}`}>
<span>{x.intent_tier}</span><span className="font-normal tabular-nums opacity-80">{x.intent_score}</span>
{x.flag_stale && <span title="Past 60 days — beyond the 95th-percentile close time of 25 days. Needs a chase or a Cancelled." className="opacity-70">⏳</span>}
{x.flag_committed_in_email && <span title="The client has already said approved / please proceed, or discussed the invoice, while the Quotes sheet still reads Open. Threads like these confirmed 96% of the time. Most likely a win nobody has logged yet.">✍</span>}
{x.flag_no_agency && <span title="No Agency recorded. Quotes with a blank Agency confirm at 13.5% against 80% when it is filled in — and that holds independently of price." className="opacity-70">⚑</span>}
</span>
) : <span className="text-xs text-mav-muted">—</span>}</td>
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
<span className="text-mav-muted">Showing <span className="text-mav-fg">{curPage * perPage + 1}–{Math.min((curPage + 1) * perPage, o.length)}</span> of <span className="text-mav-fg">{o.length}</span></span>
<div className="flex items-center gap-1 ml-auto">
<button onClick={() => setPage(0)} disabled={curPage === 0} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-mav-fg disabled:opacity-40">« First</button>
<button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={curPage === 0} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-mav-fg disabled:opacity-40">‹ Prev</button>
<span className="px-2 text-mav-muted">Page <span className="text-mav-fg">{curPage + 1}</span> / {pageCount}</span>
<button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={curPage >= pageCount - 1} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-mav-fg disabled:opacity-40">Next ›</button>
<button onClick={() => setPage(pageCount - 1)} disabled={curPage >= pageCount - 1} className="px-2 py-1 rounded border border-mav-line text-mav-muted enabled:hover:text-mav-fg disabled:opacity-40">Last »</button>
</div>
<select value={perPage} onChange={e => setPerPage(Number(e.target.value))} className={selCls} title="Rows per page">
{[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} / page</option>)}
<option value={100000}>Show all</option>
</select>
</div>
)}
</div>

{sel && (
<div className="fixed inset-0 lg:left-60 z-40" onClick={() => setSel(null)}>
<div className="absolute inset-0 bg-black/50" />
<aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6 lg:p-8">
<div className="flex items-start justify-between gap-3 mb-4">
<div>
{/* The client name opens their Client 360 record. Somebody looking at a deal
    almost always wants to know who they are dealing with — what else is
    running, what has been escalated, when they last booked — and until now
    that meant leaving the page, finding the client list and searching. */}
<Link href={`/clients?client=${encodeURIComponent(sel.company_name || '')}`}
  className="group inline-flex items-center gap-1.5 text-xl font-semibold hover:text-mav-yellow transition-colors"
  title={`Open ${sel.company_name} in Client 360`}>
  {sel.company_name}
  <span className="text-sm text-mav-muted group-hover:text-mav-yellow">↗</span>
</Link>
<div className="mt-1 flex flex-wrap gap-1">
<span className={`text-xs px-2 py-1 rounded-full ${statusTone(oppStatus(sel))}`}>{oppStatus(sel)}</span>
<span className={`text-xs px-2 py-1 rounded-full ${typeLabel(sel) === 'New + Repeat' ? 'bg-purple-500/15 text-purple-300' : sel.is_new_client ? 'bg-blue-500/15 text-blue-400' : 'bg-mav-line text-mav-muted'}`}>{typeLabel(sel) === 'New + Repeat' ? 'New + repeat work' : sel.is_new_client ? 'New business' : 'Repeat client'}</span>
{(sel.sources || (sel.source ? [sel.source] : [])).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).map(sr => <span key={sr} className={`text-xs px-2 py-1 rounded-full ${srcTag(sr)}`}>{srcLabel(sr)}</span>)}
</div>
</div>
<button onClick={() => setSel(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
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
{/* Confirming is ONE action now. There used to be a quick toggle beside this that
    recorded the call without the details, from the era when the Quotes sheet was the
    record and could be finished by hand afterwards. After the 1 Oct cutover there is
    no afterwards, so a confirmation that skips the details would write an unfinishable
    half-row into the sheet. Full width because it is the thing you came here to do. */}
{canConfirmLocally(sel, me, iAmAdmin) && !sel.won && (
<button onClick={() => setConfirming(sel)}
className="w-full mb-2 px-3 py-2.5 rounded-md bg-green-500 text-black text-sm font-bold hover:brightness-110 transition">
Mark Confirmed
</button>
)}
<div className="flex flex-wrap gap-2">
{/* The undo half of the old toggle has to stay: it is the only way back from a
    confirmation made by mistake. */}
{sel.email_won && (
<button disabled={savingWon} onClick={() => toggleConfirmed(sel)}
className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg transition-colors disabled:opacity-50">
{savingWon ? 'Saving…' : 'Undo confirm'}
</button>
)}
<button disabled={savingLost} onClick={() => toggleLost(sel)}
className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${sel.email_lost ? 'border-mav-line text-mav-muted hover:text-mav-fg' : 'border-red-500/50 text-red-300 hover:bg-red-500/15'}`}>
{savingLost ? 'Saving…' : sel.email_lost ? 'Undo Lost' : '✗ Mark Lost'}
</button>
{/* "Might not come" is a pipeline-confidence call, so it only applies while the deal is still live. */}
{(oppStatus(sel) === 'Open' || oppStatus(sel) === 'On Hold' || sel.unlikely) && (
<button disabled={savingUnlikely} onClick={() => toggleUnlikely(sel)}
className={`text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${sel.unlikely ? 'border-mav-line text-mav-muted hover:text-mav-fg' : 'border-orange-500/50 text-orange-300 hover:bg-orange-500/15'}`}>
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

{sel.intent_score != null && sel.intent_tier && (
<div className="mb-5 rounded-lg border border-mav-line bg-mav-dark/40 p-3">
<div className="flex items-baseline justify-between mb-2">
<span className="text-xs uppercase tracking-wide text-mav-muted">Buying intent — what past quotes predict</span>
<span title={`${sel.intent_tier} — ${TIER_LABEL[sel.intent_tier]} (${TIER_MEANING[sel.intent_tier]?.range}). ${TIER_MEANING[sel.intent_tier]?.what}`}
  className={`text-xs font-semibold px-2 py-1 rounded cursor-help ${TIER_STYLE[sel.intent_tier]}`}>{sel.intent_tier} · {sel.intent_score}</span>
</div>
<p className="text-sm text-mav-muted mb-3">
<span className="text-mav-fg">{sel.intent_tier} = {TIER_LABEL[sel.intent_tier]}</span> ({TIER_MEANING[sel.intent_tier]?.range}).{' '}
{TIER_MEANING[sel.intent_tier]?.what}{' '}
Of the <span className="tabular-nums">{cohort.n}</span> quotes decided since April 2026, ones shaped like this converted about {sel.intent_score}% of the time.
{sel.win_probability != null && Math.abs(sel.win_probability - sel.intent_score) >= 25 && (
<span className="text-amber-300"> This is {sel.win_probability > sel.intent_score ? 'well below' : 'well above'} the {sel.win_probability}% on the deal — worth a second look at which is right.</span>
)}
</p>
{/* The four factors. Each shows its raw value AND what that value does to the score,
    because the raw decimal alone is actively misleading: 0.942 looks like a penalty
    and is in fact a 10% uplift. The ×N line is the part to read. */}
<div className="text-[11px] text-mav-muted mb-1.5">
  Each factor is measured against the average quote. <span className="text-emerald-300">×1.10</span> means it
  pushes this deal 10% above the base rate; <span className="text-orange-300">×0.85</span> would pull it 15% below.
</div>
<div className="grid grid-cols-4 gap-2 text-xs">
<div title={`Relationship — how often THIS client has confirmed quotes before. ${sel.client_decided_quotes != null ? `They have confirmed ${sel.client_confirmed_quotes} of ${sel.client_decided_quotes} decided quotes.` : 'No decided quotes from them yet, so this sits at the house average.'} Higher is better. A client with 20+ quotes is a reseller shopping around and scores LOWER, not higher — historically those confirm about 25% of the time.`}
  className="cursor-help"><div className="text-mav-muted mb-0.5 underline decoration-dotted decoration-mav-line underline-offset-2">Relationship</div><div className="font-semibold tabular-nums">{sel.intent_relationship}</div>
<Effect v={effect(sel.intent_relationship, PIVOT.relationship)} />
<div className="text-mav-muted mt-0.5">{sel.client_decided_quotes != null ? `${sel.client_confirmed_quotes}/${sel.client_decided_quotes} confirmed` : 'no history'}</div></div>
<div title={`Value band — what quotes at this price historically convert at. ${sel.value ? `This one is ${money(sel.value)}.` : 'No value on this quote, so it sits at the average.'} Small quotes convert far more often than large ones: under $250 confirms about 96% of the time, and the rate falls steadily as the number grows. Higher is better.`}
  className="cursor-help"><div className="text-mav-muted mb-0.5 underline decoration-dotted decoration-mav-line underline-offset-2">Value band</div><div className="font-semibold tabular-nums">{sel.intent_value_factor}</div>
<Effect v={effect(sel.intent_value_factor, PIVOT.value)} />
<div className="text-mav-muted mt-0.5">{sel.value ? money(sel.value) : 'no value'}</div></div>
<div title={`Email — what the client has actually said, read from their own replies only (our chasing cannot manufacture a positive). ${sel.signal_label ? `Here: ${sel.signal_label}.` : 'No thread matched to this deal.'} Invoice or payment talk confirms 96%, "approved / please proceed" 96%, access handed over 93%, kickoff returned 90% — against 71% for a thread showing none of them. Higher is better.`}
  className="cursor-help"><div className="text-mav-muted mb-0.5 underline decoration-dotted decoration-mav-line underline-offset-2">Email</div><div className="font-semibold tabular-nums">{sel.intent_signal}</div>
<Effect v={effect(sel.intent_signal, PIVOT.email)} />
<div className="text-mav-muted mt-0.5">{sel.signal_label ? sel.signal_label.split(' ').slice(0,2).join(' ') : 'no thread'}</div></div>
<div title={`Silence — how long since anyone touched this deal${sel.days_since_touch != null ? `: ${sel.days_since_touch} days` : ''}. ${sel.intent_basis === 'sheet-date' ? 'Measured from the SHEET date because no email was found, and the sheet is logged over a week late on 22% of rows — so this deal may be fresher than it looks.' : 'Measured from the last email on the thread.'} Higher is better; a deal going quiet is the clearest signal it is drifting.`}
  className="cursor-help"><div className="text-mav-muted mb-0.5 underline decoration-dotted decoration-mav-line underline-offset-2">Silence</div><div className="font-semibold tabular-nums">{sel.intent_recency}</div>
{/* Silence multiplies outright rather than against an average, so its raw value
    IS its effect. Shown the same way so the row reads consistently. */}
<Effect v={sel.intent_recency} />
<div className="text-mav-muted mt-0.5">{sel.days_since_touch != null ? `${sel.days_since_touch}d quiet` : 'unknown'}</div></div>
</div>

{/* The actual sum, with this deal's own numbers in it. A reader who does not trust
    the score can follow it end to end rather than being asked to take 97 on faith.
    The cap is stated because it bites often: four good factors routinely multiply
    past 1.0, and the model refuses to claim any deal is more than 97% certain. */}
<div className="mt-3 pt-3 border-t border-mav-line text-[11px] text-mav-muted">
<div className="uppercase tracking-wide mb-1.5">How this score is built</div>
<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums">
  <span>base {Math.round(BASE_RATE * 100)}%</span>
  <span className="opacity-50">×</span>
  <span className="text-mav-fg">{effect(sel.intent_relationship, PIVOT.relationship)?.toFixed(2) ?? '—'}</span>
  <span className="opacity-50">relationship ×</span>
  <span className="text-mav-fg">{effect(sel.intent_value_factor, PIVOT.value)?.toFixed(2) ?? '—'}</span>
  <span className="opacity-50">value ×</span>
  <span className="text-mav-fg">{effect(sel.intent_signal, PIVOT.email)?.toFixed(2) ?? '—'}</span>
  <span className="opacity-50">email ×</span>
  <span className="text-mav-fg">{sel.intent_recency?.toFixed(2) ?? '—'}</span>
  <span className="opacity-50">silence</span>
  <span className="opacity-50">=</span>
  <span className={`font-semibold ${TIER_STYLE[sel.intent_tier]} px-1.5 py-0.5 rounded`}>{sel.intent_score}%</span>
</div>
<p className="mt-1.5">
  The base is how often a quote confirms at all. Each factor then multiplies it up or down.
  {sel.intent_score === 97 && ' Capped at 97% — the model never calls any open deal a certainty.'}
</p>
</div>

{/* All five bands, with the current one lit. Without this the letter is a grade with
    no scale — you cannot tell whether B is second-best of three or of five. */}
<div className="mt-3 pt-3 border-t border-mav-line">
<div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1.5">What the bands mean</div>
<div className="flex flex-wrap gap-1.5">
{(['A','B','C','D','E'] as const).map(t => (
<span key={t} title={`${TIER_LABEL[t]} (${TIER_MEANING[t].range}) — ${TIER_MEANING[t].what}`}
  className={`text-[11px] px-1.5 py-0.5 rounded cursor-help ${t === sel.intent_tier
    ? TIER_STYLE[t]
    : 'text-mav-muted border border-mav-line'}`}>
  {t} {TIER_LABEL[t]} <span className="opacity-60">{TIER_MEANING[t].range}</span>
</span>
))}
</div>
</div>
{sel.intent_basis === 'sheet-date' && (
<p className="mt-2 text-xs text-mav-muted">Recency is from the sheet&apos;s own date — no email found for this deal. The sheet is logged more than a week late on 22% of rows, so this deal may be fresher than it looks.</p>
)}
{sel.flag_committed_in_email && (
<p className="mt-2 text-xs text-emerald-300">✍ The client has already committed in writing — {sel.signal_label}. Threads like these confirmed 96% of the time. The Quotes sheet still reads Open, so this is most likely a win nobody has logged.</p>
)}
{sel.signal_label === 'no commitment signal in the thread' && (
<p className="mt-2 text-xs text-mav-muted">No approval, invoice, access or kickoff signal anywhere in the client&apos;s replies. Threads like that confirm 71% of the time against 96% when one is present.</p>
)}
{sel.flag_stale && <p className="mt-2 text-xs text-amber-300">⏳ Past 60 days. 95% of quotes that convert do so within 25 — this needs a chase or a Cancelled.</p>}
{sel.flag_no_agency && <p className="mt-2 text-xs text-amber-300">⚑ No Agency recorded. Blank-Agency quotes confirm at 13.5% against 80% when filled in, independently of price.</p>}
</div>
)}

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
{/* Where to go in the Quotes tab. Absent on email-origin deals, which have no line yet. */}
<div><div className="text-xs text-mav-muted">Quotes sheet row</div>{sel.sheet_row ? <span className="tabular-nums">{sel.sheet_row}</span> : <span className="text-mav-muted">not in the sheet</span>}</div>
<div className="col-span-2"><div className="text-xs text-mav-muted">{sel.quote_ref ? 'Quote / subject' : 'Subject'}</div>{sel.source_subject || '—'}</div>
</div>
</aside>
</div>
)}
</div>
)
}
