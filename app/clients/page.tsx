'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getClients, getEmailSignals, getEscalations, getBookingsFull, type Client, type EmailSignal, type Escalation, type BookingRow } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const norm = (s?: string) => (s || '').trim().toLowerCase()
const akey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const ym = (s?: string) => (s || '').slice(0, 7)
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const now = new Date()
const monthsAgoYM = (n: number) => { const d = new Date(now); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monLabel = (y?: string) => { const p = (y || '').split('-'); return p.length >= 2 ? `${SHORT[+p[1]]} ${p[0]}` : (y || '') }
// month key 'YYYY-MM' -> absolute month index (year*12 + month) for span/recency math
const ymIdx = (k?: string) => { const p = (k || '').slice(0, 7).split('-'); return p.length >= 2 && p[0] && p[1] ? +p[0] * 12 + (+p[1] - 1) : null }
const nowIdx = now.getFullYear() * 12 + now.getMonth()
const plural = (n: number, w: string) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`

// Derived engagement history for a client, computed from the revenue/bookings rows.
type Tenure = { first?: string; last?: string; activeMonths: number; spanMonths: number; total: number; avgActive: number; sinceLast: number | null; services: string[] }

const sentBucket = (s?: string) => {
  const v = (s || '').toLowerCase()
  if (/(positive|happy|good|great|strong|delight)/.test(v)) return 'Positive'
  if (/(negative|unhappy|poor|bad|risk|frustrat|churn|escalat)/.test(v)) return 'Negative'
  if (/(neutral|stable|ok|mixed)/.test(v)) return 'Neutral'
  return ''
}
const tone = (b: string) => b === 'Positive' ? 'bg-green-500/15 text-green-400' : b === 'Negative' ? 'bg-red-500/15 text-red-400' : b === 'Neutral' ? 'bg-amber-500/15 text-amber-400'
  : b === 'At risk' ? 'bg-red-500/20 text-red-300' : b === 'Watch' ? 'bg-orange-500/20 text-orange-300' : 'bg-mav-line text-mav-muted'
const sigTone = (t?: string) => { const v = (t || '').toLowerCase(); if (/risk|escalat|churn/.test(v)) return 'bg-red-500/15 text-red-400'; if (/oppo|lead|upsell|cross/.test(v)) return 'bg-blue-500/15 text-blue-400'; if (/positive|win|prais/.test(v)) return 'bg-green-500/15 text-green-400'; return 'bg-mav-line text-mav-muted' }
const impactTone = (i?: string) => /critical|sev1|sev 1/i.test(i || '') ? 'bg-red-500/20 text-red-300' : /major/i.test(i || '') ? 'bg-red-500/15 text-red-400' : /minor/i.test(i || '') ? 'bg-amber-500/15 text-amber-400' : 'bg-mav-line text-mav-muted'
const dotCls = (b: string) => b === 'At risk' ? 'bg-red-500' : b === 'Watch' ? 'bg-orange-400' : b === 'Positive' ? 'bg-green-400' : b === 'Negative' ? 'bg-red-400' : b === 'Neutral' ? 'bg-amber-400' : 'bg-mav-muted'

type Risk = { level: '' | 'At risk' | 'Watch'; reasons: string[]; escs: Escalation[]; posFb: Escalation[]; negSigs: EmailSignal[] }
// the escalation report also logs positive feedback, tagged "Not An Escalation" — those must NOT count as risk
const isPosFb = (e: Escalation) => /not an escalation/i.test(e.escalation_type || '') || /not an escalation/i.test(e.business_impact || '')
const isJunk = (e: Escalation) => /^(source|escalation type|type of situation)$/i.test((e.escalation_type || '').trim()) || /^escalation type$/i.test((e.business_impact || '').trim())

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [signals, setSignals] = useState<EmailSignal[]>([])
  const [escs, setEscs] = useState<Escalation[]>([])
  const [q, setQ] = useState(''); const [ind, setInd] = useState(''); const [stat, setStat] = useState(''); const [aiOnly, setAiOnly] = useState(false)
  const [owner, setOwner] = useState(''); const [geo, setGeo] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'ltv' | 'owner' | 'geo'>('ltv'); const [sortAsc, setSortAsc] = useState(false)
  const [selC, setSelC] = useState<Client | null>(null)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  useEffect(() => { getClients().then(setClients); getEmailSignals().then(setSignals); getEscalations().then(setEscs); getBookingsFull().then(setBookings) }, [])

  const sigByCompany = useMemo(() => {
    const m = new Map<string, EmailSignal[]>()
    for (const s of signals) { const k = norm(s.company_name); if (!k) continue; (m.get(k) || m.set(k, []).get(k))!.push(s) }
    for (const a of m.values()) a.sort((x, y) => (y.source_date || '').localeCompare(x.source_date || ''))
    return m
  }, [signals])

  // escalations carry the client name in the `geo` field (sheet column drift); match on alphanumeric key
  const escByClient = useMemo(() => {
    const tagged = escs.map(e => ({ e, k: akey(e.geo) || akey(e.company_name) }))
    const map = new Map<string, Escalation[]>()
    for (const c of clients) {
      const ck = akey(c.company_name); if (ck.length < 4) { map.set(c.company_name, []); continue }
      const list = tagged.filter(t => t.k && (t.k === ck || (t.k.length >= 4 && (t.k.startsWith(ck) || ck.startsWith(t.k))))).map(t => t.e)
        .sort((a, b) => (b.tracking_date || '').localeCompare(a.tracking_date || ''))
      map.set(c.company_name, list)
    }
    return map
  }, [escs, clients])

  // bookings grouped by client (normalised name), for the tenure summary in the detail panel
  const bookingsByClient = useMemo(() => {
    const m = new Map<string, BookingRow[]>()
    for (const b of bookings) { const k = norm(b.company_name); if (!k) continue; (m.get(k) || m.set(k, []).get(k))!.push(b) }
    return m
  }, [bookings])

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
    const negSigs = (sigByCompany.get(norm(c.company_name)) || []).filter(s => sentBucket(s.sentiment) === 'Negative' || /risk|escalat|churn/i.test(s.signal_type || ''))
    const lb = ym(c.last_booking_month)
    const gap = !!lb && lb < monthsAgoYM(2) && (c.ltv_usd || 0) > 0
    const reasons: string[] = []
    let level: Risk['level'] = ''
    if (maxMonth > 2) { level = 'At risk'; reasons.push(`${maxMonth} escalations in ${monLabel(maxKey)}`) }
    if (recentMajor.length) { level = 'At risk'; reasons.push(`${recentMajor.length} major escalation${recentMajor.length > 1 ? 's' : ''} in the last 2 months`) }
    if (!level) {
      if (negSigs.length) { level = 'Watch'; reasons.push('client sounding frustrated over email') }
      if (list.length) { level = 'Watch'; reasons.push(`${list.length} escalation${list.length > 1 ? 's' : ''} on record`) }
      if (gap) { level = 'Watch'; reasons.push(`no new booking since ${monLabel(lb)} — contract may be winding down`) }
    }
    return { level, reasons, escs: list, posFb, negSigs }
  }

  // Genuine risk wins; otherwise positive feedback (with no negative signal) shows green; else the recorded sentiment
  const statusOf = (c: Client) => { const r = riskOf(c); if (r.level) return r.level; if (r.posFb.length && !r.negSigs.length) return 'Positive'; return sentBucket(c.sentiment) }

  const owners = uniq(clients.map(c => c.pc_sme))
  const geos = uniq(clients.map(c => c.geo))
  const industries = uniq(clients.map(c => c.industry))
  const aiCount = clients.filter(c => c.ai_focus).length
  const statCount = (b: string) => clients.filter(c => statusOf(c) === b).length
  // client count per industry (drives the clickable breakdown chart)
  const indCounts = useMemo(() => {
    const m: Record<string, number> = {}
    clients.forEach(c => { const k = c.industry || 'Other / Unclassified'; m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [clients])
  const maxIndCount = indCounts[0]?.[1] || 1

  const rows = useMemo(() => {
    let result = clients
      .filter(c => c.company_name.toLowerCase().includes(q.toLowerCase()))
      .filter(c => !ind || (c.industry || 'Other / Unclassified') === ind)
      .filter(c => !stat || statusOf(c) === stat)
      .filter(c => !aiOnly || c.ai_focus)
      .filter(c => !owner || c.pc_sme === owner)
      .filter(c => !geo || c.geo === geo)
    
    // Apply sorting
    result.sort((a, b) => {
      let aVal: string | number, bVal: string | number
      switch (sortBy) {
        case 'name':
          aVal = a.company_name.toLowerCase()
          bVal = b.company_name.toLowerCase()
          break
        case 'ltv':
          aVal = a.ltv_usd || 0
          bVal = b.ltv_usd || 0
          break
        case 'owner':
          aVal = (a.pc_sme || '').toLowerCase()
          bVal = (b.pc_sme || '').toLowerCase()
          break
        case 'geo':
          aVal = (a.geo || '').toLowerCase()
          bVal = (b.geo || '').toLowerCase()
          break
        default:
          aVal = 0
          bVal = 0
      }
      
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })
    
    return result
  }, [clients, q, ind, stat, aiOnly, owner, geo, sortBy, sortAsc, escByClient, sigByCompany])

  const handleSort = (field: 'name' | 'ltv' | 'owner' | 'geo') => {
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
      <Header title="Clients" subtitle="Health, sentiment & escalations — At risk / Watch flags from triggers and email signals" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className={`${sel} w-52`} />
        <select value={ind} onChange={e => setInd(e.target.value)} className={sel}><option value="">All industries</option>{industries.map(i => <option key={i} value={i}>{i}</option>)}</select>
        <select value={owner} onChange={e => setOwner(e.target.value)} className={sel}><option value="">All owners</option>{owners.map(o => <option key={o} value={o}>{o}</option>)}</select>
        <select value={geo} onChange={e => setGeo(e.target.value)} className={sel}><option value="">All GEOs</option>{geos.map(g => <option key={g} value={g}>{g}</option>)}</select>
        <select value={stat} onChange={e => setStat(e.target.value)} className={sel}>
          <option value="">All health</option>
          <option value="At risk">🔴 At risk ({statCount('At risk')})</option>
          <option value="Watch">🟠 Watch ({statCount('Watch')})</option>
          <option value="Positive">🟢 Positive ({statCount('Positive')})</option>
          <option value="Neutral">🟡 Neutral ({statCount('Neutral')})</option>
          <option value="Negative">🔴 Negative ({statCount('Negative')})</option>
        </select>
        <button onClick={() => setAiOnly(v => !v)} className={`text-sm px-3 py-2 rounded-md border transition-colors ${aiOnly ? 'bg-mav-yellow text-black border-mav-yellow font-medium' : 'border-mav-line text-mav-muted hover:text-white'}`}>⚡ AI &amp; Automation{aiCount ? ` (${aiCount})` : ''}</button>
        <span className="text-xs text-mav-muted ml-auto">{rows.length} clients</span>
      </div>

      <p className="text-xs text-mav-muted mb-4"><span className="text-red-300">At risk</span> = &gt;2 escalations in a month or a major escalation in the last 2 months. <span className="text-orange-300">Watch</span> = email-sensed frustration, an older escalation, or a contract winding down (no recent booking). Positive feedback logged in the escalation report (tagged &ldquo;Not an escalation&rdquo;) is excluded from risk and shown in green. Click a row for the full picture. Click column headers to sort.</p>

      <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-sm font-medium">Clients by industry</div>
          <div className="text-xs text-mav-muted">{clients.length} total · click a bar to filter{ind ? ` · showing ${ind}` : ''}</div>
        </div>
        <div className="space-y-1.5">
          {indCounts.map(([name, n]) => {
            const active = ind === name
            const pct = Math.round((n / maxIndCount) * 100)
            return (
              <button key={name} onClick={() => setInd(active ? '' : name)} title={`${n} client${n === 1 ? '' : 's'} — click to ${active ? 'clear' : 'filter'}`}
                className="w-full flex items-center gap-3 text-left group py-0.5">
                <span className={`w-44 shrink-0 truncate text-xs ${active ? 'text-mav-yellow font-medium' : 'text-mav-muted group-hover:text-white'}`}>{name}</span>
                <span className="flex-1 h-4 rounded bg-mav-dark overflow-hidden">
                  <span className={`block h-full rounded ${active ? 'bg-mav-yellow' : 'bg-mav-yellow/40 group-hover:bg-mav-yellow/70'}`} style={{ width: `${pct}%` }} />
                </span>
                <span className={`w-8 text-right text-xs font-semibold ${active ? 'text-mav-yellow' : 'text-white'}`}>{n}</span>
              </button>
            )
          })}
        </div>
        {ind && <button onClick={() => setInd('')} className="mt-3 text-xs text-mav-muted hover:text-white">✕ Clear industry filter</button>}
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-mav-muted border-b border-mav-line"><tr>
              {['', 
                <button key="client" onClick={() => handleSort('name')} className="hover:text-white cursor-pointer">Client{getSortIndicator('name')}</button>,
                'Industry',
                <button key="geo" onClick={() => handleSort('geo')} className="hover:text-white cursor-pointer">GEO{getSortIndicator('geo')}</button>,
                <button key="owner" onClick={() => handleSort('owner')} className="hover:text-white cursor-pointer">Owner{getSortIndicator('owner')}</button>,
                'Health',
                'Escal.',
                'Convos',
                <button key="ltv" onClick={() => handleSort('ltv')} className="hover:text-white cursor-pointer">LTV{getSortIndicator('ltv')}</button>
              ].map((h, i) => <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(c => {
                const r = riskOf(c); const st = r.level || sentBucket(c.sentiment); const nc = (sigByCompany.get(norm(c.company_name)) || []).length
                const rowBg = r.level === 'At risk' ? 'bg-red-500/5' : r.level === 'Watch' ? 'bg-orange-500/5' : c.ai_focus ? 'bg-mav-yellow/5' : ''
                return (
                  <tr key={c.company_name} onClick={() => setSelC(c)} className={`border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer ${rowBg}`}>
                    <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dotCls(st)}`} /></td>
                    <td className="px-4 py-3">{c.company_name}{c.ai_focus && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold whitespace-nowrap">⚡ AI</span>}{c.website && <div className="text-xs text-mav-muted">{c.website}</div>}</td>
                    <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{c.industry || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.geo}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.pc_sme}</td>
                    <td className="px-4 py-3"><button onClick={e => { e.stopPropagation(); setStat(b => b === st ? '' : st) }} className={`text-xs px-2 py-1 rounded-full hover:ring-1 hover:ring-mav-yellow/50 ${tone(st)}`}>{st || '—'}</button></td>
                    <td className="px-4 py-3">{r.escs.length ? <span className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-400 font-medium">⚠ {r.escs.length}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{nc ? <span className="text-xs px-2 py-1 rounded-full bg-blue-500/15 text-blue-400 font-medium">💬 {nc}</span> : <span className="text-xs text-mav-muted">—</span>}</td>
                    <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selC && (() => {
        const r = riskOf(selC); const convos = sigByCompany.get(norm(selC.company_name)) || []; const ten = tenureOf(selC)
        return (
          <div className="fixed inset-0 z-40" onClick={() => setSelC(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><span className={`inline-block w-2.5 h-2.5 rounded-full ${dotCls(r.level || sentBucket(selC.sentiment))}`} /><h2 className="text-xl font-semibold">{selC.company_name}</h2></div>
                  {selC.ai_focus && <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-semibold">⚡ AI &amp; Automation</span>}
                  {selC.website && <div className="text-xs text-mav-muted mt-1">{selC.website}</div>}
                </div>
                <button onClick={() => setSelC(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
              </div>

              {r.level && <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${r.level === 'At risk' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-orange-500/40 bg-orange-500/10 text-orange-300'}`}><span className="font-semibold">{r.level === 'At risk' ? '🔴 At risk' : '🟠 Watch'}:</span> {r.reasons.join(' · ')}</div>}

              <div className="flex flex-wrap gap-2 mb-5">
                {selC.sentiment && <span className={`text-xs px-2 py-1 rounded-full ${tone(sentBucket(selC.sentiment))}`}>Sentiment: {selC.sentiment}</span>}
                {selC.rag_status && <span className={`text-xs px-2 py-1 rounded-full ${tone(sentBucket(selC.rag_status) || (selC.rag_status === 'Green' ? 'Positive' : selC.rag_status === 'Red' ? 'Negative' : 'Neutral'))}`}>RAG: {selC.rag_status}</span>}
                {selC.client_status && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{selC.client_status}</span>}
              </div>

              <div className="border-t border-mav-line pt-4 grid grid-cols-2 gap-y-3 text-sm">
                <div><div className="text-xs text-mav-muted">Industry</div>{selC.industry || '—'}</div>
                <div><div className="text-xs text-mav-muted">Type</div>{selC.client_type || '—'}</div>
                <div><div className="text-xs text-mav-muted">GEO</div>{selC.geo || '—'}</div>
                <div><div className="text-xs text-mav-muted">Owner</div>{selC.pc_sme || selC.sales_person || '—'}</div>
                <div><div className="text-xs text-mav-muted">Lifetime value</div>{selC.ltv_usd ? fmtUsd(selC.ltv_usd) : '—'}</div>
                <div><div className="text-xs text-mav-muted">Last booking</div>{ym(selC.last_booking_month) || '—'}</div>
                {selC.email && <div className="col-span-2"><div className="text-xs text-mav-muted">Email</div>{selC.email}</div>}
              </div>

              {r.escs.length > 0 && (
                <div className="mt-6 border-t border-mav-line pt-4">
                  <div className="flex items-center gap-2 mb-3"><span className="text-xs uppercase tracking-wide text-mav-muted">Escalations &amp; triggers</span><span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">{r.escs.length}</span></div>
                  <div className="space-y-3">
                    {r.escs.slice(0, 12).map(e => (
                      <div key={e.id} className="rounded-lg border border-mav-line bg-mav-dark/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-snug">{e.link || e.email_subject || e.project_name || '(escalation)'}</div>
                          {e.business_impact && <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${impactTone(e.business_impact)}`}>{e.business_impact}</span>}
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
                        <div className="text-sm font-medium leading-snug">{e.link || e.email_subject || e.project_name || '(positive note)'}</div>
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
                          <div className="flex items-start justify-between gap-2"><div className="text-sm font-medium leading-snug">{s.source_subject || '(no subject)'}</div>{s.sentiment && <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${tone(sentBucket(s.sentiment))}`}>{s.sentiment}</span>}</div>
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
            </aside>
          </div>
        )
      })()}
    </div>
  )
}
