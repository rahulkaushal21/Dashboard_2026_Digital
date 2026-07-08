'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getDelights, type Delight } from '@/lib/supabase'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)

export default function Delights() {
  const [rows, setRows] = useState<Delight[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(''); const [geo, setGeo] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<Delight | null>(null)

  useEffect(() => { getDelights().then(r => { setRows(r); setLoading(false) }) }, [])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (geo && (r.geo || '') !== geo) return false
    if (q) { const hay = `${r.company_name} ${r.headline || ''} ${r.items.map(i => `${i.quote || ''} ${i.project || ''}`).join(' ')}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, from, to])

  return (
    <div>
      <Header title="Delights" subtitle="Clients who shared genuinely great appreciation — the standout testimonials from the feedback sheet, worth celebrating and reusing." />

      <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-green-300 font-semibold">✨ Real appreciation only:</span> curated testimonials logged in the feedback sheet (e.g. Tanium, Cohort, Poloko). Everyday &ldquo;thanks / looks good&rdquo; email replies are intentionally excluded. One card per client — a ready source for testimonials, case studies and cross-sell.
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or quote…" className={`${sel} min-w-[220px] flex-1`} />
        <select value={geo} onChange={e => setGeo(e.target.value)} className={sel}>
          <option value="">All GEOs</option>
          {geos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-xs text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
        {(q || geo || from || to) && <button onClick={() => { setQ(''); setGeo(''); setFrom(''); setTo('') }} className="text-xs text-mav-muted hover:text-white">✕ clear</button>}
        <span className="text-xs text-mav-muted ml-auto">{filtered.length} happy clients</span>
      </div>

      {loading ? <p className="text-sm text-mav-muted">Loading…</p>
        : !rows.length ? <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">No client delights captured yet.</div>
        : !filtered.length ? <p className="text-sm text-mav-muted">No delights match these filters.</p>
        : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(r => (
            <button key={r.company_name} onClick={() => setSel(r)} className="text-left rounded-lg border border-green-500/25 bg-green-500/[0.04] hover:bg-green-500/[0.08] transition-colors p-4">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-lg">💚</span>
                <span className="font-semibold">{r.company_name}</span>
                {r.geo && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mav-line text-mav-muted">{r.geo}</span>}
                {r.count > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">{r.count} testimonials</span>}
              </div>
              {r.headline
                ? <p className="text-sm leading-relaxed line-clamp-4 text-white/90">&ldquo;{r.headline}&rdquo;</p>
                : <p className="text-sm text-mav-muted italic">{r.headline_evidence ? 'Great feedback captured as a screenshot' : 'Positive feedback on record'}{r.headline_project ? ` — ${r.headline_project}` : ''}.</p>}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-mav-muted">
                {r.headline_evidence && <a href={r.headline_evidence} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-green-400 hover:underline">📷 View feedback</a>}
                {r.date && <span>· {day(r.date)}</span>}
              </div>
            </button>
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
                  <span className="text-lg">💚</span><h2 className="text-xl font-semibold">{sel_.company_name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {sel_.geo && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.geo}</span>}
                  {sel_.count > 1 && <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-400">{sel_.count} testimonials</span>}
                  {sel_.client_email && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.client_email}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="text-xs uppercase tracking-wide text-green-300/80 mb-2">What the client said</div>
            <div className="space-y-3">
              {sel_.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((it, i) => (
                <div key={i} className="rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3">
                  {it.quote
                    ? <p className="text-sm leading-relaxed">&ldquo;{it.quote}&rdquo;</p>
                    : <p className="text-sm text-mav-muted italic">{it.evidence ? 'Feedback captured as a screenshot.' : 'Positive feedback on record.'}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-mav-muted">
                    {it.project && <span className="px-1.5 py-0.5 rounded-full bg-mav-line">{it.project}</span>}
                    {it.type && <span>{it.type}</span>}
                    {it.date && <span>· {it.date}</span>}
                    {it.evidence && <a href={it.evidence} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">📷 View feedback</a>}
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
