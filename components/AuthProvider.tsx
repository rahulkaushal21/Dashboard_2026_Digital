'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { checkAccess, getMyProfile, setCurrentEmail, clearCurrentEmail, canSee, Profile } from '@/lib/access'
import Sidebar from './Sidebar'

interface AuthState { profile: Profile | null; email: string | null; signOut: () => void }
const AuthCtx = createContext<AuthState>({ profile: null, email: null, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined) // undefined = loading

  useEffect(() => { getMyProfile().then(p => setProfile(p ?? null)) }, [])

  const onLogin = (p: Profile) => setProfile(p)
  const signOut = () => { clearCurrentEmail(); setProfile(null) }

  if (profile === undefined) return <Centered>Loading…</Centered>
  if (!profile || !profile.is_active) return <LoginScreen onLogin={onLogin} />

  return (
    <AuthCtx.Provider value={{ profile, email: profile.email, signOut }}>
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

function LoginScreen({ onLogin }: { onLogin: (p: Profile) => void }) {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const login = async () => {
    setErr(''); setBusy(true)
    try {
      const p = await checkAccess(email)
      if (p && p.is_active) { setCurrentEmail(email); onLogin(p) }
      else setErr("This email doesn't have access. Ask an admin to add you.")
    } catch (e: any) { setErr(e.message || 'Login failed') }
    finally { setBusy(false) }
  }
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="flex items-center gap-2 mb-6">
          <span className="inline-block w-3 h-3 rounded-sm bg-mav-yellow" />
          <span className="font-semibold tracking-tight">Digital Dashboard</span>
        </div>
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-mav-muted mb-4">Enter your work email to continue.</p>
        <div className="space-y-3">
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
            onKeyDown={e => e.key === 'Enter' && login()} autoFocus
            className="w-full bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
          <button onClick={login} disabled={busy}
            className="w-full bg-mav-yellow text-black font-medium rounded-md py-2 text-sm disabled:opacity-60">
            {busy ? 'Checking…' : 'Log in'}
          </button>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>
      </div>
    </div>
  )
}
