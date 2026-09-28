'use client'
import { useEffect, useState } from 'react'
import { getDirectoryMember, getUpcomingHolidays, isLive, TEAM_REGIONS, type DirectoryMember, type Holiday } from '@/lib/supabase'
import { currentEmail, getStoredProfile } from '@/lib/access'
import { useUnit } from './BusinessUnitProvider'
import { unitLabel } from '@/lib/business-unit'
import InfoTip from './InfoTip'

// Who is looking, and when their client's country is shut.
//
// The holidays are the CLIENT's, not ours. Bonny works WEB-UK, so what matters to her is
// that the UK is closed on the 25th — not that India is. A chased approval that lands on
// a bank holiday costs a week, and nobody thinks to check another country's calendar.
//
// LP/HUB works across all three regions, so they get all three, each row tagged with the
// country — an LP PM needs to know whichever of them is shut that week.
//
// It is the home page's header, so it reads like every other page's (components/Header):
// the greeting as the title, the dark chip naming the department and the period, the
// page's actions on the right. The holidays sit in one line under it rather than in a
// box beside it, so the cards start where they start on every other page.

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

// A name from the Google sign-in, for anybody who is not in the PM directory. Admins and
// leadership are not PMs, so they were greeted with a bare "Good evening" and nothing
// else — the one line on the page addressed to them, addressed to nobody.
const signInName = (): string => {
  const p = getStoredProfile()
  // First name only, to match how a PM from the directory is greeted.
  const full = (p?.full_name || '').trim()
  if (full) return full.split(/\s+/)[0]
  const local = (p?.email || currentEmail() || '').split('@')[0]
  if (!local) return ''
  // first.last / first_last / first-last -> First
  const first = local.split(/[._-]+/)[0]
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
}

export default function GreetingBar({ chip, actions }: { chip?: string; actions?: React.ReactNode }) {
  const { unit, canSwitch } = useUnit()
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [fallbackName, setFallbackName] = useState('')
  const [soon, setSoon] = useState<Holiday[]>([])
  const [next, setNext] = useState<Holiday | undefined>()
  // Set after mount: working out the hour during render makes the static export's
  // prerendered HTML disagree with the browser.
  const [greeting, setGreeting] = useState('Hello')

  useEffect(() => {
    setGreeting(hello())
    setFallbackName(signInName())
    getDirectoryMember(currentEmail()).then(m => {
      setMe(m)
      const regions = m?.team ? (TEAM_REGIONS[m.team] || []) : []
      if (!regions.length) return
      getUpcomingHolidays(regions).then(r => { setSoon(r.soon); setNext(r.next) })
    })
  }, [])

  const regions = me?.team ? (TEAM_REGIONS[me.team] || []) : []
  const first = (me?.name || '').split(' ')[0] || fallbackName

  const dept = canSwitch ? (unit === 'all' ? 'All departments' : unitLabel(unit)) : ''
  const chipText = [dept, chip].filter(Boolean).join(' · ')

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-4">
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-none">
            {greeting}{first ? <>, <span className="text-mav-yellow">{first}</span></> : ''}
          </h1>
          {chipText && (
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 rounded-md bg-mav-fg text-mav-dark whitespace-nowrap">
              {chipText}
            </span>
          )}
          <InfoTip text={me?.team
            ? <>You are on <span className="font-semibold">{me.team}</span>. Everything below is your accounts &mdash; switch to all of Web from the filter.</>
            : <>Revenue, clients and pipeline at a glance.</>} />
        </div>
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {actions}
          <span className={`font-mono text-[10.5px] uppercase tracking-[0.08em] px-2 py-1 rounded-full border flex items-center gap-1.5 ${isLive ? 'border-green-500/40 text-green-400' : 'border-mav-line text-mav-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500' : 'bg-mav-muted'}`} />
            {isLive ? 'Live' : 'Sample'}
          </span>
        </div>
      </header>

      {regions.length > 0 && (
        <div className="mb-4 rounded-xl border border-mav-line bg-mav-panel px-4 py-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">
            {regions.join(' · ')} holidays &middot; next 3 weeks
          </span>
          {soon.length > 0 ? (
            soon.map(h => {
              const n = daysAway(h.on_date)
              return (
                <span key={`${h.region}-${h.on_date}`} className="inline-flex items-baseline gap-2 text-sm">
                  <span className={n <= 7 ? 'text-amber-300' : ''}>
                    {/* The country is on every entry, not only in the label: an LP PM
                        sees three countries here and "Christmas Day" alone does not
                        say whose office is shut. */}
                    {regions.length > 1 && <span className="text-mav-muted mr-1.5">{h.region}</span>}
                    {h.name}
                  </span>
                  <span className="text-xs text-mav-muted whitespace-nowrap">{label(h.on_date)} &middot; {away(n)}</span>
                </span>
              )
            })
          ) : (
            // An empty box says nothing. "Clear for three weeks, and here is the next
            // one" is the answer somebody actually wanted.
            <span className="text-sm text-mav-muted">
              Clear for three weeks.
              {next && <> Next is <span className="text-mav-fg">{next.name}</span>{regions.length > 1 ? ` in the ${next.region}` : ''}, {label(next.on_date)}.</>}
            </span>
          )}
        </div>
      )}
    </>
  )
}
