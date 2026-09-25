'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X, LayoutDashboard, Briefcase, Users, AlertTriangle, Siren, Sparkles, Target, TrendingUp, LineChart, History, Archive, LogOut, BarChart3, GraduationCap, ChevronDown, ChevronRight, UserCog, Settings, Table2, PieChart } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canSee } from '@/lib/access'
import ThemeToggle from './ThemeToggle'
import { hueFor } from '@/lib/section-hue'
import { NAV_EVENT } from '@/lib/use-close-on-nav'

// A nav entry is either a link or a group of links. Groups exist so the reporting pages
// can sit together without crowding the seven the business is run from; access is still
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
  // ── The seven pages the business is run from day to day ──────────────────────
  // Everything that is read to DECIDE something sits at this level. Everything that is
  // read to EXPLAIN something afterwards went into the group below. Thirteen top-level
  // items meant scanning the whole rail to find the two or three anybody opens daily.
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/revenue-sheet', label: 'Project sheet', icon: Table2 },
  // The page has always held the feedback sheet plus manually added praise; 'Delights'
  // described the best of it rather than the thing itself. The URL stays /delights so
  // existing links and bookmarks still resolve.
  { href: '/delights', label: 'Feedback', icon: Sparkles },
  // Critical Escalations only. Major Process Gap is the standing log, which is read to
  // find patterns rather than to act today, so it sits with the reports.
  { href: '/critical-escalations', label: 'Critical Escalations', icon: Siren },
  { href: '/pm-team', label: 'PM Team', icon: UserCog },
  { href: '/kb-report', label: 'KB report', icon: PieChart },

  // ── Everything read to explain the numbers, not to act on them ───────────────
  // Access is still granted per sub-page, never per group: an empty group is dropped
  // rather than shown, so nobody sees a header that opens onto nothing.
  {
    label: 'Business Reports', icon: BarChart3, children: [
      { href: '/business-numbers', label: 'Business Numbers', icon: LineChart },
      { href: '/business-trend', label: 'Business Trend', icon: TrendingUp },
      { href: '/last-year', label: 'Quarter over Quarter', icon: History },
      { href: '/clients', label: 'Client 360', icon: Users },
      { href: '/escalations', label: 'Major Process Gap', icon: AlertTriangle },
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
        <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
        <span className="font-semibold tracking-tight truncate">Web Digital Dashboard</span>
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
      {/* The rail is 240px, and the longer name no longer fits on one line at this
          weight. Allowed to wrap rather than truncated — "Web Digital Dash…" in the one
          place that says what the product is would be worse than two lines. */}
      <div className="flex items-start gap-2 px-2 py-3 mb-4">
        <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow shrink-0 mt-1" />
        <span className="font-semibold tracking-tight leading-tight min-w-0">Web Digital Dashboard</span>
      </div>
      <nav className="space-y-1">
        {items.map(entry => isGroup(entry)
          ? <NavGroup key={entry.label} group={entry} path={path} />
          : <NavLink key={entry.href} leaf={entry} path={path} />)}
      </nav>
      <div className="mt-auto pt-4 border-t border-mav-line">
        {/* Light or dark, remembered per browser. Dark stays the default. */}
        <div className="px-3 mb-2 -mx-0"><ThemeToggle /></div>
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

// The active item is filled with ITS OWN section colour rather than the one brand yellow:
// the nav is where you learn what each section's colour is, so every page's heading rule
// and card edges are already familiar by the time you get there. White text on these,
// since they are all dark enough to carry it in both themes.
// items-start, not items-center: the longest label now wraps to two lines on a 240px
// rail, and centring would float the icon into the middle of them.
const linkCls = (active: boolean, indent = false) =>
  `flex items-start gap-3 ${indent ? 'pl-9 pr-3' : 'px-3'} py-2 rounded-md text-sm leading-snug transition-colors
   ${active ? 'text-white font-medium' : 'text-mav-muted hover:text-mav-fg hover:bg-mav-panel'}`

function NavLink({ leaf, path, indent }: { leaf: Leaf; path: string; indent?: boolean }) {
  const { href, label, icon: Icon } = leaf
  const active = samePath(path, href)
  const hue = hueFor(href)
  return (
    // Announce the click so any open drawer closes itself. Needed because clicking the
    // section you are ALREADY on is a navigation to the same route: nothing re-renders,
    // so a drawer left open would stay open and the link would look broken.
    <Link href={href} onClick={() => window.dispatchEvent(new Event(NAV_EVENT))}
      className={linkCls(active, indent)}
      style={active ? { background: `var(--nav-${hue.name}, ${hue.dark})` } : undefined}>
      <Icon size={16} className="shrink-0 mt-0.5" /> <span className="min-w-0">{label}</span>
    </Link>
  )
}

function NavGroup({ group, path }: { group: Group; path: string }) {
  const { label, icon: Icon, children } = group
  const hasActive = children.some(c => samePath(path, c.href))
  // Open when you're inside it; otherwise remember what you last toggled.
  const [open, setOpen] = useState(hasActive)
  const expanded = open || hasActive
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={expanded}
        className={`w-full ${linkCls(false)} justify-between ${hasActive ? 'text-mav-fg' : ''}`}
      >
        <span className="flex items-center gap-3"><Icon size={16} className="shrink-0 mt-0.5" /> <span className="min-w-0">{label}</span></span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {children.map(c => <NavLink key={c.href} leaf={c} path={path} indent />)}
        </div>
      )}
    </div>
  )
}
