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
    if (q) { const hay = `${r.company_name} ${r.quote || ''}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, from, to])

  return (
    <div>
      <Header title="Delights" subtitle="Clients who told us they're genuinely happy — the standout positive feedback and praise received over email." />

      <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-green-300 font-semibold">✨ Wins worth celebrating:</span> clients who shared real appreciation — glowing project feedback and email praise (e.g. Tanium). One card per client, newest first. A great source for testimonials, case studies and cross-sell.
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
                {r.count > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">{r.count} praises</span>}
              </div>
              {r.quote ? <p className="text-sm leading-relaxed line-clamp-4 text-white/90">&ldquo;{r.quote}&rdquo;</p>
                : <p className="text-sm text-mav-muted italic">Positive feedback on record.</p>}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-mav-muted">
                {r.source && <span>{r.source}</span>}{r.date && <span>· {day(r.date)}</span>}
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
                  {sel_.count > 1 && <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-400">{sel_.count} praises</span>}
                  {sel_.source && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{sel_.source}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="mb-5">
              <div className="text-xs uppercase tracking-wide text-green-300/80 mb-1">What the client said</div>
              {sel_.quote ? <p className="text-base leading-relaxed whitespace-pre-line">&ldquo;{sel_.quote}&rdquo;</p>
                : <p className="text-sm text-mav-muted italic">Positive feedback on record (no quote captured).</p>}
            </div>

            <div className="border-t border-mav-line pt-4 grid grid-cols-1 gap-y-3 text-sm">
              {sel_.client_email && <div><div className="text-xs text-mav-muted">Contact</div>{sel_.client_email}</div>}
              <div><div className="text-xs text-mav-muted">GEO</div>{sel_.geo || '—'}</div>
              <div><div className="text-xs text-mav-muted">Source</div>{sel_.source || '—'}</div>
              <div><div className="text-xs text-mav-muted">Date</div>{day(sel_.date) || '—'}</div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
