'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X, LayoutDashboard, Briefcase, Users, AlertTriangle, Siren, Sparkles, Target, TrendingUp, LineChart, History, Archive, LogOut, BarChart3, GraduationCap, ChevronDown, ChevronRight, UserCog, Settings, Table2, PieChart, Zap, Wrench, Calculator, Receipt, Activity, MessageSquare, ClipboardList } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canSee } from '@/lib/access'
import ThemeToggle from './ThemeToggle'
import { useUnit } from './BusinessUnitProvider'
import { UNITS } from '@/lib/business-unit'
import { MavlersMark } from './MavlersLogo'
import { NAV_EVENT } from '@/lib/use-close-on-nav'
import { useActionCount } from '@/lib/use-action-count'

// A nav entry is either a link or a group of links. Groups exist so the reporting pages
// can sit together without crowding the eight the business is run from; access is still
// granted per sub-page, never per group.
//
// ADDING A PAGE MEANS EDITING TWO LISTS. This one draws the sidebar; PAGES in
// lib/access.ts is what canSee() and the route guard read. A page added to PAGES alone
// works perfectly if you type its URL and is invisible to everyone who does not — which
// is exactly how Needs Input, Project Sheet and Revenue Sheet shipped unreachable.
type Leaf = { href: string; label: string; icon: any }
type Group = { label: string; icon: any; children: Leaf[] }
type Entry = Leaf | Group
const isGroup = (e: Entry): e is Group => 'children' in e

const nav: Entry[] = [
  // ── A focused rail (owner's call, 5 Oct 2026) ─────────────────────────────────
  // Sixteen links in a column made the two or three anybody opens daily hard to find.
  // Top level is now what is opened EVERY day — the pulse, the dashboard, the pipeline —
  // and the rest sits in four groups by the job it does. Order inside each group is the
  // order agreed on 28 Sep. Groups open by themselves when you are inside one.
  //
  // Daily Pulse first and on its own: it is the morning read, everything new from the
  // mailbox, quotes and sheets in one list, so it must never be one click deeper.
  { href: '/pulse', label: 'Daily Pulse', icon: Activity },
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  // What clients are saying. /delights keeps its URL so old links still resolve. Major
  // Process Gap is the standing log of what went wrong, read alongside escalations.
  {
    label: 'Client voice', icon: MessageSquare, children: [
      { href: '/delights', label: 'Feedback', icon: Sparkles },
      { href: '/critical-escalations', label: 'Critical Escalations', icon: Siren },
      { href: '/clients', label: 'Client 360', icon: Users },
      { href: '/escalations', label: 'Major Process Gap', icon: AlertTriangle },
    ],
  },
  // The delivery side: the ledger, the people, what is due, and the knowledge base.
  {
    label: 'Delivery', icon: ClipboardList, children: [
      { href: '/revenue-sheet', label: 'Project sheet', icon: Table2 },
      { href: '/pm-team', label: 'PM Team', icon: UserCog },
      { href: '/actions', label: 'Actions', icon: Zap },
      { href: '/kb-report', label: 'KB report', icon: PieChart },
    ],
  },
  // Read to explain the numbers, not to act on them.
  {
    label: 'Business Reports', icon: BarChart3, children: [
      { href: '/invoices', label: 'Invoices & Reconciliation', icon: Receipt },
      { href: '/business-numbers', label: 'Business Numbers', icon: LineChart },
      { href: '/business-trend', label: 'Business Trend', icon: TrendingUp },
      { href: '/last-year', label: 'Comparison', icon: History },
      { href: '/sql-leads', label: 'SQL / Leads', icon: Target },
      { href: '/operations/revenue-history', label: 'Revenue History', icon: Archive },
      { href: '/operations/lnd', label: 'L&D Program', icon: GraduationCap },
    ],
  },
  // Needs Input is deliberately NOT here. The page still exists and still works at
  // /needs-input — it is kept in PAGES in lib/access.ts so the route guard covers it —
  // it just is not offered in the nav. Put an entry back here to restore it.
  //
  // Forecast is likewise absent: it is a tab inside Business Trend now, because the two
  // answered the same question from opposite ends and reading one without the other was
  // how the same month got two different explanations.
  //
  // Small working tools a PM uses mid-task. A group from the start, because the Vendor
  // Calculator is the first of several.
  {
    label: 'PM Tools', icon: Wrench, children: [
      { href: '/pm-tools/vendor-calculator', label: 'Vendor Calculator', icon: Calculator },
    ],
  },
  { href: '/admin', label: 'Settings', icon: Settings },
]

// Below lg the sidebar is a slide-in drawer rather than a permanent 240px column —
// on a 375px phone a fixed sidebar left 135px for the content. `open` is lifted here
// so the burger button and the drawer share it, and the drawer closes on navigation.
export default function Sidebar() {
  const path = usePathname()
  const { profile, email, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  // Close on route change, otherwise tapping a link leaves the drawer covering the page.
  useEffect(() => { setOpen(false) }, [path])
  // Don't let the page scroll behind an open drawer.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])
  // Drop any group the viewer can see no children of, so an empty header never shows.
  // Worked out after mount and cached — the rail never waits on it.
  const actionCount = useActionCount(canSee(profile, '/actions'))
  const items: Entry[] = []
  for (const e of nav) {
    if (isGroup(e)) {
      const children = e.children.filter(c => canSee(profile, c.href))
      if (children.length) items.push({ ...e, children })
    } else if (canSee(profile, e.href)) {
      items.push(e)
    }
  }
  return (
    <>
      {/* Mobile top bar. Fixed so it survives the page's own scroll container. */}
      <div className="theme-rail lg:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-3 h-14 px-4 bg-mav-dark border-b border-mav-line">
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
          className="p-2 -ml-2 rounded-md text-mav-muted hover:text-mav-fg hover:bg-mav-panel">
          <Menu size={20} />
        </button>
        <MavlersMark className="h-4 w-auto text-mav-fill shrink-0" />
        <span className="font-bold tracking-[0.08em] uppercase truncate text-white">Web Digital</span>
      </div>

      {/* Scrim. Only rendered when open so it can never swallow taps on desktop. */}
      {open && <div onClick={() => setOpen(false)} className="lg:hidden fixed inset-0 z-40 bg-black/60" aria-hidden="true" />}

      <aside className={`theme-rail w-60 shrink-0 bg-mav-dark border-r border-mav-line h-screen overflow-y-auto p-4 flex flex-col
        fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:translate-x-0
        ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setOpen(false)} aria-label="Close menu"
          className="lg:hidden absolute top-3 right-3 p-2 rounded-md text-mav-muted hover:text-mav-fg hover:bg-mav-panel">
          <X size={18} />
        </button>
      {/* One line, in capitals, as Web PM sets its own name. "Dashboard" was dropped to
          get there: on a 240px rail the three words wrapped, and the page itself already
          says it is a dashboard. */}
      {/* White set explicitly. The rail redefines the colour tokens, but text that only
          INHERITS its colour got it from <body>, computed against the page's near-black —
          which is how the name vanished on the dark rail. */}
      <div className="flex items-center gap-2.5 px-3 py-3 mb-3">
        <MavlersMark className="h-5 w-auto text-mav-fill shrink-0" />
        <span className="text-[15px] font-bold tracking-[0.08em] uppercase whitespace-nowrap text-white">Web Digital</span>
      </div>
      <DepartmentSwitch />
      <nav className="space-y-1">
        {items.map(entry => isGroup(entry)
          ? <NavGroup key={entry.label} group={entry} path={path} counts={{ '/actions': actionCount }} />
          : <NavLink key={entry.href} leaf={entry} path={path} count={entry.href === '/actions' ? actionCount : null} />)}
      </nav>
      <div className="mt-auto pt-4 border-t border-mav-line">
        {/* Light or dark, remembered per browser. Dark stays the default. */}
        <div className="mb-2"><ThemeToggle /></div>
      </div>
      <div className="pt-3 border-t border-mav-line px-3">
        {email && <p className="text-xs text-mav-muted truncate mb-2" title={email}>{email}</p>}
        <button onClick={signOut} className="flex items-center gap-2 text-xs text-mav-muted hover:text-mav-fg">
          <LogOut size={13} /> Sign out
        </button>
      </div>
      </aside>
    </>
  )
}

// The GitHub Pages build sets trailingSlash, so usePathname() hands back "/clients/"
// while the nav holds "/clients" — an exact compare never matched and no tab ever lit
// up. Normalise both sides (keeping "/" for the root) before comparing.
const trim = (p?: string | null) => { const v = (p || '/').split(/[?#]/)[0]; return v.length > 1 ? v.replace(/\/+$/, '') : '/' }
// A detail page keeps its section lit: /pm-team/afzal-multani highlights PM Team.
// '/' is excluded or it would match every route.
const samePath = (path: string | null, href: string) =>
  trim(path) === trim(href) || (href !== '/' && trim(path).startsWith(trim(href) + '/'))

// items-start, not items-center: the longest label now wraps to two lines on a 240px
// rail, and centring would float the icon into the middle of them.
// Capitals with a little tracking, and the active item filled brand yellow with dark
// text — Web PM's rail, so the two tools feel like one. The per-section hues this used
// to fill with are gone from the rail: one accent reads faster than fifteen.
const linkCls = (active: boolean, indent = false) =>
  `flex items-center gap-3 ${indent ? 'pl-9 pr-3' : 'px-3'} py-2 rounded-md text-[12px] font-semibold uppercase tracking-[0.04em] leading-snug whitespace-nowrap transition-colors
   ${active ? 'bg-mav-fill text-black font-semibold' : 'text-mav-muted hover:text-mav-fg hover:bg-mav-panel'}`

function NavLink({ leaf, path, indent, count }: { leaf: Leaf; path: string; indent?: boolean; count?: number | null }) {
  const { href, label, icon: Icon } = leaf
  const active = samePath(path, href)
  return (
    // Announce the click so any open drawer closes itself. Needed because clicking the
    // section you are ALREADY on is a navigation to the same route: nothing re-renders,
    // so a drawer left open would stay open and the link would look broken.
    <Link href={href} onClick={() => window.dispatchEvent(new Event(NAV_EVENT))}
      className={linkCls(active, indent)}>
      <Icon size={16} className="shrink-0" /> <span className="min-w-0 truncate" title={label}>{label}</span>
      {/* Its own span so the label still truncates and the count never does. */}
      {count != null && <span className="-ml-2 shrink-0 font-normal opacity-60 tabular-nums">({count.toLocaleString()})</span>}
    </Link>
  )
}

// Closed by default (owner's call, 5 Oct 2026); a group opens itself only while you are on
// one of its pages, and a click opens it for the visit. Nothing is remembered between
// visits, so the rail always starts focused.
function NavGroup({ group, path, counts = {} }: { group: Group; path: string; counts?: Record<string, number | null> }) {
  const { label, icon: Icon, children } = group
  const hasActive = children.some(c => samePath(path, c.href))
  const [open, setOpen] = useState(hasActive)
  // Drop the open/closed state an earlier build saved, so it cannot reopen a group.
  useEffect(() => { try { window.localStorage.removeItem(`nav-group:${label}`) } catch { /* private window */ } }, [label])
  const expanded = open || hasActive
  // A closed group still shows the count of anything inside that has one (Actions).
  const total = children.reduce((s, c) => s + (counts[c.href] || 0), 0)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={expanded}
        className={`w-full ${linkCls(false)} justify-between text-left ${hasActive ? 'text-mav-fg' : ''}`}
      >
        <span className="flex items-center gap-3 min-w-0"><Icon size={16} className="shrink-0" /> <span className="min-w-0 truncate">{label}</span>
          {!expanded && total > 0 && <span className="-ml-2 shrink-0 font-normal opacity-60 tabular-nums">({total.toLocaleString()})</span>}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {children.map(c => <NavLink key={c.href} leaf={c} path={path} indent count={counts[c.href] ?? null} />)}
        </div>
      )}
    </div>
  )
}

// The department the whole board is read for — All, LP/HUB or WEB.
//
// It lives in the rail, under the product name, because it is not a property of any one
// page: every total, card and table on every page follows it, and it stays put as you
// move between them. It used to sit in each page's header, where it looked like a filter
// for that page alone. Admins only, as before; everyone else reads All.
function DepartmentSwitch() {
  const { unit, setUnit, canSwitch } = useUnit()
  if (!canSwitch) return null
  return (
    <div className="px-2 mb-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mav-muted mb-1.5">Department</div>
      <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-mav-line bg-mav-panel p-0.5"
        role="group" aria-label="Department">
        {UNITS.map(u => {
          const on = u.id === unit
          return (
            <button key={u.id} onClick={() => setUnit(u.id)} title={u.hint} aria-pressed={on}
              className={`py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-md transition-colors ${
                on ? 'bg-mav-fill text-black' : 'text-mav-muted hover:text-mav-fg'}`}>
              {u.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
