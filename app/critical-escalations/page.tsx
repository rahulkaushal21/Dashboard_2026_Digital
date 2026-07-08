'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getCriticalEscalations, dismissEscalation, type CriticalEscalation } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)
const kindTone = (t?: string) => {
  const v = (t || '').toLowerCase()
  if (/complaint|churn/.test(v)) return 'bg-red-500/20 text-red-300'
  if (/risk|escalat/.test(v)) return 'bg-orange-500/20 text-orange-300'
  return 'bg-mav-line text-mav-muted'
}
const kindLabel = (t?: string) => {
  const v = (t || '').toLowerCase()
  if (/complaint/.test(v)) return 'Complaint'
  if (/churn/.test(v)) return 'Churn risk'
  if (/risk|escalat/.test(v)) return 'At risk'
  return t || 'Negative'
}

export default function CriticalEscalations() {
  const [rows, setRows] = useState<CriticalEscalation[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(''); const [geo, setGeo] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<CriticalEscalation | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { getCriticalEscalations().then(r => { setRows(r); setLoading(false) }) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (geo && (r.geo || '') !== geo) return false
    if (q) { const hay = `${r.company_name || ''} ${r.summary || ''} ${r.source_subject || ''} ${r.client_email || ''}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.source_date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, from, to])

  async function remove(r: CriticalEscalation) {
    if (!r.thread_id) { alert('This escalation has no thread reference and can only be resolved by re-classifying the email.'); return }
    const ok = window.confirm(`Remove this escalation for “${r.company_name || 'client'}”?\n\nUse this when it was flagged but isn't actually a major client escalation (a minor gap). It will be hidden from this list; the underlying email signal is kept.`)
    if (!ok) return
    const reason = window.prompt('Optional: why isn\'t this major? (kept for the record)', '') || undefined
    setBusy(r.thread_id)
    const done = await dismissEscalation(r.thread_id, { company: r.company_name, actor: currentEmail() || undefined, reason })
    setBusy(null)
    if (!done) { alert('Could not remove it — please try again.'); return }
    setRows(prev => prev.filter(x => x.thread_id !== r.thread_id))
    setSel(null)
  }

  return (
    <div>
      <Header title="Critical Escalations" subtitle="Major negative feedback raised by clients over email — the critical, customer-side red flags. Resolve or re-classify a thread and it drops off automatically." />

      <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-red-300 font-semibold">What this is:</span> live client-triggered escalations — formal complaints, disputes and at-risk warnings pulled straight from customer emails. It updates every 30 minutes. If something here was flagged but isn&rsquo;t genuinely major, use <span className="text-red-300">Remove</span> to drop it (the email signal is preserved).
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, subject or detail…" className={`${sel} min-w-[220px] flex-1`} />
        <select value={geo} onChange={e => setGeo(e.target.value)} className={sel}>
          <option value="">All GEOs</option>
          {geos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-xs text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
        {(q || geo || from || to) && <button onClick={() => { setQ(''); setGeo(''); setFrom(''); setTo('') }} className="text-xs text-mav-muted hover:text-white">✕ clear</button>}
        <span className="text-xs text-mav-muted ml-auto">{filtered.length} of {rows.length} shown</span>
      </div>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p>
        : !rows.length ? <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">🎉 No critical client escalations right now — nothing on the customer side is flagged negative.</div>
        : !filtered.length ? <p className="text-sm text-mav-muted">No escalations match these filters.</p>
        : (
        <div className="space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="rounded-lg border border-red-500/25 bg-red-500/[0.04] hover:bg-red-500/[0.08] transition-colors px-4 py-3 flex items-start gap-3">
              <span className="mt-1.5 inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              <button onClick={() => setSel(r)} className="text-left flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{r.company_name || '(unknown client)'}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${kindTone(r.signal_type)}`}>{kindLabel(r.signal_type)}</span>
                  {r.geo && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mav-line text-mav-muted">{r.geo}</span>}
                  {r.source_date && <span className="text-[11px] text-mav-muted">{day(r.source_date)}</span>}
                </div>
                <div className="text-sm text-mav-muted mt-1 line-clamp-2">{r.summary || r.source_subject || '(no detail)'}</div>
              </button>
              <button onClick={() => remove(r)} disabled={busy === r.thread_id}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-red-300 hover:border-red-500/40 disabled:opacity-50">
                {busy === r.thread_id ? '…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {sel_ && (
        <div className="fixed inset-0 z-40" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                  <h2 className="text-xl font-semibold">{sel_.company_name || '(unknown client)'}</h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs px-2 py-1 rounded-full ${kindTone(sel_.signal_type)}`}>{kindLabel(sel_.signal_type)}</span>
                  {sel_.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.geo}</span>}
                  {sel_.source_date && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{day(sel_.source_date)}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="mb-5">
              <div className="text-xs uppercase tracking-wide text-mav-muted mb-1">What happened — client escalation</div>
              <p className="text-sm leading-relaxed whitespace-pre-line">{sel_.summary || '(no detail recorded)'}</p>
            </div>

            <div className="border-t border-mav-line pt-4 grid grid-cols-1 gap-y-3 text-sm">
              {sel_.source_subject && <div><div className="text-xs text-mav-muted">Email subject</div>{sel_.source_subject}</div>}
              {sel_.client_email && <div><div className="text-xs text-mav-muted">Raised by</div>{sel_.client_email}</div>}
              <div><div className="text-xs text-mav-muted">GEO</div>{sel_.geo || '—'}</div>
              <div><div className="text-xs text-mav-muted">Date</div>{day(sel_.source_date) || '—'}</div>
            </div>

            <div className="mt-6 border-t border-mav-line pt-4">
              <p className="text-xs text-mav-muted mb-2">Flagged but not actually a major client escalation? Remove it from this list — the underlying email signal is preserved.</p>
              <button onClick={() => remove(sel_)} disabled={busy === sel_.thread_id}
                className="text-sm px-3 py-2 rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                {busy === sel_.thread_id ? 'Removing…' : '✕ Remove escalation'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
