'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { Panel } from '@/components/PageParts'
import { getPmIncentives, type PmIncentiveRow } from '@/lib/supabase'

// The quarter's PM incentive: base plus a growth booster, per PM.
//
// ITS OWN PAGE, AND ITS OWN MENU ENTRY, because it is not for the same audience as the
// rest of PM Team. canSee() in lib/access hides the rail entry and refuses the route for
// everybody outside INCENTIVE_EMAILS — one rule covering both, since a page merely
// missing from the sidebar is still reachable by typing its address.
//
// WHY THERE IS NO ARITHMETIC HERE. The dashboard is a static export, so anything this
// file worked out would ship inside public JavaScript that needs no login to read — the
// rates and every payout, one "view source" away. The page renders what
// pm_incentive_sheet() returns and nothing else, and that function hands rows only to the
// addresses listed in incentive_viewers. Even the base rate on screen is divided back out
// of the figures rather than written down.
//
// THE ONE EXCEPTION is the pace reading on a quarter still running, which divides a
// booked total by the months gone. Both numbers are already in the payload and neither
// rate is involved, so nothing new is published by doing it here.

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = (n: number | null) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const RATE_KEY = 'incentive_usd_inr'

// The financial year's quarters. These land on calendar quarter boundaries, which is why
// the function can take a start date and work the rest out for itself.
const QUARTERS = [
  { key: 'Q1', start: '2026-04-01', months: 'Apr–Jun 2026' },
  { key: 'Q2', start: '2026-07-01', months: 'Jul–Sep 2026' },
  { key: 'Q3', start: '2026-10-01', months: 'Oct–Dec 2026' },
]

// How much of a quarter has actually happened: whole months gone, plus the fraction of
// the one running. A quarter still open divides its booked total by THREE inside the
// function — correct once it closes, and badly wrong before, because on 15 October it
// reads every PM at minus eighty per cent. So the page measures the pace instead, and
// says plainly that it is a pace.
function elapsedMonths(start: string, now = new Date()): number {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(s); e.setMonth(e.getMonth() + 3)
  if (now >= e) return 3
  if (now <= s) return 0
  const full = (now.getFullYear() - s.getFullYear()) * 12 + (now.getMonth() - s.getMonth())
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return full + (now.getTime() - mStart.getTime()) / (mEnd.getTime() - mStart.getTime())
}

export default function IncentivePage() {
  const [q, setQ] = useState('Q2')
  // Kept per quarter, so flipping between tabs in front of an audience does not blank
  // the table and re-ask the database each time.
  const [byQuarter, setByQuarter] = useState<Record<string, PmIncentiveRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [pm, setPm] = useState('')
  // The quarter's USD→INR rate. Typed in rather than built in, because it changes every
  // quarter — 87.59 was Q1's and 89.41 is Q2's — and remembered in this browser so it
  // survives a reload without being written into the build or the database. A per-viewer
  // convenience, which is the only thing localStorage is good for: it can come back empty
  // in a private window or with site data cleared, so every read and write is wrapped and
  // the page renders fine without it.
  const [inr, setInr] = useState('')
  useEffect(() => {
    try { const v = localStorage.getItem(RATE_KEY); if (v) setInr(v) } catch {}
  }, [])
  const setRate = (v: string) => {
    setInr(v)
    try { localStorage.setItem(RATE_KEY, v) } catch {}
  }

  const quarter = QUARTERS.find(x => x.key === q) || QUARTERS[1]

  useEffect(() => {
    if (byQuarter[q]) { setLoading(false); return }
    setLoading(true)
    getPmIncentives(quarter.start)
      .then(r => setByQuarter(prev => ({ ...prev, [q]: r })))
      .finally(() => setLoading(false))
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = byQuarter[q] || []
  const gone = elapsedMonths(quarter.start)
  const open = gone < 3
  // Under a week in, a run rate is noise dressed as a number.
  const paceReadable = gone >= 0.25

  // Named PM or everybody. The point of the filter is a screenshare: one person's figures
  // on screen and nobody else's, so the headline stats narrow with the table.
  const rows = useMemo(() => pm ? all.filter(r => r.pm_owner === pm) : all, [all, pm])

  const base = rows.reduce((s, r) => s + r.base_usd, 0)
  const boost = rows.reduce((s, r) => s + r.growth_usd, 0)
  const revenue = rows.reduce((s, r) => s + r.this_total, 0)
  const earners = rows.filter(r => r.growth_usd > 0).length
  // Recovered from the data, never stated: base_usd is this_total times the rate. Read
  // off the whole quarter rather than the filtered rows, so it survives a PM with no
  // revenue being selected.
  const withRev = all.find(r => r.this_total > 0)
  const baseRate = withRev ? (withRev.base_usd / withRev.this_total) * 100 : null

  const rate = Number(inr)
  const showInr = Number.isFinite(rate) && rate > 0
  const toInr = (n: number) => '₹' + Math.round(n * rate).toLocaleString('en-IN')

  const th = 'px-3 py-2.5 font-medium whitespace-nowrap text-xs text-mav-fg/70'
  const td = 'px-3 py-2.5 whitespace-nowrap text-sm'

  return (
    <div>
      <Header title="Incentive" chip={quarter.months}
        subtitle="Base on the quarter’s delivered revenue, plus a booster for beating the bar" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {QUARTERS.map(x => {
          const running = elapsedMonths(x.start) < 3
          return (
            <button key={x.key} onClick={() => setQ(x.key)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                x.key === q
                  ? 'bg-mav-yellow text-black border-mav-yellow font-medium'
                  : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
              {x.key} <span className="opacity-70 text-xs">{x.months}</span>
              {running && <span className={`ml-1.5 text-[10px] ${x.key === q ? 'opacity-70' : 'text-amber-400'}`}>open</span>}
            </button>
          )
        })}
        <label className="ml-auto flex items-center gap-2 text-xs text-mav-muted">
          PM
          <select value={pm} onChange={e => setPm(e.target.value)}
            className="bg-mav-panel border border-mav-line rounded-lg px-2.5 py-1.5 text-sm text-mav-fg outline-none focus:border-mav-yellow">
            <option value="">All PMs</option>
            {all.map(r => <option key={r.pm_owner} value={r.pm_owner}>{r.pm_owner}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-mav-muted">
          USD→INR
          <input value={inr} onChange={e => setRate(e.target.value)} placeholder="rate" inputMode="decimal"
            className="w-24 bg-mav-dark border border-mav-fg/20 rounded px-2 py-1 text-xs text-mav-fg
                       focus:outline-none focus:border-mav-yellow" />
        </label>
      </div>

      {/* Said before any figure on an open quarter is read, not in a footnote under it. */}
      {open && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <b>{quarter.key} is still running</b> — {Math.round((gone / 3) * 100)}% of it gone.
          Base is what has been earned so far and will grow. Growth and the booster are
          <b> not settled until the quarter closes</b>, so the column shows the pace against
          the bar rather than a result.
        </div>
      )}

      {loading ? <div className="text-sm text-mav-muted">Loading…</div>
       : !all.length ? <p className="text-sm text-mav-muted mt-8">Nothing to show.</p>
       : <>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Delivered" value={whole(revenue)} note={pm || `the quarter, all ${all.length} PMs`} />
        <Stat label={baseRate == null ? 'Base' : `Base @ ${baseRate.toFixed(2)}%`} value={usd(base)}
          note={open ? 'so far' : undefined} />
        <Stat label="Growth booster" value={open ? '—' : usd(boost)}
          note={open ? 'settles at quarter end' : `${earners} of ${rows.length} earned it`} />
        <Stat label={open ? 'Base so far' : 'Total payout'}
          value={showInr ? toInr(base + boost) : usd(base + boost)}
          note={showInr ? usd(base + boost) : 'USD'} strong />
      </div>

      <Panel flush className="mb-6" title={pm || 'Per PM'}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-y border-mav-line bg-mav-fg/[0.03]">
              <tr>
                <th className={th}>PM</th>
                <th className={`${th} text-right`}>Bar / month</th>
                <th className={`${th} text-right`}>{open ? 'Pace / month' : 'Qtr avg'}</th>
                <th className={`${th} text-right`}>{open ? 'Pace vs bar' : 'Growth'}</th>
                <th className={`${th} text-right`}>Delivered</th>
                <th className={`${th} text-right`}>Base</th>
                {!open && <th className={`${th} text-right`}>Booster</th>}
                {!open && <th className={`${th} text-right`}>Total</th>}
                {showInr && <th className={`${th} text-right`}>INR</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                // On an open quarter the function's own average and growth are measured
                // over three months that have not happened. Both are re-read here against
                // the months that have.
                const pace = open && paceReadable ? r.this_total / gone : null
                const vsBar = pace != null && r.base_month ? (pace / r.base_month - 1) * 100 : null
                const shownAvg = open ? pace : r.this_avg
                const shownPct = open ? vsBar : r.growth_pct
                return (
                <tr key={r.pm_owner} className="border-b border-mav-line/60">
                  <td className={`${td} font-medium`}>{r.pm_owner}</td>
                  {/* The bar, and whether it was raised by an earlier quarter this year
                      rather than still being the last-year average. */}
                  <td className={`${td} text-right text-mav-fg/60`}>
                    {whole(r.base_month)}
                    {r.base_raised && <span className="ml-1 text-[11px] text-mav-yellow" title="Raised: an earlier quarter this year beat the last-year average">↑</span>}
                  </td>
                  <td className={`${td} text-right`}>{shownAvg == null ? <span className="text-mav-fg/30">too early</span> : whole(shownAvg)}</td>
                  <td className={`${td} text-right font-medium ${
                    shownPct == null ? 'text-mav-fg/30'
                    : shownPct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {/* Whole percentages, to read the same as the PM Team scorecard
                        next door rather than a decimal that looks like a disagreement. */}
                    {shownPct == null ? '—' : `${shownPct > 0 ? '+' : ''}${Math.round(shownPct)}%`}
                  </td>
                  <td className={`${td} text-right text-mav-fg/60`}>{whole(r.this_total)}</td>
                  <td className={`${td} text-right`}>{usd(r.base_usd)}</td>
                  {/* A zero booster shows as a dash, not $0.00: the row did not earn one,
                      which reads differently from earning one that rounded to nothing. */}
                  {!open && <td className={`${td} text-right`}>
                    {r.growth_usd > 0
                      ? <>{usd(r.growth_usd)} <span className="text-[11px] text-mav-muted">@{(r.growth_rate * 100).toFixed(2)}%</span></>
                      : <span className="text-mav-fg/25">—</span>}
                  </td>}
                  {!open && <td className={`${td} text-right font-semibold text-mav-yellow`}>{usd(r.total_usd)}</td>}
                  {showInr && <td className={`${td} text-right font-semibold`}>{toInr(open ? r.base_usd : r.total_usd)}</td>}
                </tr>
              )})}
            </tbody>
            {/* No total line under a single PM: it would just repeat their row. */}
            {!pm && <tfoot>
              <tr className="border-t border-mav-line">
                <td className={`${td} font-semibold`}>Total</td>
                <td colSpan={4} />
                <td className={`${td} text-right font-semibold`}>{usd(base)}</td>
                {!open && <td className={`${td} text-right font-semibold`}>{usd(boost)}</td>}
                {!open && <td className={`${td} text-right font-semibold text-mav-yellow`}>{usd(base + boost)}</td>}
                {showInr && <td className={`${td} text-right font-semibold`}>{toInr(base + boost)}</td>}
              </tr>
            </tfoot>}
          </table>
        </div>
      </Panel>
      </>}

      <Panel className="mb-6" title="How it is worked out">
        <ul className="text-sm text-mav-fg/80 space-y-2 list-disc pl-5">
          <li><b>Base</b> is a fixed percentage of the quarter&rsquo;s booked revenue, read from the <b>same table the PM Team scorecard reads</b>, so Booked, Avg/month and Base/month match it cell for cell.</li>
          <li><b>The bar</b> is the PM&rsquo;s last-year monthly average, raised to a better figure once they beat it in an earlier quarter of the same year, and never lowered. An <span className="text-mav-yellow">↑</span> marks a bar that has been raised.</li>
          <li><b>Growth</b> is the quarter&rsquo;s monthly average against that bar.</li>
          <li><b>The booster</b> is a further percentage of the same revenue, added to the base, and is <b>only ever a reward</b> &mdash; a quarter that did not beat the bar earns base alone.</li>
          <li><b>A quarter still running</b> shows its pace: revenue booked so far over the months gone. It is not a forecast and not a payout.</li>
          <li>The roster is the PM Team list. Somebody booking revenue who is not on it does not appear here at all.</li>
        </ul>
        <p className="mt-4 text-xs text-mav-muted">
          Revenue is credited to whoever owns the line, so an account changing hands moves
          it with them &mdash; worth a look before this pays out.
        </p>
      </Panel>
    </div>
  )
}

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-mav-line/60 bg-mav-panel px-3 py-2.5">
      <div className="text-[11px] text-mav-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${strong ? 'text-mav-yellow' : ''}`}>{value}</div>
      {note && <div className="text-[11px] text-mav-fg/45 mt-0.5">{note}</div>}
    </div>
  )
}
