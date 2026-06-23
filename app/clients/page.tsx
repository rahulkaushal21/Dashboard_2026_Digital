'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { getClients, getBookingsFull, getQuotes, getFeedback, getEscalations, getEmailSignals,
  type Client, type BookingRow, type Quote, type Feedback, type Escalation, type EmailSignal } from '@/lib/supabase'
import { fmtUsd } from '@/lib/metrics'

const sentColor = (s?: string) =>
  s === 'At Risk' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
  : s === 'Watch' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
  : s === 'Positive' ? 'bg-green-500/15 text-green-400 border border-green-500/30'
  : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
const dot = (rag?: string) => rag === 'Red' ? 'bg-red-400' : rag === 'Amber' ? 'bg-amber-400' : 'bg-green-400'
const lc = (s?: string) => (s || '').trim().toLowerCase()
const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [signals, setSignals] = useState<EmailSignal[]>([])
  const [q, setQ] = useState(''); const [fSent, setFSent] = useState(''); const [fGeo, setFGeo] = useState('')
  const [fOwner, setFOwner] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    getClients().then(setClients); getBookingsFull().then(setBookings); getQuotes().then(setQuotes)
    getFeedback().then(setFeedback); getEscalations().then(setEscalations); getEmailSignals().then(setSignals)
  }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const byCompany = useMemo(() => {
    const m: Record<string, { bk: BookingRow[]; qt: Quote[]; fb: Feedback[]; esc: Escalation[]; sig: EmailSignal[] }> = {}
    const ensure = (k: string) => (m[k] = m[k] || { bk: [], qt: [], fb: [], esc: [], sig: [] })
    bookings.forEach(b => ensure(lc(b.company_name)).bk.push(b))
    quotes.forEach(x => ensure(lc(x.agency)).qt.push(x))
    feedback.forEach(x => ensure(lc(x.agency)).fb.push(x))
    escalations.forEach(x => ensure(lc(x.company_name)).esc.push(x))
    signals.forEach(x => ensure(lc(x.company_name)).sig.push(x))
    return m
  }, [bookings, quotes, feedback, escalations, signals])

  const rows = useMemo(() => clients
    .filter(c => c.company_name.toLowerCase().includes(q.toLowerCase()))
    .filter(c => !fSent || (c.sentiment || 'Neutral') === fSent)
    .filter(c => !fGeo || (c.geo || '') === fGeo)
    .filter(c => !fOwner || (c.pc_sme || '') === fOwner)
    .sort((a, b) => (b.ltv_usd || 0) - (a.ltv_usd || 0)), [clients, q, fSent, fGeo, fOwner])

  const revInRange = useMemo(() => bookings.filter(b => inRange(b.booking_month || b.booking_date)).reduce((s, b) => s + (b.booking_amount || 0), 0), [bookings, from, to])
  const atRisk = rows.filter(c => c.sentiment === 'At Risk').length
  const positive = rows.filter(c => c.sentiment === 'Positive').length
  const reset = () => { setQ(''); setFSent(''); setFGeo(''); setFOwner(''); setFrom(''); setTo('') }

  return (
    <div>
      <Header title="Clients" subtitle="Portfolio, health & sentiment — click a client for full detail" />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className={`${selCls} w-48`} />
        <select value={fSent} onChange={e => setFSent(e.target.value)} className={selCls}><option value="">All sentiment</option>{['Positive', 'Watch', 'At Risk', 'Neutral'].map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={fGeo} onChange={e => setFGeo(e.target.value)} className={selCls}><option value="">All GEO</option>{uniq(clients.map(c => c.geo)).map(g => <option key={g} value={g}>{g}</option>)}</select>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)} className={selCls}><option value="">All owners</option>{uniq(clients.map(c => c.pc_sme)).map(o => <option key={o} value={o}>{o}</option>)}</select>
        <span className="text-xs text-mav-muted ml-1">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="text-xs text-mav-muted">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
        <button onClick={reset} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-white">Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Clients shown" value={String(rows.length)} />
        <KPICard label="At risk" value={String(atRisk)} />
        <KPICard label="Positive" value={String(positive)} />
        <KPICard label="Revenue in range" value={fmtUsd(revInRange)} />
      </div>
      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>{['', 'Client', 'Sentiment', 'Industry', 'GEO', 'Owner', 'LTV', ''].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const isOpen = open === c.company_name
              const d = byCompany[lc(c.company_name)] || { bk: [], qt: [], fb: [], esc: [], sig: [] }
              return (
                <>
                  <tr key={c.company_name} onClick={() => setOpen(isOpen ? null : c.company_name)} className="border-b border-mav-line/60 hover:bg-mav-dark/40 cursor-pointer">
                    <td className="px-4 py-3"><span className={`inline-block w-2 h-2 rounded-full ${dot(c.rag_status)}`} /></td>
                    <td className="px-4 py-3 font-medium text-mav-yellow">{c.company_name}{c.email && <div className="text-xs text-mav-muted font-normal">{c.email}</div>}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${sentColor(c.sentiment)}`}>{c.sentiment || 'Neutral'}</span></td>
                    <td className="px-4 py-3 text-mav-muted">{c.industry || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.geo || '—'}</td>
                    <td className="px-4 py-3 text-mav-muted">{c.pc_sme || '—'}</td>
                    <td className="px-4 py-3">{c.ltv_usd ? fmtUsd(c.ltv_usd) : '—'}</td>
                    <td className="px-4 py-3 text-mav-muted text-xs">{isOpen ? '▲' : '▼'}</td>
                  </tr>
                  {isOpen && <Detail c={c} d={d} inRange={inRange} />}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Detail({ c, d, inRange }: { c: Client; d: { bk: BookingRow[]; qt: Quote[]; fb: Feedback[]; esc: Escalation[]; sig: EmailSignal[] }; inRange: (s?: string) => boolean }) {
  const bk = d.bk.filter(b => inRange(b.booking_month || b.booking_date))
  const fb = d.fb.filter(x => inRange(x.added_date))
  const esc = d.esc.filter(x => inRange(x.tracking_date))
  const sig = d.sig.filter(x => inRange((x.source_date || '').slice(0, 10)))

  const months = Array.from(new Set(d.bk.map(b => (b.booking_month || '').slice(0, 7)).filter(Boolean))).sort()
  const trend = months.slice(-12).map(m => ({ m, v: d.bk.filter(b => (b.booking_month || '').slice(0, 7) === m).reduce((s, b) => s + (b.booking_amount || 0), 0) }))
  const maxV = Math.max(1, ...trend.map(t => t.v))
  const svc: Record<string, number> = {}
  d.bk.forEach(b => { const k = b.service_name || 'Other'; svc[k] = (svc[k] || 0) + (b.booking_amount || 0) })
  const svcArr = Object.entries(svc).sort((a, b) => b[1] - a[1])
  const tenure = months.length ? `${months[0]} → ${months[months.length - 1]}` : '—'
  const totalBk = d.bk.length
  const avg = totalBk ? (d.bk.reduce((s, b) => s + (b.booking_amount || 0), 0) / totalBk) : 0

  return (
    <tr className="bg-mav-dark/30 border-b border-mav-line/60">
      <td colSpan={8} className="px-6 py-5">
        <div className="grid lg:grid-cols-3 gap-6">
          <div>
            <div className="text-xs text-mav-muted mb-2">{[c.email, c.pc_sme, c.sales_person, c.geo, c.industry].filter(Boolean).join(' · ')}</div>
            {c.journey && <div className="mb-3"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Last-quarter journey</div><div className="text-sm">{c.journey}</div></div>}
            {c.action_steps && <div className="mb-3"><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">Action steps</div><div className="text-sm text-mav-yellow">{c.action_steps}</div></div>}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Stat label="LTV" value={fmtUsd(c.ltv_usd || 0)} />
              <Stat label="Bookings" value={String(totalBk)} />
              <Stat label="Avg booking" value={fmtUsd(avg)} />
              <Stat label="Tenure" value={tenure} />
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-mav-muted mb-2">Revenue trend (12 mo)</div>
            <div className="space-y-1">
              {trend.length ? trend.map(t => (
                <div key={t.m} className="flex items-center gap-2 text-xs"><span className="w-16 text-mav-muted">{t.m}</span>
                  <div className="flex-1 bg-mav-line/30 rounded h-2"><div className="bg-mav-yellow h-2 rounded" style={{ width: `${(t.v / maxV) * 100}%` }} /></div>
                  <span className="w-16 text-right text-mav-muted">{t.v ? fmtUsd(t.v) : ''}</span></div>
              )) : <div className="text-sm text-mav-muted">No booking history.</div>}
            </div>
            <div className="text-xs uppercase tracking-wide text-mav-muted mt-4 mb-2">Service mix</div>
            <div className="space-y-1">{svcArr.slice(0, 6).map(([k, v]) => <Row key={k} a={k} b="" c={fmtUsd(v)} />)}{svcArr.length === 0 && <div className="text-sm text-mav-muted">—</div>}</div>
          </div>
          <div className="space-y-4">
            {bk.length > 0 && <Section title={`Bookings in range (${bk.length})`}>{bk.slice(0, 8).map(b => <Row key={b.id} a={(b.booking_month || '').slice(0, 7) || b.booking_date} b={b.service_name} c={b.booking_amount ? fmtUsd(b.booking_amount) : ''} />)}</Section>}
            {d.qt.length > 0 && <Section title={`Quotes (${d.qt.length})`}>{d.qt.slice(0, 6).map(x => <Row key={x.id} a={x.added_date} b={x.status} c={x.usd_value ? fmtUsd(x.usd_value) : ''} />)}</Section>}
            {fb.length > 0 && <Section title={`Feedback (${fb.length})`}>{fb.slice(0, 5).map(x => <Row key={x.id} a={x.nature} b={(x.comments || '').slice(0, 70)} c="" />)}</Section>}
            {esc.length > 0 && <Section title={`Escalations (${esc.length})`}>{esc.slice(0, 5).map(x => <Row key={x.id} a={x.tracking_date} b={x.escalation_type || x.situation_type} c={x.business_impact} />)}</Section>}
            {sig.length > 0 && <Section title={`Email signals (${sig.length})`}>{sig.slice(0, 5).map(x => <Row key={x.id} a={x.sentiment} b={(x.summary || x.source_subject || '').slice(0, 70)} c="" />)}</Section>}
            {bk.length + d.qt.length + fb.length + esc.length + sig.length === 0 && <div className="text-sm text-mav-muted">No activity records in the selected range.</div>}
          </div>
        </div>
      </td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="bg-mav-panel border border-mav-line rounded-lg px-3 py-2"><div className="text-xs text-mav-muted">{label}</div><div className="text-sm font-medium">{value}</div></div>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="text-xs uppercase tracking-wide text-mav-muted mb-1">{title}</div><div className="space-y-1">{children}</div></div>
}
function Row({ a, b, c }: { a?: string; b?: string; c?: string }) {
  return <div className="flex justify-between gap-3 text-sm border-b border-mav-line/40 py-1"><span className="text-mav-muted whitespace-nowrap">{a || '—'}</span><span className="flex-1 truncate">{b || ''}</span><span className="text-mav-muted whitespace-nowrap">{c || ''}</span></div>
}
