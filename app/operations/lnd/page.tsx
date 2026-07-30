'use client'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Header from '@/components/Header'
import { getLnd, getLndModules, creditedPct, strictPct, type LndRow, type LndModule } from '@/lib/supabase'

const sel = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'
// Re-reads the published sheet on demand. Authenticated with the public anon key —
// the private sync token stays server-side, out of this bundle.
const SYNC_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '') + '/functions/v1/sync-lnd?year=2026'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
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
// Always show the canonical full legal name; the summary tab's short name is an
// unstable alias and must never be what a manager reads.
const displayName = (r: { learner_full_name?: string | null; learner_name: string }) => r.learner_full_name || r.learner_name

type Group = { key: string; n: number; credited: number; zero: number; complete: number; stalled: number }

// Shared by "By level" and "By reporting manager" — both want the same three facts:
// how many people, how many finished, and who is not moving.
const Breakdown = ({ title, rows, note }: { title: string; rows: Group[]; note?: string }) => (
  <div className="bg-mav-panel border border-mav-line rounded-xl p-5">
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="font-semibold">{title}</h2>
      {note && <span className="text-xs text-mav-muted">{note}</span>}
    </div>
    <div className="space-y-4">
      {rows.map(g => (
        <div key={g.key}>
          <div className="flex justify-between items-baseline text-sm mb-1 gap-2">
            <span className="truncate" title={g.key}>{g.key}</span>
            <span className="font-semibold shrink-0">{pct(g.credited)}</span>
          </div>
          <div className="h-2 rounded-full bg-mav-line overflow-hidden">
            <div className="h-full bg-mav-yellow" style={{ width: `${g.credited}%` }} />
          </div>
          <div className="text-[11px] mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-mav-muted">{g.n} {g.n === 1 ? 'member' : 'members'}</span>
            <span className={g.complete ? 'text-green-400' : 'text-mav-muted'}>{g.complete} completed</span>
            {g.zero > 0 && <span className="text-red-400">{g.zero} never started</span>}
            {g.stalled > 0 && <span className="text-amber-400">{g.stalled} stalled</span>}
          </div>
        </div>
      ))}
    </div>
  </div>
)

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
  const [mods, setMods] = useState<LndModule[]>([])
  const [loading, setLoading] = useState(true)
  const [level, setLevel] = useState('')
  const [mgr, setMgr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'' | 'zero' | 'stalled' | 'done'>('')
  const [sort, setSort] = useState<'progress' | 'name' | 'activity'>('progress')
  const [picked, setPicked] = useState<LndRow | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  useEffect(() => { Promise.all([getLnd(), getLndModules()]).then(([r, m]) => { setRows(r); setMods(m); setLoading(false) }) }, [])

  // Pull the sheet again right now. Reports what actually moved — "no change" is a
  // real, useful answer, and saying it plainly beats a spinner that implies work.
  async function syncNow() {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: ANON ? { apikey: ANON, Authorization: 'Bearer ' + ANON } : {},
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
      const [r2, m2] = await Promise.all([getLnd(), getLndModules()])
      setRows(r2); setMods(m2)
      setSyncMsg(
        j.added || j.changed
          ? `Synced — ${j.added} new, ${j.changed} updated. Latest snapshot ${fmtDate(j.latest_snapshot)}.`
          : `Synced — nothing changed in the sheet. Latest snapshot ${fmtDate(j.latest_snapshot)}.`,
      )
    } catch (err) {
      setSyncMsg(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicked(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      if (q && !`${displayName(r)} ${r.reporting_manager || ''} ${r.remarks || ''}`.toLowerCase().includes(q.toLowerCase())) return false
      if (only === 'zero' && !zeroStart(r)) return false
      if (only === 'stalled' && !stalled(r)) return false
      if (only === 'done' && strictPct(r) < 100) return false
      return true
    })
    list = list.slice().sort((a, b) =>
      sort === 'name' ? displayName(a).localeCompare(displayName(b))
      : sort === 'activity' ? (b.last_activity || '').localeCompare(a.last_activity || '')
      : creditedPct(b) - creditedPct(a))
    return list
  }, [current, level, mgr, q, only, sort])

  const byLevel = useMemo(() => levels.map(l => {
    const g = current.filter(r => r.level === l)
    return {
      key: l, n: g.length,
      credited: g.reduce((s, r) => s + creditedPct(r), 0) / (g.length || 1),
      zero: g.filter(zeroStart).length,
      complete: g.filter(r => strictPct(r) >= 100).length,
      stalled: g.filter(stalled).length,
    }
  }), [current, levels])

  const byMgr = useMemo(() => mgrs.map(m => {
    const g = current.filter(r => (r.reporting_manager || '') === m)
    return {
      key: m, n: g.length,
      credited: g.reduce((s, r) => s + creditedPct(r), 0) / (g.length || 1),
      zero: g.filter(zeroStart).length,
      complete: g.filter(r => strictPct(r) >= 100).length,
      stalled: g.filter(stalled).length,
    }
  }).sort((a, b) => b.n - a.n), [current, mgrs])

  // Every assigned course, across the whole cohort. This is the view the weekly
  // summary could never give: which courses land and which ones people stall on.
  const byCourse = useMemo(() => {
    const m = new Map<string, { course: string; track: string; n: number; done: number; doing: number; ns: number }>()
    for (const x of mods) {
      const k = x.course
      const e = m.get(k) || { course: x.course, track: x.track || '—', n: 0, done: 0, doing: 0, ns: 0 }
      e.n++
      if (x.is_complete || /complete/i.test(x.status || '')) e.done++
      else if (/progress/i.test(x.status || '')) e.doing++
      else e.ns++
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => (b.n - a.n) || (a.done / a.n - b.done / b.n))
  }, [mods])

  // Modules for whoever is open in the drawer.
  const pickedMods = useMemo(() => {
    if (!picked) return []
    const key = picked.learner_key
    return mods
      .filter(x => key ? x.learner_key === key : x.learner_full_name === displayName(picked))
      .sort((a, b) => {
        const rank = (x: LndModule) => (x.is_complete || /complete/i.test(x.status || '')) ? 0 : /progress/i.test(x.status || '') ? 1 : 2
        return rank(a) - rank(b) || a.course.localeCompare(b.course)
      })
  }, [mods, picked])

  // One learner's row from every snapshot they appear in, oldest first.
  const history = useMemo(
    () => picked ? rows.filter(r => (r.learner_key || r.learner_name) === (picked.learner_key || picked.learner_name)).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)) : [],
    [rows, picked],
  )

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
        const p = prevBy.get(r.learner_key || r.learner_name.toLowerCase())
        return s + (p ? Math.max(0, r.completed - p.completed) : 0)
      }, 0),
      movedPeople: current.filter(r => {
        const p = prevBy.get(r.learner_key || r.learner_name.toLowerCase())
        return p != null && r.completed > p.completed
      }).length,
      carried: current.filter(r => prevBy.has(r.learner_key || r.learner_name.toLowerCase())).length,
      fresh: current.filter(r => !prevBy.has(r.learner_key || r.learner_name.toLowerCase())).length,
    }
  }, [current, prevBy])

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

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={syncNow} disabled={syncing}
          title="Re-read the L&D sheet now instead of waiting for the hourly pull"
          className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-mav-line hover:border-mav-yellow hover:text-white text-mav-muted disabled:opacity-60 disabled:hover:border-mav-line">
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {syncMsg && (
          <span className={`text-xs ${syncMsg.startsWith('Sync failed') ? 'text-red-400' : 'text-mav-muted'}`}>{syncMsg}</span>
        )}
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <Breakdown title="By level" rows={byLevel} />
        <Breakdown title="By reporting manager" rows={byMgr} note="who needs a nudge" />
      </div>

      {byCourse.length > 0 && (
        <div className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="font-semibold">By course</h2>
            <span className="text-xs text-mav-muted">{mods.length} assignments across {byCourse.length} courses</span>
          </div>
          <p className="text-xs text-mav-muted mb-4">
            Where the cohort gets stuck. A course with people in progress and nobody finishing is a
            course problem, not a motivation problem.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-mav-muted border-b border-mav-line">
                <tr>
                  <th className="px-2 py-2">Course</th>
                  <th className="px-2 py-2">Track</th>
                  <th className="px-2 py-2 text-right">Assigned</th>
                  <th className="px-2 py-2 text-right">Completed</th>
                  <th className="px-2 py-2 text-right">In progress</th>
                  <th className="px-2 py-2 text-right">Not started</th>
                  <th className="px-2 py-2 w-32">Mix</th>
                </tr>
              </thead>
              <tbody>
                {byCourse.map(c => {
                  const stuck = c.n >= 5 && c.done === 0
                  return (
                    <tr key={c.course} className="border-b border-mav-line/60 last:border-0">
                      <td className="px-2 py-2">
                        {c.course}
                        {stuck && <span className="ml-2 text-[11px] text-red-400">nobody finishing</span>}
                      </td>
                      <td className="px-2 py-2 text-mav-muted text-xs">{c.track}</td>
                      <td className="px-2 py-2 text-right">{c.n}</td>
                      <td className={`px-2 py-2 text-right ${c.done ? 'text-green-400' : 'text-mav-muted'}`}>{c.done}</td>
                      <td className={`px-2 py-2 text-right ${c.doing ? 'text-mav-yellow' : 'text-mav-muted'}`}>{c.doing}</td>
                      <td className="px-2 py-2 text-right text-mav-muted">{c.ns}</td>
                      <td className="px-2 py-2">
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-mav-line">
                          <div className="bg-green-500" style={{ width: `${(c.done / c.n) * 100}%` }} />
                          <div className="bg-mav-yellow" style={{ width: `${(c.doing / c.n) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                const p = prevBy.get(r.learner_key || r.learner_name.toLowerCase())
                const gained = p ? r.completed - p.completed : null
                return (
                  <tr key={r.id} className="border-b border-mav-line/60 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <button onClick={() => setPicked(r)}
                        className="font-medium text-left hover:text-mav-yellow hover:underline underline-offset-2">
                        {displayName(r)}
                      </button>
                      {!p && <div><span className="text-[11px] text-mav-yellow">new this snapshot</span></div>}
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

      {picked && (
          <div className="fixed inset-0 z-40" onClick={() => setPicked(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <aside onClick={e => e.stopPropagation()}
              className="absolute right-0 top-0 h-full w-full max-w-lg bg-mav-panel border-l border-mav-line shadow-2xl overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-semibold">{displayName(picked)}</h2>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{picked.level}</span>
                    {picked.reporting_manager && <span className="text-xs px-2 py-1 rounded-full bg-mav-line text-mav-muted">{picked.reporting_manager}</span>}
                    <span className={`text-xs px-2 py-1 rounded-full ${strictPct(picked) >= 100 ? 'bg-green-500/15 text-green-400' : 'bg-mav-line text-mav-muted'}`}>
                      {pct(creditedPct(picked))} · {pct(strictPct(picked))} strict
                    </span>
                  </div>
                </div>
                <button onClick={() => setPicked(null)} className="text-mav-muted hover:text-white text-2xl leading-none">×</button>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-6 text-center">
                <div className="rounded-lg border border-green-500/25 bg-green-500/[0.05] py-3">
                  <div className="text-2xl font-semibold text-green-400">{picked.completed}</div>
                  <div className="text-[11px] text-mav-muted">completed</div>
                </div>
                <div className="rounded-lg border border-mav-yellow/25 bg-mav-yellow/[0.05] py-3">
                  <div className="text-2xl font-semibold text-mav-yellow">{picked.in_progress}</div>
                  <div className="text-[11px] text-mav-muted">in progress</div>
                </div>
                <div className="rounded-lg border border-mav-line py-3">
                  <div className="text-2xl font-semibold text-mav-muted">{picked.not_started}</div>
                  <div className="text-[11px] text-mav-muted">not started</div>
                </div>
              </div>

              <div className="text-xs uppercase tracking-wide text-mav-muted mb-2">
                Courses <span className="normal-case tracking-normal">({pickedMods.length} assigned)</span>
              </div>
              {pickedMods.length ? (
                <div className="space-y-1.5 mb-6">
                  {pickedMods.map(m => {
                    const done = m.is_complete || /complete/i.test(m.status || '')
                    const doing = !done && /progress/i.test(m.status || '')
                    return (
                      <div key={m.id} className={`rounded-lg border p-2.5 ${done ? 'border-green-500/25 bg-green-500/[0.05]' : doing ? 'border-mav-yellow/25 bg-mav-yellow/[0.05]' : 'border-mav-line'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm">{done ? '✓' : doing ? '◐' : '○'} {m.course}</span>
                          <span className={`text-[11px] shrink-0 ${done ? 'text-green-400' : doing ? 'text-mav-yellow' : 'text-mav-muted'}`}>
                            {done ? 'Completed' : doing ? `${m.completion_pct ?? 0}%` : 'Not started'}
                          </span>
                        </div>
                        <div className="text-[11px] text-mav-muted mt-1 flex flex-wrap gap-x-3">
                          {m.track && <span>{m.track}</span>}
                          {m.started_on && <span>started {fmtDate(m.started_on)}</span>}
                          {m.completed_on && <span>finished {fmtDate(m.completed_on)}</span>}
                          {!m.started_on && !m.completed_on && <span>never opened</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-mav-muted mb-6">No module rows for this learner in the level tabs.</p>
              )}

              <div className="text-xs uppercase tracking-wide text-mav-muted mb-2">Week by week</div>
              <div className="space-y-2">
                {history.slice().reverse().map((h, i, arr) => {
                  const older = arr[i + 1]
                  const gained = older ? h.completed - older.completed : null
                  return (
                    <div key={h.id} className={`rounded-lg border p-3 ${h.snapshot_date === latest ? 'border-mav-yellow/30 bg-mav-yellow/[0.04]' : 'border-mav-line'}`}>
                      <div className="flex justify-between items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {fmtDate(h.snapshot_date)}
                          {h.snapshot_date === latest && <span className="text-[11px] text-mav-yellow ml-2">latest</span>}
                        </span>
                        <span className="text-xs shrink-0">
                          {h.completed}/{h.total_modules} done
                          {gained != null && gained > 0 && <span className="text-green-400 ml-2">+{gained}</span>}
                          {gained === 0 && <span className="text-mav-muted ml-2">no change</span>}
                        </span>
                      </div>
                      <ProgressBar r={h} />
                      {h.remarks && <p className="text-xs text-mav-muted mt-2 leading-relaxed">{h.remarks}</p>}
                      <div className="text-[11px] text-mav-muted mt-1">Last activity {fmtDate(h.last_activity)}</div>
                    </div>
                  )
                })}
              </div>
              {history.length === 1 && (
                <p className="text-xs text-mav-muted mt-3">First snapshot for this learner — no earlier week to compare against.</p>
              )}
            </aside>
          </div>
      )}
    </div>
  )
}
