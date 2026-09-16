'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { getSettings, saveSettings } from '@/lib/config'
import { Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { listAdmins, addAdmin, removeAdmin, isOwner, OWNER_EMAIL, ALLOWED_DOMAINS, type AdminRow } from '@/lib/access'

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

const SUPER_ADMIN = 'web@uplers.com'

/**
 * Who can see the whole PM Team section. Only the owner can edit this; everyone
 * else does not see the panel at all. The database enforces the same rule
 * against the Google JWT, so hiding the UI is a convenience, not the control.
 */
function AdminsPanel() {
  const { email } = useAuth()
  const [rows, setRows] = useState<AdminRow[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => listAdmins().then(setRows).catch(() => setRows([]))
  useEffect(() => { refresh() }, [])

  if (!isOwner(email)) return null

  const add = async () => {
    if (!newEmail.trim()) return
    setBusy(true); setStatus('')
    try {
      await addAdmin(newEmail, email || OWNER_EMAIL, note)
      setNewEmail(''); setNote(''); setStatus('Added.'); refresh()
    } catch (e: any) { setStatus(e.message || 'Could not add') }
    finally { setBusy(false) }
  }

  const drop = async (e: string) => {
    setBusy(true); setStatus('')
    try { await removeAdmin(e); setStatus('Removed.'); refresh() }
    catch (err: any) { setStatus(err.message || 'Could not remove') }
    finally { setBusy(false) }
  }

  const inp = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow'

  return (
    <div>
      <h2 className="text-base font-semibold mb-1">PM Team access</h2>
      <p className="text-sm text-mav-muted mb-4">
        Admins see every PM&rsquo;s scorecard. A PM without admin sees only their own, and anyone who is neither sees
        none of it. Everything else in the dashboard is open to all {ALLOWED_DOMAINS.join(' and ')} accounts.
        Only <span className="text-white">{OWNER_EMAIL}</span> can change this list.
      </p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr><th className="px-4 py-2 font-medium">Admin</th><th className="px-4 py-2 font-medium">Why</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-mav-line/60">
              <td className="px-4 py-3">{OWNER_EMAIL}</td>
              <td className="px-4 py-3 text-mav-muted">Owner — always an admin, cannot be removed</td>
              <td></td>
            </tr>
            {rows.map(r => (
              <tr key={r.email} className="border-b border-mav-line/60">
                <td className="px-4 py-3">{r.email}</td>
                <td className="px-4 py-3 text-mav-muted">{r.note || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => drop(r.email)} disabled={busy}
                    className="text-mav-muted hover:text-red-400 disabled:opacity-50" aria-label={`Remove ${r.email}`}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-3 text-mav-muted">No other admins yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="name@mavlers.com"
          onKeyDown={e => e.key === 'Enter' && add()} className={`${inp} w-64`} />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why (optional)" className={`${inp} w-64`} />
        <button onClick={add} disabled={busy}
          className="bg-mav-yellow text-black font-medium rounded-md px-4 py-2 text-sm disabled:opacity-60">
          {busy ? 'Saving…' : 'Add admin'}
        </button>
        {status && <span className="text-sm text-mav-muted">{status}</span>}
      </div>
    </div>
  )
}

export default function Admin() {
  return (
    <div className="space-y-10">
      <div>
        <Header title="Settings" subtitle="Point the routine at a sheet and an inbox — no code change needed" />
        {/* User access used to live here. Access is now decided by Google sign-in
            and the email domain (lib/access.ts), so there is no list to manage. */}
        <SettingsForm />
      </div>
      <AdminsPanel />
    </div>
  )
}
