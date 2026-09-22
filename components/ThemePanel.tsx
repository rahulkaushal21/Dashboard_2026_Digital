'use client'
import { useEffect, useState } from 'react'
import { THEMES } from '@/lib/themes'
import { setMyTheme, useTheme, cacheTeamTheme } from './ThemeToggle'
import { getSettings, saveSettings } from '@/lib/config'

// The theme picker.
//
// Clicking a theme applies it immediately and for real — the whole page changes under the
// panel. That is the point: a swatch tells you almost nothing about what a dashboard full
// of tables and charts looks like in it, and the only honest preview is the thing itself.
// Nothing is saved anywhere but this browser until an admin makes one the team default.

export default function ThemePanel({ canEdit }: { canEdit: boolean }) {
  const theme = useTheme()
  const [teamDefault, setTeamDefault] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      const d = s.default_theme || 'dark'
      setTeamDefault(d)
      cacheTeamTheme(d)
    }).catch(() => { /* settings are admin-readable; a PM just sees no default marked */ })
  }, [])

  const makeDefault = async () => {
    if (!theme) return
    setBusy(true); setStatus('')
    try {
      await saveSettings({ default_theme: theme })
      setTeamDefault(theme)
      cacheTeamTheme(theme)
      setStatus(`${THEMES.find(t => t.id === theme)?.name} is the default for anyone who has not picked their own.`)
    } catch (e) {
      setStatus(String(e))
    }
    setBusy(false)
  }

  return (
    <div className="mb-10">
      <h2 className="text-base font-semibold mb-1">Appearance</h2>
      <p className="text-sm text-mav-muted mb-4 max-w-3xl">
        Click one to try it &mdash; it applies straight away, across the whole dashboard. A swatch tells you very
        little about what a page of tables and charts actually looks like, so the only useful preview is using it.
        Your choice is remembered in this browser and nobody else is affected.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {THEMES.map(t => {
          const on = theme === t.id
          return (
            <button key={t.id} onClick={() => setMyTheme(t.id)}
              className={`text-left rounded-xl border p-4 transition-colors ${on
                ? 'border-mav-yellow bg-mav-yellow/10'
                : 'border-mav-line bg-mav-panel hover:border-mav-fg/30'}`}>
              {/* Page, card, border, text — the four colours that decide how a dashboard
                  reads, in the order you meet them. */}
              <div className="flex gap-1 mb-3">
                {t.swatch.map((c, i) => (
                  <span key={i} className="h-8 flex-1 rounded-md border border-black/20" style={{ background: c }} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                {on && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mav-fill text-black font-semibold">Using</span>}
                {teamDefault === t.id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-mav-line text-mav-muted">Team default</span>
                )}
              </div>
              <p className="text-xs text-mav-muted mt-1 leading-relaxed">{t.blurb}</p>
            </button>
          )
        })}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={makeDefault} disabled={busy || !theme || theme === teamDefault}
            className="text-xs px-4 py-2 rounded-md bg-mav-fill text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
            {busy ? 'Saving…' : theme === teamDefault ? 'This is already the default' : 'Make this the team default'}
          </button>
          <span className="text-[11px] text-mav-muted max-w-xl">
            {/* Worth saying plainly, or somebody will set the default and wonder why the
                room does not change. */}
            The default is what a new person, a new laptop, or anybody who has never opened this panel gets.
            It does not override a choice somebody has already made for themselves, and it reaches them on their
            next load rather than instantly.
          </span>
        </div>
      )}
      {status && <p className="text-sm text-mav-muted mt-2">{status}</p>}
    </div>
  )
}
