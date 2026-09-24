'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useThemeInk } from '@/lib/use-theme-ink'
import Header from '@/components/Header'
import MultiSelect from '@/components/MultiSelect'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'
import { readDeepLink, clearDeepLink } from '@/lib/deep-link'
import Link from 'next/link'
import { getClient360, type Client360, getClientProjects, getClientQuotes, getClientQbrs, getDirectoryMember, type ClientProject, type ClientQuote, type ClientQbr, getClients, getEmailSignals, getEscalations, getBookingsFull, getOpportunities, getFeedback, getClientDirectory, getEscalationVerdicts, type Mix, type Client, type EmailSignal, type Escalation, type BookingRow, type Opportunity, type Feedback, type ClientDirectory , getClientOwners, clientKey } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'
import { AUTOMATION_PLAYS, UNIVERSAL_PLAYS, PLAY_TYPE_TONE, type PlayType } from '@/lib/automation-plays'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '@/components/AuthProvider'
import ClientQbrPanel from '@/components/ClientQbrPanel'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
// An empty selection means "all" — the same thing the old "All industries" option meant.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())
const norm = (s?: string) => (s || '').trim().toLowerCase()
const akey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Expand a company name into candidate match keys: the whole name, the name minus a
// leading article ("The View From Here" -> "viewfromhere"), the part before the first
// "(", and every parenthetical token ("Enphase (Solargraf)" -> "solargraf";
// "ForHealth (Zulu8)" -> "zulu8"). This lets email/opportunity names written as
// "EndClient (Agency)" or "Product (Client)" link to the canonical booking client.
const stripArticle = (s: string) => s.replace(/^\s*(the|a|an)\s+/i, '')
const nameKeys = (name?: string): string[] => {
  const raw = name || ''
  const out = new Set<string>()
  const add = (s: string) => { const k = akey(s); if (k.length >= 2) out.add(k) }
  add(raw); add(stripArticle(raw))
  const before = raw.split('(')[0]; if (before !== raw) { add(before); add(stripArticle(before)) }
  for (const m of raw.matchAll(/\(([^)]+)\)/g)) { add(m[1]); add(stripArticle(m[1])) }
  return [...out]
}
// Two names match if any candidate keys are equal, or (for keys >= 4 chars) one is a
// prefix of the other. The >=4 floor avoids short tokens colliding across clients.
const keyMatch = (a: string[], b: string[]): boolean => {
  for (const x of a) for (const y of b) {
    if (x === y) return true
    if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true
  }
  return false
}
// Display aliases: booked under one name, better shown merged (keyed by akey).
const DISPLAY_ALIAS: Record<string, string> = {
  projectcentreltd: 'Project Centre Ltd / Marston Holdings',
}
const displayName = (name?: string) => DISPLAY_ALIAS[akey(name)] || name || ''
const ym = (s?: string) => (s || '').slice(0, 7)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
// n months back from today, as 'YYYY-MM'. Done with month arithmetic rather than
// Date.setMonth: on the 31st, setMonth(-11) asks for "Sep 31", which JS rolls
// forward into October — so on a 31-day month this returned only 7 distinct
// months out of 12, duplicating some and dropping others. That skewed the dip
// windows and would have mislabelled the 12-month billing chart.
const monthsAgoYM = (n: number) => {
  const i = now.getFullYear() * 12 + now.getMonth() - n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }
// month key 'YYYY-MM' -> absolute month index (year*12 + month) for span/recency math
const ymIdx = (k?: string) => { const p = (k || '').slice(0, 7).split('-'); return p.length >= 2 && p[0] && p[1] ? +p[0] * 12 + (+p[1] - 1) : null }
const nowIdx = now.getFullYear() * 12 + now.getMonth()
const plural = (n: number, w: string) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`

// Derived engagement history for a client, computed from the revenue/bookings rows.
type Tenure = { first?: string; last?: string; activeMonths: number; spanMonths: number; total: number; avgActive: number; sinceLast: number | null; services: string[] }

// clients.sentiment is written by compute_client_sentiment() as one of
// 'Positive' | 'At Risk' | 'Watch' | 'Neutral'. 'Watch' is checked BEFORE the negative
// pattern — it means an escalation is logged but nothing negative is live, which is not
// the same as an at-risk account and shouldn't be coloured like one.
const sentBucket = (s?: string) => {
  const v = (s || '').toLowerCase()
  if (/(positive|happy|good|great|strong|delight)/.test(v)) return 'Positive'
  if (/watch/.test(v)) return 'Watch'
  if (/(negative|unhappy|poor|bad|risk|frustrat|churn|escalat)/.test(v)) return 'Negative'
  if (/(neutral|stable|ok|mixed)/.test(v)) return 'Neutral'
  return ''
}
const tone = (b: string) => b === 'Positive' ? 'bg-green-500/15 text-green-400' : b === 'Negative' ? 'bg-red-500/15 text-red-400' : b === 'Neutral' ? 'bg-amber-500/15 text-amber-400'
  : b === 'At risk' ? 'bg-red-500/20 text-red-300' : b === 'Watch' ? 'bg-orange-500/20 text-orange-300' : 'bg-mav-line text-mav-muted'
const sigTone = (t?: string) => { const v = (t || '').toLowerCase(); if (/risk|escalat|churn/.test(v)) return 'bg-red-500/15 text-red-400'; if (/oppo|lead|upsell|cross/.test(v)) return 'bg-blue-500/15 text-blue-400'; if (/positive|win|prais/.test(v)) return 'bg-green-500/15 text-green-400'; return 'bg-mav-line text-mav-muted' }
const impactTone = (i?: string) => /critical|sev1|sev 1/i.test(i || '') ? 'bg-red-500/20 text-red-300' : /major/i.test(i || '') ? 'bg-red-500/15 text-red-400' : /minor/i.test(i || '') ? 'bg-amber-500/15 text-amber-400' : 'bg-mav-line text-mav-muted'
// Every badge on a card carries whatever the source sheet put in that column, and those
// sheets are hand-filled: Business Impact has turned up holding a whole paragraph. A
// shrink-0 badge with a paragraph in it cannot wrap and cannot shrink, so it pushed out
// of its card and straight across the column beside it — which is what made one client's
// escalation text run over the panel next to it. Capped, truncated, full text on hover.
const Tag = ({ cls, text }: { cls: string; text: string }) => (
  <span title={text} className={`shrink-0 max-w-[45%] truncate text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>{text}</span>
)
// Colour per engagement model, shared by the proportion bar and its legend.
// Dedicated work carries the brand yellow so the thing this panel is asked about
// reads first; the rest sit muted around it.
const modelBar = (name: string) => {
  const v = (name || '').toLowerCase()
  if (/partial dedicated/.test(v)) return 'bg-amber-500'
  if (/dedicated/.test(v)) return 'bg-mav-yellow'
  if (/new development/.test(v)) return 'bg-blue-500'
  if (/maintan|mainten/.test(v)) return 'bg-emerald-500'
  if (/ad-?hoc/.test(v)) return 'bg-purple-500'
  if (/additional pages/.test(v)) return 'bg-sky-600'
  if (/change request/.test(v)) return 'bg-rose-500'
  return 'bg-mav-line'
}
const dotCls = (b: string) => b === 'At risk' ? 'bg-red-500' : b === 'Watch' ? 'bg-orange-400' : b === 'Positive' ? 'bg-green-400' : b === 'Negative' ? 'bg-red-400' : b === 'Neutral' ? 'bg-amber-400' : 'bg-mav-muted'

type Risk = { level: '' | 'At risk' | 'Watch'; reasons: string[]; escs: Escalation[]; posFb: Escalation[]; negSigs: EmailSignal[]; recovered: boolean; recoveryNote?: string; unresolved: boolean; dip?: { last: number; prior: number; dropPct: number; stopped: boolean } }
// A feedback-table row counts as positive when its Nature/type reads positive (praise, happy, great…)
const isPosFeedback = (f: Feedback) => sentBucket(f.nature) === 'Positive' || /positive|praise|apprec|happy|great|delight|testimonial/i.test(`${f.nature || ''} ${f.feedback_type || ''}`)
// the escalation report also logs positive feedback, tagged "Not An Escalation" — those must NOT count as risk
const isPosFb = (e: Escalation) => /not an escalation/i.test(e.escalation_type || '') || /not an escalation/i.test(e.business_impact || '')
const isJunk = (e: Escalation) => /^(source|escalation type|type of situation)$/i.test((e.escalation_type || '').trim()) || /^escalation type$/i.test((e.business_impact || '').trim())


// One figure, its label, and a line saying what it is made of.
//
// The third line is the point. "Average value $2,140" invites the question "of what?",
// and a number nobody can source is a number nobody acts on — so every tile says how many
// projects it is over, or which months, or how many quotes.
function Stat({ label, value, sub, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'bad'
}) {
  const colour = tone === 'good' ? 'text-green-300' : tone === 'warn' ? 'text-amber-300' : tone === 'bad' ? 'text-red-300' : 'text-mav-fg'
  return (
    <div className="rounded-lg border border-mav-line bg-mav-dark/40 px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wide text-mav-muted">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="text-[11px] text-mav-fg/50 mt-0.5 leading-snug">{sub}</div>}
    </div>
  )
}

const SPLIT_COLOURS = ['#FFDB2D', '#7CC4FF', '#9B8CFF', '#5FD3A0']

// A quote's own status text, straight from the Quotes sheet. Confirmed/won reads green,
// lost or dropped red, anything else is still in play.
const quoteTone = (v?: string) => {
  const t = (v || '').toLowerCase()
  if (/confirm|won|approved/.test(t)) return 'bg-green-500/15 text-green-400'
  if (/lost|reject|drop|cancel|declin/.test(t)) return 'bg-red-500/15 text-red-400'
  return 'bg-blue-500/15 text-blue-400'
}
// Delivery state, not sales state: Delivered is the finished one.
const deliveryTone = (v?: string) => {
  const t = (v || '').toLowerCase()
  if (/deliver|complete|live/.test(t)) return 'bg-green-500/15 text-green-400'
  if (/cancel/.test(t)) return 'bg-red-500/15 text-red-400'
  if (/hold|await|review/.test(t)) return 'bg-amber-500/15 text-amber-400'
  return 'bg-mav-line text-mav-muted'
}

// The client score.
//
// One number out of 100, and every point of it is shown alongside so it can be argued
// with. A score nobody can take apart is a score nobody trusts — and this one is built
// from data that is often thin (CSAT is filled in on 1 feedback row out of 68), so being
// able to see WHY it says 55 matters more than the 55 does.
//
// It starts at a neutral 70 and moves on things we actually hold: how recently they
// booked, what has been escalated, what has been praised, whether their spend collapsed,
// and whether there is anything live in the pipeline. It is a prompt to go and look, not
// a verdict.
const scoreOf = (i: {
  monthsQuiet: number | null; escs6: number; unresolved: boolean; delights: number
  negSignals: number; dip?: { stopped: boolean }; openQuotes: number
}) => {
  const parts: { label: string; points: number }[] = []
  const add = (label: string, points: number) => { if (points !== 0) parts.push({ label, points }) }

  if (i.monthsQuiet == null) add('never booked', -20)
  else if (i.monthsQuiet <= 1) add('booked this month or last', 10)
  else if (i.monthsQuiet >= 7) add(`no booking for ${i.monthsQuiet} months`, -20)
  else if (i.monthsQuiet >= 4) add(`no booking for ${i.monthsQuiet} months`, -10)

  if (i.escs6 === 0) add('no escalation in 6 months', 10)
  else if (i.escs6 === 1) add('1 escalation in 6 months', -5)
  else add(`${i.escs6} escalations in 6 months`, i.escs6 >= 3 ? -20 : -10)
  if (i.unresolved) add('an escalation is still open', -15)

  if (i.delights > 0) add(`${i.delights} piece${i.delights === 1 ? '' : 's'} of positive feedback`, Math.min(i.delights * 5, 15))
  if (i.negSignals > 0) add(`${i.negSignals} unhappy email thread${i.negSignals === 1 ? '' : 's'}`, Math.max(i.negSignals * -5, -15))
  if (i.dip) add(i.dip.stopped ? 'billing has stopped' : 'revenue halved or worse', i.dip.stopped ? -20 : -10)
  if (i.openQuotes > 0) add(`${i.openQuotes} live quote${i.openQuotes === 1 ? '' : 's'}`, 5)

  const score = Math.max(0, Math.min(100, 70 + parts.reduce((sum, x) => sum + x.points, 0)))
  const band = score >= 80 ? 'Strong' : score >= 60 ? 'Steady' : score >= 40 ? 'Worth a call' : 'At risk'
  const tone = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-mav-fg' : score >= 40 ? 'text-amber-400' : 'text-red-400'
  return { score, band, tone, parts: parts.sort((a, b) => a.points - b.points) }
}

// One "what they buy" list — every technology, service type or department this client has
// paid for, biggest first. The Overview tiles answer with a single winner ("mostly built
// in Wordpress"); that is the headline and not the whole answer. A client on Wordpress
// who also had two Shopify builds and an AI job reads as a pure Wordpress account here,
// and whoever is about to pitch them never finds out otherwise.
//
// Ordered and sized by revenue, not by project count, to match the tiles: eleven tiny
// AWS tickets are not a bigger part of the relationship than one large build.
const MixList = ({ title, note, rows }: { title: string; note: string; rows?: Mix[] }) => {
  if (!rows || rows.length === 0) return null
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs uppercase tracking-wide text-mav-muted">{title}</span>
        <span className="text-[11px] text-mav-muted">{rows.length} &middot; {note}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((x, i) => (
          <div key={x.name} className="text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate" title={x.name}>{x.name}</span>
              <span className="text-[11px] text-mav-muted tabular-nums shrink-0">{x.projects}&times;</span>
              <span className="tabular-nums shrink-0">{fmtUsd(x.amount)}</span>
              <span className="tabular-nums text-mav-muted w-12 text-right shrink-0">{x.pct}%</span>
            </div>
            {/* A bar per row rather than one stacked bar: these lists run to seven or
                eight entries, and a stacked bar at that length is unreadable slivers. */}
            <div className="mt-1 h-1 rounded-full bg-mav-dark overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(x.pct, 1)}%`, background: SPLIT_COLOURS[i % SPLIT_COLOURS.length] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sep 2026" from a YYYY-MM or a date string, without a timezone shifting the month. */
const monthName = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})/.exec(v || '')
  return m ? `${MON3[+m[2] - 1]} ${m[1]}` : '—'
}
/** "21 Sep 2026" — unambiguous, unlike a locale-shuffled numeric date. */
const dayName = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? `${+m[3]} ${MON3[+m[2] - 1]} ${m[1]}` : '—'
}
const monthsSince = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})/.exec(v || '')
  if (!m) return null
  const now = new Date()
  return (now.getFullYear() - +m[1]) * 12 + (now.getMonth() + 1 - +m[2])
}

export default function Clients() {
  const ink = useThemeInk()
  const [clients, setClients] = useState<Client[]>([])
  const [c360, setC360] = useState<Record<string, Client360>>({})
  // Per-client detail, loaded only when a drawer opens. Delivery history alone is 3,218
  // rows across every client; pulling all of it to show one account's twelve projects is
  // a page that gets slower every month the sheet grows.
  const [cProjects, setCProjects] = useState<ClientProject[]>([])
  const [cQuotes, setCQuotes] = useState<ClientQuote[]>([])
  const [qbrs, setQbrs] = useState<ClientQbr[]>([])
  const { profile, email } = useAuth()
  // A QBR may be written up by the PM who ran the call or by an admin — the same rule the
  // database enforces. Checked against the PM directory rather than the email domain:
  // being a colleague is not the same as owning the account.
  const [isPm, setIsPm] = useState(false)
  useEffect(() => { getDirectoryMember(email).then(m => setIsPm(!!m)) }, [email])
  const canQbr = !!profile?.is_admin || isPm
  // Which panel of the client drawer is open. Kept on the page, not the drawer, so it
  // survives closing one client and opening the next — somebody comparing two accounts
  // on the same measure should not have to find the tab again each time.
  const [cTab, setCTab] = useState<'overview' | 'work' | 'projects' | 'health' | 'qbr'>('overview')
  // Starts on this person's own accounts. Client 360 is where a PM prepares for a call,
  // and 405 clients is a directory; theirs is the working list. One click shows the lot.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])
  const [signals, setSignals] = useState<EmailSignal[]>([])
  const [escs, setEscs] = useState<Escalation[]>([])
  // Verdicts a human recorded on Critical Escalations. Honoured here so a client can't be
  // called At risk off the same signal that was dismissed or closed out one screen away.
  const [verdicts, setVerdicts] = useState<{ dismissed: Set<string>; settled: Set<string>; unresolved: Set<string> }>({ dismissed: new Set(), settled: new Set(), unresolved: new Set() })
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [allOpps, setAllOpps] = useState<Opportunity[]>([])
  const [q, setQ] = useState(''); const [ind, setInd] = useState<string[]>([]); const [stat, setStat] = useState(''); const [aiOnly, setAiOnly] = useState(false)
  // Clients whose billing has fallen off a cliff in the last two completed months.
  const [dipOnly, setDipOnly] = useState(false)
  const [owner, setOwner] = useState<string[]>([]); const [geo, setGeo] = useState<string[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [recentOnly, setRecentOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'ltv' | 'owner' | 'geo' | 'activity'>('activity'); const [sortAsc, setSortAsc] = useState(false)
  const [selC, setSelC] = useState<Client | null>(null)
  // Using the sidebar closes this drawer — including a click on the section you are
  // already on, which is not a route change and so re-renders nothing by itself.
  useCloseOnNav(useCallback(() => setSelC(null), []))
  // Clearing first matters: without it the previous client's projects stay on screen for
  // as long as the fetch takes, and what you are reading is another account's delivery
  // history under this account's name.
  const refreshQbrs = () => { if (selC) getClientQbrs(selC.company_name).then(setQbrs) }
  useEffect(() => {
    if (!selC) return
    const name = selC.company_name
    setCProjects([]); setCQuotes([]); setQbrs([])
    getClientProjects(name).then(setCProjects)
    getClientQuotes(name).then(setCQuotes)
    getClientQbrs(name).then(setQbrs)
  }, [selC])
  // The Client-Backup directory: every client on the sheet, booked or not.
  const [dir, setDir] = useState<ClientDirectory[]>([])
  const [mode, setMode] = useState<'clients' | 'directory'>('clients')
  const [bu, setBu] = useState<string[]>([]); const [linked, setLinked] = useState<'' | 'yes' | 'no'>('')
  // Directory-only: filter by the AI stance classified from each company's own site text
  const [aiStance, setAiStance] = useState<'' | 'native' | 'adjacent'>('')
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  // Automation section: which industry card is expanded, and an optional play-type filter
  const [openPlayInd, setOpenPlayInd] = useState<string>('')
  const [playType, setPlayType] = useState<PlayType | ''>('')
  // Both of these open CLOSED. They are reference sections, not the reason anybody comes
  // to this page — the client table is — and between them they pushed the table most of
  // a screen down on every visit.
  // Every owner of each client, not the one name on the record. A client split by
  // service belongs to both the people delivering it, and both should find it here.
  const [ownerMap, setOwnerMap] = useState<Map<string, string[]>>(new Map())
  useEffect(() => { getClientOwners().then(setOwnerMap).catch(() => {}) }, [])
  const ownersOf = (name?: string) => ownerMap.get(clientKey(name)) || []
  const [showInd, setShowInd] = useState(false)
  // The chip on the shut industry panel. One industry is worth naming; four are not
  // worth truncating into nonsense.
  const indLabel = ind.length === 1 ? ind[0] : `${ind.length} industries`
  const [showAuto, setShowAuto] = useState(false)
  // Both tables page at 50. The directory is ~2,000 rows and was rendering every one
  // of them into the DOM on every keystroke of the search box.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  useEffect(() => {
    // Arriving from a deal on Opportunities: ?client=Acme opens straight onto that
    // record. Matched on the name because that is what the two tables share — there is
    // no id on a client — and case/spacing-insensitively, because the name comes from
    // whichever sheet the deal came from.
    getClients().then(rows => {
      setClients(rows)
      const want = readDeepLink('client')
      if (!want) return
      const k = want.trim().toLowerCase()
      const hit = rows.find(c => (c.company_name || '').trim().toLowerCase() === k)
        || rows.find(c => (c.company_name || '').trim().toLowerCase().includes(k))
      if (hit) setSelC(hit)
      clearDeepLink('client')
    })
    getClient360().then(setC360); getEmailSignals().then(setSignals); getEscalations().then(setEscs); getEscalationVerdicts().then(setVerdicts); getBookingsFull().then(setBookings); getFeedback().then(setFeedback)
    getClientDirectory().then(setDir)
    // only email-sourced opportunities count as "active discussion" (sheet quotes live on the Opportunities page)
    // — but keep the full list too, because the automation-demand scan below needs to
    // see sheet quote lines as well ("Barton Automation", "Klaviyo integration"…).
    getOpportunities().then(all => { setAllOpps(all); setOpps(all.filter(o => (o.source_tags || []).includes('email') || o.source === 'email')) })
  }, [])

  // The client LIST comes only from booking data (as before). Signals/escalations/
  // opportunities are linked to each client by token matching (nameKeys/keyMatch), so a
  // thread logged as "Enphase (Solargraf)" attaches to the "Enphase Energy" booking row.
  const allClients = clients

  // email conversation signals linked to each client
  const sigByClient = useMemo(() => {
    const tagged = signals.map(s => ({ s, keys: nameKeys(s.company_name) }))
    const map = new Map<string, EmailSignal[]>()
    for (const c of allClients) {
      const ck = nameKeys(c.company_name)
      map.set(c.company_name, tagged.filter(t => keyMatch(ck, t.keys)).map(t => t.s)
        .sort((x, y) => (y.source_date || '').localeCompare(x.source_date || '')))
    }
    return map
  }, [signals, allClients])

  // Match escalations by company_name (plus geo as a fallback, since some older sheet
  // rows carried the client name in the geo field).
  const escByClient = useMemo(() => {
    const tagged = escs.map(e => ({ e, keys: [...nameKeys(e.company_name), ...nameKeys(e.geo)] }))
    const map = new Map<string, Escalation[]>()
    for (const c of allClients) {
      const ck = nameKeys(c.company_name)
      map.set(c.company_name, tagged.filter(t => keyMatch(ck, t.keys)).map(t => t.e)
        .sort((a, b) => (b.tracking_date || '').localeCompare(a.tracking_date || '')))
    }
    return map
  }, [escs, allClients])

  // positive feedback-table rows linked to each client (agency name → client), newest first
  const posFbByClient = useMemo(() => {
    const tagged = feedback.filter(isPosFeedback).map(f => ({ f, keys: nameKeys(f.agency) }))
    const map = new Map<string, Feedback[]>()
    for (const c of allClients) {
      const ck = nameKeys(c.company_name)
      map.set(c.company_name, tagged.filter(t => keyMatch(ck, t.keys)).map(t => t.f)
        .sort((a, b) => (b.added_date || '').localeCompare(a.added_date || '')))
    }
    return map
  }, [feedback, allClients])

  // email-sourced opportunities linked to each client
  const oppByClient = useMemo(() => {
    const tagged = opps.map(o => ({ o, keys: nameKeys(o.company_name) }))
    const map = new Map<string, Opportunity[]>()
    for (const c of allClients) {
      const ck = nameKeys(c.company_name)
      map.set(c.company_name, tagged.filter(t => keyMatch(ck, t.keys)).map(t => t.o)
        .sort((a, b) => (b.source_date || '').localeCompare(a.source_date || '')))
    }
    return map
  }, [opps, allClients])

  // last activity (date + kind counts) for a client, across all three linked sources
  type Act = { last: string; convo: number; esc: number; quote: number }
  const activityOf = (c: Client): Act => {
    const sig = sigByClient.get(c.company_name) || []
    const esc = (escByClient.get(c.company_name) || []).filter(e => !isPosFb(e) && !isJunk(e))
    const opp = oppByClient.get(c.company_name) || []
    const dates = [
      ...sig.map(s => (s.source_date || '').slice(0, 10)),
      ...esc.map(e => (e.tracking_date || '').slice(0, 10)),
      ...opp.map(o => (o.source_date || '').slice(0, 10)),
    ].filter(Boolean).sort()
    return { last: dates[dates.length - 1] || '', convo: sig.length, esc: esc.length, quote: opp.length }
  }
  const lastActivity = (c: Client) => activityOf(c).last

  // bookings grouped by client (normalised name), for the tenure summary in the detail panel
  const bookingsByClient = useMemo(() => {
    const m = new Map<string, BookingRow[]>()
    for (const b of bookings) { const k = norm(b.company_name); if (!k) continue; (m.get(k) || m.set(k, []).get(k))!.push(b) }
    return m
  }, [bookings])

  // A steep, recent fall in billing. Compares the last two COMPLETED months against the
  // two before them — the month in progress is excluded, since a half-billed month looks
  // like a collapse in every account. "Steep" is a halving or worse on a client who was
  // billing at least $2,000 over those two months, so a $300 one-off going quiet doesn't
  // cry wolf. This is a business signal, not a sentiment one: the client may be perfectly
  // happy and simply have stopped spending, which is exactly what's worth knowing early.
  const DIP_FLOOR = 2000, DIP_RATIO = 0.5
  const dipByClient = useMemo(() => {
    const last2 = [monthsAgoYM(1), monthsAgoYM(2)]
    const prior2 = [monthsAgoYM(3), monthsAgoYM(4)]
    const acc = new Map<string, { last: number; prior: number }>()
    for (const b of bookings) {
      const k = norm(b.company_name); if (!k) continue
      const m = ym(b.booking_month); const amt = b.booking_amount || 0
      if (!last2.includes(m) && !prior2.includes(m)) continue
      const e = acc.get(k) || { last: 0, prior: 0 }
      if (last2.includes(m)) e.last += amt; else e.prior += amt
      acc.set(k, e)
    }
    const out = new Map<string, { last: number; prior: number; dropPct: number; stopped: boolean }>()
    for (const [k, e] of acc) {
      if (e.prior < DIP_FLOOR || e.last > e.prior * DIP_RATIO) continue
      out.set(k, { last: Math.round(e.last), prior: Math.round(e.prior), dropPct: Math.round((1 - e.last / e.prior) * 100), stopped: e.last <= 0 })
    }
    return out
  }, [bookings])
  const dipWindow = `${monLabel(monthsAgoYM(2))}–${monLabel(monthsAgoYM(1))} vs ${monLabel(monthsAgoYM(4))}–${monLabel(monthsAgoYM(3))}`

  const tenureOf = (c: Client): Tenure | null => {
    const list = (bookingsByClient.get(norm(c.company_name)) || []).filter(b => (b.booking_amount || 0) !== 0)
    if (!list.length) return null
    const months = list.map(b => ym(b.booking_month)).filter(Boolean).sort()
    const first = months[0], last = months[months.length - 1]
    const fi = ymIdx(first), li = ymIdx(last)
    const activeMonths = new Set(months).size
    const spanMonths = fi != null && li != null ? li - fi + 1 : activeMonths
    const total = list.reduce((s, b) => s + (b.booking_amount || 0), 0)
    return { first, last, activeMonths, spanMonths, total, avgActive: activeMonths ? total / activeMonths : 0, sinceLast: li != null ? nowIdx - li : null, services: uniq(list.map(b => b.service_name)) }
  }

  // Last 12 months of billing for one client, plus the split by engagement model
  // (the sheet's "Project Type"). Both come from web_revenue — the same table
  // behind LTV, the dip check and every other page — so the chart total and the
  // split total are always the same money.
  //
  // Every one of the 12 buckets is emitted even when nothing was billed: a
  // client who went quiet for four months should show four empty columns, not a
  // compressed chart that hides the gap.
  const MONTHS_BACK = 12
  type Billing = {
    series: { key: string; label: string; full: string; amount: number }[]
    total: number; activeMonths: number
    models: { name: string; amount: number; pct: number }[]
    dedicated: number; dedicatedPct: number
    firstLabel: string; lastLabel: string
  }
  const billingOf = (c: Client): Billing | null => {
    const keys: string[] = []
    for (let i = MONTHS_BACK - 1; i >= 0; i--) keys.push(monthsAgoYM(i))
    const lo = keys[0], hi = keys[keys.length - 1]
    const byMonth = new Map<string, number>(keys.map(k => [k, 0]))
    const byModel = new Map<string, number>()
    for (const b of bookingsByClient.get(norm(c.company_name)) || []) {
      const k = ym(b.booking_month)
      if (!k || k < lo || k > hi) continue
      const amt = Number(b.booking_amount) || 0
      byMonth.set(k, (byMonth.get(k) || 0) + amt)
      // A blank Project Type is shown as its own line rather than folded into a
      // neighbour — inventing a model for it would misstate the dedicated share.
      const m = (b.engagement_model || '').trim() || 'Unspecified'
      byModel.set(m, (byModel.get(m) || 0) + amt)
    }
    const series = keys.map(k => ({ key: k, label: SHORT[+k.slice(5, 7)] || k, full: monLabel(k), amount: Math.round(byMonth.get(k) || 0) }))
    const total = series.reduce((sum, p) => sum + p.amount, 0)
    if (total <= 0) return null
    const models = [...byModel.entries()]
      .map(([name, amount]) => ({ name, amount: Math.round(amount), pct: total ? (amount / total) * 100 : 0 }))
      .filter(m => m.amount !== 0)
      .sort((a, b) => b.amount - a.amount)
    // "Partial Dedicated" counts toward dedicated work but is kept as its own
    // line below, so the headline number and the breakdown agree.
    const dedicated = models.filter(m => /dedicated/i.test(m.name)).reduce((sum, m) => sum + m.amount, 0)
    return {
      series, total, activeMonths: series.filter(p => p.amount > 0).length, models,
      dedicated, dedicatedPct: total ? (dedicated / total) * 100 : 0,
      firstLabel: monLabel(lo), lastLabel: monLabel(hi),
    }
  }

  const riskOf = (c: Client): Risk => {
    const all = escByClient.get(c.company_name) || []
    const posFb = all.filter(isPosFb)                          // positive feedback logged in the escalation report
    const list = all.filter(e => !isPosFb(e) && !isJunk(e))    // genuine escalations only
    const byMonth: Record<string, number> = {}
    list.forEach(e => { const k = ym(e.tracking_date); if (k) byMonth[k] = (byMonth[k] || 0) + 1 })
    const maxKey = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a])[0]
    const maxMonth = maxKey ? byMonth[maxKey] : 0
    const cutoff = monthsAgoYM(2)
    const recentMajor = list.filter(e => (ym(e.tracking_date) >= cutoff) && /major|critical|high|sev/i.test(`${e.business_impact || ''} ${e.escalation_type || ''}`))
    // A negative signal stops counting once someone has ruled on it in Critical
    // Escalations — dismissed ("not our escalation") or closed out as fixed/positive.
    // A thread marked Unresolved is in neither set, so it still counts: that is the
    // whole point of the Unresolved tag.
    const judged = (s: EmailSignal) => !!s.thread_id && (verdicts.dismissed.has(s.thread_id) || verdicts.settled.has(s.thread_id))
    const negSigs = (sigByClient.get(c.company_name) || []).filter(s => (sentBucket(s.sentiment) === 'Negative' || /risk|escalat|churn/i.test(s.signal_type || '')) && !judged(s))
    // Someone has looked at this client's escalation and it is STILL broken. Worth calling
    // out in its own colour: it is not an untriaged alert, it is a standing promise to fix.
    const unresolved = negSigs.some(s => !!s.thread_id && verdicts.unresolved.has(s.thread_id))
    const posSigs = (sigByClient.get(c.company_name) || []).filter(s => sentBucket(s.sentiment) === 'Positive')
    const posFbTbl = posFbByClient.get(c.company_name) || []
    const lb = ym(c.last_booking_month)
    const gap = !!lb && lb < monthsAgoYM(2) && (c.ltv_usd || 0) > 0

    // Date-based recovery: compare the newest *negative* event (a genuine escalation or a
    // negative email signal) against the newest *positive* event (positive email praise,
    // positive feedback logged in the escalation report, or a positive feedback-table row).
    // If the latest positive lands AFTER the latest negative, the client has bounced back —
    // stale escalation history no longer defines their standing, so we show green.
    const d = (s?: string) => (s || '').slice(0, 10)
    const lastNeg = [...list.map(e => d(e.tracking_date)), ...negSigs.map(s => d(s.source_date))].filter(Boolean).sort().pop() || ''
    const lastPos = [...posSigs.map(s => d(s.source_date)), ...posFb.map(e => d(e.tracking_date)), ...posFbTbl.map(f => d(f.added_date))].filter(Boolean).sort().pop() || ''
    const recovered = !!lastPos && !!lastNeg && lastPos > lastNeg
    const recoveryNote = recovered ? `Recovered — positive feedback on ${lastPos} came after the last escalation (${lastNeg}).` : undefined

    const reasons: string[] = []
    let level: Risk['level'] = ''
    // A recovery (latest sentiment event is positive) suppresses escalation/email-sensed risk.
    if (!recovered) {
      if (maxMonth > 2) { level = 'At risk'; reasons.push(`${maxMonth} escalations in ${monLabel(maxKey)}`) }
      if (recentMajor.length) { level = 'At risk'; reasons.push(`${recentMajor.length} major escalation${recentMajor.length > 1 ? 's' : ''} in the last 2 months`) }
      if (!level) {
        if (negSigs.length) { level = 'Watch'; reasons.push('client sounding frustrated over email') }
        if (list.length) { level = 'Watch'; reasons.push(`${list.length} escalation${list.length > 1 ? 's' : ''} on record`) }
        if (gap) { level = 'Watch'; reasons.push(`no new booking since ${monLabel(lb)} — contract may be winding down`) }
      }
    }
    if (unresolved) { level = level || 'Watch'; reasons.unshift('escalation marked Unresolved — looked at, still broken') }
    // A revenue collapse stands on its own — it applies even to a "recovered" client,
    // because a happy client who has stopped spending is still a client walking away.
    const dip = dipByClient.get(norm(c.company_name))
    if (dip) {
      level = level || 'Watch'
      reasons.push(dip.stopped
        ? `billing stopped — ${fmtUsd(dip.prior)} over ${dipWindow.split(' vs ')[1]}, nothing since`
        : `revenue down ${dip.dropPct}% — ${fmtUsd(dip.prior)} → ${fmtUsd(dip.last)} (${dipWindow})`)
    }
    return { level, reasons, escs: list, posFb, negSigs, recovered, recoveryNote, unresolved, dip }
  }

  // Genuine risk wins; a date-based recovery or positive feedback (with no later negative)
  // shows green; else the recorded sentiment.
  const statusOf = (c: Client) => { const r = riskOf(c); if (r.level) return r.level; if (r.recovered || (r.posFb.length && !r.negSigs.length)) return 'Positive'; return sentBucket(c.sentiment) }

  // Filter options come from the owner sets, so picking a PM finds the clients they
  // share as well as the ones the record hands them outright.
  const owners = useMemo(() => uniq([...ownerMap.values()].flat()), [ownerMap])
  const geos = uniq(clients.map(c => c.geo))
  const industries = uniq(clients.map(c => c.industry))
  const aiCount = clients.filter(c => c.ai_focus).length
  const statCount = (b: string) => allClients.filter(c => statusOf(c) === b).length
  // recent-activity cutoff (last 14 days) for the quick "🔥 Active discussions" toggle
  const recentCutoff = useMemo(() => { const d = new Date(now); d.setDate(d.getDate() - 14); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, [])
  // client count per industry (drives the clickable breakdown chart)
  const indCounts = useMemo(() => {
    const m: Record<string, number> = {}
    clients.forEach(c => { const k = c.industry || 'Other / Unclassified'; m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [clients])
  const maxIndCount = indCounts[0]?.[1] || 1

  // ---- Client-Backup directory -------------------------------------------------
  // Filtered with the same search/industry/GEO controls as the client table, plus
  // BU and a "already a revenue client" filter. Nothing here is deduplicated away:
  // a directory row that matches a booked client is flagged rather than hidden, so
  // the same company can never be counted twice across the two views.
  const dirIndustries = useMemo(() => uniq(dir.map(d => d.industry)), [dir])
  const dirGeos = useMemo(() => uniq(dir.map(d => d.geo)), [dir])
  const dirBus = useMemo(() => uniq(dir.map(d => d.bu)), [dir])
  const dirRows = useMemo(() => {
    const needle = q.toLowerCase()
    return dir
      .filter(d => !needle || `${d.company_name} ${d.domain || ''} ${d.am_name || ''}`.toLowerCase().includes(needle))
      .filter(d => keeps(ind, d.industry || 'Other / Unclassified'))
      .filter(d => keeps(geo, d.geo))
      .filter(d => keeps(bu, d.bu))
      .filter(d => !linked || (linked === 'yes' ? d.is_revenue_client : !d.is_revenue_client))
      .filter(d => !aiStance || d.ai_stance === aiStance)
      .sort((a, b) => a.company_name.toLowerCase().localeCompare(b.company_name.toLowerCase()))
  }, [dir, q, ind, geo, bu, linked, aiStance])
  // The window the LTV figures actually cover. LTV is all-time billed revenue per
  // client — every booking row we hold, not a rolling 12 months — so the honest way to
  // present it is to say which months we hold. Computed from the loaded revenue rows.
  const ltvWindow = useMemo(() => {
    const ms = bookings.map(b => ym(b.booking_month)).filter(Boolean).sort()
    if (!ms.length) return null
    const lo = ms[0], hi = ms[ms.length - 1]
    const a = ymIdx(lo), b = ymIdx(hi)
    return { lo, hi, months: a != null && b != null ? b - a + 1 : 0 }
  }, [bookings])
  // How each directory row's industry was arrived at — drives the legend above the table.
  const dirSrc = useMemo(() => ({
    verified: dir.filter(d => d.industry_source === 'website' && d.industry_confidence !== 'low').length,
    thin: dir.filter(d => d.industry_source === 'website' && d.industry_confidence === 'low').length,
    sheet: dir.filter(d => d.industry_source !== 'website').length,
  }), [dir])
  const dirAi = useMemo(() => ({
    native: dir.filter(d => d.ai_stance === 'native').length,
    adjacent: dir.filter(d => d.ai_stance === 'adjacent').length,
    unknown: dir.filter(d => !d.ai_stance).length,
  }), [dir])
  const dirIndCounts = useMemo(() => {
    const m: Record<string, number> = {}
    dir.forEach(d => { const k = d.industry || 'Other / Unclassified'; m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [dir])

  // ---- Automation demand we have already heard ---------------------------------
  // The ⚡ AI-native flag is NOT an opportunity signal — it was set by a one-off
  // classification pass and means "this client's own business is AI" (accessiBe,
  // Sensen.ai, Omniscient Neurotechnology). Only 13 booked clients carry it, and
  // reading that as the size of the automation opportunity badly understates it.
  //
  // This is the honest version: scan every quote line and every logged conversation
  // for automation-shaped language, and surface the clients who have ALREADY asked us
  // for this kind of work. Evidence-backed, so each name comes with the line that
  // matched rather than a score nobody can check.
  const DEMAND_RE = /(automat|chatbot|integration|zapier|make\.com|\bn8n\b|dashboard|spreadsheet|google sheet|workflow|\bapi\b|klaviyo|gohighlevel)/i
  const demandByCompany = useMemo(() => {
    const m = new Map<string, { company: string; evidence: string[] }>()
    const add = (company?: string, ev?: string) => {
      const name = (company || '').trim()
      if (!name || !ev) return
      const k = name.toLowerCase()
      if (!m.has(k)) m.set(k, { company: name, evidence: [] })
      const bucket = m.get(k)!
      const line = ev.trim().slice(0, 90)
      if (line && !bucket.evidence.includes(line)) bucket.evidence.push(line)
    }
    for (const o of allOpps) {
      const hay = `${o.source_subject || ''} ${o.summary || ''} ${o.gist || ''}`
      if (DEMAND_RE.test(hay)) add(o.company_name, o.source_subject || o.summary)
    }
    for (const s of signals) {
      const hay = `${s.source_subject || ''} ${s.summary || ''}`
      if (DEMAND_RE.test(hay)) add(s.company_name, s.source_subject || s.summary)
    }
    return m
  }, [allOpps, signals])
  // Attach each demand hit to a directory industry, so the per-industry rows can show
  // "N companies here have already asked". Matched on the same name keys the rest of
  // this page uses, so "Enphase (Solargraf)" still lands on the right row.
  const demandByIndustry = useMemo(() => {
    const tagged = [...demandByCompany.values()].map(d => ({ d, keys: nameKeys(d.company) }))
    const out: Record<string, { company: string; evidence: string[] }[]> = {}
    const seen = new Set<string>()
    for (const entry of tagged) {
      const hit = dir.find(x => keyMatch(nameKeys(x.company_name), entry.keys))
        || clients.find(x => keyMatch(nameKeys(x.company_name), entry.keys))
      const k = hit ? ((hit as ClientDirectory | Client).industry || 'Other / Unclassified') : ''
      if (!k) continue
      if (seen.has(entry.d.company.toLowerCase())) continue
      seen.add(entry.d.company.toLowerCase())
      ;(out[k] = out[k] || []).push(entry.d)
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => b.evidence.length - a.evidence.length)
    return out
  }, [demandByCompany, dir, clients])

  // ---- Automation opportunity rows ---------------------------------------------
  // One row per directory industry: how many companies sit in it, how many of those
  // already buy from us, and the lifetime value those buyers represent. Sorted by
  // company count, because the pitch is "here is the size of the addressable list",
  // not "here is where the revenue already is".
  const autoRows = useMemo(() => {
    const ltv: Record<string, number> = {}
    clients.forEach(c => { const k = c.industry || 'Other / Unclassified'; ltv[k] = (ltv[k] || 0) + (Number(c.ltv_usd) || 0) })
    const m: Record<string, { companies: number; booked: number }> = {}
    dir.forEach(d => {
      const k = d.industry || 'Other / Unclassified'
      if (!m[k]) m[k] = { companies: 0, booked: 0 }
      m[k].companies++
      if (d.is_revenue_client) m[k].booked++
    })
    // AI stance per industry, read across the WHOLE directory rather than the booked
    // clients only — this is what the old ⚡ flag could never do.
    const aiNative: Record<string, number> = {}
    const aiAdj: Record<string, number> = {}
    dir.forEach(d => {
      const k = d.industry || 'Other / Unclassified'
      if (d.ai_stance === 'native') aiNative[k] = (aiNative[k] || 0) + 1
      else if (d.ai_stance === 'adjacent') aiAdj[k] = (aiAdj[k] || 0) + 1
    })
    return Object.entries(m)
      .map(([name, v]) => ({ name, ...v, ltv: ltv[name] || 0, book: AUTOMATION_PLAYS[name], demand: demandByIndustry[name] || [], aiNative: aiNative[name] || 0, aiAdj: aiAdj[name] || 0 }))
      .filter(r => r.book)
      .sort((a, b) => b.companies - a.companies)
  }, [dir, clients, demandByIndustry])
  const autoTotals = useMemo(() => autoRows.reduce((a, r) => ({
    companies: a.companies + r.companies, booked: a.booked + r.booked,
    demand: a.demand + r.demand.length, aiNative: a.aiNative + r.aiNative,
  }), { companies: 0, booked: 0, demand: 0, aiNative: 0 }), [autoRows])
  // What "AI & Automation" has actually billed, and how concentrated it is. Computed
  // rather than written down, so the argument below can't quietly go stale — and the
  // concentration number is the point: one client currently IS this service line.
  const aiBook = useMemo(() => {
    const rows = bookings.filter(b => /ai\s*&?\s*automation/i.test(b.service_name || ''))
    const total = rows.reduce((s, b) => s + (Number(b.booking_amount) || 0), 0)
    const byClient: Record<string, number> = {}
    rows.forEach(b => { const k = displayName(b.company_name) || '—'; byClient[k] = (byClient[k] || 0) + (Number(b.booking_amount) || 0) })
    const top = Object.entries(byClient).sort((a, b) => b[1] - a[1])[0]
    return { total, count: rows.length, topName: top?.[0] || '', topShare: total > 0 && top ? Math.round((top[1] / total) * 100) : 0 }
  }, [bookings])

  const rows = useMemo(() => {
    // date-range filter runs on each client's last-activity date; a client with no
    // activity is excluded whenever any date filter (range or "recent") is active.
    const lo = recentOnly ? (from && from > recentCutoff ? from : recentCutoff) : from
    const hi = to
    let result = allClients
      .filter(c => !justMine || mine.ownsClient(c.company_name))
      .filter(c => (c.company_name + ' ' + displayName(c.company_name)).toLowerCase().includes(q.toLowerCase()))
      .filter(c => keeps(ind, c.industry || 'Other / Unclassified'))
      .filter(c => !stat || statusOf(c) === stat)
      .filter(c => !aiOnly || c.ai_focus)
      .filter(c => !dipOnly || dipByClient.has(norm(c.company_name)))
      .filter(c => owner.length === 0 || ownersOf(c.company_name).some(p => owner.includes(p)) || keeps(owner, c.pc_sme))
      .filter(c => keeps(geo, c.geo))
      .filter(c => {
        if (!lo && !hi) return true
        const d = lastActivity(c)
        if (!d) return false
        if (lo && d < lo) return false
        if (hi && d > hi) return false
        return true
      })

    // Apply sorting
    result = [...result].sort((a, b) => {
      let aVal: string | number, bVal: string | number
      switch (sortBy) {
        case 'name': aVal = a.company_name.toLowerCase(); bVal = b.company_name.toLowerCase(); break
        case 'ltv': aVal = a.ltv_usd || 0; bVal = b.ltv_usd || 0; break
        case 'owner': aVal = (a.pc_sme || '').toLowerCase(); bVal = (b.pc_sme || '').toLowerCase(); break
        case 'geo': aVal = (a.geo || '').toLowerCase(); bVal = (b.geo || '').toLowerCase(); break
        case 'activity': aVal = lastActivity(a) || ''; bVal = lastActivity(b) || ''; break
        default: aVal = 0; bVal = 0
      }
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })

    return result
  }, [allClients, q, ind, stat, aiOnly, owner, geo, from, to, recentOnly, recentCutoff, sortBy, sortAsc, escByClient, sigByClient, oppByClient, verdicts, dipOnly, dipByClient, justMine, mine])

  // ---- Paging ------------------------------------------------------------------
  // Any change to what is being listed sends you back to page 1 — otherwise you filter
  // 2,000 rows down to 12 while sitting on page 8 and the table looks empty.
  const total = mode === 'clients' ? rows.length : dirRows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => { setPage(1) }, [mode, q, ind, stat, aiOnly, dipOnly, owner, geo, bu, linked, aiStance, from, to, recentOnly, sortBy, sortAsc])
  const safePage = Math.min(page, pageCount)
  const pageRows = useMemo(() => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [rows, safePage])
  const pageDirRows = useMemo(() => dirRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [dirRows, safePage])
  const firstShown = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(safePage * PAGE_SIZE, total)
  // Page numbers with ellipses: always first and last, plus a window around the current
  // page, so 41 pages of directory don't render 41 buttons.
  const pageNums = useMemo(() => {
    const out: (number | '…')[] = []
    for (let i = 1; i <= pageCount; i++) {
      if (i === 1 || i === pageCount || Math.abs(i - safePage) <= 1) out.push(i)
      else if (out[out.length - 1] !== '…') out.push('…')
    }
    return out
  }, [pageCount, safePage])
  const Pager = () => total === 0 ? null : (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-mav-line text-xs">
      <span className="text-mav-muted">Showing {firstShown.toLocaleString()}–{lastShown.toLocaleString()} of {total.toLocaleString()}</span>
      {pageCount > 1 && (
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
            className="px-2 py-1 rounded border border-mav-line text-mav-muted hover:text-mav-fg disabled:opacity-30 disabled:hover:text-mav-muted">← Prev</button>
          {pageNums.map((n, i) => n === '…'
            ? <span key={`e${i}`} className="px-1 text-mav-muted">…</span>
            : <button key={n} onClick={() => setPage(n)}
                className={`px-2.5 py-1 rounded border transition-colors ${n === safePage ? 'bg-mav-fill text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>{n}</button>)}
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}
            className="px-2 py-1 rounded border border-mav-line text-mav-muted hover:text-mav-fg disabled:opacity-30 disabled:hover:text-mav-muted">Next →</button>
        </div>
      )}
    </div>
  )

  const handleSort = (field: 'name' | 'ltv' | 'owner' | 'geo' | 'activity') => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(field)
      setSortAsc(false)
    }
  }

  const getSortIndicator = (field: string) => {
    if (sortBy !== field) return ' ↕'
    return sortAsc ? ' ↑' : ' ↓'
  }

  return (
    <div>
      <Header title="Client 360" subtitle="Booked clients, sorted by latest action. Click a client for its live discussions — escalations, open quotes & email conversations." />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {mine.canScope && (
          <MineFilter on={justMine} onChange={setJustMine} label="My clients"
            hidden={allClients.filter(c => !mine.ownsClient(c.company_name)).length} />
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className={`${sel} w-52`} />
        <MultiSelect label="All industries" options={mode === 'clients' ? industries : dirIndustries} selected={ind} onChange={setInd} className="w-44" />
        <MultiSelect label="All owners" options={owners} selected={owner} onChange={setOwner} className="w-40" />
        <MultiSelect label="All GEOs" options={mode === 'clients' ? geos : dirGeos} selected={geo} onChange={setGeo} className="w-36" />
        {mode === 'directory' && <MultiSelect label="All BUs" options={dirBus} selected={bu} onChange={setBu} className="w-36" />}
        {mode === 'directory' && <select value={linked} onChange={e => setLinked(e.target.value as '' | 'yes' | 'no')} className={sel}><option value="">Booked &amp; not booked</option><option value="yes">Booked revenue</option><option value="no">No revenue yet</option></select>}
        {mode === 'directory' && <select value={aiStance} onChange={e => setAiStance(e.target.value as '' | 'native' | 'adjacent')} title="Classified from each company's own site title and meta description, already cached on the directory row" className={sel}><option value="">Any AI stance</option><option value="native">AI-native ({dirAi.native})</option><option value="adjacent">AI/automation positioning ({dirAi.adjacent})</option></select>}
        <select value={stat} onChange={e => setStat(e.target.value)} title="Two things sit in one list. “Live” is computed here and now from escalations, email tone and booking gaps. “Recorded” is the sentiment stored on the client record by the nightly sentiment pass — a client can carry an at-risk sentiment without anything live against them today." className={sel}>
          <option value="">All health</option>
          <option value="At risk">🔴 At risk — live ({statCount('At risk')})</option>
          <option value="Watch">🟠 Watch — live ({statCount('Watch')})</option>
          <option value="Negative">🔴 At risk — recorded ({statCount('Negative')})</option>
          <option value="Positive">🟢 Positive ({statCount('Positive')})</option>
          <option value="Neutral">🟡 Neutral ({statCount('Neutral')})</option>
        </select>
        <button onClick={() => setAiOnly(v => !v)} title="Booked clients whose OWN business is AI (accessiBe, Sensen.ai, Omniscient Neurotechnology…). This describes the client — it is not our automation pipeline. For that, see 'Automation opportunities by industry' below the table." className={`text-sm px-3 py-2 rounded-md border transition-colors ${aiOnly ? 'bg-mav-fill text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>⚡ AI-native clients{aiCount ? ` (${aiCount})` : ''}</button>
        <button onClick={() => setDipOnly(v => !v)} title={`Billing at least $2,000 across ${dipWindow.split(' vs ')[1]}, then halved or worse across ${dipWindow.split(' vs ')[0]}. The month still billing is excluded. A happy client can appear here — that is the point: it is a spend signal, not a sentiment one.`} className={`text-sm px-3 py-2 rounded-md border transition-colors ${dipOnly ? 'bg-orange-500/20 text-orange-300 border-orange-500/50 font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>📉 Revenue dip{dipByClient.size ? ` (${dipByClient.size})` : ''}</button>
        <button onClick={() => setRecentOnly(v => !v)} title="Clients with a logged email conversation, an escalation or an open quote dated in the last 14 days. It filters the table to accounts something has actually happened on recently — the quiet ones drop out." className={`text-sm px-3 py-2 rounded-md border transition-colors ${recentOnly ? 'bg-mav-fill text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>🔥 Active discussions <span className="opacity-60">(14d)</span></button>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-mav-line overflow-hidden">
            <button onClick={() => setMode('clients')} className={`text-xs px-3 py-2 transition-colors ${mode === 'clients' ? 'bg-mav-fill text-black font-medium' : 'text-mav-muted hover:text-mav-fg'}`}>Revenue clients ({clients.length})</button>
            <button onClick={() => setMode('directory')} className={`text-xs px-3 py-2 transition-colors ${mode === 'directory' ? 'bg-mav-fill text-black font-medium' : 'text-mav-muted hover:text-mav-fg'}`}>Full directory ({dir.length})</button>
          </div>
          <span className="text-xs text-mav-muted">{mode === 'clients' ? rows.length : dirRows.length} shown</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-mav-muted">Activity between</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
        <span className="text-xs text-mav-muted">and</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
        {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} className="text-xs text-mav-muted hover:text-mav-fg">✕ clear dates</button>}
        <span className="text-xs text-mav-muted ml-auto">💬 email · ⚠ escalation · 💰 quote — sorted by latest action</span>
      </div>

      <p className="text-xs text-mav-muted mb-4"><span className="text-red-300">At risk</span> = &gt;2 escalations in a month or a major escalation in the last 2 months. <span className="text-orange-300">Watch</span> = email-sensed frustration, an older escalation, a contract winding down (no recent booking), or a <span className="text-orange-300">📉 revenue dip</span> — billing halved or worse across the last two completed months on a client who was spending at least $2,000. A dip is a spend signal, not a mood one: a perfectly happy client can show it, which is why it is worth catching early. Positive feedback logged in the escalation report (tagged &ldquo;Not an escalation&rdquo;) is excluded from risk and shown in green. The health filter holds two different things: <span className="text-red-300">At risk / Watch — live</span> is worked out here from escalations, email tone and booking gaps, while <span className="text-red-300">At risk — recorded</span> is the sentiment stored on the client record. A negative email signal stops counting in either once it is dismissed or closed out on <span className="text-red-300">Critical Escalations</span>; one tagged <span className="text-amber-300">⚑ Unresolved</span> there keeps counting and the client is highlighted in amber here. Risk is date-aware: if a client&rsquo;s <span className="text-green-300">latest</span> sentiment event is positive feedback that came <em>after</em> their last escalation, they count as recovered and show green. Click a row for the full picture. Click column headers to sort.</p>

      <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <button onClick={() => setShowInd(v => !v)} className="text-sm font-medium inline-flex items-center gap-1.5 hover:text-mav-yellow transition-colors">
            <span className="text-xs text-mav-muted">{showInd ? '▾' : '▸'}</span>Clients by industry
            {/* An active filter has to be visible even when the panel is shut, or you
                are looking at a filtered table with nothing saying why. */}
            {!showInd && ind.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-mav-yellow/15 text-mav-yellow font-normal">{indLabel}</span>}
          </button>
          <div className="text-xs text-mav-muted">
            {(mode === 'clients' ? clients.length : dir.length)} total
            {showInd
              ? <> · click a bar to filter{ind.length ? ` · showing ${indLabel}` : ''} · <button onClick={() => setShowInd(false)} className="hover:text-mav-fg underline underline-offset-2">hide</button></>
              : <> · <button onClick={() => setShowInd(true)} className="hover:text-mav-fg underline underline-offset-2">show</button></>}
            {!showInd && ind.length > 0 && <> · <button onClick={() => setInd([])} className="hover:text-mav-fg underline underline-offset-2">clear filter</button></>}
          </div>
        </div>
        <div className={`space-y-1.5 ${showInd ? '' : 'hidden'}`}>
          {(mode === 'clients' ? indCounts : dirIndCounts).map(([name, n]) => {
            const active = ind.includes(name)
            const pct = Math.round((n / (mode === 'clients' ? maxIndCount : (dirIndCounts[0]?.[1] || 1))) * 100)
            return (
              <button key={name} onClick={() => setInd(active ? ind.filter(x => x !== name) : [...ind, name])} title={`${n} client${n === 1 ? '' : 's'} — click to ${active ? 'clear' : 'filter'}`}
                className="w-full flex items-center gap-3 text-left group py-0.5">
                <span className={`w-44 shrink-0 truncate text-xs ${active ? 'text-mav-yellow font-medium' : 'text-mav-muted group-hover:text-mav-fg'}`}>{name}</span>
                <span className="flex-1 h-4 rounded bg-mav-dark overflow-hidden">
                  <span className={`block h-full rounded ${active ? 'bg-mav-yellow' : 'bg-mav-yellow/40 group-hover:bg-mav-yellow/70'}`} style={{ width: `${pct}%` }} />
                </span>
                <span className={`w-8 text-right text-xs font-semibold ${active ? 'text-mav-yellow' : 'text-mav-fg'}`}>{n}</span>
              </button>
            )
          })}
        </div>
        {ind.length > 0 && <button onClick={() => setInd([])} className="mt-3 text-xs text-mav-muted hover:text-mav-fg">✕ Clear industry filter</button>}
      </div>

      {mode === 'clients' ? (
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
              {['', 
                <button key="client" onClick={() => handleSort('name')} className="hover:text-mav-fg cursor-pointer">Client{getSortIndicator('name')}</button>,
                'Industry',
                <button key="geo" onClick={() => handleSort('geo')} className="hover:text-mav-fg cursor-pointer">GEO{getSortIndicator('geo')}</button>,
                <button key="owner" onClick={() => handleSort('owner')} className="hover:text-mav-fg cursor-pointer">Owner{getSortIndicator('owner')}</button>,
                'Health',
                <button key="activity" onClick={() => handleSort('activity')} className="hover:text-mav-fg cursor-pointer">Last activity{getSortIndicator('activity')}</button>,
                'Escal.',
                'Convos',
                <button key="ltv" onClick={() => handleSort('ltv')} title={`All-time billed revenue for this client${ltvWindow ? ` — every booking we hold, ${monLabel(ltvWindow.lo)} to ${monLabel(ltvWindow.hi)} (${ltvWindow.months} months)` : ''}. Not a rolling 12 months and not a forecast.`} className="hover:text-mav-fg cursor-pointer">LTV{getSortIndicator('ltv')}</button>
              ].map((h, i) => <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {pageRows.map(c => {
                const r = riskOf(c); const st = r.level || sentBucket(c.sentiment); const nc = (sigByClient.get(c.company_name) || []).length
                const act = activityOf(c); const isRecent = !!act.last && act.last >= recentCutoff
                // Amber wins over the risk tint: an Unresolved tag is a human's call and
                // should be findable by eye when scanning the list.
                const rowBg = r.unresolved ? 'bg-amber-500/10' : r.level === 'At risk' ? 'bg-red-500/5' : r.level === 'Watch' ? 'bg-orange-500/5' : c.ai_focus ? 'bg-mav-yellow/5' : ''
                return (
                  <tr key={c.company_name} onClick={() => setSelC(c)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${rowBg}`}>
                    <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${r.unresolved ? 'bg-amber-400' : dotCls(st)}`} title={r.unresolved ? 'Escalation marked Unresolved on Critical Escalations' : undefined} /></td>
                    <td className="px-4 py-3">{displayName(c.company_name)}{r.unresolved && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold whitespace-nowrap" title="Someone looked at this client's escalation and it is still broken">⚑ Unresolved</span>}{r.dip && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-semibold whitespace-nowrap" title={`${fmtUsd(r.dip.prior)} → ${fmtUsd(r.dip.last)} (${dipWindow})`}>📉 {r.dip.stopped ? 'Billing stopped' : `Revenue −${r.dip.dropPct}%`}</span>}{c.ai_focus && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold whitespace-nowrap">⚡ AI</span>}{c.website && <div className="text-xs text-mav-muted">{c.website}</div>}</td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{c.industry || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.geo}</td>
                    <td className="px-4 py-3 text-mav-muted">
                      {(() => {
                        const os = ownersOf(c.company_name)
                        if (!os.length) return c.pc_sme || '—'
                        // The one with the most revenue leads; the rest are named in the
                        // tooltip rather than wrapped over three lines in a table cell.
                        return <span title={os.join(', ')}>{os[0]}{os.length > 1 && <span className="text-mav-yellow/80"> +{os.length - 1}</span>}</span>
                      })()}
                    </td>
                    <td className="px-4 py-3"><button onClick={e => { e.stopPropagation(); setStat(b => b === st ? '' : st) }} className={`text-xs px-2 py-1 rounded-full hover:ring-1 hover:ring-mav-yellow/50 ${tone(st)}`}>{st || '—'}</button></td>
                    <td className="px-4 py-3 whitespace-nowrap">{act.last
                      ? <span className="inline-flex items-center gap-1.5"><span className={isRecent ? 'text-mav-fg' : 'text-mav-muted'}>{act.last}</span><span className="text-[11px] tracking-tight">{act.convo ? '💬' : ''}{act.esc ? '⚠' : ''}{act.quote ? '💰' : ''}</span>{isRecent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-mav-yellow" title="active in the last 14 days" />}</span>
                      : <span className="text-xs text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{r.escs.length ? <span className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-400 font-medium">⚠ {r.escs.length}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{nc ? <span className="text-xs px-2 py-1 rounded-full bg-blue-500/15 text-blue-400 font-medium">💬 {nc}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pager />
      </div>
      ) : (
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        {/* Legend for the marks in the Industry column. These were previously explained
            only on hover, which meant nobody knew the tick was there to be hovered. */}
        <div className="px-4 py-3 border-b border-mav-line flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="text-mav-muted">How each industry was decided:</span>
          <span><span className="text-mav-fg">✓</span> <span className="text-mav-muted">read from the company&rsquo;s own website &mdash; confirmed ({dirSrc.verified.toLocaleString()})</span></span>
          <span><span className="text-mav-fg">◌</span> <span className="text-mav-muted">read from the website, but the page was thin &mdash; worth a check ({dirSrc.thin.toLocaleString()})</span></span>
          <span><span className="text-mav-fg">no mark</span> <span className="text-mav-muted">taken from the sheet, never verified against the site ({dirSrc.sheet.toLocaleString()})</span></span>
          <span className="text-mav-muted">Smaller grey text under the group name is the granular industry it was merged from.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
              {['Client', 'Industry', 'AI stance', 'BU', 'GEO', 'Account manager', 'Head', 'Type', 'Technology'].map((h, i) => (
                <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {pageDirRows.map(d => (
                <tr key={d.id} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 ${d.is_revenue_client ? 'bg-mav-yellow/5' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{d.company_name}</span>
                      {d.is_revenue_client && <span title={`Booked revenue as "${d.matched_client}"`} className="text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold whitespace-nowrap">£ booked</span>}
                    </div>
                    {d.domain && <div className="text-xs text-mav-muted">{d.domain}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={d.industry ? '' : 'text-mav-muted'}>{d.industry || '—'}</span>
                    {d.industry_source === 'website' && <span title={d.industry_confidence === 'low' ? 'Read from the website, but the page was thin — worth a check' : 'Confirmed by reading the company website'} className="ml-2 text-[11px] text-mav-muted">{d.industry_confidence === 'low' ? '◌' : '✓'}</span>}
                    {d.industry_detail && d.industry_detail !== d.industry && <div className="text-xs text-mav-muted">{d.industry_detail}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {d.ai_stance === 'native' ? <span title={d.ai_evidence ? `Matched on: “${d.ai_evidence}”` : ''} className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">AI-native</span>
                      : d.ai_stance === 'adjacent' ? <span title={d.ai_evidence ? `Matched on: “${d.ai_evidence}”` : ''} className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">AI/automation</span>
                      : d.ai_stance === 'none' ? <span className="text-mav-muted text-xs">—</span>
                      : <span title="No site text was captured for this company, so its stance is unknown rather than no" className="text-mav-muted text-xs">?</span>}
                  </td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{d.bu || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted">{d.geo || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{d.am_name || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{d.head || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted">{d.direct_agency || '—'}</td>
                  <td className="px-4 py-3 text-mav-muted text-xs max-w-[16rem] truncate" title={d.technology || ''}>{d.technology || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager />
      </div>
      )}

      {/* ---- Automation opportunities by industry --------------------------------
          Sits below the client list because it reads off the same directory: every
          industry group, what still runs on people and spreadsheets in it, and the
          builds we could sell against that. The counts are live; the plays are a
          fixed catalogue in lib/automation-plays.ts. */}
      <div className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
          <button onClick={() => setShowAuto(v => !v)} className="text-lg font-semibold inline-flex items-center gap-2 hover:text-mav-yellow transition-colors">
            <span className="text-xs text-mav-muted">{showAuto ? '▾' : '▸'}</span>⚡ Automation opportunities by industry
          </button>
          <div className="text-xs text-mav-muted">
            {autoTotals.companies.toLocaleString()} companies in the directory · {autoTotals.booked} already buying · {autoRows.length} industries
            {' · '}
            <button onClick={() => setShowAuto(v => !v)} className="hover:text-mav-fg underline underline-offset-2">{showAuto ? 'hide' : 'show'}</button>
          </div>
        </div>
        {showAuto && <>
        <p className="text-xs text-mav-muted mb-4 max-w-4xl leading-relaxed">
          Where each industry still runs on a person, a spreadsheet and an inbox — and what Mavlers.ai could sell against it.
          {aiBook.count > 0 && <>Booked <span className="text-mav-yellow">AI &amp; Automation</span> revenue is <span className="text-mav-fg">{fmtUsd(aiBook.total)} across {aiBook.count} booking{aiBook.count === 1 ? '' : 's'}</span>
          {aiBook.topName && <>, and <span className="text-mav-fg">{aiBook.topShare}% of it is one client</span> ({aiBook.topName} — timesheet sync, warranty accounting, a nightly SAP cleanse, an AI translation plugin)</>}. </>}
          Against a directory of {autoTotals.companies.toLocaleString()} companies who already trust us with their websites, that is the gap this section is about.
          Click an industry to open its plays.
        </p>
        <p className="text-[11px] text-mav-muted mb-4 max-w-4xl leading-relaxed">
          <span className="text-mav-fg">How the LTV figure on each industry is calculated:</span> it is the sum of every dollar we have billed
          the <em>already-booked</em> clients in that industry &mdash; all-time, not a rolling window, and not a projection for the whole industry.
          It comes from the bookings master (all business units), plus any client that appears only in the web-revenue feed, so nothing is double-counted.
          {ltvWindow && <> The revenue we hold runs <span className="text-mav-fg">{monLabel(ltvWindow.lo)} &rarr; {monLabel(ltvWindow.hi)}</span> ({ltvWindow.months} months),
          so &ldquo;lifetime&rdquo; means that window &mdash; a client who spent with us before {monLabel(ltvWindow.lo)} will read low here.</>}
          {' '}The {autoTotals.companies.toLocaleString()}-company count beside it is the whole directory, booked or not, which is why a big list can sit next to a small LTV.
        </p>

        {/* The four numbers that size this, from widest to warmest. The last one is the
            trap: ⚡ AI-native counts clients whose OWN business is AI — it is not the
            opportunity, and reading it as such understates the list by two orders of
            magnitude. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5">
          {[
            { n: autoTotals.companies.toLocaleString(), label: 'Addressable', sub: 'companies in the directory, all with an industry playbook below', cls: 'text-mav-fg' },
            { n: autoTotals.booked.toLocaleString(), label: 'Warm', sub: 'already buying from us — we hold the relationship and built the site', cls: 'text-mav-yellow' },
            { n: autoTotals.demand.toLocaleString(), label: 'Demand already heard', sub: 'have asked us for automation, integration or dashboard work in a quote or a conversation', cls: 'text-green-400' },
            { n: `${dirAi.native} + ${dirAi.adjacent}`, label: 'AI-native / AI-positioned', sub: `across the whole directory, read from each company's own site text — ${dirAi.unknown} more have no site text and are unknown, not no`, cls: 'text-blue-400' },
          ].map(s => (
            <div key={s.label} className="bg-mav-panel border border-mav-line rounded-xl p-4">
              <div className={`text-2xl font-semibold ${s.cls}`}>{s.n}</div>
              <div className="text-xs font-medium mt-0.5">{s.label}</div>
              <div className="text-[11px] text-mav-muted leading-relaxed mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-mav-muted">Filter by build type:</span>
          {(Object.keys(PLAY_TYPE_TONE) as PlayType[]).map(t => (
            <button key={t} onClick={() => setPlayType(playType === t ? '' : t)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${playType === t ? 'bg-mav-fill text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>{t}</button>
          ))}
          {playType && <button onClick={() => setPlayType('')} className="text-xs text-mav-muted hover:text-mav-fg">✕ clear</button>}
        </div>

        <div className="space-y-2">
          {autoRows.map(r => {
            const open = openPlayInd === r.name
            const plays = playType ? r.book.plays.filter(p => p.type === playType) : r.book.plays
            if (playType && !plays.length) return null
            const pct = Math.round((r.companies / (autoRows[0]?.companies || 1)) * 100)
            return (
              <div key={r.name} className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
                <button onClick={() => setOpenPlayInd(open ? '' : r.name)} className="w-full text-left px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-sm font-medium ${open ? 'text-mav-yellow' : ''}`}>{r.name}</span>
                    <span className="text-xs text-mav-muted" title={`${r.companies} companies in the directory · ${r.booked} of them have booked revenue · ${fmtUsd(r.ltv)} is all-time billings from those ${r.booked}, not a forecast for the industry`}>{r.companies.toLocaleString()} companies · {r.booked} booked · {fmtUsd(r.ltv)} LTV</span>
                    {r.demand.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium" title={`${r.demand.length} client${r.demand.length === 1 ? ' has' : 's have'} already asked for automation-shaped work`}>{r.demand.length} asked</span>}
                    {r.aiNative > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400" title="Companies whose own product is AI">{r.aiNative} AI-native</span>}
                    {r.aiAdj > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400" title="Companies whose own positioning leans on AI or automation — they already speak the language">{r.aiAdj} AI-positioned</span>}
                    <div className="flex gap-1 ml-auto">
                      {r.book.plays.map(p => <span key={p.name} className={`text-[10px] px-1.5 py-0.5 rounded-full ${PLAY_TYPE_TONE[p.type]}`}>{p.type}</span>)}
                      <span className="text-mav-muted text-xs ml-1">{open ? '▾' : '▸'}</span>
                    </div>
                  </div>
                  <span className="mt-2 block h-1 rounded bg-mav-dark overflow-hidden">
                    <span className={`block h-full rounded ${open ? 'bg-mav-yellow' : 'bg-mav-yellow/40'}`} style={{ width: `${pct}%` }} />
                  </span>
                </button>
                {open && (
                  <div className="px-5 pb-5 border-t border-mav-line pt-4">
                    <p className="text-xs leading-relaxed text-mav-muted mb-4 max-w-4xl"><span className="text-mav-fg font-medium">Where the manual effort sits: </span>{r.book.pain}</p>
                    <div className="grid gap-3 md:grid-cols-3">
                      {plays.map(p => (
                        <div key={p.name} className="rounded-lg border border-mav-line bg-mav-dark/40 p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 break-words text-sm font-medium leading-snug">{p.name}</div>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${PLAY_TYPE_TONE[p.type]}`}>{p.type}</span>
                          </div>
                          <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">Replaces</div>
                          <p className="text-xs leading-relaxed text-mav-muted mb-3">{p.replaces}</p>
                          <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">Example build</div>
                          <p className="text-xs leading-relaxed">{p.example}</p>
                        </div>
                      ))}
                    </div>
                    {r.demand.length > 0 && (
                      <div className="mt-4 rounded-lg border border-green-500/25 bg-green-500/5 p-4">
                        <div className="text-xs font-medium text-green-400 mb-1">Start here — {r.demand.length} client{r.demand.length === 1 ? ' has' : 's have'} already asked</div>
                        <p className="text-[11px] text-mav-muted mb-3">Automation-shaped language found in their own quote lines or logged conversations. Quoted below so you can judge each one rather than trust a score.</p>
                        <div className="flex flex-wrap gap-2">
                          {r.demand.slice(0, 12).map(d => (
                            <span key={d.company} title={d.evidence.join(' · ')} className="text-xs px-2 py-1 rounded-md bg-mav-dark/60 border border-mav-line">
                              <span className="font-medium">{d.company}</span>
                              <span className="text-mav-muted"> — {d.evidence[0]}{d.evidence.length > 1 ? ` (+${d.evidence.length - 1})` : ''}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <button onClick={() => { setInd([r.name]); setMode('directory'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      className="mt-4 text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg transition-colors">
                      → See the {r.companies.toLocaleString()} {r.name} companies in the directory
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mt-4">
          <div className="text-sm font-medium mb-1">Sells into any industry</div>
          <p className="text-xs text-mav-muted mb-4">Structural rather than sectoral — start here on an account whose industry you are not sure about.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(playType ? UNIVERSAL_PLAYS.filter(p => p.type === playType) : UNIVERSAL_PLAYS).map(p => (
              <div key={p.name} className="rounded-lg border border-mav-line bg-mav-dark/40 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 break-words text-sm font-medium leading-snug">{p.name}</div>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${PLAY_TYPE_TONE[p.type]}`}>{p.type}</span>
                </div>
                <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">Replaces</div>
                <p className="text-xs leading-relaxed text-mav-muted mb-3">{p.replaces}</p>
                <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1">Example build</div>
                <p className="text-xs leading-relaxed">{p.example}</p>
              </div>
            ))}
          </div>
        </div>
        </>}
      </div>

      {selC && (() => {
        const r = riskOf(selC); const convos = sigByClient.get(selC.company_name) || []; const ten = tenureOf(selC)
        const bill = billingOf(selC)
        const cOpps = oppByClient.get(selC.company_name) || []
        // The panel stops at the main nav (w-60) rather than covering it, so you can
        // still move to another page without closing the client first. Below lg the nav
        // is itself a slide-in drawer and there is nothing to spare, so this takes the
        // lot. It was max-w-md before; at that width the billing chart, the open quotes
        // and the conversations were three narrow stacks you scrolled past each other.
        return (
          <div className="fixed inset-0 lg:left-60 z-40" onClick={() => setSelC(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6 lg:p-8">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><span className={`inline-block w-2.5 h-2.5 rounded-full ${dotCls(r.level || (r.recovered ? 'Positive' : sentBucket(selC.sentiment)))}`} /><h2 className="text-xl font-semibold">{displayName(selC.company_name)}</h2></div>
                  {selC.ai_focus && <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold">⚡ AI &amp; Automation</span>}
                  {selC.website && <div className="text-xs text-mav-muted mt-1">{selC.website}</div>}
                </div>
                <button onClick={() => setSelC(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
              </div>

              {r.level && <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${r.unresolved ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : r.level === 'At risk' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-orange-500/40 bg-orange-500/10 text-orange-300'}`}><span className="font-semibold">{r.unresolved ? '⚑ Unresolved' : r.level === 'At risk' ? '🔴 At risk' : '🟠 Watch'}:</span> {r.reasons.join(' · ')}</div>}

              {!r.level && r.recovered && <div className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 text-green-300 px-3 py-2 text-sm"><span className="font-semibold">🟢 Recovered:</span> {r.recoveryNote}</div>}

              <div className="flex flex-wrap gap-2 mb-5">
                {selC.sentiment && <span className={`text-xs px-2 py-1 rounded-full ${tone(sentBucket(selC.sentiment))}`}>Sentiment: {selC.sentiment}</span>}
                {selC.rag_status && <span className={`text-xs px-2 py-1 rounded-full ${tone(sentBucket(selC.rag_status) || (selC.rag_status === 'Green' ? 'Positive' : selC.rag_status === 'Red' ? 'Negative' : 'Neutral'))}`}>RAG: {selC.rag_status}</span>}
                {selC.client_status && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{selC.client_status}</span>}
              </div>

              <div className="border-t border-mav-line pt-4 grid grid-cols-2 xl:grid-cols-4 gap-y-3 gap-x-6 text-sm">
                <div><div className="text-xs text-mav-muted">Industry</div>{selC.industry || '—'}</div>
                <div><div className="text-xs text-mav-muted">Type</div>{selC.client_type || '—'}</div>
                <div><div className="text-xs text-mav-muted">GEO</div>{selC.geo || '—'}</div>
                <div>
                  <div className="text-xs text-mav-muted">{ownersOf(selC.company_name).length > 1 ? 'Owners' : 'Owner'}</div>
                  {ownersOf(selC.company_name).join(', ') || selC.pc_sme || selC.sales_person || '—'}
                </div>
                <div><div className="text-xs text-mav-muted" title={`Sum of every booking recorded for this client${ltvWindow ? `, ${monLabel(ltvWindow.lo)} to ${monLabel(ltvWindow.hi)}` : ''}`}>Lifetime value{ltvWindow ? <span className="ml-1 opacity-60">({ltvWindow.months}mo)</span> : null}</div>{selC.ltv_usd ? fmtUsd(selC.ltv_usd) : '—'}</div>
                <div><div className="text-xs text-mav-muted">Last booking</div>{ym(selC.last_booking_month) || '—'}</div>
                {selC.email && <div className="col-span-2"><div className="text-xs text-mav-muted">Email</div>{selC.email}</div>}
              </div>

              {/* Tabs rather than one long scroll. There are five different questions
                  people bring to a client — how big are they, what do they buy, what has
                  been delivered, how do they feel about us, and what did we agree on the
                  last call — and stacking all five meant scrolling past four to reach the
                  fifth. */}
              <div className="mt-5 flex gap-1 border-b border-mav-line overflow-x-auto">
                {([['overview', 'Overview'], ['work', 'Revenue & work'], ['projects', 'Projects & quotes'], ['health', 'Health & talk'], ['qbr', 'QBR']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setCTab(k)}
                    className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${cTab === k
                      // Filled, like every other chosen-state on these pages. A yellow
                      // underline alone was too quiet to answer "which tab am I on"
                      // without reading the labels.
                      ? 'bg-mav-fill text-black border-mav-yellow font-medium rounded-t-md'
                      : 'border-transparent text-mav-muted hover:text-mav-fg hover:bg-mav-fg/5 rounded-t-md'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {cTab === 'overview' && (() => {
                const k = (selC.company_name || '').trim().toLowerCase()
                const m = c360[k]
                if (!m) return (
                  <p className="text-sm text-mav-muted mt-5">
                    No delivered projects on record for this client yet, so there is nothing to measure.
                  </p>
                )
                const quiet = monthsSince(m.last_month)
                // Split is capped at four lines plus a remainder. A client with nine
                // project types produces a bar chart of slivers nobody can read.
                const split = m.revenue_split || []
                const top = split.slice(0, 4)
                const rest = split.slice(4)
                const restAmt = rest.reduce((sum, x) => sum + Number(x.amount || 0), 0)
                const restPct = rest.reduce((sum, x) => sum + Number(x.pct || 0), 0)
                return (
                  <div className="mt-5">
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      <Stat label="Lifetime value" value={fmtUsd(m.lifetime_usd)}
                        sub={`${m.projects} project${m.projects === 1 ? '' : 's'} delivered`} />
                      <Stat label="Relationship"
                        value={m.tenure_months ? `${m.tenure_months} mo` : '—'}
                        sub={m.first_month ? `since ${monthName(m.first_month)} · billed in ${m.months_active}` : undefined} />
                      <Stat label="Average value" value={fmtUsd(m.avg_value)}
                        sub={`per project, across ${m.projects}`} />
                      <Stat label="Sales cycle"
                        value={m.sales_cycle_days != null ? `${m.sales_cycle_days} days` : '—'}
                        sub={m.sales_cycle_n ? `quote to confirmed, over ${m.sales_cycle_n} quote${m.sales_cycle_n === 1 ? '' : 's'}` : 'no confirmed quotes on record'} />

                      <Stat label="Last booked" value={monthName(m.last_month)}
                        sub={m.last_amount ? `${fmtUsd(m.last_amount)}${m.last_project ? ` · ${m.last_project}` : ''}` : undefined}
                        tone={quiet != null && quiet >= 4 ? 'warn' : undefined} />
                      <Stat label="Last delivered" value={dayName(m.last_delivered)} />
                      <Stat label="Strongest month" value={monthName(m.strongest_month)}
                        sub={m.strongest_amount ? fmtUsd(m.strongest_amount) : undefined} />
                      <Stat label="Client experience"
                        value={r.level || (r.recovered ? 'Recovered' : sentBucket(selC.sentiment) || '—')}
                        tone={r.level === 'At risk' ? 'bad' : r.level ? 'warn' : r.recovered ? 'good' : undefined}
                        sub={`${r.escs.length} escalation${r.escs.length === 1 ? '' : 's'} · ${r.posFb.length} delight${r.posFb.length === 1 ? '' : 's'}`} />

                      <Stat label="Mostly handled by" value={m.handled_by || '—'}
                        sub={m.handled_by_pct != null ? `${m.handled_by_pct}% of their revenue` : undefined} />
                      <Stat label="Mostly built in" value={m.built_in || '—'}
                        sub={m.built_in_pct != null ? `${m.built_in_pct}% of their revenue` : undefined} />
                    </div>

                    {top.length > 0 && (
                      <div className="mt-5 border-t border-mav-line pt-4">
                        <div className="text-xs uppercase tracking-wide text-mav-muted mb-2">Revenue split</div>
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-mav-dark mb-3">
                          {top.map((x, i) => (
                            <div key={x.name} title={`${x.name} · ${fmtUsd(x.amount)} · ${x.pct}%`}
                              style={{ width: `${x.pct}%`, background: SPLIT_COLOURS[i % SPLIT_COLOURS.length] }} />
                          ))}
                          {restPct > 0 && <div title={`Everything else · ${fmtUsd(restAmt)}`} style={{ width: `${restPct}%`, background: ink.grid }} />}
                        </div>
                        <div className="space-y-1.5">
                          {top.map((x, i) => (
                            <div key={x.name} className="flex items-center gap-2 text-sm">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SPLIT_COLOURS[i % SPLIT_COLOURS.length] }} />
                              <span className="flex-1 truncate">{x.name}</span>
                              <span className="tabular-nums">{fmtUsd(x.amount)}</span>
                              <span className="tabular-nums text-mav-muted w-12 text-right">{x.pct}%</span>
                            </div>
                          ))}
                          {rest.length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-mav-muted">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ink.grid }} />
                              <span className="flex-1">{rest.length} other type{rest.length === 1 ? '' : 's'}</span>
                              <span className="tabular-nums">{fmtUsd(restAmt)}</span>
                              <span className="tabular-nums w-12 text-right">{Math.round(restPct)}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Two columns once there is room. Each section is a grid item, so billing
                  can sit beside the open quotes instead of a screen above them.
                  items-start keeps a short section short rather than stretching it to
                  match its neighbour. */}
              {cTab === 'work' && (
              <div className="xl:grid xl:grid-cols-2 xl:gap-x-8 xl:items-start">
              {(() => {
                const m = c360[(selC.company_name || '').trim().toLowerCase()]
                if (!m || !(m.tech_split?.length || m.service_split?.length || m.dept_split?.length)) return null
                return (
                  <div className="xl:col-span-2 mt-6 border-t border-mav-line pt-4">
                    <div className="text-xs uppercase tracking-wide text-mav-muted mb-1">What they buy</div>
                    <p className="text-[11px] text-mav-muted mb-4">
                      Everything on this client&rsquo;s record, by share of their {fmtUsd(m.lifetime_usd)} lifetime value &mdash;
                      not only the one they buy most. Each list adds to 100%.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-6">
                      <MixList title="Technology" note="what it was built in" rows={m.tech_split} />
                      <MixList title="Service type" note="what we did" rows={m.service_split} />
                      <MixList title="Service dept" note="where it sat" rows={m.dept_split} />
                    </div>
                  </div>
                )
              })()}

              {bill && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs uppercase tracking-wide text-mav-muted">Billing &middot; last 12 months</span>
                    <span className="text-base font-semibold tabular-nums">{fmtUsd(bill.total)}</span>
                  </div>
                  <div className="text-[11px] text-mav-muted mt-1">
                    {bill.firstLabel} &rarr; {bill.lastLabel} &middot; billed in {bill.activeMonths} of {MONTHS_BACK} months
                    {bill.activeMonths > 0 && <> &middot; {fmtUsd(Math.round(bill.total / bill.activeMonths))} per billed month</>}
                  </div>
                  <div className="mt-3 -ml-2">
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={bill.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="label" stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} interval={0} />
                        <YAxis stroke={ink.axis} fontSize={10} tickLine={false} axisLine={false} width={44}
                          tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} />
                        <Tooltip
                          cursor={{ fill: ink.hover }}
                          contentStyle={{ background: ink.tip, border: `1px solid ${ink.grid}`, borderRadius: 8, fontSize: 12 }}
                          labelFormatter={(_l: any, pl: any) => pl?.[0]?.payload?.full || ''}
                          formatter={(v: number) => [fmtUsd(v), 'Billed']} />
                        <Bar dataKey="amount" fill="#FFDB2D" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <span className="text-xs uppercase tracking-wide text-mav-muted">By engagement model</span>
                      {bill.dedicated > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold">
                          {Math.round(bill.dedicatedPct)}% dedicated
                        </span>
                      )}
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-mav-line mb-3">
                      {bill.models.map(m => (
                        <div key={m.name} className={modelBar(m.name)} style={{ width: `${m.pct}%` }} title={`${m.name} — ${fmtUsd(m.amount)} (${m.pct.toFixed(0)}%)`} />
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      {bill.models.map(m => (
                        <div key={m.name} className="flex items-center gap-2.5 text-sm">
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${modelBar(m.name)}`} />
                          <span className="flex-1 truncate">{m.name}</span>
                          <span className="tabular-nums">{fmtUsd(m.amount)}</span>
                          <span className="w-9 text-right text-xs text-mav-muted tabular-nums">{Math.round(m.pct)}%</span>
                        </div>
                      ))}
                    </div>
                    {bill.dedicated > 0 && (
                      <p className="mt-3 text-[11px] text-mav-muted leading-relaxed">
                        {fmtUsd(bill.dedicated)} of the last 12 months is dedicated work
                        {bill.models.some(m => /^partial dedicated$/i.test(m.name)) && <> (Dedicated + Partial Dedicated)</>}.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {cOpps.length > 0 && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-center gap-2 mb-3"><span className="text-xs uppercase tracking-wide text-mav-muted">Open opportunities &amp; quotes</span><span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">{cOpps.length}</span><span className="text-[11px] text-mav-muted">needs input</span></div>
                  <div className="space-y-3">
                    {/* Each quote opens on Opportunities, where it can actually be acted
                        on — confirmed, marked lost, or edited. Showing it here and making
                        somebody go and find it there again was the gap. */}
                    {cOpps.slice(0, 8).map(o => (
                      <Link key={o.id} href={`/opportunities?deal=${o.id}`}
                        className="block rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 hover:border-blue-400/50 hover:bg-blue-500/10 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 break-words text-sm font-medium leading-snug">{o.summary || o.rfq_status || o.source_subject || '(opportunity)'}</div>
                          {o.win_probability != null && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{o.win_probability}%</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mav-muted">
                          {o.rfq_status && <span className="px-1.5 py-0.5 rounded-full bg-mav-line">{o.rfq_status}</span>}
                          {o.source_date && <span>{(o.source_date || '').slice(0, 10)}</span>}
                          {o.pm_owner && <span>· {o.pm_owner}</span>}
                        </div>
                        {o.gist && <p className="mt-2 text-xs leading-relaxed text-mav-muted">{o.gist}</p>}
                        <div className="mt-2 text-[11px] text-blue-400">Open on Opportunities &rarr;</div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              </div>
              )}

              {cTab === 'projects' && (() => {
                const conf = cQuotes.filter(x => /confirm|won|approved/i.test(x.status || ''))
                const lost = cQuotes.filter(x => /lost|reject|drop|cancel|declin/i.test(x.status || ''))
                const openQ = cQuotes.length - conf.length - lost.length
                const cycles = conf.map(x => x.confirmed_in_days).filter((d): d is number => d != null)
                const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length * 10) / 10 : null
                const hrs = cProjects.filter(x => (x.internal_hrs || 0) > 0 && x.actual_hrs != null)
                return (
                  <div className="mt-5 space-y-8">
                    <div>
                      <div className="flex items-baseline gap-2 flex-wrap mb-1">
                        <span className="text-xs uppercase tracking-wide text-mav-muted">Quotes journey</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">{cQuotes.length}</span>
                        {cQuotes.length > 0 && (
                          <span className="text-[11px] text-mav-muted">
                            {conf.length} confirmed · {lost.length} lost · {openQ} open
                            {cQuotes.length ? ` · ${Math.round(conf.length / cQuotes.length * 100)}% conversion` : ''}
                            {avgCycle != null ? ` · ${avgCycle} days to confirm` : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-mav-muted mb-3">
                        Every quote this client was ever sent, newest first &mdash; won, lost and still open.
                        Conversion counts quotes, not money.
                      </p>
                      {cQuotes.length === 0
                        ? <p className="text-sm text-mav-muted">No quotes on record for this client. Only 274 of 405 clients have any &mdash; the older revenue predates the Quotes sheet.</p>
                        : (
                          <div className="overflow-x-auto rounded-lg border border-mav-line">
                            <table className="w-full text-sm">
                              <thead className="text-left text-mav-fg/70 border-b border-mav-line bg-mav-dark/40">
                                <tr>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Date</th>
                                  <th className="px-3 py-2 font-medium">Quote</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Type</th>
                                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Status</th>
                                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Days</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cQuotes.map(x => (
                                  <tr key={x.id} className="border-b border-mav-line/60 last:border-0 align-top">
                                    <td className="px-3 py-2 whitespace-nowrap text-mav-muted">{dayName(x.added_date)}</td>
                                    <td className="px-3 py-2"><div className="max-w-md break-words">{x.subject_project || x.quote_id || '—'}</div>
                                      {x.quote_id && x.subject_project && <div className="text-[11px] text-mav-muted">{x.quote_id}</div>}</td>
                                    <td className="px-3 py-2 text-mav-muted whitespace-nowrap">{[x.project_type, x.technology].filter(Boolean).join(' · ') || '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{x.usd_value ? fmtUsd(x.usd_value) : '—'}</td>
                                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${quoteTone(x.status)}`}>{x.status || 'open'}</span></td>
                                    <td className="px-3 py-2 text-right tabular-nums text-mav-muted whitespace-nowrap">{x.confirmed_in_days ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                    </div>

                    <div>
                      <div className="flex items-baseline gap-2 flex-wrap mb-1">
                        <span className="text-xs uppercase tracking-wide text-mav-muted">Delivery history</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-medium">{cProjects.length}</span>
                        {hrs.length > 0 && <span className="text-[11px] text-mav-muted">{hrs.length} with hours logged</span>}
                      </div>
                      <p className="text-[11px] text-mav-muted mb-3">
                        Every project on the revenue sheet for this client, newest first &mdash; who built it, when it
                        landed, and how the hours came out. Optimization is internal hours against actual.
                      </p>
                      {cProjects.length === 0
                        ? <p className="text-sm text-mav-muted">Nothing delivered on record yet.</p>
                        : (
                          <div className="overflow-x-auto rounded-lg border border-mav-line">
                            <table className="w-full text-sm">
                              <thead className="text-left text-mav-fg/70 border-b border-mav-line bg-mav-dark/40">
                                <tr>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Month</th>
                                  <th className="px-3 py-2 font-medium">Project</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Built in</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Expert</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Start &rarr; delivered</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Hrs</th>
                                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value</th>
                                  <th className="px-3 py-2 font-medium whitespace-nowrap">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cProjects.map(x => {
                                  const ih = Number(x.internal_hrs), ah = Number(x.actual_hrs)
                                  const opt = (ih > 0 && Number.isFinite(ah) && x.actual_hrs != null) ? Math.round(((ih - ah) / ih) * 100) : null
                                  return (
                                    <tr key={x.id} className="border-b border-mav-line/60 last:border-0 align-top">
                                      <td className="px-3 py-2 whitespace-nowrap text-mav-muted">{monthName(x.booking_month)}</td>
                                      <td className="px-3 py-2"><div className="max-w-md break-words">{x.project_name || '—'}</div>
                                        <div className="text-[11px] text-mav-muted">{[x.project_id, x.service_type, x.service_dept].filter(Boolean).join(' · ')}</div></td>
                                      <td className="px-3 py-2 text-mav-muted whitespace-nowrap">{[x.technology, x.project_type].filter(Boolean).join(' · ') || '—'}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">{x.expert || '—'}<div className="text-[11px] text-mav-muted">{x.pc_sme || ''}</div></td>
                                      <td className="px-3 py-2 whitespace-nowrap text-mav-muted">{dayName(x.start_date)} &rarr; {dayName(x.delivery_date)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                                        {x.internal_hrs != null || x.actual_hrs != null ? `${x.internal_hrs ?? '—'} / ${x.actual_hrs ?? '—'}` : '—'}
                                        {opt != null && <div className={`text-[11px] ${opt >= 0 ? 'text-green-400' : 'text-amber-400'}`} title="Internal hours against actual. Positive means it took less than planned.">{opt}%</div>}
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{x.usd_value ? fmtUsd(x.usd_value) : '—'}</td>
                                      <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${deliveryTone(x.project_status)}`}>{x.project_status || '—'}</span></td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                    </div>
                  </div>
                )
              })()}

              {cTab === 'health' && (
              <div className="xl:grid xl:grid-cols-2 xl:gap-x-8 xl:items-start">
              {(() => {
                const cutoff6 = monthsAgoYM(6)
                const sc = scoreOf({
                  monthsQuiet: ten?.sinceLast ?? monthsSince(selC.last_booking_month),
                  escs6: r.escs.filter(e => ym(e.tracking_date) >= cutoff6).length,
                  unresolved: r.unresolved,
                  delights: r.posFb.length + (posFbByClient.get(selC.company_name) || []).length,
                  negSignals: r.negSigs.length,
                  dip: r.dip,
                  openQuotes: cOpps.length,
                })
                return (
                  <div className="xl:col-span-2 mt-6 border-t border-mav-line pt-4">
                    <div className="text-xs uppercase tracking-wide text-mav-muted mb-3">Client score</div>
                    <div className="flex flex-wrap items-start gap-6">
                      <div className="shrink-0">
                        <div className={`text-4xl font-semibold tabular-nums ${sc.tone}`}>{sc.score}</div>
                        <div className={`text-sm ${sc.tone}`}>{sc.band}</div>
                        <div className="text-[11px] text-mav-muted mt-1">out of 100</div>
                      </div>
                      <div className="flex-1 min-w-[16rem]">
                        {/* Every point shown, because a score nobody can take apart is a
                            score nobody trusts — and this one is built on thin data. */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-mav-muted">
                            <span className="flex-1">starting point</span><span className="tabular-nums w-10 text-right">70</span>
                          </div>
                          {sc.parts.map(x => (
                            <div key={x.label} className="flex items-center gap-2 text-sm">
                              <span className="flex-1 min-w-0 truncate" title={x.label}>{x.label}</span>
                              <span className={`tabular-nums w-10 text-right ${x.points > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {x.points > 0 ? '+' : ''}{x.points}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-mav-muted mt-3 max-w-2xl">
                          Built from escalations, feedback, email tone, booking recency and live quotes &mdash; everything
                          this dashboard already holds. CSAT is not in it: the feedback sheet has a score on 1 row out of 68,
                          so a CSAT-weighted number would be mostly invented. Treat this as a prompt to go and look, not a verdict.
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {r.escs.length > 0 && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-center gap-2 mb-3"><span className="text-xs uppercase tracking-wide text-mav-muted">Escalations &amp; triggers</span><span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">{r.escs.length}</span></div>
                  <div className="space-y-3">
                    {r.escs.slice(0, 12).map(e => (
                      <div key={e.id} className="rounded-lg border border-mav-line bg-mav-dark/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 break-words text-sm font-medium leading-snug">{e.link || e.email_subject || e.project_name || '(escalation)'}</div>
                          {e.business_impact && <Tag cls={impactTone(e.business_impact)} text={e.business_impact} />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mav-muted">
                          {e.tracking_date && <span>{(e.tracking_date || '').slice(0, 10)}</span>}
                          {e.source && <span className="px-1.5 py-0.5 rounded-full bg-mav-line">{e.source}</span>}
                          {e.escalation_type && <span>{e.escalation_type}</span>}
                          {e.raised_by && <span>· {e.raised_by}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {r.posFb.length > 0 && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-center gap-2 mb-3"><span className="text-xs uppercase tracking-wide text-mav-muted">Positive feedback</span><span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">{r.posFb.length}</span><span className="text-[11px] text-mav-muted">logged in the escalation report, tagged &ldquo;Not an escalation&rdquo;</span></div>
                  <div className="space-y-3">
                    {r.posFb.slice(0, 8).map(e => (
                      <div key={e.id} className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                        <div className="min-w-0 break-words text-sm font-medium leading-snug">{e.link || e.email_subject || e.project_name || '(positive note)'}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mav-muted">{e.tracking_date && <span>{(e.tracking_date || '').slice(0, 10)}</span>}<span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">Positive · not an escalation</span>{e.raised_by && <span>· {e.raised_by}</span>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {convos.length > 0 && (() => {
                // The email scan stores one signal per thread; show the most recent 20 with a sentiment summary.
                const emails = convos.slice(0, 20)
                const pos = emails.filter(s => sentBucket(s.sentiment) === 'Positive').length
                const neg = emails.filter(s => sentBucket(s.sentiment) === 'Negative').length
                const neu = emails.filter(s => sentBucket(s.sentiment) === 'Neutral').length
                const latest = (emails[0]?.source_date || '').slice(0, 10)
                const oldest = (emails[emails.length - 1]?.source_date || '').slice(0, 10)
                return (
                  <div className="mt-6 border-t border-mav-line pt-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs uppercase tracking-wide text-mav-muted">Email review</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">last {emails.length}{convos.length > emails.length ? ` of ${convos.length}` : ''}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
                      {pos > 0 && <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">{pos} positive</span>}
                      {neg > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{neg} negative</span>}
                      {neu > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{neu} neutral</span>}
                      {latest && <span className="text-mav-muted ml-1">{oldest && oldest !== latest ? `${oldest} → ${latest}` : latest}</span>}
                    </div>
                    <div className="space-y-3">
                      {emails.map(s => (
                        <div key={s.id} className="rounded-lg border border-mav-line bg-mav-dark/40 p-3">
                          <div className="flex items-start justify-between gap-2"><div className="min-w-0 break-words text-sm font-medium leading-snug">{s.source_subject || '(no subject)'}</div>{s.sentiment && <Tag cls={tone(sentBucket(s.sentiment))} text={s.sentiment} />}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mav-muted">{s.signal_type && <span className={`px-1.5 py-0.5 rounded-full ${sigTone(s.signal_type)}`}>{s.signal_type.replace(/_/g, ' ')}</span>}{s.source_date && <span>{(s.source_date || '').slice(0, 10)}</span>}{s.client_email && <span>· {s.client_email}</span>}</div>
                          {s.summary && <p className="mt-2 text-xs leading-relaxed text-mav-muted">{s.summary}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {ten && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs uppercase tracking-wide text-mav-muted">Tenure &amp; engagement</span>
                    {ten.sinceLast != null && ten.sinceLast >= 3
                      ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">dormant {plural(ten.sinceLast, 'mo')}</span>
                      : ten.sinceLast != null && ten.sinceLast <= 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">active this month</span>}
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between gap-3"><span className="text-mav-muted">Client since</span><span className="font-medium">{monLabel(ten.first)} · {plural(ten.spanMonths, 'month')}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-mav-muted">Active months</span><span className="font-medium">{ten.activeMonths} of {ten.spanMonths}{ten.spanMonths > 0 ? ` · ${Math.round(ten.activeMonths / ten.spanMonths * 100)}% billed` : ''}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-mav-muted">Last booking</span><span className="font-medium">{monLabel(ten.last)}{ten.sinceLast != null ? ` · ${ten.sinceLast <= 0 ? 'this month' : plural(ten.sinceLast, 'mo') + ' ago'}` : ''}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-mav-muted">Total billed</span><span className="font-medium">{fmtUsd(ten.total)}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-mav-muted">Avg / active month</span><span className="font-medium">{fmtUsd(ten.avgActive)}</span></li>
                    {ten.services.length > 0 && <li className="flex justify-between gap-3"><span className="text-mav-muted shrink-0">Services</span><span className="font-medium text-right">{ten.services.join(', ')}</span></li>}
                  </ul>
                </div>
              )}

              {selC.journey && <div className="mt-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Journey</div><p className="text-sm leading-relaxed whitespace-pre-wrap">{selC.journey}</p></div>}
              {selC.action_steps && <div className="mt-5"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Next steps</div><p className="text-sm leading-relaxed whitespace-pre-wrap">{selC.action_steps}</p></div>}
              {!r.escs.length && !r.posFb.length && !convos.length && !selC.journey && !selC.action_steps && !ten && <p className="text-sm text-mav-muted mt-5">No escalations, conversations or notes recorded for this client yet.</p>}
              </div>
              )}

              {cTab === 'qbr' && (
                <ClientQbrPanel company={selC.company_name} rows={qbrs} canEdit={canQbr} onSaved={refreshQbrs} />
              )}
            </aside>
          </div>
        )
      })()}
    </div>
  )
}
