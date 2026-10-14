'use client'
import { useEffect, useState } from 'react'
import { Panel } from '@/components/PageParts'
import { getPmIncentives, type PmIncentiveRow } from '@/lib/supabase'

// The quarter's PM incentive, base plus growth booster.
//
// WHY THIS COMPONENT DOES NO ARITHMETIC. It renders what pm_incentives() returns and
// nothing else — no rate, no threshold, no multiplication. The dashboard is a static
// export, so every number this file worked out itself would sit in public JavaScript
// that needs no login to read. Keeping the sums in the database means a page served to
// a stranger contains the words below and not one figure.
//
// The caller decides whether to mount this at all (canSeeIncentive). That is a courtesy
// to save a pointless request; the database refusal is the actual lock.

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// NO RATE IS WRITTEN HERE. The first version said "Base @ 0.25%" and put that figure in
// a bundle anybody can read without logging in. Every percentage on screen is now either
// returned by the server or divided back out of figures it returned, so a page served to
// a stranger carries the words below and not one number.
const HOW = `Base is a fixed percentage of the quarter's delivered revenue. The booster \
is a further percentage on the same revenue, set by how far the quarter's monthly average \
beat the previous quarter's — and it is only ever a reward, so a quarter that went \
backwards earns base alone. Revenue counts in the quarter a line STARTS, the same basis \
as Business Numbers and the Business Overview sheet.`

export default function IncentivePanel() {
  const [rows, setRows] = useState<PmIncentiveRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { getPmIncentives().then(setRows).finally(() => setLoading(false)) }, [])

  // Nothing to say rather than an empty table. This is also what anybody who somehow
  // reaches this component without being entitled to the data sees, since the database
  // hands them no rows.
  if (loading || !rows.length) return null

  // Recovered from the data rather than stated: base_usd is this_total times the rate,
  // so dividing gives it back exactly without the number ever being in this file.
  const withRev = rows.find(r => r.this_total > 0)
  const baseRate = withRev ? (withRev.base_usd / withRev.this_total) * 100 : null
  const base = rows.reduce((s, r) => s + r.base_usd, 0)
  const boost = rows.reduce((s, r) => s + r.growth_usd, 0)
  const revenue = rows.reduce((s, r) => s + r.this_total, 0)

  const th = 'px-3 py-2.5 font-medium whitespace-nowrap text-xs text-mav-fg/70'
  const td = 'px-3 py-2.5 whitespace-nowrap text-sm'

  return (
    <Panel className="mb-6" flush title="Incentive" info={HOW}
      right={<span className="text-xs text-mav-muted">Jul&ndash;Sep 2026 &middot; yours only &middot; USD</span>}>

      <div className="px-4 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Delivered" value={whole(revenue)} note="the quarter, all PMs" />
        <Stat label={baseRate == null ? 'Base' : `Base @ ${baseRate.toFixed(2)}%`} value={usd(base)} />
        <Stat label="Growth booster" value={usd(boost)} note={`${rows.filter(r => r.growth_usd > 0).length} of ${rows.length} earned it`} />
        <Stat label="Total payout" value={usd(base + boost)} strong />
      </div>

      <div className="overflow-x-auto mt-4">
        <table className="w-full text-left">
          <thead className="border-y border-mav-line bg-mav-fg/[0.03]">
            <tr>
              <th className={th}>PM</th>
              <th className={`${th} text-right`}>Prev qtr</th>
              <th className={`${th} text-right`}>This qtr</th>
              <th className={`${th} text-right`}>Avg / month</th>
              <th className={`${th} text-right`}>Growth</th>
              <th className={`${th} text-right`}>Base</th>
              <th className={`${th} text-right`}>Booster</th>
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.pm_owner} className="border-b border-mav-line/60">
                <td className={`${td} font-medium`}>{r.pm_owner}</td>
                <td className={`${td} text-right text-mav-fg/60`}>{whole(r.prev_total)}</td>
                <td className={`${td} text-right`}>{whole(r.this_total)}</td>
                <td className={`${td} text-right text-mav-fg/60`}>{whole(r.prev_avg)} &rarr; {whole(r.this_avg)}</td>
                <td className={`${td} text-right font-medium ${
                  r.growth_pct == null ? 'text-mav-fg/30'
                  : r.growth_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {r.growth_pct == null ? '—' : `${r.growth_pct > 0 ? '+' : ''}${r.growth_pct}%`}
                </td>
                <td className={`${td} text-right`}>{usd(r.base_usd)}</td>
                {/* A zero booster is shown as a dash, not $0.00: the row did not earn
                    one, which reads differently from earning one that rounded to
                    nothing. The rate beside it says which band paid. */}
                <td className={`${td} text-right`}>
                  {r.growth_usd > 0
                    ? <>{usd(r.growth_usd)} <span className="text-[11px] text-mav-muted">@{(r.growth_rate * 100).toFixed(2)}%</span></>
                    : <span className="text-mav-fg/25">—</span>}
                </td>
                <td className={`${td} text-right font-semibold text-mav-yellow`}>{usd(r.total_usd)}</td>
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
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-4 py-3 text-xs text-mav-muted">
        Attributed to whoever owns the line at delivery, so an account changing hands moves
        the revenue with it &mdash; worth checking before this drives money.
        INR conversion is not applied yet.
      </p>
    </Panel>
  )
}

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-mav-line/60 px-3 py-2.5">
      <div className="text-[11px] text-mav-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${strong ? 'text-mav-yellow' : ''}`}>{value}</div>
      {note && <div className="text-[11px] text-mav-fg/45 mt-0.5">{note}</div>}
    </div>
  )
}
