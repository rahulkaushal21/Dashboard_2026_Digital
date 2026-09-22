'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { hueFor } from '@/lib/section-hue'
import { getSettings } from '@/lib/config'
import { cacheTeamTheme, THEME_KEY } from './ThemeToggle'

// Publishes the current section's colour as a CSS variable on <html>, so anything on the
// page can pick it up with var(--section) without being handed a prop through five levels.
//
// Two variables, not one: the same hue needs a darker shade to read on warm paper and a
// lighter one to read on near-black, and a single colour that works on both is a muddy
// mid-grey. Which one applies is decided in CSS by the theme, not here.
export default function SectionTheme() {
  const path = usePathname()

  // Pick up the team's default theme, once, for anybody who has not chosen their own.
  //
  // This has to live somewhere every page mounts. It was only in the Settings panel at
  // first, which meant the default reached exactly the people who went looking for it —
  // and nobody else, which is the opposite of what a default is for.
  //
  // Skipped entirely once somebody has their own pick: their choice wins, so the query
  // would be a round trip whose answer is thrown away.
  useEffect(() => {
    let mine: string | null = null
    try { mine = localStorage.getItem(THEME_KEY) } catch { /* blocked storage; just ask */ }
    if (mine) return
    getSettings().then(s => cacheTeamTheme(s.default_theme)).catch(() => { /* keep the built-in default */ })
  }, [])

  useEffect(() => {
    const hue = hueFor(path)
    const el = document.documentElement
    el.style.setProperty('--section-light', hue.light)
    el.style.setProperty('--section-dark', hue.dark)
  }, [path])
  return null
}
