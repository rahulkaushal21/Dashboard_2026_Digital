'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getCriticalEscalations, markEscalationStatus, dismissEscalation, type CriticalEscalation } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)
const sentBucket = (s?: string) => { const v = (s || '').toLowerCase(); if (/posit|happy|great|delight/.test(v)) return 'Positive'; if (/negat|risk|churn|frustrat/.test(v)) return 'Negative'; if (/neutral|stable|mixed/.test(v)) return 'Neutral'; return '' }
const kindTone = (t?: string) => { const v = (t || '').toLowerCase(); if (/complaint|churn/.test(v)) return 'bg-red-500/15 text-red-400'; if (/risk|escalat/.test(v)) return 'bg-orange-500/15 text-orange-300'; return 'bg-mav-line text-mav-muted' }
const kindLabel = (t?: string) => { const v = (t || '').toLowerCase(); if (/complaint/.test(v)) return 'Complaint'; if (/churn/.test(v)) return 'Churn risk'; if (/risk|escalat/.test(v)) return 'At risk'; return t || 'Negative' }

export default function CriticalEscalations() {
  const [rows, setRows] = useState<CriticalEscalation[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(''); const [geo, setGeo] = useState(''); const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('all')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<CriticalEscalation | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { getCriticalEscalations().then(r => { setRows(r); setLoading(false) }) }, [])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])
  const openCount = rows.filter(r => r.status === 'open').length

  const filtered = useMemo(() => rows.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (geo && (r.geo || '') !== geo) return false
    if (q) { const hay = `${r.company_name} ${r.headline || ''} ${r.items.map(i => i.escalation_summary).join(' ')}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.last_flagged_date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, status, from, to])

  const key = (r: CriticalEscalation) => r.threadIds.join(',')
  const patch = (r: CriticalEscalation, fields: Partial<CriticalEscalation>) => {
    setRows(prev => prev.map(x => key(x) === key(r) ? { ...x, ...fields } : x))
    setSel(prev => prev && key(prev) === key(r) ? { ...prev, ...fields } : prev)
  }

  async function setStatusOf(r: CriticalEscalation, st: 'open' | 'fixed' | 'positive') {
    setBusy(key(r))
    const ok = await markEscalationStatus(r.threadIds, st, { actor: currentEmail() || undefined })
    setBusy(null)
    if (!ok) { alert('Could not update — please try again.'); return }
    patch(r, { status: st === 'open' ? 'open' : 'resolved', resolved_at: st === 'open' ? undefined : new Date().toISOString(), resolved_by: st === 'open' ? undefined : (currentEmail() || undefined) })
  }

  async function remove(r: CriticalEscalation) {
    const many = r.count > 1 ? ` (${r.count} threads)` : ''
    if (!window.confirm(`Remove ${r.company_name}${many} from Critical Escalations?\n\nUse this ONLY when it was flagged but isn't actually a major client escalation (false alarm). To mark a real one as resolved, use “Mark fixed / positive” — it stays in the list.`)) return
    const reason = window.prompt('Optional: why isn\'t this a real escalation? (kept for the record)', '') || undefined
    setBusy(key(r))
    const done = await dismissEscalation(r.threadIds, { actor: currentEmail() || undefined, reason })
    setBusy(null)
    if (!done) { alert('Could not remove it — please try again.'); return }
    setRows(prev => prev.filter(x => key(x) !== key(r))); setSel(null)
  }

  return (
    <div>
      <Header title="Critical Escalations" subtitle="Major negative feedback raised by clients over email — one row per client. Escalations stay here even after they're resolved; mark them Fixed or Positive yourself." />

      <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-red-300 font-semibold">How this works:</span> one entry per client (all their escalation threads roll up together). Every escalation is captured automatically and <span className="text-white">kept</span> — it never disappears on its own. When the client comes back positive, click <span className="text-green-300">Mark fixed / positive</span> so the &ldquo;was escalated → now solved&rdquo; history stays visible. Use <span className="text-mav-muted">Remove</span> only for a false alarm.
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or detail…" className={`${sel} min-w-[220px] flex-1`} />
        <select value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | 'resolved')} className={sel}>
          <option value="all">All statuses</option>
          <option value="open">● Open only</option>
          <option value="resolved">✓ Resolved only</option>
        </select>
        <select value={geo} onChange={e => setGeo(e.target.value)} className={sel}>
          <option value="">All GEOs</option>
          {geos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-xs text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
        {(q || geo || from || to || status !== 'all') && <button onClick={() => { setQ(''); setGeo(''); setFrom(''); setTo(''); setStatus('all') }} className="text-xs text-mav-muted hover:text-white">✕ clear</button>}
        <span className="text-xs text-mav-muted ml-auto">{filtered.length} clients · {openCount} open</span>
      </div>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p>
        : !rows.length ? <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">No client escalations captured yet.</div>
        : !filtered.length ? <p className="text-sm text-mav-muted">No escalations match these filters.</p>
        : (
        <div className="space-y-2">
          {filtered.map(r => {
            const resolved = r.status === 'resolved'; const turnedPositive = !resolved && sentBucket(r.latest_sentiment) === 'Positive'
            return (
            <div key={key(r)} className={`rounded-lg border px-4 py-3 flex items-start gap-3 transition-colors ${resolved ? 'border-mav-line bg-mav-panel hover:bg-mav-line/20' : 'border-red-500/25 bg-red-500/[0.04] hover:bg-red-500/[0.08]'}`}>
              <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${resolved ? 'bg-green-500' : 'bg-red-500'}`} />
              <button onClick={() => setSel(r)} className="text-left flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{r.company_name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${resolved ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>{resolved ? '✓ Resolved' : '● Open'}</span>
                  {r.count > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mav-line text-mav-muted">{r.count} escalations</span>}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${kindTone(r.signal_type)}`}>{kindLabel(r.signal_type)}</span>
                  {r.geo && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mav-line text-mav-muted">{r.geo}</span>}
                  {r.last_flagged_date && <span className="text-[11px] text-mav-muted">{day(r.last_flagged_date)}</span>}
                  {turnedPositive && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">client now positive →</span>}
                </div>
                <div className="text-sm text-mav-muted mt-1 line-clamp-2">{r.headline || '(no detail)'}</div>
              </button>
              <div className="shrink-0 flex flex-col gap-1">
                {!resolved
                  ? <>
                      <button onClick={() => setStatusOf(r, 'fixed')} disabled={busy === key(r)} className="text-xs px-2.5 py-1 rounded-md border border-green-500/40 text-green-300 hover:bg-green-500/10 disabled:opacity-50">Mark fixed</button>
                      <button onClick={() => setStatusOf(r, 'positive')} disabled={busy === key(r)} className="text-xs px-2.5 py-1 rounded-md border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50">Positive</button>
                    </>
                  : <button onClick={() => setStatusOf(r, 'open')} disabled={busy === key(r)} className="text-xs px-2.5 py-1 rounded-md border border-mav-line text-mav-muted hover:text-orange-300 disabled:opacity-50">Reopen</button>}
              </div>
            </div>
          )})}
        </div>
      )}

      {sel_ && (
        <div className="fixed inset-0 z-40" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${sel_.status === 'resolved' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <h2 className="text-xl font-semibold">{sel_.company_name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`text-xs px-2 py-1 rounded-full ${sel_.status === 'resolved' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>{sel_.status === 'resolved' ? '✓ Resolved' : '● Open'}</span>
                  {sel_.count > 1 && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.count} escalations</span>}
                  {sel_.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.geo}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
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
                  {it.source_subject && <div className="mt-2 text-[11px] text-mav-muted">✉ {it.source_subject}{it.client_email ? ` · ${it.client_email}` : ''}</div>}
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-mav-line pt-4 space-y-3">
              {sel_.status !== 'resolved' ? (
                <div className="flex gap-2">
                  <button onClick={() => setStatusOf(sel_, 'fixed')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-green-500/40 text-green-300 hover:bg-green-500/10 disabled:opacity-50">✓ Mark fixed</button>
                  <button onClick={() => setStatusOf(sel_, 'positive')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50">★ Mark positive</button>
                </div>
              ) : (
                <button onClick={() => setStatusOf(sel_, 'open')} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-orange-300 disabled:opacity-50">↺ Reopen</button>
              )}
              <div>
                <p className="text-xs text-mav-muted mb-2">Flagged by mistake — not actually a major escalation? Remove it (the email signals are preserved).</p>
                <button onClick={() => remove(sel_)} disabled={busy === key(sel_)} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-red-300 hover:border-red-500/40 disabled:opacity-50">✕ Remove (false alarm)</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
