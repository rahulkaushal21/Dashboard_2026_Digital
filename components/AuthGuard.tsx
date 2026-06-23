'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LogOut } from 'lucide-react'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(undefined)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="text-mav-muted">Loading…</div>

  if (!supabase) return <div className="text-mav-muted">Connect Supabase to enable sign-in.</div>

  if (!session) {
    const sendLink = async () => {
      setErr('')
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
      if (error) setErr(error.message); else setSent(true)
    }
    return (
      <div className="max-w-sm mt-10">
        <h1 className="text-xl font-semibold mb-2">Sign in</h1>
        <p className="text-sm text-mav-muted mb-4">Admin access — we'll email you a one-time sign-in link.</p>
        {sent ? (
          <p className="text-sm text-green-400">Link sent to {email}. Check your inbox.</p>
        ) : (
          <div className="space-y-3">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
              className="w-full bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
            <button onClick={sendLink} className="w-full bg-mav-yellow text-black font-medium rounded-md py-2 text-sm">Send sign-in link</button>
            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1 text-xs text-mav-muted hover:text-white">
          <LogOut size={13} /> Sign out ({session.user?.email})
        </button>
      </div>
      {children}
    </div>
  )
}
