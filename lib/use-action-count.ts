'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useUnit } from '@/components/BusinessUnitProvider'
import { countActionsFor, ACTIONS_CHANGED } from './actions'

// The number beside "Actions" in the sidebar: the page's headline total for this viewer's
// default view, in the department they are reading.
//
// It must never slow the rail down, so it is worked out after the first paint, when the
// browser is idle, and held in sessionStorage for five minutes per person and department
// so moving between pages does not refetch it. The Actions page announces its own writes
// (ACTIONS_CHANGED), and that — not the timer — is what makes it recount early.

const TTL_MS = 5 * 60_000
const keyFor = (email: string, unit: string) => `actions-count|${email}|${unit}`

function readCached(key: string): number | null {
  try {
    const s = window.sessionStorage.getItem(key)
    if (!s) return null
    const v = JSON.parse(s) as { n: number; at: number }
    return Date.now() - v.at < TTL_MS && Number.isFinite(v.n) ? v.n : null
  } catch { return null }
}
function writeCached(key: string, n: number) {
  try { window.sessionStorage.setItem(key, JSON.stringify({ n, at: Date.now() })) } catch { /* private mode: just recount next time */ }
}
function dropCached(email: string) {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i)
      if (k && k.startsWith(`actions-count|${email}|`)) window.sessionStorage.removeItem(k)
    }
  } catch { /* nothing to drop */ }
}

const whenIdle = (fn: () => void): (() => void) => {
  const w = window as any
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: 3000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, 800)
  return () => window.clearTimeout(id)
}

/** null until known — show nothing rather than a guess. */
export function useActionCount(enabled = true): number | null {
  const { profile, email } = useAuth()
  const { unit, ready } = useUnit()
  const isAdmin = !!profile?.is_admin
  // Held with the key it was counted for, so a department switch never shows the old
  // department's number while the new one is worked out.
  const [count, setCount] = useState<{ key: string; n: number } | null>(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    if (!email) return
    const onChange = () => { dropCached(email); setBump(b => b + 1) }
    window.addEventListener(ACTIONS_CHANGED, onChange)
    return () => window.removeEventListener(ACTIONS_CHANGED, onChange)
  }, [email])

  useEffect(() => {
    if (!enabled || !email || !ready) return
    const key = keyFor(email, unit)
    const cached = readCached(key)
    if (cached != null) { setCount({ key, n: cached }); return }
    // A recount after a write keeps the old number up until the new one lands.
    let live = true
    const cancel = whenIdle(() => {
      countActionsFor(email, isAdmin, unit)
        .then(n => { if (!live) return; writeCached(key, n); setCount({ key, n }) })
        .catch(() => { /* leave the label bare */ })
    })
    return () => { live = false; cancel() }
  }, [enabled, email, isAdmin, unit, ready, bump])

  if (!enabled || !email || !ready || !count || count.key !== keyFor(email, unit)) return null
  return count.n
}
