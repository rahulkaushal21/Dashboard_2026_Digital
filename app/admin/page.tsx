'use client'
import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import Header from '@/components/Header'
import { getSettings, saveSettings } from '@/lib/config'
import { PAGES, Profile, listUsers, upsertUser, deleteUser } from '@/lib/access'

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

function UsersPanel() {
  const [users, setUsers] = useState<Profile[]>([])
  const [status, setStatus] = useState('')
  // add-user form
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'viewer' | 'admin'>('viewer')
  const [pages, setPages] = useState<string[]>([])

  const refresh = () => listUsers().then(setUsers)
  useEffect(() => { refresh() }, [])

  const togglePage = (href: string) =>
    setPages(p => p.includes(href) ? p.filter(x => x !== href) : [...p, href])

  const add = async () => {
    if (!email.trim()) return
    setStatus('Saving…')
    try {
      await upsertUser({ email, full_name: name || null, role, allowed_pages: pages, is_active: true })
      setEmail(''); setName(''); setRole('viewer'); setPages([]); setStatus('Added.')
      refresh()
    } catch (e: any) { setStatus('Error: ' + e.message) }
  }

  const toggleActive = async (u: Profile) => {
    setStatus('Saving…')
    try { await upsertUser({ ...u, is_active: !u.is_active }); setStatus(''); refresh() }
    catch (e: any) { setStatus('Error: ' + e.message) }
  }

  const remove = async (u: Profile) => {
    if (u.email === SUPER_ADMIN) return
    if (!confirm(`Remove access for ${u.email}?`)) return
    setStatus('Removing…')
    try { await deleteUser(u.email); setStatus(''); refresh() }
    catch (e: any) { setStatus('Error: ' + e.message) }
  }

  const pageLabel = (u: Profile) =>
    u.role === 'admin' ? 'All pages'
      : (u.allowed_pages && u.allowed_pages.length
          ? PAGES.filter(p => u.allowed_pages!.includes(p.href)).map(p => p.label).join(', ')
          : '—')

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">User access</h2>
        <p className="text-xs text-mav-muted mb-4">Only people listed here can sign in and see data. Admins see everything and can manage this list; viewers see only the pages you tick.</p>
        <div className="border border-mav-line rounded-md divide-y divide-mav-line">
          {users.map(u => (
            <div key={u.email} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{u.email} {u.email === SUPER_ADMIN && <span className="text-mav-muted">· super admin</span>}</div>
                <div className="text-xs text-mav-muted truncate">{u.role} · {pageLabel(u)}</div>
              </div>
              <button onClick={() => toggleActive(u)} disabled={u.email === SUPER_ADMIN}
                className={`text-xs px-2 py-1 rounded ${u.is_active ? 'text-green-400' : 'text-mav-muted'} ${u.email === SUPER_ADMIN ? 'opacity-40' : 'hover:bg-mav-panel'}`}>
                {u.is_active ? 'Active' : 'Disabled'}
              </button>
              <button onClick={() => remove(u)} disabled={u.email === SUPER_ADMIN}
                className={`text-mav-muted ${u.email === SUPER_ADMIN ? 'opacity-30' : 'hover:text-red-400'}`}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!users.length && <div className="px-3 py-3 text-sm text-mav-muted">No users yet.</div>}
        </div>
      </div>

      <div className="border border-mav-line rounded-md p-4 space-y-3">
        <h3 className="text-sm font-semibold">Add user</h3>
        <div className="flex flex-wrap gap-3">
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="person@company.com"
            className="flex-1 min-w-[200px] bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)"
            className="w-40 bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow" />
          <select value={role} onChange={e => setRole(e.target.value as any)}
            className="bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow">
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {role === 'viewer' && (
          <div>
            <p className="text-xs text-mav-muted mb-2">Pages this viewer can see:</p>
            <div className="flex flex-wrap gap-2">
              {PAGES.map(p => (
                <button key={p.href} onClick={() => togglePage(p.href)}
                  className={`text-xs px-2.5 py-1 rounded border ${pages.includes(p.href) ? 'bg-mav-yellow text-black border-mav-yellow' : 'border-mav-line text-mav-muted hover:text-white'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={add} className="flex items-center gap-1.5 bg-mav-yellow text-black font-medium rounded-md px-4 py-2 text-sm">
            <Plus size={14} /> Add user
          </button>
          {status && <span className="text-sm text-mav-muted">{status}</span>}
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  return (
    <div className="space-y-10">
      <div>
        <Header title="Settings" subtitle="Point the routine at a sheet and an inbox — no code change needed" />
        <SettingsForm />
      </div>
      <UsersPanel />
    </div>
  )
}
