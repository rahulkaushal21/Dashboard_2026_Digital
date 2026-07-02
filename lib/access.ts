import { supabase } from './supabase'

// The pages a viewer can be granted. `/admin` (Settings + user management) is
// admin-only and never appears here. Keys are the route hrefs, matched against
// dashboard_users.allowed_pages.
export const PAGES: { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/clients', label: 'Clients' },
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
  allowed_pages?: string[] | null
}

const KEY = 'dash_email'
const PKEY = 'dash_profile'
export function currentEmail(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(KEY)
}
// Cache the whole profile so a reload is instant and does NOT depend on a
// network round-trip succeeding — the session survives transient failures.
export function getStoredProfile(): Profile | null {
  if (typeof window === 'undefined') return null
  try { const s = window.localStorage.getItem(PKEY); return s ? JSON.parse(s) as Profile : null }
  catch { return null }
}
export function saveSession(profile: Profile) {
  window.localStorage.setItem(KEY, profile.email.trim().toLowerCase())
  window.localStorage.setItem(PKEY, JSON.stringify(profile))
}
export function clearSession() { window.localStorage.removeItem(KEY); window.localStorage.removeItem(PKEY) }

// Which routes this profile may open. Admins see everything (incl. Settings);
// viewers see only their allowed_pages.
export function canSee(profile: Profile | null, path: string): boolean {
  if (!profile || !profile.is_active) return false
  if (profile.role === 'admin') return true
  if (path === '/admin') return false
  const allowed = profile.allowed_pages || []
  return allowed.includes(path)
}

// Look up an email in the allowlist (active only). Returns the profile, or null
// if the email is definitively not on the list. THROWS on a transient error
// (network/RPC) so callers can tell "not allowed" apart from "couldn't check".
export async function checkAccess(email: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('dashboard_check', { p_email: email.trim().toLowerCase() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return (row as Profile) || null
}

// ---- Admin user management (RPCs verify the actor is an active admin) ----
export async function listUsers(): Promise<Profile[]> {
  if (!supabase) return []
  const { data } = await supabase.rpc('dashboard_list', { p_actor: currentEmail() || '' })
  return (data as Profile[]) || []
}

export async function upsertUser(u: Partial<Profile> & { email: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.rpc('dashboard_upsert_user', {
    p_actor: currentEmail() || '',
    p_email: u.email.trim().toLowerCase(),
    p_full_name: u.full_name ?? '',
    p_role: u.role || 'viewer',
    p_pages: u.role === 'admin' ? [] : (u.allowed_pages || []),
    p_active: u.is_active ?? true,
  })
  if (error) throw error
}

export async function deleteUser(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.rpc('dashboard_delete_user', {
    p_actor: currentEmail() || '',
    p_email: email.trim().toLowerCase(),
  })
  if (error) throw error
}
