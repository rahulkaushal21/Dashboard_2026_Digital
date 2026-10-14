'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { Panel } from '@/components/PageParts'
import { getPmIncentives, type PmIncentiveRow } from '@/lib/supabase'

// The quarter's PM incentive: base plus a growth booster, per PM.
//
// ITS OWN PAGE, AND ITS OWN MENU ENTRY, because it is not for the same audience as the
// rest of PM Team. canSee() in lib/access hides the rail entry and refuses the route for
// everybody but Rahul — one rule covering both, since a page merely missing from the
// sidebar is still reachable by typing its address.
//
// WHY THERE IS NO ARITHMETIC HERE. The dashboard is a static export, so anything this
// file worked out would ship inside public JavaScript that needs no login to read — the
// rates and every payout, one "view source" away. The page renders what
// pm_incentive_sheet() returns and nothing else, and that function hands rows to one
// email address. Even the base rate on screen is divided back out of the figures rather
// than written down.

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = (n: number | null) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')

export default function IncentivePage() {
  const [rows, setRows] = useState<PmIncentiveRow[]>([])
  const [loading, setLoading] = useState(true)
  // The quarter's USD→INR rate, typed in rather than stored: it changes every quarter and
  // 87.59 was last quarter's, not this one's. Kept in the page only, so no rate of any
  // kind is written into the build.
  const [inr, setInr] = useState('')

  useEffect(() => { getPmIncentives().then(setRows).finally(() => setLoading(false)) }, [])

  if (loading) return <div className="text-sm text-mav-muted">Loading…</div>

  // Also what anybody who reaches this page without being entitled to the data sees,
  // since the database hands them no rows.
  if (!rows.length) {
    return (
      <div>
        <Header title="Incentive" subtitle="Quarterly PM incentive" />
        <p className="text-sm text-mav-muted mt-8">Nothing to show.</p>
      </div>
    )
  }

  const base = rows.reduce((s, r) => s + r.base_usd, 0)
  const boost = rows.reduce((s, r) => s + r.growth_usd, 0)
  const revenue = rows.reduce((s, r) => s + r.this_total, 0)
  const earners = rows.filter(r => r.growth_usd > 0).length
  // Recovered from the data, never stated: base_usd is this_total times the rate.
  const withRev = rows.find(r => r.this_total > 0)
  const baseRate = withRev ? (withRev.base_usd / withRev.this_total) * 100 : null

  const rate = Number(inr)
  const showInr = Number.isFinite(rate) && rate > 0
  const toInr = (n: number) => '₹' + Math.round(n * rate).toLocaleString('en-IN')

  const th = 'px-3 py-2.5 font-medium whitespace-nowrap text-xs text-mav-fg/70'
  const td = 'px-3 py-2.5 whitespace-nowrap text-sm'

  return (
    <div>
      <Header title="Incentive" chip="Jul–Sep 2026"
        subtitle="Base on the quarter’s delivered revenue, plus a booster for beating the bar" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Delivered" value={whole(revenue)} note="the quarter, all PMs" />
        <Stat label={baseRate == null ? 'Base' : `Base @ ${baseRate.toFixed(2)}%`} value={usd(base)} />
        <Stat label="Growth booster" value={usd(boost)} note={`${earners} of ${rows.length} earned it`} />
        <Stat label="Total payout" value={showInr ? toInr(base + boost) : usd(base + boost)}
          note={showInr ? usd(base + boost) : 'USD'} strong />
      </div>

      <Panel flush className="mb-6" title="Per PM"
        right={
          <label className="flex items-center gap-2 text-xs text-mav-muted">
            USD→INR
            <input value={inr} onChange={e => setInr(e.target.value)} placeholder="rate" inputMode="decimal"
              className="w-24 bg-mav-dark border border-mav-fg/20 rounded px-2 py-1 text-xs text-mav-fg
                         focus:outline-none focus:border-mav-yellow" />
          </label>
        }>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-y border-mav-line bg-mav-fg/[0.03]">
              <tr>
                <th className={th}>PM</th>
                <th className={`${th} text-right`}>Bar / month</th>
                <th className={`${th} text-right`}>Qtr avg</th>
                <th className={`${th} text-right`}>Growth</th>
                <th className={`${th} text-right`}>Delivered</th>
                <th className={`${th} text-right`}>Base</th>
                <th className={`${th} text-right`}>Booster</th>
                <th className={`${th} text-right`}>Total</th>
                {showInr && <th className={`${th} text-right`}>INR</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.pm_owner} className="border-b border-mav-line/60">
                  <td className={`${td} font-medium`}>{r.pm_owner}</td>
                  {/* The bar, and whether it was raised by an earlier quarter this year
                      rather than still being the last-year average. */}
                  <td className={`${td} text-right text-mav-fg/60`}>
                    {whole(r.base_month)}
                    {r.base_raised && <span className="ml-1 text-[11px] text-mav-yellow" title="Raised: an earlier quarter this year beat the last-year average">↑</span>}
                  </td>
                  <td className={`${td} text-right`}>{whole(r.this_avg)}</td>
                  <td className={`${td} text-right font-medium ${
                    r.growth_pct == null ? 'text-mav-fg/30'
                    : r.growth_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {r.growth_pct == null ? 'no bar' : `${r.growth_pct > 0 ? '+' : ''}${r.growth_pct}%`}
                  </td>
                  <td className={`${td} text-right text-mav-fg/60`}>{whole(r.this_total)}</td>
                  <td className={`${td} text-right`}>{usd(r.base_usd)}</td>
                  {/* A zero booster shows as a dash, not $0.00: the row did not earn one,
                      which reads differently from earning one that rounded to nothing. */}
                  <td className={`${td} text-right`}>
                    {r.growth_usd > 0
                      ? <>{usd(r.growth_usd)} <span className="text-[11px] text-mav-muted">@{(r.growth_rate * 100).toFixed(2)}%</span></>
                      : <span className="text-mav-fg/25">—</span>}
                  </td>
                  <td className={`${td} text-right font-semibold text-mav-yellow`}>{usd(r.total_usd)}</td>
                  {showInr && <td className={`${td} text-right font-semibold`}>{toInr(r.total_usd)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-mav-line">
                <td className={`${td} font-semibold`}>Total</td>
                <td colSpan={4} />
                <td className={`${td} text-right font-semibold`}>{usd(base)}</td>
                <td className={`${td} text-right font-semibold`}>{usd(boost)}</td>
                <td className={`${td} text-right font-semibold text-mav-yellow`}>{usd(base + boost)}</td>
                {showInr && <td className={`${td} text-right font-semibold`}>{toInr(base + boost)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <Panel className="mb-6" title="How it is worked out">
        <ul className="text-sm text-mav-fg/80 space-y-2 list-disc pl-5">
          <li><b>Base</b> is a fixed percentage of the quarter&rsquo;s delivered revenue, from the Project sheet, counted in the quarter a line <b>starts</b> &mdash; the basis Business Numbers and the Business Overview sheet use.</li>
          <li><b>The bar</b> is the PM&rsquo;s last-year monthly average, raised to a better figure once they beat it in an earlier quarter of the same year, and never lowered. An <span className="text-mav-yellow">↑</span> marks a bar that has been raised.</li>
          <li><b>Growth</b> is the quarter&rsquo;s monthly average against that bar.</li>
          <li><b>The booster</b> is a further percentage of the same revenue, added to the base, and is <b>only ever a reward</b> &mdash; a quarter that did not beat the bar earns base alone.</li>
          <li>A PM with no baseline on record has no bar to beat, so earns base only.</li>
        </ul>
        <p className="mt-4 text-xs text-mav-muted">
          Revenue is credited to whoever owns the line at delivery, so an account changing
          hands moves it &mdash; worth a look before this pays out.
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
