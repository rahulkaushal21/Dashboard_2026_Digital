'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { getLnd, creditedPct, strictPct, type LndRow } from '@/lib/supabase'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
const pct = (n: number) => `${n.toFixed(1)}%`
const dayjs = (s?: string | null) => (s || '').slice(0, 10)
const fmtDate = (s?: string | null) =>
  s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—'

// Days since a learner last did anything, measured against the snapshot date rather
// than "today" so the number doesn't drift while the sheet sits un-updated.
const daysBetween = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null
  const d = (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000
  return Number.isFinite(d) ? Math.round(d) : null
}
const STALL_DAYS = 14

const Stat = ({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
    <div className="text-xs uppercase tracking-wide text-mav-muted">{label}</div>
    <div className={`text-3xl font-semibold mt-2 ${tone}`}>{value}</div>
    {sub && <div className="text-xs text-mav-muted mt-2">{sub}</div>}
  </div>
)

// completed / in-progress / not-started as one bar.
const ProgressBar = ({ r }: { r: LndRow }) => {
  const t = Math.max(r.total_modules, 1)
  const w = (n: number) => `${(n / t) * 100}%`
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-mav-line" title={`${r.completed} done · ${r.in_progress} in progress · ${r.not_started} not started`}>
      <div className="bg-green-500" style={{ width: w(r.completed) }} />
      <div className="bg-mav-yellow" style={{ width: w(r.in_progress) }} />
      <div className="bg-transparent" style={{ width: w(r.not_started) }} />
    </div>
  )
}

export default function LndPage() {
  const [rows, setRows] = useState<LndRow[]>([])
  const [loading, setLoading] = useState(true)
  const [level, setLevel] = useState('')
  const [mgr, setMgr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'' | 'zero' | 'stalled' | 'done'>('')
  const [sort, setSort] = useState<'progress' | 'name' | 'activity'>('progress')

  useEffect(() => { getLnd().then(r => { setRows(r); setLoading(false) }) }, [])

  const dates = useMemo(
    () => Array.from(new Set(rows.map(r => r.snapshot_date))).sort(),
    [rows],
  )
  const latest = dates[dates.length - 1]
  const prev = dates[dates.length - 2]

  const current = useMemo(() => rows.filter(r => r.snapshot_date === latest), [rows, latest])
  const prevBy = useMemo(() => {
    const m = new Map<string, LndRow>()
    rows.filter(r => r.snapshot_date === prev).forEach(r => m.set(r.learner_name.toLowerCase(), r))
    return m
  }, [rows, prev])

  const levels = useMemo(() => Array.from(new Set(current.map(r => r.level))).sort(), [current])
  const mgrs = useMemo(() => Array.from(new Set(current.map(r => r.reporting_manager || '').filter(Boolean))).sort(), [current])

  const zeroStart = (r: LndRow) => r.completed === 0 && r.in_progress === 0
  const stalled = (r: LndRow) => {
    const d = daysBetween(r.last_activity, latest)
    return !zeroStart(r) && d != null && d >= STALL_DAYS && strictPct(r) < 100
  }

  const filtered = useMemo(() => {
    let list = current.filter(r => {
      if (level && r.level !== level) return false
      if (mgr && (r.reporting_manager || '') !== mgr) return false
      if (q && !`${r.learner_name} ${r.reporting_manager || ''} ${r.remarks || ''}`.toLowerCase().includes(q.toLowerCase())) return false
      if (only === 'zero' && !zeroStart(r)) return false
      if (only === 'stalled' && !stalled(r)) return false
      if (only === 'done' && strictPct(r) < 100) return false
      return true
    })
    list = list.slice().sort((a, b) =>
      sort === 'name' ? a.learner_name.localeCompare(b.learner_name)
      : sort === 'activity' ? (b.last_activity || '').localeCompare(a.last_activity || '')
      : creditedPct(b) - creditedPct(a))
    return list
  }, [current, level, mgr, q, only, sort])

  // Cohort trend on a CONSISTENT basis, recomputed from counts every week.
  const trend = useMemo(() => dates.map(d => {
    const g = rows.filter(r => r.snapshot_date === d)
    const n = g.length || 1
    return {
      date: d,
      learners: g.length,
      credited: g.reduce((s, r) => s + creditedPct(r), 0) / n,
      strict: g.reduce((s, r) => s + strictPct(r), 0) / n,
      done: g.reduce((s, r) => s + r.completed, 0),
      total: g.reduce((s, r) => s + r.total_modules, 0),
    }
  }), [rows, dates])

  const byLevel = useMemo(() => levels.map(l => {
    const g = current.filter(r => r.level === l)
    return { level: l, n: g.length, credited: g.reduce((s, r) => s + creditedPct(r), 0) / (g.length || 1), zero: g.filter(zeroStart).length }
  }), [current, levels])

  const byMgr = useMemo(() => mgrs.map(m => {
    const g = current.filter(r => (r.reporting_manager || '') === m)
    return {
      mgr: m, n: g.length,
      credited: g.reduce((s, r) => s + creditedPct(r), 0) / (g.length || 1),
      zero: g.filter(zeroStart).length,
      stalled: g.filter(stalled).length,
    }
  }).sort((a, b) => b.n - a.n), [current, mgrs])

  const k = useMemo(() => {
    const n = current.length || 1
    return {
      learners: current.length,
      credited: current.reduce((s, r) => s + creditedPct(r), 0) / n,
      strict: current.reduce((s, r) => s + strictPct(r), 0) / n,
      done: current.reduce((s, r) => s + r.completed, 0),
      total: current.reduce((s, r) => s + r.total_modules, 0),
      zero: current.filter(zeroStart).length,
      stalled: current.filter(stalled).length,
      complete: current.filter(r => strictPct(r) >= 100).length,
      // Genuine week-on-week movement = modules actually completed, never the %.
      movedModules: current.reduce((s, r) => {
        const p = prevBy.get(r.learner_name.toLowerCase())
        return s + (p ? Math.max(0, r.completed - p.completed) : 0)
      }, 0),
      movedPeople: current.filter(r => {
        const p = prevBy.get(r.learner_name.toLowerCase())
        return p != null && r.completed > p.completed
      }).length,
      carried: current.filter(r => prevBy.has(r.learner_name.toLowerCase())).length,
      fresh: current.filter(r => !prevBy.has(r.learner_name.toLowerCase())).length,
    }
  }, [current, prevBy])

  const maxTrend = Math.max(...trend.map(t => t.credited), 10)

  if (loading) return <div><Header title="Learning & Development" subtitle="Loading…" /><p className="text-sm text-mav-muted">Loading…</p></div>
  if (!rows.length) return (
    <div>
      <Header title="Learning & Development" subtitle="Team upskilling program" />
      <div className="rounded-lg border border-mav-line bg-mav-panel px-4 py-10 text-center text-sm text-mav-muted">No L&amp;D snapshots loaded yet.</div>
    </div>
  )

  return (
    <div>
      <Header
        title="Learning & Development"
        subtitle={`Team upskilling program · ${k.learners} learners · snapshot ${fmtDate(latest)}`}
      />

      {/* The single most important caveat about this data. */}
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-mav-muted">
        <span className="text-amber-300 font-semibold">Progress is recomputed here, not read from the sheet.</span>{' '}
        Every figure below is derived from the raw module counts, with an in-progress module credited as half.
        The sheet&rsquo;s own <em>Overall Progress</em> column changed definition on 29 Jul 2026 — nine learners
        appeared to jump ahead without finishing a single module — so it is stored for audit and never displayed.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="Active learners" value={String(k.learners)}
          sub={`${k.carried} continuing · ${k.fresh} new this snapshot`} />
        <Stat label="Cohort progress" value={pct(k.credited)}
          sub={`${pct(k.strict)} counting completed modules only`} />
        <Stat label="Modules completed" value={`${k.done} / ${k.total}`}
          sub={`${pct((k.done / Math.max(k.total, 1)) * 100)} of everything assigned`} />
        <Stat label="Never started" value={String(k.zero)} tone={k.zero ? 'text-red-400' : 'text-green-400'}
          sub={k.zero ? 'no module opened at all' : 'everyone has begun'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <Stat label={`Stalled ${STALL_DAYS}+ days`} value={String(k.stalled)} tone={k.stalled ? 'text-amber-400' : ''}
          sub="started, then went quiet" />
        <Stat label="Finished the track" value={String(k.complete)} tone={k.complete ? 'text-green-400' : ''}
          sub="all assigned modules complete" />
        <Stat label="Real movement since last snapshot" value={`${k.movedModules} modules`}
          sub={`${k.movedPeople} of ${k.carried} continuing learners completed something`} />
      </div>

      {/* Cohort trend — recomputed, so it is comparable across weeks. */}
      <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-semibold">Cohort progress over time</h2>
          <span className="text-xs text-mav-muted">credited basis · recomputed from counts</span>
        </div>
        <div className="flex items-end gap-3 h-40">
          {trend.map(t => (
            <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-2">
              <span className="text-xs font-semibold">{pct(t.credited)}</span>
              <div className="w-full rounded-t bg-mav-yellow/80" style={{ height: `${(t.credited / maxTrend) * 100}%`, minHeight: 4 }} />
              <span className="text-[11px] text-mav-muted whitespace-nowrap">{fmtDate(t.date)}</span>
              <span className="text-[11px] text-mav-muted">{t.learners} ppl</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-mav-muted mt-4">
          Modules completed: {trend.map(t => `${fmtDate(t.date)} ${t.done}/${t.total}`).join('  ·  ')}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <h2 className="font-semibold mb-4">By level</h2>
          <div className="space-y-3">
            {byLevel.map(l => (
              <div key={l.level}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{l.level} <span className="text-mav-muted">· {l.n}</span></span>
                  <span className="font-semibold">{pct(l.credited)}</span>
                </div>
                <div className="h-2 rounded-full bg-mav-line overflow-hidden">
                  <div className="h-full bg-mav-yellow" style={{ width: `${l.credited}%` }} />
                </div>
                {l.zero > 0 && <div className="text-[11px] text-red-400 mt-1">{l.zero} never started</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-semibold">By reporting manager</h2>
            <span className="text-xs text-mav-muted">who needs a nudge</span>
          </div>
          <div className="space-y-3">
            {byMgr.map(m => (
              <div key={m.mgr}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="truncate pr-2" title={m.mgr}>{m.mgr} <span className="text-mav-muted">· {m.n}</span></span>
                  <span className="font-semibold">{pct(m.credited)}</span>
                </div>
                <div className="h-2 rounded-full bg-mav-line overflow-hidden">
                  <div className="h-full bg-mav-yellow" style={{ width: `${m.credited}%` }} />
                </div>
                <div className="text-[11px] mt-1 flex gap-3">
                  {m.zero > 0 && <span className="text-red-400">{m.zero} never started</span>}
                  {m.stalled > 0 && <span className="text-amber-400">{m.stalled} stalled</span>}
                  {!m.zero && !m.stalled && <span className="text-green-400">all moving</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search learner or manager…" className={`${sel} min-w-[200px] flex-1`} />
        <select value={level} onChange={e => setLevel(e.target.value)} className={sel}>
          <option value="">All levels</option>
          {levels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={mgr} onChange={e => setMgr(e.target.value)} className={sel}>
          <option value="">All managers</option>
          {mgrs.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className={sel}>
          <option value="progress">Sort: progress</option>
          <option value="name">Sort: name</option>
          <option value="activity">Sort: last activity</option>
        </select>
        <button onClick={() => setOnly(only === 'zero' ? '' : 'zero')}
          className={`text-xs px-2 py-1.5 rounded-md border ${only === 'zero' ? 'border-red-400 text-red-300 bg-red-500/10' : 'border-mav-line text-mav-muted hover:text-white'}`}>
          Never started ({k.zero})
        </button>
        <button onClick={() => setOnly(only === 'stalled' ? '' : 'stalled')}
          className={`text-xs px-2 py-1.5 rounded-md border ${only === 'stalled' ? 'border-amber-400 text-amber-300 bg-amber-500/10' : 'border-mav-line text-mav-muted hover:text-white'}`}>
          Stalled ({k.stalled})
        </button>
        <button onClick={() => setOnly(only === 'done' ? '' : 'done')}
          className={`text-xs px-2 py-1.5 rounded-md border ${only === 'done' ? 'border-green-400 text-green-300 bg-green-500/10' : 'border-mav-line text-mav-muted hover:text-white'}`}>
          Complete ({k.complete})
        </button>
        {(q || level || mgr || only) && <button onClick={() => { setQ(''); setLevel(''); setMgr(''); setOnly('') }} className="text-xs text-mav-muted hover:text-white">✕ clear</button>}
        <span className="text-xs text-mav-muted ml-auto">{filtered.length} learners</span>
      </div>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-mav-muted border-b border-mav-line">
              <tr>
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Manager</th>
                <th className="px-4 py-3 w-48">Modules</th>
                <th className="px-4 py-3 text-right">Progress</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const gap = daysBetween(r.last_activity, latest)
                const p = prevBy.get(r.learner_name.toLowerCase())
                const gained = p ? r.completed - p.completed : null
                return (
                  <tr key={r.id} className="border-b border-mav-line/60 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.learner_name}</div>
                      {!p && <span className="text-[11px] text-mav-yellow">new this snapshot</span>}
                    </td>
                    <td className="px-4 py-3 text-mav-muted">{r.level}</td>
                    <td className="px-4 py-3 text-mav-muted truncate max-w-[180px]" title={r.reporting_manager || ''}>{r.reporting_manager || '—'}</td>
                    <td className="px-4 py-3">
                      <ProgressBar r={r} />
                      <div className="text-[11px] text-mav-muted mt-1">
                        {r.completed} done · {r.in_progress} in progress · {r.not_started} to start
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={`font-semibold ${strictPct(r) >= 100 ? 'text-green-400' : creditedPct(r) === 0 ? 'text-red-400' : ''}`}>
                        {pct(creditedPct(r))}
                      </div>
                      <div className="text-[11px] text-mav-muted">{pct(strictPct(r))} strict</div>
                      {gained != null && gained > 0 && <div className="text-[11px] text-green-400">+{gained} this week</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className={gap != null && gap >= STALL_DAYS ? 'text-amber-400' : 'text-mav-muted'}>{fmtDate(r.last_activity)}</div>
                      {gap != null && <div className="text-[11px] text-mav-muted">{gap}d before snapshot</div>}
                    </td>
                    <td className="px-4 py-3 text-mav-muted text-xs max-w-[280px]">{r.remarks || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-mav-muted mt-3">
        Source: L&amp;D program sheet, published to web and pulled hourly. Snapshots held:{' '}
        {dates.map(fmtDate).join(' · ')}.
      </p>
    </div>
  )
}
