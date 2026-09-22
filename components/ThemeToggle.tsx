'use client'
import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { THEMES, themeById, isTheme } from '@/lib/themes'

// Picking a theme.
//
// Two layers, and the order matters. A person's own choice lives in THIS browser's
// localStorage and always wins. Under it sits the team default an admin sets in Settings,
// which is what a new person, a new laptop, or anybody who has never opened the picker
// gets. Without that second layer "make this the default" would only ever mean the one
// browser the admin clicked it in.
//
// The team default is read from the database, which is a round trip — far too slow for
// the first paint. So it is cached in localStorage when it arrives and the cached copy is
// what the pre-paint script reads. A newly-changed default therefore reaches somebody on
// their second load, not their first, which is the right trade for never flashing.

export const THEME_KEY = 'mav-theme'          // this person's pick
export const TEAM_THEME_KEY = 'mav-theme-team' // last known team default

export function applyTheme(id: string) {
  const t = themeById(id) || THEMES[0]
  const el = document.documentElement
  el.setAttribute('data-theme', t.id)
  el.setAttribute('data-family', t.family)
}

/** Remember this person's choice and apply it. */
export function setMyTheme(id: string) {
  applyTheme(id)
  try { localStorage.setItem(THEME_KEY, id) } catch { /* private window; the page still works */ }
  window.dispatchEvent(new Event('mav-theme-change'))
}

/** Cache the team default so the pre-paint script can use it next load. */
export function cacheTeamTheme(id?: string | null) {
  try {
    if (isTheme(id)) localStorage.setItem(TEAM_THEME_KEY, id as string)
    // A theme applies immediately only for somebody who has not chosen their own.
    if (isTheme(id) && !localStorage.getItem(THEME_KEY)) applyTheme(id as string)
  } catch { /* nothing to do */ }
}

export function useTheme() {
  // Starts null rather than guessing: this HTML is prerendered, and painting the wrong
  // swatch as selected for a frame on every load is worse than painting nothing.
  const [theme, setTheme] = useState<string | null>(null)
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') || 'dark')
    read()
    window.addEventListener('mav-theme-change', read)
    return () => window.removeEventListener('mav-theme-change', read)
  }, [])
  return theme
}

/** The sidebar's compact cycler. The full picker, with swatches, is in Settings. */
export default function ThemeToggle() {
  const theme = useTheme()
  if (!theme) return null
  const i = Math.max(0, THEMES.findIndex(t => t.id === theme))
  const next = THEMES[(i + 1) % THEMES.length]
  const current = THEMES[i]

  return (
    <button onClick={() => setMyTheme(next.id)}
      title={`${current.name} — click for ${next.name}. All five are in Settings.`}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-mav-muted hover:text-mav-fg hover:bg-mav-panel transition-colors">
      <Palette size={16} />
      <span className="truncate">{current.name}</span>
      <span className="ml-auto flex gap-0.5 shrink-0">
        {next.swatch.slice(0, 3).map((c, k) => (
          <span key={k} className="w-2 h-3 rounded-[2px] border border-black/20" style={{ background: c }} />
        ))}
      </span>
    </button>
  )
}

/**
 * Applies the theme BEFORE the page paints.
 *
 * Without it the browser paints the built-in dark, then React mounts and switches — a
 * flash on every load for anybody not on Charcoal. An inline blocking script in <head> is
 * the only place that can be prevented. Falls back through: my pick, the cached team
 * default, then Charcoal.
 */
export const themeScript = `(function(){try{
var F={${THEMES.map(t => `'${t.id}':'${t.family}'`).join(',')}};
var t=localStorage.getItem('${THEME_KEY}')||localStorage.getItem('${TEAM_THEME_KEY}');
if(!F[t])t='dark';
document.documentElement.setAttribute('data-theme',t);
document.documentElement.setAttribute('data-family',F[t]);
}catch(e){document.documentElement.setAttribute('data-theme','dark');document.documentElement.setAttribute('data-family','dark')}})()`
