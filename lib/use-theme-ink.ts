'use client'
import { useEffect, useState } from 'react'

// Chart colours, read from the theme.
//
// Recharts and hand-written SVG need a concrete colour string — a CSS variable cannot be
// passed to a `stroke` prop and resolved. So the three chart inks are declared once in
// globals.css and read back here, which keeps them in the theme rather than scattered as
// hex literals that only look right on one background.
//
// Re-read when the theme attribute changes, so switching does not leave black gridlines
// on a white page until the next reload.

export interface ThemeInk { grid: string; axis: string; tip: string; fg: string; hover: string }

const DARK: ThemeInk = { grid: '#333333', axis: '#9a9a9a', tip: '#1B1B1B', fg: '#f2f2f2', hover: 'rgba(255,255,255,0.05)' }

const read = (): ThemeInk => {
  if (typeof window === 'undefined') return DARK
  const s = getComputedStyle(document.documentElement)
  const v = (n: string, fallback: string) => s.getPropertyValue(n).trim() || fallback
  return {
    grid: v('--chart-grid', DARK.grid),
    axis: v('--chart-axis', DARK.axis),
    tip: v('--chart-tip', DARK.tip),
    fg: v('--chart-fg', DARK.fg),
    // The hover wash behind a chart cursor. A white 5% over cream is invisible, so it
    // is declared per family rather than assumed to be light-on-dark.
    hover: v('--chart-hover', DARK.hover),
  }
}

export function useThemeInk(): ThemeInk {
  // Starts on the dark values because that is what the prerendered HTML is painted with;
  // anything else would disagree with the server output on first render.
  const [ink, setInk] = useState<ThemeInk>(DARK)
  useEffect(() => {
    const sync = () => setInk(read())
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return ink
}
