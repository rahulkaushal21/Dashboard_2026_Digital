'use client'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

// Light or dark, remembered per person.
//
// DARK IS THE DEFAULT and stays the default. It is what the team has been using for
// months, and a dashboard that changes colour under people because a preference shipped
// is its own bug. Light is there for whoever wants it — a laptop in daylight, mostly.
//
// The choice lives in localStorage, per browser. It is a display preference, not data:
// syncing it through Supabase would mean a round trip before the first paint, which is
// exactly when you cannot afford one.

export const THEME_KEY = 'mav-theme'

export default function ThemeToggle() {
  // Starts as null rather than 'dark' so the button renders nothing until we know: the
  // static export prerenders this HTML, and guessing here paints the wrong icon for a
  // frame on every load.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(THEME_KEY) } catch { /* private window, blocked storage */ }
    setTheme(saved === 'light' ? 'light' : 'dark')
  }, [])

  useEffect(() => {
    if (!theme) return
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* nothing to do; the page still works */ }
  }, [theme])

  if (!theme) return null
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-mav-muted hover:text-mav-fg hover:bg-mav-panel transition-colors">
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  )
}

/**
 * Applies the saved theme BEFORE the page paints.
 *
 * Without this the browser paints the default dark, then React mounts and switches to
 * light — a black flash on every page load for anybody using light mode. It runs as a
 * blocking inline script in <head>, which is the one place a flash can be prevented.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`
