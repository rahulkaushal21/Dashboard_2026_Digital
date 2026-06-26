'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Briefcase, Users, FileText, Factory, AlertTriangle, Target, TrendingUp, History, PieChart, Settings } from 'lucide-react'

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/quotes', label: 'Quotes', icon: FileText },
  { href: '/industry', label: 'Industry Focus', icon: Factory },
  { href: '/escalations', label: 'Escalations', icon: AlertTriangle },
  { href: '/sql-leads', label: 'SQL / Leads', icon: Target },
  { href: '/business-trend', label: 'Business Trend', icon: TrendingUp },
  { href: '/last-year', label: 'Last Year Review', icon: History },
  { href: '/pareto', label: '20 / 80 Rule', icon: PieChart },
  { href: '/admin', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="w-60 shrink-0 bg-mav-dark border-r border-mav-line h-screen overflow-y-auto p-4">
      <div className="flex items-center gap-2 px-2 py-3 mb-4">
        <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
        <span className="font-semibold tracking-tight">Digital Dashboard</span>
      </div>
      <nav className="space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
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
    </aside>
  )
}
