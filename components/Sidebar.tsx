'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, Briefcase, Users, AlertTriangle, Siren, Sparkles, Target, TrendingUp, History, Settings, LogOut, Cog, GraduationCap, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canSee } from '@/lib/access'

// A nav entry is either a link or a group of links. Groups exist so Operations can
// hold several sub-pages without crowding the top level; access is still granted
// per sub-page, never per group.
type Leaf = { href: string; label: string; icon: any }
type Group = { label: string; icon: any; children: Leaf[] }
type Entry = Leaf | Group
const isGroup = (e: Entry): e is Group => 'children' in e

const nav: Entry[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/escalations', label: 'Major Process Gap', icon: AlertTriangle },
  { href: '/critical-escalations', label: 'Critical Escalations', icon: Siren },
  { href: '/delights', label: 'Delights', icon: Sparkles },
  { href: '/sql-leads', label: 'SQL / Leads', icon: Target },
  { href: '/business-trend', label: 'Business Trend', icon: TrendingUp },
  { href: '/last-year', label: 'Last Year Review', icon: History },
  {
    label: 'Operations', icon: Cog, children: [
      { href: '/operations/lnd', label: 'L&D Program', icon: GraduationCap },
    ],
  },
  { href: '/admin', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const path = usePathname()
  const { profile, email, signOut } = useAuth()
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
    <aside className="w-60 shrink-0 bg-mav-dark border-r border-mav-line h-screen overflow-y-auto p-4 flex flex-col">
      <div className="flex items-center gap-2 px-2 py-3 mb-4">
        <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
        <span className="font-semibold tracking-tight">Digital Dashboard</span>
      </div>
      <nav className="space-y-1">
        {items.map(entry => isGroup(entry)
          ? <NavGroup key={entry.label} group={entry} path={path} />
          : <NavLink key={entry.href} leaf={entry} path={path} />)}
      </nav>
      <div className="mt-auto pt-4 border-t border-mav-line px-3">
        {email && <p className="text-xs text-mav-muted truncate mb-2" title={email}>{email}</p>}
        <button onClick={signOut} className="flex items-center gap-2 text-xs text-mav-muted hover:text-white">
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </aside>
  )
}

const linkCls = (active: boolean, indent = false) =>
  `flex items-center gap-3 ${indent ? 'pl-9 pr-3' : 'px-3'} py-2 rounded-md text-sm transition-colors
   ${active ? 'bg-mav-yellow text-black font-medium' : 'text-mav-muted hover:text-white hover:bg-mav-panel'}`

function NavLink({ leaf, path, indent }: { leaf: Leaf; path: string; indent?: boolean }) {
  const { href, label, icon: Icon } = leaf
  return (
    <Link href={href} className={linkCls(path === href, indent)}>
      <Icon size={16} /> {label}
    </Link>
  )
}

function NavGroup({ group, path }: { group: Group; path: string }) {
  const { label, icon: Icon, children } = group
  const hasActive = children.some(c => path === c.href)
  // Open when you're inside it; otherwise remember what you last toggled.
  const [open, setOpen] = useState(hasActive)
  const expanded = open || hasActive
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={expanded}
        className={`w-full ${linkCls(false)} justify-between`}
      >
        <span className="flex items-center gap-3"><Icon size={16} /> {label}</span>
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
