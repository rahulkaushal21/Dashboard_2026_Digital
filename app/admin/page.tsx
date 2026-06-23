'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import AuthGuard from '@/components/AuthGuard'
import { getSettings, saveSettings } from '@/lib/config'

function SettingsForm() {
  const [sheet, setSheet] = useState('')
  const [gmail, setGmail] = useState('')
  const [updated, setUpdated] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => { getSettings().then(s => { setSheet(s.business_sheet_url || ''); setGmail(s.scan_gmail_address || ''); setUpdated(s.updated_at || '') }) }, [])
  const save = async () => {
    setStatus('Saving…')
    try { await saveSettings({ business_sheet_url: sheet, scan_gmail_address: gmail }); setStatus('Saved — the next routine run will use these.') }
    catch (e: any) { setStatus('Error: ' + e.message) }
  }
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1">Business Sheet URL</label>
        <p className="text-xs text-mav-muted mb-2">The Google Sheet the routine reads (bookings, quotes, SQLs).</p>
        <input value={sheet} onChange={e => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…"
          className="w-full bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Inbox to scan (Gmail address)</label>
        <p className="text-xs text-mav-muted mb-2">Use your own Gmail to test, then switch to the live central inbox. If the live inbox is a different Google account, also re-point the routine's Gmail connector to it.</p>
        <input value={gmail} onChange={e => setGmail(e.target.value)} placeholder="central-inbox@company.com"
          className="w-full bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
      </div>
      <div className="flex items-center gap-4">
        <button onClick={save} className="bg-mav-yellow text-black font-medium rounded-md px-5 py-2 text-sm">Save settings</button>
        {status && <span className="text-sm text-mav-muted">{status}</span>}
      </div>
      {updated && <p className="text-xs text-mav-muted">Last updated {new Date(updated).toLocaleString()}</p>}
    </div>
  )
}

export default function Admin() {
  return (
    <div>
      <Header title="Settings" subtitle="Point the routine at a sheet and an inbox — no code change needed" />
      <AuthGuard><SettingsForm /></AuthGuard>
    </div>
  )
}
