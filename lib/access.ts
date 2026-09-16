import { supabase } from './supabase'

// Access model
// ------------
// Anyone signing in with a Mavlers or Uplers Google account gets the dashboard.
// There is no per-person allowlist any more: everyone on it was an admin, so it
// gated nothing and only added a step.
//
// The one exception is the PM Team section. A PM sees their own scorecard and
// nobody else's; anyone who is not a PM sees the whole team. That rule lives in
// lib/pm-team.ts (pmByEmail), derived from the roster rather than a permissions
// table.
//
// STATED PLAINLY: the PM rule is CLIENT-SIDE. The pages still load the full
// dataset with the public anon key and hide what the viewer should not see. It
// stops a PM browsing a colleague's numbers; it does not stop someone who opens
// developer tools. Enforcing it properly means filtering in the database against
// the signed-in identity — a separate piece of work.

/** Domains allowed to sign in. */
export const ALLOWED_DOMAINS = ['mavlers.com', 'uplers.com']

export const isAllowedDomain = (email?: string | null): boolean => {
  const at = (email || '').trim().toLowerCase().split('@')[1]
  return !!at && ALLOWED_DOMAINS.includes(at)
}

// Every signed-in person sees all of these. The list stays so the sidebar and the
// route guard read from one place.
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

// Derived from the Google identity now rather than read from a table. `role` is
// kept so existing callers still compile; everyone who signs in is equivalent.
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

export const profileFor = (email: string, fullName?: string | null): Profile => ({
  email: email.trim().toLowerCase(),
  full_name: fullName || null,
  role: 'admin',
  is_active: true,
  allowed_pages: PAGES.map(p => p.href),
})

// Every signed-in person can open every page. The only scoping left is inside
// the PM Team pages, which narrow to the viewer's own record.
export function canSee(profile: Profile | null, _path: string): boolean {
  return !!profile && profile.is_active
}

/**
 * Access is decided by the email domain alone — no database round-trip, so it
 * cannot fail transiently and lock somebody out. Kept as a function so the
 * sign-in path has a single entry point.
 */
export async function checkAccess(email: string): Promise<Profile | null> {
  return isAllowedDomain(email) ? profileFor(email) : null
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

// The dashboard_users allowlist and its admin RPCs are no longer consulted. The
// table is left in the database rather than dropped, so the old model can be
// restored by reinstating checkAccess() and canSee() if this one proves too open.
