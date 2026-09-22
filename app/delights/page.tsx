'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import Header from '@/components/Header'
import { useCloseOnNav } from '@/lib/use-close-on-nav'
import { getDelights, type Delight } from '@/lib/supabase'
import { useMine } from '@/lib/mine'
import MineFilter from '@/components/MineFilter'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const uniq = (a: (string | undefined)[]) => Array.from(new Set(a.map(x => (x || '').trim()).filter(Boolean))).sort()
const day = (s?: string) => (s || '').slice(0, 10)

export default function Delights() {
  const [rows, setRows] = useState<Delight[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(''); const [geo, setGeo] = useState(''); const [src, setSrc] = useState<'' | 'sheet' | 'email'>('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [sel_, setSel] = useState<Delight | null>(null)
  // Starts on this person's own clients. A PM opens Delights to see their own accounts
  // being praised; everybody's is a nice read and not the job. One click shows the lot.
  const mine = useMine()
  const [justMine, setJustMine] = useState(true)
  useEffect(() => { if (mine.ready && !mine.canScope) setJustMine(false) }, [mine.ready, mine.canScope])
  // Using the sidebar closes this drawer — including a click on the section you are
  // already on, which is not a route change and so re-renders nothing by itself.
  useCloseOnNav(useCallback(() => setSel(null), []))

  useEffect(() => { getDelights().then(r => { setRows(r); setLoading(false) }) }, [])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])

  const geos = useMemo(() => uniq(rows.map(r => r.geo)), [rows])

  const srcCounts = useMemo(() => ({
    sheet: rows.filter(r => (r.sheet_count || 0) > 0).length,
    email: rows.filter(r => (r.email_count || 0) > 0).length,
  }), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (justMine && !mine.ownsClient(r.company_name)) return false
    if (geo && (r.geo || '') !== geo) return false
    if (src === 'sheet' && !(r.sheet_count || 0)) return false
    if (src === 'email' && !(r.email_count || 0)) return false
    if (q) { const hay = `${r.company_name} ${r.headline || ''} ${r.items.map(i => `${i.quote || ''} ${i.project || ''}`).join(' ')}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    const d = day(r.date)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  }), [rows, q, geo, src, from, to, justMine, mine])

  return (
    <div>
      <Header title="Delights" subtitle="Clients who shared genuinely great appreciation — the standout testimonials from the feedback sheet, worth celebrating and reusing." />

      <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-green-300 font-semibold">✨ Real appreciation only:</span> two sources — curated testimonials from the feedback sheet (Tanium, Cohort, Poloko), and praise picked up in the email review and marked <span className="text-sky-300">✉ email</span>. Email counts only when the client actually paid a compliment (&ldquo;brilliant service&rdquo;, &ldquo;particularly impressed&rdquo;, &ldquo;looking forward to working with you again&rdquo;); everyday &ldquo;thanks / looks good / approved&rdquo; replies stay out. One card per client — a ready source for testimonials, case studies and cross-sell.
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {mine.canScope && (
          <MineFilter on={justMine} onChange={setJustMine} label="My clients"
            hidden={rows.filter(r => !mine.ownsClient(r.company_name)).length} />
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or quote…" className={`${sel} min-w-[220px] flex-1`} />
        <select value={geo} onChange={e => setGeo(e.target.value)} className={sel}>
          <option value="">All GEOs</option>
          {geos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {(['sheet', 'email'] as const).map(k => (
          <button key={k} onClick={() => setSrc(v => v === k ? '' : k)} className={`text-xs px-2.5 py-2 rounded-md border transition-colors ${src === k ? (k === 'email' ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'bg-green-500/20 text-green-300 border-green-500/50') : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>{k === 'email' ? '✉ From email' : '📋 From sheet'} ({srcCounts[k]})</button>
        ))}
        <span className="text-xs text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
        <span className="text-xs text-mav-muted">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
        {(q || geo || src || from || to) && <button onClick={() => { setQ(''); setGeo(''); setSrc(''); setFrom(''); setTo('') }} className="text-xs text-mav-muted hover:text-mav-fg">✕ clear</button>}
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
                {!!r.email_count && <span title={`${r.email_count} picked up in the email review`} className="text-[11px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300">✉ {r.email_count} from email</span>}
              </div>
              {r.headline
                ? <p className="text-sm leading-relaxed line-clamp-4 text-mav-fg/90">&ldquo;{r.headline}&rdquo;</p>
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
        <div className="fixed inset-0 lg:left-60 z-40" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6 lg:p-8">
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
              <button onClick={() => setSel(null)} className="text-mav-muted hover:text-mav-fg text-2xl leading-none">×</button>
            </div>

            <div className="text-xs uppercase tracking-wide text-green-300/80 mb-2">What the client said</div>
            <div className="space-y-3">
              {sel_.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((it, i) => (
                <div key={i} className="rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3">
                  {it.quote
                    ? <p className="text-sm leading-relaxed">&ldquo;{it.quote}&rdquo;</p>
                    : <p className="text-sm text-mav-muted italic">{it.evidence ? 'Feedback captured as a screenshot.' : 'Positive feedback on record.'}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-mav-muted">
                    <span className={`px-1.5 py-0.5 rounded-full ${it.source === 'email' ? 'bg-sky-500/15 text-sky-300' : 'bg-green-500/15 text-green-400'}`} title={it.source === 'email' ? `From the email review${it.subject ? ` — “${it.subject}”` : ''}` : 'Logged in the feedback sheet'}>{it.source === 'email' ? '✉ email' : '📋 sheet'}</span>
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
