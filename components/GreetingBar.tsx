'use client'
import { useEffect, useState } from 'react'
import { getDirectoryMember, getUpcomingHolidays, TEAM_REGIONS, type DirectoryMember, type Holiday } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'

// Who is looking, and when their client's country is shut.
//
// The holidays are the CLIENT's, not ours. Bonny works WEB-UK, so what matters to her is
// that the UK is closed on the 25th — not that India is. A chased approval that lands on
// a bank holiday costs a week, and nobody thinks to check another country's calendar.
//
// LP/HUB works across all three regions, so they get all three, each row tagged with the
// country — an LP PM needs to know whichever of them is shut that week.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const label = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  // Built from the parts rather than parsed, so a timezone cannot shift the date a day.
  const dow = DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${dow} ${d} ${MON[m - 1]}`
}

const daysAway = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const then = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((then - today) / 86400000)
}

const away = (n: number) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`

const hello = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function GreetingBar() {
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [soon, setSoon] = useState<Holiday[]>([])
  const [next, setNext] = useState<Holiday | undefined>()
  // Set after mount: working out the hour during render makes the static export's
  // prerendered HTML disagree with the browser.
  const [greeting, setGreeting] = useState('Hello')

  useEffect(() => {
    setGreeting(hello())
    getDirectoryMember(currentEmail()).then(m => {
      setMe(m)
      const regions = m?.team ? (TEAM_REGIONS[m.team] || []) : []
      if (!regions.length) return
      getUpcomingHolidays(regions).then(r => { setSoon(r.soon); setNext(r.next) })
    })
  }, [])

  const regions = me?.team ? (TEAM_REGIONS[me.team] || []) : []
  const first = (me?.name || '').split(' ')[0]

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">
          {greeting}{first ? <>, <span className="text-mav-yellow">{first}</span></> : ''}
        </h1>
        <p className="text-xs text-mav-muted mt-1">
          {me?.team
            ? <>You are on <span className="text-mav-fg">{me.team}</span>. Revenue, clients and pipeline at a glance.</>
            : <>Revenue, clients and pipeline at a glance.</>}
        </p>
      </div>

      {regions.length > 0 && (
        <div className="rounded-xl border border-mav-line bg-mav-panel px-4 py-3 min-w-[15rem]">
          <div className="text-[11px] uppercase tracking-wide text-mav-muted mb-1.5">
            {regions.join(' · ')} holidays &middot; next 3 weeks
          </div>
          {soon.length > 0 ? (
            <ul className="space-y-1">
              {soon.map(h => {
                const n = daysAway(h.on_date)
                return (
                  <li key={`${h.region}-${h.on_date}`} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={n <= 7 ? 'text-amber-300' : ''}>
                      {/* The country is on every row, not only in the heading: an LP PM
                          sees three countries here and "Christmas Day" alone does not
                          say whose office is shut. */}
                      {regions.length > 1 && <span className="text-mav-muted mr-1.5">{h.region}</span>}
                      {h.name}
                    </span>
                    <span className="text-xs text-mav-muted whitespace-nowrap">{label(h.on_date)} &middot; {away(n)}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            // An empty box says nothing. "Clear for three weeks, and here is the next
            // one" is the answer somebody actually wanted.
            <p className="text-sm text-mav-muted">
              Clear for three weeks.
              {next && <> Next is <span className="text-mav-fg">{next.name}</span>{regions.length > 1 ? ` in the ${next.region}` : ''}, {label(next.on_date)}.</>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
