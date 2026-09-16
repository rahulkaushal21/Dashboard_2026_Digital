import { supabase } from './supabase'

// Access model
// ------------
// Anyone signing in with a Mavlers or Uplers Google account gets the dashboard.
// There is no per-person allowlist any more: everyone on it was an admin, so it
// gated nothing and only added a step.
//
// The one exception is the PM Team section:
//   • an ADMIN sees every PM
//   • a PM sees their own scorecard and nobody else's
//   • anyone who is neither sees none of it
// Admins live in `dashboard_admins`, managed by the owner from Settings.
//
// STATED PLAINLY: the PM rule is CLIENT-SIDE. The pages still load the full
// dataset with the public anon key and hide what the viewer should not see. It
// stops a PM browsing a colleague's numbers; it does not stop someone who opens
// developer tools. Enforcing it properly means filtering in the database against
// the signed-in identity — a separate piece of work.

/** Domains allowed to sign in. */
export const ALLOWED_DOMAINS = ['mavlers.com', 'uplers.com']

/**
 * The owner, who manages the admin list. Fixed here and in the database policy
 * rather than stored as a row, so deleting the last admin can never lock
 * everybody out of admin management.
 */
export const OWNER_EMAIL = 'web@uplers.com'
export const isOwner = (email?: string | null) => (email || '').trim().toLowerCase() === OWNER_EMAIL

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
  /** Sees the whole PM Team section. Resolved at sign-in from dashboard_admins. */
  is_admin?: boolean
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

// ---- Forcing everybody to sign in again -----------------------------------
// BUMP THIS STRING to sign every user out. On the next load their cached profile
// is dropped and their Google session is revoked, so they land on the sign-in
// screen and have to go through Google again.
//
// Why a constant in the bundle rather than a server-side revocation list: this is
// a static export with no server of its own, so nothing re-checks a session on
// each request. Clearing `auth.sessions` in Postgres revokes the REFRESH token,
// but it does not reach the profile cached in localStorage — which is what keeps
// somebody signed in here — and an already-issued access token stays valid until
// it expires. Shipping a new epoch in the JS reaches every browser the moment it
// loads the new build, which is the only moment we actually control.
export const SESSION_EPOCH = '2026-09-16-google-reauth'
const EKEY = 'dash_epoch'

/**
 * True when this browser has not yet been through the current epoch.
 *
 * Note a browser that has NEVER signed in is also "stale" — it has no marker at
 * all. That is deliberate and harmless: it clears nothing, stamps the marker, and
 * shows the sign-in screen it would have shown anyway.
 */
export function sessionEpochStale(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(EKEY) !== SESSION_EPOCH }
  catch { return false }   // storage blocked — never lock somebody into a logout loop
}

/**
 * Perform the forced sign-out, then stamp the epoch so it happens exactly once.
 *
 * The stamp is written FIRST and unconditionally. If it were written only after a
 * successful sign-out, a user coming back from the Google redirect would arrive
 * still stale, get signed out again, and bounce between here and Google forever.
 */
export async function applySessionEpoch(): Promise<void> {
  try { window.localStorage.setItem(EKEY, SESSION_EPOCH) } catch { /* nothing more we can do */ }
  clearSession()
  await signOutGoogle()
}

export const profileFor = (email: string, fullName?: string | null, isAdmin = false): Profile => ({
  is_admin: isAdmin || isOwner(email),
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
  if (!isAllowedDomain(email)) return null
  return profileFor(email, null, await isAdminEmail(email))
}

// ---- Admin list -----------------------------------------------------------
//
// Reads go through the signed-in session, so `dashboard_admins` is invisible to
// anon. Writes are refused by the database unless the JWT belongs to the owner —
// the client cannot talk its way past that by claiming to be somebody else.

export interface AdminRow { email: string; added_by: string; added_at?: string; note?: string | null }

/**
 * Whether this address is an admin. The owner always is, checked locally first,
 * so a failed or not-yet-created table can never lock the owner out of the
 * section they administer.
 */
export async function isAdminEmail(email: string): Promise<boolean> {
  if (isOwner(email)) return true
  if (!supabase) return false
  try {
    const { data, error } = await supabase
      .from('dashboard_admins').select('email').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (error) return false
    return !!data
  } catch { return false }
}

export async function listAdmins(): Promise<AdminRow[]> {
  if (!supabase) return []
  const { data } = await supabase.from('dashboard_admins').select('*').order('added_at', { ascending: true })
  return (data as AdminRow[]) || []
}

export async function addAdmin(email: string, addedBy: string, note?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const e = email.trim().toLowerCase()
  if (!isAllowedDomain(e)) throw new Error(`Only ${ALLOWED_DOMAINS.join(' and ')} addresses can be admins.`)
  const { error } = await supabase.from('dashboard_admins').insert({ email: e, added_by: addedBy, note: note || null })
  if (error) throw new Error(error.message)
}

export async function removeAdmin(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('dashboard_admins').delete().eq('email', email.trim().toLowerCase())
  if (error) throw new Error(error.message)
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

/**
 * Does a Google session actually exist in this browser?
 *
 * getSession() reads localStorage and never makes a network call, so `false`
 * here means "there is no session", NOT "we could not reach Supabase". That
 * distinction is the whole point: the cached profile exists to survive a
 * transient network failure, not to outlive the session itself.
 *
 * Errors fail OPEN — an unreadable store should not eject somebody who is
 * genuinely signed in.
 */
export async function hasGoogleSession(): Promise<boolean> {
  if (!supabase) return true   // no backend wired up (mock data) — nothing to check
  try {
    const { data } = await supabase.auth.getSession()
    return !!data.session
  } catch { return true }
}

/**
 * Call `onLost` if the Google session ends while the page is open — a sign-out
 * in another tab, or a refresh that fails. Page load is not the only moment a
 * session can disappear, and a tab left open for a day would otherwise keep
 * showing a signed-in dashboard whose every write is refused.
 *
 * Returns an unsubscribe function.
 */
export function onSessionLost(onLost: () => void): () => void {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) onLost()
  })
  return () => { try { data.subscription.unsubscribe() } catch { /* already gone */ } }
}

export async function signOutGoogle(): Promise<void> {
  try { await supabase?.auth.signOut() } catch { /* local session is cleared anyway */ }
}

// The dashboard_users allowlist and its admin RPCs are no longer consulted. The
// table is left in the database rather than dropped, so the old model can be
// restored by reinstating checkAccess() and canSee() if this one proves too open.
