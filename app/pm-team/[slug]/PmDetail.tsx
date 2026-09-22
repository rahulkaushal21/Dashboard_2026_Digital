'use client'
import { useEffect, useMemo, useState } from 'react'
import ClientLink from '@/components/ClientLink'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/Header'
import { useAuth } from '@/components/AuthProvider'
import { OWNER_EMAIL } from '@/lib/access'
import { getBookingsFull, getOpportunities, getQuotes, getPmFeedback, getEmailSignals, type BookingRow, type Opportunity, type Quote, type PmFeedbackRow, type EmailSignal } from '@/lib/supabase'
import { buildPmStats, growthPct, pendingOpps, oppDate, isNewDevQuote, isWon, isLost, quoteConfirmDate, oppConfirmDate } from '@/lib/pm-metrics'
import { pmBySlug, pmByEmail, fqOf, qLabel, totalPct, attainment, TARGETS, WEIGHTS, type FQ } from '@/lib/pm-team'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mLabel = (k: string) => { const [y, m] = k.split('-'); return `${SHORT[Number(m)]} '${y.slice(2)}` }
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

const NOW = new Date()
const CUR_FQ = fqOf(NOW.getFullYear(), NOW.getMonth() + 1)
const QUARTERS: FQ[] = Array.from({ length: CUR_FQ.q }, (_, i) => ({ fy: CUR_FQ.fy, q: i + 1 }))

export default function PmDetail({ slug }: { slug: string }) {
  const pm = pmBySlug(slug)
  const { email, profile } = useAuth()
  // Admins may open any scorecard. A PM may open their own and nobody else's.
  // Anyone who is neither may open none.
  const isAdmin = !!profile?.is_admin
  const me = pmByEmail(email)
  const blocked = !isAdmin && (!me || !pm || me.slug !== pm.slug)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [fb, setFb] = useState<PmFeedbackRow[]>([])
  const [sigs, setSigs] = useState<EmailSignal[]>([])
  const [qi, setQi] = useState(QUARTERS.length - 1)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback(), getEmailSignals()])
      .then(([b, o, qs, f, sg]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f); setSigs(sg) })
  }, [])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb, sigs), [bookings, opps, quotes, fb, sigs])
  const s = pm ? stats.get(pm.slug) : undefined
  const fq = QUARTERS[qi]

  // Month-over-month bookings from the first month with data to now, so a zero
  // month shows as a gap rather than silently closing up.
  const months = useMemo(() => {
    if (!s) return [] as { k: string; v: number }[]
    const keys = [...s.byMonth.keys()].sort()
    if (!keys.length) return []
    const out: { k: string; v: number }[] = []
    let [y, m] = keys[0].split('-').map(Number)
    const end = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
    for (let i = 0; i < 48; i++) {
      const k = `${y}-${String(m).padStart(2, '0')}`
      out.push({ k, v: s.byMonth.get(k) || 0 })
      if (k >= end) break
      m++; if (m > 12) { m = 1; y++ }
    }
    return out
  }, [s])

  const pending = useMemo(() => (s ? pendingOpps(s.opps, NOW) : { rows: [], toppedUp: 0 }), [s])

  if (!pm) return <div><Header title="PM not found" /><Link href="/pm-team" className="text-mav-yellow text-sm">← PM Team</Link></div>

  if (blocked) return (
    <div className="max-w-md mt-16">
      <h1 className="text-xl font-semibold mb-2">Not your scorecard</h1>
      <p className="text-sm text-mav-muted mb-4">
        Individual KPI pages are private to the person they belong to.
        {me ? ' You can open your own.' : ` Ask ${OWNER_EMAIL} for admin access if you need to see the team's.`}
      </p>
      {me && (
        <Link href={`/pm-team/${me.slug}`} className="text-mav-yellow text-sm hover:underline">
          Go to my scorecard &rarr;
        </Link>
      )}
    </div>
  )

  const q = s?.quarter(fq)
  const base = s ? s.baseline(fq) : pm.lastYearAvg
  const raised = base > pm.lastYearAvg
  const growth = q ? growthPct(q.avg, base) : null
  const total = q ? totalPct(growth, q.q2c, q.feedback) : 0
  const peak = Math.max(1, ...months.map(x => x.v))

  // Every deal behind the Q2C figure — Quotes tab AND email — so the number can be
  // checked rather than trusted. Email rows carry no Project Type, so they are the
  // ones the classifier picked out; showing them here is what makes that auditable.
  const [qa, qb] = qKey(fq)
  const inThisQ = (d?: string) => { const k = (d || '').slice(0, 7); return k >= qa && k <= qb }
  const q2cRows = [
    ...(s?.quotes || [])
      .filter(x => isNewDevQuote(x) && (inThisQ(x.added_date) || inThisQ(quoteConfirmDate(x))))
      .map(x => ({
        key: `q${x.id}`, date: (x.added_date || '').slice(0, 10), confirmed: quoteConfirmDate(x),
        carried: !inThisQ(x.added_date), client: x.agency,
        project: x.subject_project, value: x.usd_value, status: x.status, source: 'sheet' as const,
      })),
    ...(s?.emailNewDevOpps || [])
      .filter(o => inThisQ(oppDate(o)) || inThisQ(oppConfirmDate(o)))
      .map(o => ({
        key: `e${o.id}`, date: oppDate(o).slice(0, 10), confirmed: oppConfirmDate(o),
        carried: !inThisQ(oppDate(o)), client: o.company_name,
        project: o.source_subject, value: o.est_value,
        status: isWon(o) ? 'Confirmed' : isLost(o) ? 'Cancelled' : (o.status || 'Open'),
        source: 'email' as const,
      })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return (
    <div>
      <Link href="/pm-team" className="inline-flex items-center gap-1 text-sm text-mav-muted hover:text-mav-fg mb-3">
        <ArrowLeft size={14} /> {isAdmin ? 'PM Team' : 'My scorecard'}
      </Link>
      <Header title={pm.name} subtitle="Project manager — quarterly KPI, bookings and open quotes" />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-xs text-mav-muted">Quarter</span>
        <select value={qi} onChange={e => setQi(Number(e.target.value))} className={selCls}>
          {QUARTERS.map((f, i) => <option key={i} value={i}>{qLabel(f)}</option>)}
        </select>
        {fq.q === CUR_FQ.q && <span className="text-xs text-amber-400">in progress — {q?.monthsElapsed ?? 0} of 3 months</span>}
      </div>

      {/* ---- The score, and exactly how it was reached ------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-mav-line">
          <div>
            <h2 className="font-medium">{qLabel(fq)} scorecard</h2>
            <p className="text-xs text-mav-muted mt-0.5">Each measure scored on how far it got towards full marks, then weighted.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">{total.toFixed(0)}%</div>
            <div className="text-xs text-mav-muted">Total</div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-5 py-2 font-medium">Measure</th>
              <th className="px-5 py-2 font-medium">Result</th>
              <th className="px-5 py-2 font-medium">Full marks</th>
              <th className="px-5 py-2 font-medium text-right">Attained</th>
              <th className="px-5 py-2 font-medium text-right">Weight</th>
              <th className="px-5 py-2 font-medium text-right">Contributes</th>
            </tr>
          </thead>
          <tbody>
            <KpiRow measure="Growth" result={growth == null ? '—' : `${growth.toFixed(1)}%`}
              note={`${money(q?.avg || 0)}/mo vs ${money(base)} base`}
              raw={growth} target={TARGETS.growth} targetLabel={`${TARGETS.growth}%`} weight={WEIGHTS.growth} />
            <KpiRow measure="Q2C" result={q?.q2c == null ? '—' : `${q.q2c.toFixed(0)}%`}
              note={`${q?.won ?? 0} confirmed in this quarter of ${q?.shared ?? 0} in play · ${q?.lost ?? 0} cancelled, ${q?.open ?? 0} unconverted`}
              raw={q?.q2c ?? null} target={TARGETS.q2c} targetLabel={`${TARGETS.q2c}%`} weight={WEIGHTS.q2c} />
            <KpiRow measure="Feedback" result={String(q?.feedback ?? 0)}
              note={`${q?.feedbackFromSheet ?? 0} from the feedback sheet · ${q?.feedbackFromEmail ?? 0} found in email`}
              raw={q?.feedback ?? 0} target={TARGETS.feedback} targetLabel={String(TARGETS.feedback)} weight={WEIGHTS.feedback} />
          </tbody>
          <tfoot>
            <tr className="border-t border-mav-line bg-mav-dark/40">
              <td className="px-5 py-3 font-medium" colSpan={5}>Total</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold">{total.toFixed(1)}%</td>
            </tr>
          </tfoot>
        </table>

        <div className="px-5 py-3 border-t border-mav-line text-xs text-mav-muted space-y-1">
          <p>
            <span className="text-mav-fg">Base {money(base)} a month.</span>{' '}
            {raised
              ? `Raised from a last-year average of ${money(pm.lastYearAvg)} — that bar was cleared earlier this year, so the higher figure stands from here.`
              : `This is the last-year monthly average, still the bar because it has not been beaten this year yet.`}
          </p>
          {growth != null && growth < 0 && <p>Growth is below the base, so it contributes nothing to the Total rather than pulling it negative.</p>}
          {(q?.shared ?? 0) === 0 && <p className="text-amber-400">No New-development quote was raised this quarter, so Q2C has nothing to measure and contributes nothing.</p>}
          {(q?.open ?? 0) > 0 && <p>{q?.open} quote{(q?.open ?? 0) === 1 ? '' : 's'} raised this quarter and not yet converted — they count against Q2C here, and if one is signed next quarter that win lands there, not back here.</p>}
        </div>
      </section>

      {/* ---- Month over month bookings ---------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl p-5 mb-6">
        <h2 className="font-medium mb-1">Month-over-month bookings</h2>
        <p className="text-xs text-mav-muted mb-4">USD booked each month. Apr–Jun 2026 is fixed to the revenue sheet&rsquo;s pivot, the agreed final figure for that quarter.</p>
        {months.length === 0 ? <p className="text-sm text-mav-muted">No bookings recorded.</p> : (
          <div className="overflow-x-auto">
            {/* items-stretch, and each column h-full, is load-bearing: with
                items-end the columns size to their content, so the bars' own
                percentage heights resolve against an indefinite height and
                collapse to nothing — which is why no bars were drawing. */}
            <div className="flex items-stretch gap-2 min-w-[680px] h-52">
              {months.map(({ k, v }, i) => {
                const prev = i > 0 ? months[i - 1].v : null
                const up = prev != null && v >= prev
                return (
                  <div key={k} className="flex-1 h-full flex flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-mav-muted whitespace-nowrap">{v ? money(v) : ''}</span>
                    {/* The bar's percentage height resolves against THIS box, which
                        flex-1 + min-h-0 gives a definite height — the labels above
                        and below can no longer push it past the chart. */}
                    <div className="flex-1 min-h-0 w-full flex items-end">
                      <div className={`w-full rounded-t ${v === 0 ? 'bg-mav-line' : up ? 'bg-mav-yellow' : 'bg-mav-yellow/45'}`}
                        style={{ height: `${Math.max(2, (v / peak) * 100)}%` }} title={`${mLabel(k)} — ${money(v)}`} />
                    </div>
                    <span className="text-[10px] text-mav-muted whitespace-nowrap">{mLabel(k)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-mav-muted mt-3">Solid bars are up on the month before; faded bars are down.</p>
      </section>

      {/* ---- The quotes behind Q2C -------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4">
          <h2 className="font-medium">New-development quotes · {qLabel(fq)}</h2>
          <p className="text-xs text-mav-muted mt-1">
            Everything behind the Q2C figure: raised this quarter, or raised earlier and confirmed in it. Quotes-tab rows with
            Project Type “New Development”, plus deals worked over email that were never written onto the sheet — those are read
            from the subject and brief, and only counted on an explicit build signal.
          </p>
          <p className="text-xs text-mav-muted mt-1">
            {q?.shared ?? 0} raised ({(q?.shared ?? 0) - (q?.sharedFromEmail ?? 0)} sheet · {q?.sharedFromEmail ?? 0} email)
            {' · '}{q?.won ?? 0} confirmed · {q?.lost ?? 0} cancelled · {q?.open ?? 0} still open.
          </p>
        </div>
        {q2cRows.length === 0 ? <p className="px-5 pb-5 text-sm text-mav-muted">No New-development work raised this quarter.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[740px]">
              <thead className="text-left text-mav-muted border-y border-mav-line">
                <tr>{['Raised', 'Confirmed', 'Client', 'Project', 'Value', 'Found in', 'Status'].map(h => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {q2cRows.map(x => (
                  <tr key={x.key} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-2.5 text-mav-muted whitespace-nowrap">
                      {x.date}
                      {x.carried && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-mav-yellow/15 text-mav-yellow">carried in</span>}
                    </td>
                    <td className="px-5 py-2.5 text-mav-muted whitespace-nowrap">{x.confirmed || '—'}</td>
                    <td className="px-5 py-2.5">{x.client}</td>
                    <td className="px-5 py-2.5 text-mav-muted max-w-[260px] truncate" title={x.project}>{x.project}</td>
                    <td className="px-5 py-2.5 tabular-nums">{x.value ? money(x.value) : <span className="text-mav-muted">—</span>}</td>
                    <td className="px-5 py-2.5"><SourcePill s={x.source} /></td>
                    <td className="px-5 py-2.5"><StatusPill s={x.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Open opportunities ----------------------------------------- */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-medium">Open opportunities</h2>
          <p className="text-xs text-mav-muted mt-1">
            Raised this month and still open — Quotes tab and email together.
            {' '}{pending.rows.filter(o => o.origin === 'email').length} of the {pending.rows.length} below came from email.
            {pending.toppedUp > 0 && ` It is early in the month, so the ${pending.toppedUp} most recent open deals from previous months are included.`}
          </p>
        </div>
        {pending.rows.length === 0 ? <p className="px-5 pb-5 text-sm text-mav-muted">Nothing open.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left text-mav-muted border-y border-mav-line">
                <tr>{['Date', 'Client', 'Subject', 'Value', 'Source', 'Status'].map(h => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {pending.rows.map(o => (
                  <tr key={o.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                    <td className="px-5 py-2.5 text-mav-muted whitespace-nowrap">{oppDate(o).slice(0, 10)}</td>
                    <td className="px-5 py-2.5"><ClientLink name={o.company_name} /></td>
                    <td className="px-5 py-2.5 text-mav-muted max-w-[260px] truncate" title={o.source_subject}>{o.source_subject}</td>
                    <td className="px-5 py-2.5 tabular-nums">{o.est_value ? money(o.est_value) : <span className="text-mav-muted">—</span>}</td>
                    <td className="px-5 py-2.5"><SourcePill s={o.origin === 'email' ? 'email' : 'sheet'} /></td>
                    <td className="px-5 py-2.5 text-mav-muted">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const qKey = (f: FQ): [string, string] => {
  const sm = f.q === 1 ? 4 : f.q === 2 ? 7 : f.q === 3 ? 10 : 1
  const y = f.q === 4 ? f.fy + 1 : f.fy
  const p = (n: number) => String(n).padStart(2, '0')
  return [`${y}-${p(sm)}`, `${y}-${p(sm + 2)}`]
}

function SourcePill({ s }: { s: 'sheet' | 'email' }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded ${s === 'email' ? 'bg-blue-500/15 text-blue-300' : 'bg-mav-line text-mav-muted'}`}>
      {s}
    </span>
  )
}

function StatusPill({ s }: { s?: string }) {
  const v = (s || '').toLowerCase()
  const cls = v === 'confirmed' ? 'bg-green-500/15 text-green-400'
    : v.includes('cancel') ? 'bg-red-500/15 text-red-400'
    : 'bg-mav-line text-mav-muted'
  return <span className={`text-[11px] px-2 py-0.5 rounded ${cls}`}>{s || '—'}</span>
}

/** One measure, shown as result → attainment → weighted contribution. */
function KpiRow({ measure, result, note, raw, target, targetLabel, weight }: {
  measure: string; result: string; note: string
  raw: number | null; target: number; targetLabel: string; weight: number
}) {
  const a = attainment(raw, target)
  return (
    <tr className="border-b border-mav-line/40">
      <td className="px-5 py-3">
        {measure}
        <span className="block text-[11px] text-mav-muted">{note}</span>
      </td>
      <td className="px-5 py-3 tabular-nums">{result}</td>
      <td className="px-5 py-3 text-mav-muted tabular-nums">{targetLabel}</td>
      <td className="px-5 py-3 text-right tabular-nums">
        <span className="inline-flex items-center gap-2">
          <span className="w-16 h-1.5 rounded-full bg-mav-line overflow-hidden">
            <span className="block h-full bg-mav-yellow" style={{ width: `${a * 100}%` }} />
          </span>
          {(a * 100).toFixed(0)}%
        </span>
      </td>
      <td className="px-5 py-3 text-right text-mav-muted tabular-nums">{Math.round(weight * 100)}%</td>
      <td className="px-5 py-3 text-right tabular-nums">{(a * weight * 100).toFixed(1)}%</td>
    </tr>
  )
}
