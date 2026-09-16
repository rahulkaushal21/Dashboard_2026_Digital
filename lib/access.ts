import { supabase } from './supabase'

// The pages a viewer can be granted. `/admin` (Settings + user management) is
// admin-only and never appears here. Keys are the route hrefs, matched against
// dashboard_users.allowed_pages.
export const PAGES: { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/clients', label: 'Clients' },
  { href: '/escalations', label: 'Escalations' },
  { href: '/critical-escalations', label: 'Critical Escalations' },
  { href: '/delights', label: 'Delights' },
  { href: '/sql-leads', label: 'SQL / Leads' },
  { href: '/business-trend', label: 'Business Trend' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/last-year', label: 'Last Year Review' },
  { href: '/pm-team', label: 'PM Team' },
]

// Operations sub-pages are deliberately NOT in PAGES. They hold named-person data
// (individual learning progress against a reporting manager), so they are admin-only
// and cannot be granted to a viewer from Settings. Move an entry into PAGES above if
// that ever needs to change.
const ADMIN_ONLY = ['/operations/lnd', '/operations/revenue-history']

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
  if (ADMIN_ONLY.includes(path)) return false
  const allowed = profile.allowed_pages || []
  if (allowed.includes(path)) return true
  // A granted section also covers its detail pages — /pm-team grants
  // /pm-team/afzal-multani. Without this a viewer could open the PM list and then
  // be locked out of every name on it. '/' is excluded explicitly, or it would
  // prefix-match the entire dashboard. The trailing slash matters: '/pm' must not
  // open '/pm-team'. ADMIN_ONLY is already rejected above, so this cannot widen it.
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path
  return allowed.some(a => a !== '/' && p.startsWith(a + '/'))
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

// ---- Google sign-in -------------------------------------------------------
//
// Google proves WHO you are; `dashboard_users` still decides WHAT you can open.
// The two are deliberately separate: signing in with a Google account that is not
// on the allowlist gets you nothing, and being on the allowlist no longer lets
// somebody else type your address and walk in.
//
// The OAuth flow is `implicit` (set on the client in lib/supabase.ts) because this
// app is a static export with no server to exchange a PKCE code. The token comes
// back in the URL fragment and supabase-js picks it up via detectSessionInUrl.

/** Where Google sends the browser back to — the page you started from. */
const returnUrl = () =>
  typeof window === 'undefined' ? '' : window.location.href.split('#')[0].split('?')[0]

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: returnUrl(),
      // Always show the chooser. Without it a shared machine silently reuses
      // whichever Google account signed in last.
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
}

/**
 * The email Google has verified for the current session, or null.
 * `email_verified` is checked explicitly — an unverified address proves nothing.
 */
export async function verifiedEmail(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user?.email) return null
  const claim = (user.user_metadata as any)?.email_verified
  if (claim === false) return null
  return user.email.trim().toLowerCase()
}

export async function signOutGoogle(): Promise<void> {
  try { await supabase?.auth.signOut() } catch { /* local session is cleared anyway */ }
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
