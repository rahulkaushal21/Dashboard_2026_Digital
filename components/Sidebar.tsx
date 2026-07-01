'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Briefcase, Users, FileText, AlertTriangle, Target, TrendingUp, History, Settings, LogOut } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canSee } from '@/lib/access'

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/quotes', label: 'Quotes', icon: FileText },
  { href: '/escalations', label: 'Escalations', icon: AlertTriangle },
  { href: '/sql-leads', label: 'SQL / Leads', icon: Target },
  { href: '/business-trend', label: 'Business Trend', icon: TrendingUp },
  { href: '/last-year', label: 'Last Year Review', icon: History },
  { href: '/admin', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const path = usePathname()
  const { profile, email, signOut } = useAuth()
  const items = nav.filter(n => canSee(profile, n.href))
  return (
    <aside className="w-60 shrink-0 bg-mav-dark border-r border-mav-line h-screen overflow-y-auto p-4 flex flex-col">
      <div className="flex items-center gap-2 px-2 py-3 mb-4">
        <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
        <span className="font-semibold tracking-tight">Digital Dashboard</span>
      </div>
      <nav className="space-y-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path === href
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
                ${active ? 'bg-mav-yellow text-black font-medium' : 'text-mav-muted hover:text-white hover:bg-mav-panel'}`}>
              <Icon size={16} /> {label}
            </Link>
          )
        })}
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
