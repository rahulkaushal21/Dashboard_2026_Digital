'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getMyProfile, canSee, Profile } from '@/lib/access'
import Sidebar from './Sidebar'

interface AuthState { profile: Profile | null; email: string | null; signOut: () => void }
const AuthCtx = createContext<AuthState>({ profile: null, email: null, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(undefined) // undefined = still loading
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { setProfile(null); return }
    getMyProfile().then(setProfile)
  }, [session])

  const signOut = () => { supabase?.auth.signOut() }

  if (session === undefined || (session && profile === undefined))
    return <Centered>Loading…</Centered>

  if (!supabase)
    return <Centered>Connect Supabase to enable sign-in.</Centered>

  if (!session)
    return <LoginScreen />

  if (!profile || !profile.is_active)
    return <NoAccess email={session.user?.email} signOut={signOut} />

  return (
    <AuthCtx.Provider value={{ profile, email: session.user?.email ?? null, signOut }}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 p-8 max-w-[1400px] h-screen overflow-y-auto">
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
        <p className="text-sm text-mav-muted">You don't have access to this page. Ask an admin to grant it in Settings.</p>
      </div>
    )
  return <>{children}</>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center text-mav-muted">{children}</div>
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const sendLink = async () => {
    setErr('')
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
    if (error) setErr(error.message); else setSent(true)
  }
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="flex items-center gap-2 mb-6">
          <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
          <span className="font-semibold tracking-tight">Digital Dashboard</span>
        </div>
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-mav-muted mb-4">Access is restricted. We'll email you a one-time sign-in link.</p>
        {sent ? (
          <p className="text-sm text-green-400">Link sent to {email}. Check your inbox, then open the link on this device.</p>
        ) : (
          <div className="space-y-3">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
              onKeyDown={e => e.key === 'Enter' && sendLink()}
              className="w-full bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
            <button onClick={sendLink} className="w-full bg-mav-yellow text-black font-medium rounded-md py-2 text-sm">Send sign-in link</button>
            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function NoAccess({ email, signOut }: { email?: string; signOut: () => void }) {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6 text-center">
        <h1 className="text-xl font-semibold mb-2">No access</h1>
        <p className="text-sm text-mav-muted mb-1">{email} isn't on the access list for this dashboard.</p>
        <p className="text-sm text-mav-muted mb-5">Ask an admin (web@uplers.com) to add you.</p>
        <button onClick={signOut} className="text-xs text-mav-muted hover:text-white underline">Sign out</button>
      </div>
    </div>
  )
}
