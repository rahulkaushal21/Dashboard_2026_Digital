import { supabase } from './supabase'

// The pages a viewer can be granted. `/admin` (Settings + user management) is
// admin-only and never appears here. Keys are the route hrefs, matched against
// dashboard_users.allowed_pages.
export const PAGES: { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/clients', label: 'Clients' },
  { href: '/quotes', label: 'Quotes' },
  { href: '/escalations', label: 'Escalations' },
  { href: '/sql-leads', label: 'SQL / Leads' },
  { href: '/business-trend', label: 'Business Trend' },
  { href: '/last-year', label: 'Last Year Review' },
]

export interface Profile {
  email: string
  full_name?: string | null
  role: 'admin' | 'viewer' | string
  is_active: boolean
  access_expires_at?: string | null
  allowed_pages?: string[] | null
}

// Which routes this profile may open. Admins see everything (incl. Settings);
// viewers see only their allowed_pages.
export function canSee(profile: Profile | null, path: string): boolean {
  if (!profile || !profile.is_active) return false
  if (profile.role === 'admin') return true
  if (path === '/admin') return false
  const allowed = profile.allowed_pages || []
  return allowed.includes(path)
}

// The current signed-in user's allowlist row (null if not on the allowlist).
export async function getMyProfile(): Promise<Profile | null> {
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email
  if (!email) return null
  const { data } = await supabase
    .from('dashboard_users')
    .select('email, full_name, role, is_active, access_expires_at, allowed_pages')
    .ilike('email', email)
    .maybeSingle()
  return (data as Profile) || null
}

// ---- Admin user management (RLS lets only an admin session write) ----
export async function listUsers(): Promise<Profile[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('dashboard_users')
    .select('email, full_name, role, is_active, access_expires_at, allowed_pages')
    .order('created_at', { ascending: true })
  return (data as Profile[]) || []
}

export async function upsertUser(u: Partial<Profile> & { email: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const row = {
    email: u.email.trim().toLowerCase(),
    full_name: u.full_name ?? null,
    role: u.role || 'viewer',
    is_active: u.is_active ?? true,
    allowed_pages: u.role === 'admin' ? null : (u.allowed_pages || []),
  }
  const { error } = await supabase.from('dashboard_users').upsert(row, { onConflict: 'email' })
  if (error) throw error
}

export async function deleteUser(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('dashboard_users').delete().ilike('email', email)
  if (error) throw error
}
