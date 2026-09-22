'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { hueFor } from '@/lib/section-hue'

// Publishes the current section's colour as a CSS variable on <html>, so anything on the
// page can pick it up with var(--section) without being handed a prop through five levels.
//
// Two variables, not one: the same hue needs a darker shade to read on warm paper and a
// lighter one to read on near-black, and a single colour that works on both is a muddy
// mid-grey. Which one applies is decided in CSS by the theme, not here.
export default function SectionTheme() {
  const path = usePathname()
  useEffect(() => {
    const hue = hueFor(path)
    const el = document.documentElement
    el.style.setProperty('--section-light', hue.light)
    el.style.setProperty('--section-dark', hue.dark)
  }, [path])
  return null
}
