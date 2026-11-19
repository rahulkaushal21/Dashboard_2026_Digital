'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/Header'
import KPICard from '@/components/KPICard'
import { KPIRow, Segments, Panel } from '@/components/PageParts'
import { useAuth } from '@/components/AuthProvider'
import { getWebLeadKpis, type WebLeadKpi } from '@/lib/supabase'
import { isMember, fqOf, qLabel, type FQ, type PmMember } from '@/lib/pm-team'

// The Web lead's scorecard.
//
// SAME PAGE AS A PM'S, different measures. The quarter picker, the card row, the
// `<quarter> scorecard` table and the history panel underneath are the shapes PmDetail
// uses, in the same order, because this is read alongside those pages and a second
// layout for one person would make the two hard to compare.
//
// What it is NOT is a PM scorecard: no deal carries Rahul Kaushal's name, so bookings,
// feedback and escalations would all read zero. His three measures are the Web PM team's
// work and come from web_lead_kpis (migration 183), so the definitions of NBD and Repeat
// live in SQL rather than being restated here.
//
// NO TOTAL, AND NO WEIGHTS. A PM's quarter scores against published targets and weights;
// these three have none set, so the scorecard shows the result and what it is made of and
// stops there. Inventing a target to fill the column would be a number nobody agreed.
//
// THE HEADLINE IS % OF RAISED, his choice: won over everything raised. Of-decided sits
// beside it because on a six-quote quarter one loss moves it fifty points.

const money = (n?: number | null) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const pct = (n?: number | null) => (n === null || n === undefined ? '—' : `${n}%`)

const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)
/** This financial year to date — the same window the PM pages offer. */
const QUARTERS: FQ[] = Array.from({ length: CUR_FQ.q }, (_, i) => ({ fy: CUR_FQ.fy, q: i + 1 }))
const keyOf = (f: FQ) => `${f.fy}Q${f.q}`

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

/** One line of the scorecard table — the same shape PmDetail's KpiRow renders. */
const KpiRow = ({ measure, result, note, quoted, converted }: {
  measure: string; result: string; note: string; quoted?: string; converted?: string
}) => (
  <tr className="border-b border-mav-line/60 last:border-0">
    <td className="px-5 py-3 font-medium whitespace-nowrap">{measure}</td>
    <td className="px-5 py-3 tabular-nums font-semibold whitespace-nowrap">{result}</td>
    <td className="px-5 py-3 text-mav-muted">{note}</td>
    <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">{quoted ?? '—'}</td>
    <td className="px-5 py-3 text-right tabular-nums text-mav-muted whitespace-nowrap">{converted ?? '—'}</td>
  </tr>
)

export default function WebLeadDetail({ pm }: { pm: PmMember }) {
  const { email } = useAuth()
  const [rows, setRows] = useState<WebLeadKpi[]>([])
  const [loading, setLoading] = useState(true)
  const [qi, setQi] = useState(QUARTERS.length - 1)

  useEffect(() => {
    let live = true
    getWebLeadKpis()
      .then(r => { if (live) setRows(r) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const byKey = useMemo(() => new Map(rows.map(r => [r.qkey, r])), [rows])
  const fq = QUARTERS[qi]
  const q = byKey.get(keyOf(fq))

  // The quarter before the selected one. Taken from the full series rather than from
  // QUARTERS, so Q1 compares against last year's Q4 instead of showing nothing.
  const prev = useMemo(() => {
    const i = rows.findIndex(r => r.qkey === keyOf(fq))
    return i > 0 ? rows[i - 1] : undefined
  }, [rows, fq])

  // Oldest first, dropping quarters with nothing in them at all — those are the future,
  // and the future is not a row.
  const history = useMemo(
    () => rows.filter(r => r.nbd_quotes > 0 || r.rep_quotes > 0 || (r.web_usd ?? 0) > 0),
    [rows])
  const unmatched = history.reduce((a, r) => a + (r.rep_unmatched || 0), 0)

  const inProgress = fq.q === CUR_FQ.q && fq.fy === CUR_FQ.fy

  // ONLY the lead. Deliberately not an is_admin check, which is how every other scorecard
  // here is gated: Pratik is a dashboard admin AND an LP/HUB PM, so admin would have let
  // a PM team member read these. Declared after the hooks so the gate never changes how
  // many run.
  const blocked = !isMember(pm, email)

  const td = 'px-5 py-3 whitespace-nowrap'
  const th = 'px-5 py-2 font-medium whitespace-nowrap'

  if (blocked) return (
    <div>
      <Header title="Not your scorecard" />
      <p className="text-sm text-mav-muted mb-3">This scorecard belongs to someone else.</p>
      <Link href="/pm-team" className="text-mav-yellow text-sm hover:underline underline-offset-2">← PM Team</Link>
    </div>
  )

  return (
    <div>
      <Link href="/pm-team" className="inline-flex items-center gap-1 text-sm text-mav-yellow hover:underline underline-offset-2 mb-3">
        <ArrowLeft size={14} /> PM Team
      </Link>
      <Header title={pm.name} chip={qLabel(fq)}
        subtitle="Web lead — quarterly KPI across the Web PM team, your own deals included" />

      {/* The quarter picker, as the page's main split — the same control the PM pages use. */}
      <Segments
        items={QUARTERS.map((f, i) => ({
          id: String(i), label: qLabel(f),
          count: f.q === CUR_FQ.q ? 'in progress' : undefined,
        }))}
        value={String(qi)} onChange={v => setQi(Number(v))} />

      {loading ? <p className="text-sm text-mav-muted">Loading…</p> : (
        <>
          <KPIRow cols={3}>
            <KPICard tone="accent" label="NBD conversion"
              value={pct(q?.nbd_pct_raised)}
              sub={<>
                <Delta now={q?.nbd_pct_raised} before={prev?.nbd_pct_raised} suffix=" vs last Q" /><br />
                <span className="text-[11px]">
                  {q?.nbd_booked ?? 0} of {q?.nbd_quotes ?? 0} clients booked · {q?.nbd_open ?? 0} open · {pct(q?.nbd_pct_decided)} of decided
                </span>
              </>}
              info="Prospects introduced by Malav Modi, Dhruti Dave or Nevilson Christian, whatever the project type, on a deal run by a Web PM or by you — including a deal shared with someone outside the team. Counted once per client, not once per quote: four quotes to the same prospect is one chance to win it, and a client counts as booked if any of its quotes won. LP/HUB excluded." />
            <KPICard tone="green" label="Repeat Q2C"
              value={pct(q?.rep_pct_raised)}
              sub={<>
                <Delta now={q?.rep_pct_raised} before={prev?.rep_pct_raised} suffix=" vs last Q" /><br />
                <span className="text-[11px]">
                  {q?.rep_won ?? 0} of {q?.rep_quotes ?? 0} won · {q?.rep_open ?? 0} open · {pct(q?.rep_pct_decided)} of decided
                </span>
              </>}
              info="New Development quotes only, from an account manager who is not one of those three, on a deal run by a Web PM or by you. Project type, not business type — business type marks new client vs repeat client and is unfilled on a fifth of recent rows." />
            <KPICard tone="amber" label="Web growth"
              value={money(q?.web_usd)}
              sub={<>
                <Delta now={q?.web_usd} before={prev?.web_usd} suffix=" vs last Q" /><br />
                <span className="text-[11px]">{prev ? `${money(prev.web_usd)} the quarter before` : 'no prior quarter'}</span>
              </>}
              info="Booked Web revenue — WEB-AU, WEB-UK, WEB-US and AI & Automation. LP and HUB excluded." />
          </KPIRow>

          {/* ---- The quarter, and what each measure is made of ---------------- */}
          <Panel flush className="mb-6" title={`${qLabel(fq)} scorecard`}
            info="The three measures the Web lead is read on. No weighted total: these have no agreed targets, so the page shows the result and what it is made of rather than inventing a bar."
            right={<span className="text-xs text-mav-muted">{inProgress ? 'quarter in progress' : 'closed quarter'}</span>}>
            <table className="w-full text-sm">
              <thead className="text-left text-mav-muted border-b border-mav-line">
                <tr>
                  <th className={th}>Measure</th>
                  <th className={th}>Result</th>
                  <th className={th}>What it is made of</th>
                  <th className={`${th} text-right`}>Quoted</th>
                  <th className={`${th} text-right`}>Converted</th>
                </tr>
              </thead>
              <tbody>
                <KpiRow measure="NBD conversion" result={pct(q?.nbd_pct_raised)}
                  note={`${q?.nbd_booked ?? 0} booked of ${q?.nbd_quotes ?? 0} clients quoted · ${q?.nbd_lost ?? 0} lost, ${q?.nbd_open ?? 0} still open`}
                  quoted={money(q?.nbd_quoted_usd)} converted={money(q?.nbd_booked_usd)} />
                <KpiRow measure="Repeat Q2C" result={pct(q?.rep_pct_raised)}
                  note={`${q?.rep_won ?? 0} won of ${q?.rep_quotes ?? 0} raised · ${q?.rep_lost ?? 0} lost, ${q?.rep_open ?? 0} still open`}
                  quoted={money(q?.rep_quoted_usd)} converted={money(q?.rep_won_usd)} />
                <KpiRow measure="Web growth" result={money(q?.web_usd)}
                  note={prev ? `${money(prev.web_usd)} the quarter before` : 'no prior quarter to compare'} />
              </tbody>
            </table>

            {/* Caveats that change how the quarter reads — one line each, as PmDetail does. */}
            <div className="px-5 py-3 border-t border-mav-line text-xs text-mav-muted space-y-1">
              {inProgress && (
                <p>This quarter is still running. Losses are recorded late, so both conversion rates read high until it closes, and the revenue is a part-quarter figure.</p>
              )}
              {(q?.nbd_quotes ?? 0) > 0 && (q?.nbd_quotes ?? 0) < 10 && (
                <p>NBD is {q?.nbd_quotes} client{q?.nbd_quotes === 1 ? '' : 's'} this quarter — one deal moves the rate by about {Math.round(100 / (q?.nbd_quotes || 1))} points, so read the count beside the percentage.</p>
              )}
              {/* Said out loud, because the denominator here is smaller than the deal
                  list on Opportunities and the difference should not look like a bug. */}
              {(q?.nbd_raw_quotes ?? 0) > (q?.nbd_quotes ?? 0) && (
                <p>{q?.nbd_raw_quotes} NBD quotes went to {q?.nbd_quotes} prospects this quarter. A prospect quoted more
                than once counts once, and counts as booked if any of its quotes won — otherwise a revised scope would
                push the rate down for doing more work on the same deal.</p>
              )}
              {(q?.nbd_quotes ?? 0) === 0 && (
                <p className="text-amber-400">No new-business opportunity was introduced this quarter, so NBD conversion has nothing to measure.</p>
              )}
              {(q?.rep_open ?? 0) > 0 && (
                <p>{q?.rep_open} New Development quote{(q?.rep_open ?? 0) === 1 ? '' : 's'} raised this quarter and not yet decided — they count against the % of raised here, and a win next quarter lands there, not back in this one.</p>
              )}
            </div>
          </Panel>

          {/* ---- Every quarter, the way PmDetail shows month over month -------- */}
          <Panel flush title="Quarter over quarter"
            info="Every quarter with activity, oldest first — the three measures side by side, so a trend is one glance rather than three clicks. The selected quarter is highlighted.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-mav-muted border-b border-mav-line">
                  <tr>
                    <th className={th}>Quarter</th>
                    <th className={`${th} text-right`}>NBD</th>
                    <th className={`${th} text-right`}>NBD clients</th>
                    <th className={`${th} text-right`}>Repeat</th>
                    <th className={`${th} text-right`}>Repeat won</th>
                    <th className={`${th} text-right`}>Web revenue</th>
                    <th className={`${th} text-right`}>vs prior Q</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, i) => (
                    <tr key={r.qkey}
                      className={`border-b border-mav-line/60 last:border-0 ${r.qkey === keyOf(fq) ? 'bg-mav-dark/40' : ''}`}>
                      <td className={td}>
                        {r.qlabel}
                        {i === history.length - 1 && <span className="ml-2 text-[10px] text-amber-400">in progress</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{pct(r.nbd_pct_raised)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.nbd_booked} of {r.nbd_quotes}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{pct(r.rep_pct_raised)}</td>
                      <td className={`${td} text-right tabular-nums text-mav-muted`}>{r.rep_won} of {r.rep_quotes}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(r.web_usd)}</td>
                      <td className={`${td} text-right`}>
                        <Delta now={r.web_usd} before={history[i - 1]?.web_usd} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unmatched > 0 && (
              <div className="border-t border-mav-line px-5 py-3 text-xs text-amber-400">
                {unmatched} New Development {unmatched === 1 ? 'quote is' : 'quotes are'} under an account-manager
                spelling the directory does not know, so they are missing from Repeat above. Add the spelling as an
                alias in Settings.
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
