'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { KPIRow, Panel } from '@/components/PageParts'
import { useAuth } from '@/components/AuthProvider'
import { getWebLeadKpis, type WebLeadKpi } from '@/lib/supabase'
import { isMember, type PmMember } from '@/lib/pm-team'

// The Web lead's scorecard.
//
// Not a PM scorecard: no deal carries Rahul Kaushal's name, so bookings, feedback and
// escalations — everything the PM page is built from — would read as zeros. His three
// KPIs are the Web PM team's work, and they come from web_lead_kpis (migration 183) so
// the definitions of NBD and Repeat live in SQL rather than being restated here.
//
// THE HEADLINE IS % OF RAISED, his choice: won ÷ everything raised. Of-decided sits
// underneath, because on a six-quote quarter one loss moves it fifty points and the pair
// says more than either alone.

const money = (n?: number | null) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const pct = (n?: number | null) => (n === null || n === undefined ? '—' : `${n}%`)

/** Rounded to one place, the way the rest of the dashboard states a change. */
const change = (now?: number | null, before?: number | null) => {
  if (now === null || now === undefined || !before) return null
  return Math.round(((now - before) / before) * 1000) / 10
}

const Delta = ({ now, before, suffix = '' }: { now?: number | null; before?: number | null; suffix?: string }) => {
  const d = change(now, before)
  if (d === null) return <span className="text-mav-muted text-xs">—</span>
  return (
    <span className={`text-xs ${d > 0 ? 'text-green-400' : d < 0 ? 'text-red-400' : 'text-mav-muted'}`}>
      {d > 0 ? '+' : ''}{d}%{suffix}
    </span>
  )
}

export default function WebLeadDetail({ pm }: { pm: PmMember }) {
  const { email } = useAuth()
  const [rows, setRows] = useState<WebLeadKpi[]>([])
  const [loading, setLoading] = useState(true)
  // ONLY the lead. Deliberately not an is_admin check, which is how every other
  // scorecard on this page is gated: Pratik is a dashboard admin AND an LP/HUB PM, so
  // admin would have let a PM team member read the lead's numbers. Declared after the
  // hooks above so the gate never changes how many run.
  const blocked = !isMember(pm, email)

  useEffect(() => {
    let live = true
    getWebLeadKpis()
      .then(r => { if (live) setRows(r) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  // A quarter with nothing in it at all is the future, and the future is not a row.
  const shown = useMemo(
    () => rows.filter(r => r.nbd_quotes > 0 || r.rep_quotes > 0 || (r.web_usd ?? 0) > 0),
    [rows])
  const cur = shown[shown.length - 1]
  const prev = shown[shown.length - 2]

  const td = 'px-3 py-3 whitespace-nowrap'
  const th = 'px-3 py-2 font-medium whitespace-nowrap'

  // Should always be zero. If an AM is ever spelled a way the directory does not know,
  // those quotes vanish from Repeat silently — so the page says so rather than hiding it.
  const unmatched = shown.reduce((a, r) => a + (r.rep_unmatched || 0), 0)

  return (
    <div>
      <Link href="/pm-team" className="inline-flex items-center gap-1.5 text-xs text-mav-muted hover:text-mav-fg mb-3">
        <ArrowLeft size={14} /> PM Team
      </Link>
      <Header title={pm.name} subtitle="Web lead — the Web PM team's numbers, not a personal scorecard"
        chip={cur?.qlabel} />

      {blocked ? <p className="text-sm text-mav-muted">This scorecard belongs to someone else.</p>
        : loading ? <p className="text-sm text-mav-muted">Loading…</p> : !cur ? (
        <p className="text-sm text-mav-muted">No quarters with any activity yet.</p>
      ) : (
        <>
          <KPIRow cols={3}>
            <KPICard tone="accent" label="NBD conversion"
              value={pct(cur.nbd_pct_raised)}
              sub={<>
                <Delta now={cur.nbd_pct_raised} before={prev?.nbd_pct_raised} suffix=" vs last Q" /><br />
                <span className="text-[11px]">
                  {cur.nbd_booked} of {cur.nbd_quotes} booked · {cur.nbd_open} open · {pct(cur.nbd_pct_decided)} of decided
                </span>
              </>} />
            <KPICard tone="green" label="Repeat Q2C"
              value={pct(cur.rep_pct_raised)}
              sub={<>
                <Delta now={cur.rep_pct_raised} before={prev?.rep_pct_raised} suffix=" vs last Q" /><br />
                <span className="text-[11px]">
                  {cur.rep_won} of {cur.rep_quotes} won · {cur.rep_open} open · {pct(cur.rep_pct_decided)} of decided
                </span>
              </>} />
            <KPICard tone="amber" label="Web growth"
              value={money(cur.web_usd)}
              sub={<>
                <Delta now={cur.web_usd} before={prev?.web_usd} suffix=" vs last Q" /><br />
                <span className="text-[11px]">{prev ? `${money(prev.web_usd)} in ${prev.qlabel.slice(-9)}` : 'no prior quarter'}</span>
              </>} />
          </KPIRow>

          {/* The current quarter is always part-done. Saying so once, here, is better than
              a caveat on each of the three cards. */}
          <p className="text-xs text-mav-muted mb-4">
            The newest quarter is still running, so its figures are a quarter in progress — losses in
            particular are recorded late, which flatters both conversion rates until it closes.
          </p>

          <Panel flush className="mb-6" title="NBD conversion by quarter"
            info={<>Opportunities introduced by the three new-business people — <b>Malav Modi, Dhruti Dave and Nevilson Christian</b> — whatever the project type, where the PM is a Web PM. Booked means won. LP/HUB is excluded, so a new-business deal that lands on an LP PM is not counted here.</>}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                  <tr>
                    <th className={th}>Quarter</th>
                    <th className={`${th} text-right`}>Quotes</th>
                    <th className={`${th} text-right`}>Booked</th>
                    <th className={`${th} text-right`}>Lost</th>
                    <th className={`${th} text-right`}>Open</th>
                    <th className={`${th} text-right`}>% of raised</th>
                    <th className={`${th} text-right`}>% of decided</th>
                    <th className={`${th} text-right`}>Quoted</th>
                    <th className={`${th} text-right`}>Booked $</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.qkey} className="border-b border-mav-line/60 last:border-0">
                      <td className={td}>{r.qlabel}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.nbd_quotes}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.nbd_booked}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.nbd_lost}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.nbd_open}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{pct(r.nbd_pct_raised)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{pct(r.nbd_pct_decided)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{money(r.nbd_quoted_usd)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(r.nbd_booked_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel flush className="mb-6" title="Repeat Q2C by quarter"
            info={<>New Development quotes only, from an account manager who is <b>not</b> one of the three new-business people, where the PM is a Web PM. Project type, not business type — business type marks new client vs repeat client and is unfilled on a fifth of recent rows. This is the same cohort the PM Q2C tab uses.</>}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                  <tr>
                    <th className={th}>Quarter</th>
                    <th className={`${th} text-right`}>Quotes</th>
                    <th className={`${th} text-right`}>Won</th>
                    <th className={`${th} text-right`}>Lost</th>
                    <th className={`${th} text-right`}>Open</th>
                    <th className={`${th} text-right`}>% of raised</th>
                    <th className={`${th} text-right`}>% of decided</th>
                    <th className={`${th} text-right`}>Quoted</th>
                    <th className={`${th} text-right`}>Won $</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.qkey} className="border-b border-mav-line/60 last:border-0">
                      <td className={td}>{r.qlabel}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.rep_quotes}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.rep_won}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.rep_lost}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.rep_open}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{pct(r.rep_pct_raised)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{pct(r.rep_pct_decided)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{money(r.rep_quoted_usd)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(r.rep_won_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unmatched > 0 && (
              <div className="border-t border-mav-line px-4 py-2 text-xs text-amber-400">
                {unmatched} New Development {unmatched === 1 ? 'quote is' : 'quotes are'} under an account-manager
                spelling the directory does not know, so they are missing from the figures above. Add the spelling as
                an alias in Settings.
              </div>
            )}
          </Panel>

          <Panel flush title="Web growth, quarter over quarter"
            info={<>Booked Web revenue by financial quarter — WEB-AU, WEB-UK, WEB-US and AI &amp; Automation. LP and HUB are excluded. The newest quarter is partial, so its change against the last full one understates the run rate.</>}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-mav-fg/70 border-b border-mav-line">
                  <tr>
                    <th className={th}>Quarter</th>
                    <th className={`${th} text-right`}>Web revenue</th>
                    <th className={`${th} text-right`}>vs prior quarter</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.qkey} className="border-b border-mav-line/60 last:border-0">
                      <td className={td}>
                        {r.qlabel}
                        {i === shown.length - 1 && <span className="ml-2 text-[10px] text-amber-400">in progress</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{money(r.web_usd)}</td>
                      <td className={`${td} text-right`}>
                        <Delta now={r.web_usd} before={shown[i - 1]?.web_usd} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
