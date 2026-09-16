'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { checkAccess, getStoredProfile, saveSession, clearSession, canSee, Profile,
  signInWithGoogle, verifiedEmail, signOutGoogle, ALLOWED_DOMAINS } from '@/lib/access'
import Sidebar from './Sidebar'

interface AuthState { profile: Profile | null; email: string | null; signOut: () => void }
const AuthCtx = createContext<AuthState>({ profile: null, email: null, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined) // undefined = loading
  // A Google account that authenticated fine but is not on an allowed domain.
  // Held so the sign-in screen can name the address it refused, rather than
  // bouncing the user back to a blank button with no idea what happened.
  const [refused, setRefused] = useState<string | null>(null)

  useEffect(() => {
    let done = false

    const run = async () => {
      // 1. A Google session wins, because it PROVES the address. Coming back from
      //    the OAuth redirect this is the only thing that exists yet.
      let google: string | null = null
      try { google = await verifiedEmail() } catch { /* fall through to the cache */ }

      if (google) {
        try {
          const p = await checkAccess(google)
          if (done) return
          if (p && p.is_active) { saveSession(p); setProfile(p); setRefused(null) }
          else {
            // Authenticated with Google, but on a domain we don't admit. Drop the
            // Google session too, or the next load silently retries the same
            // rejection forever.
            await signOutGoogle(); clearSession(); setProfile(null); setRefused(google)
          }
          return
        } catch {
          // Fall through to the cached profile rather than locking out someone
          // who is genuinely signed in.
        }
      }

      // 2. Cached profile — instant, no network gate on load.
      const stored = getStoredProfile()
      if (done) return
      if (stored && stored.is_active) {
        setProfile(stored)
        // Re-check the domain in case the rule changed since the session was
        // cached. This no longer touches the network, so it cannot fail.
        checkAccess(stored.email)
          .then(fresh => {
            if (done) return
            if (fresh === null) { clearSession(); setProfile(null) }
            else { saveSession(fresh); setProfile(fresh) }
          })
          .catch(() => { /* keep the cached session */ })
      } else {
        setProfile(null)
      }
    }

    run()
    return () => { done = true }
  }, [])

  const signOut = () => { signOutGoogle(); clearSession(); setProfile(null); setRefused(null) }

  if (profile === undefined) return <Centered>Loading…</Centered>
  if (!profile || !profile.is_active) return <LoginScreen refused={refused} />

  return (
    <AuthCtx.Provider value={{ profile, email: profile.email, signOut }}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        {/* pt-20 on mobile clears the fixed top bar; padding tightens on small screens
            so a phone is not spending 64px of a 375px width on margins. min-w-0 lets
            the flex child actually shrink, without which wide tables push the whole
            page sideways instead of scrolling inside their own container. */}
        <main className="flex-1 min-w-0 px-4 pt-20 pb-8 sm:px-6 lg:p-8 max-w-[1400px] h-screen overflow-y-auto">
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>
    </AuthCtx.Provider>
  )
}

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  const path = usePathname()
  if (!canSee(profile, path))
    return (
      <div className="max-w-md mt-16">
        <h1 className="text-xl font-semibold mb-2">No access</h1>
        <p className="text-sm text-mav-muted">You don&rsquo;t have access to this page.</p>
      </div>
    )
  return <>{children}</>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center text-mav-muted">{children}</div>
}

function LoginScreen({ refused }: { refused: string | null }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const google = async () => {
    setErr(''); setBusy(true)
    // No finally: on success the browser is already navigating to Google, and
    // clearing `busy` would flash the button back to life mid-redirect.
    try { await signInWithGoogle() }
    catch (e: any) { setErr(e.message || 'Could not start Google sign-in'); setBusy(false) }
  }

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="flex items-center gap-2 mb-6">
          <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
          <span className="font-semibold tracking-tight">Digital Dashboard</span>
        </div>
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-mav-muted mb-5">
          Use your work Google account — {ALLOWED_DOMAINS.join(' or ')}.
        </p>

        {refused && (
          <div className="mb-4 text-sm bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">
            <p className="text-red-400 font-medium">{refused} can&rsquo;t sign in here.</p>
            <p className="text-mav-muted mt-1">
              The dashboard is open to {ALLOWED_DOMAINS.join(' and ')} accounts. Sign in with your work account instead.
            </p>
          </div>
        )}

        <button onClick={google} disabled={busy}
          className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] font-medium rounded-md py-2.5 text-sm disabled:opacity-60 hover:bg-white/90 transition-colors">
          <GoogleMark />
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
