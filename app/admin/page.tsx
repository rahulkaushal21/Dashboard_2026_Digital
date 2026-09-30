'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { Segments, Panel } from '@/components/PageParts'
import InfoTip from '@/components/InfoTip'
import { getSettings, saveSettings } from '@/lib/config'
import { getCaptureMailbox } from '@/lib/supabase'
import ThemePanel from '@/components/ThemePanel'
import { Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { listAdmins, addAdmin, removeAdmin, isOwner, OWNER_EMAIL, ALLOWED_DOMAINS, type AdminRow } from '@/lib/access'
import PmDirectoryPanel from '@/components/PmDirectoryPanel'
import FxRatesPanel from '@/components/FxRatesPanel'
import PickListPanel from '@/components/PickListPanel'
import ContractorsPanel from '@/components/ContractorsPanel'
import { getDirectoryMember } from '@/lib/supabase'

function SettingsForm({ canEdit }: { canEdit: boolean }) {
  const [sheet, setSheet] = useState('')
  const [gmail, setGmail] = useState('')
  const [updated, setUpdated] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => { getSettings().then(s => { setSheet(s.business_sheet_url || ''); setGmail(s.scan_gmail_address || ''); setUpdated(s.updated_at || '') }) }, [])
  // Where mail is ACTUALLY coming from: every gmail-ingest run names its own mailbox.
  const [capture, setCapture] = useState<{ mailbox: string; at: string } | null | undefined>(undefined)
  useEffect(() => { getCaptureMailbox().then(setCapture).catch(() => setCapture(null)) }, [])
  const save = async () => {
    setStatus('Saving…')
    try { await saveSettings({ business_sheet_url: sheet, scan_gmail_address: gmail }); setStatus('Saved — the next routine run will use this.') }
    catch (e: any) { setStatus('Error: ' + e.message) }
  }
  // Read-only rendering for non-admins. The database refuses the write anyway
  // (app_settings is admin-only), so this is about not offering a button that
  // would only fail.
  const box = `w-full bg-mav-dark border border-mav-line rounded-md px-3 py-2 text-sm outline-none ${canEdit ? 'text-mav-fg focus:border-mav-yellow' : 'text-mav-muted cursor-not-allowed'}`

  return (
    <Panel title="Data sources" className="max-w-2xl">
    <div className="space-y-6">
      {!canEdit && (
        <p className="flex items-center gap-2 text-xs text-mav-muted bg-mav-dark/40 border border-mav-line rounded-lg px-3 py-2">
          You can see these settings but not change them.
          <InfoTip text={`The Business Sheet URL decides where every booking, quote and SQL figure on the dashboard comes from, so editing is limited to admins. Ask ${OWNER_EMAIL} if it needs changing.`} />
        </p>
      )}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium mb-2">
          Business Sheet URL
          <InfoTip text="The Google Sheet the routine reads (bookings, quotes, SQLs)." />
        </label>
        <input value={sheet} onChange={e => setSheet(e.target.value)} readOnly={!canEdit} disabled={!canEdit}
          placeholder="https://docs.google.com/spreadsheets/d/…" className={box} />
      </div>
      {/* THE INBOX FIELD IS GONE, and this is why.
          It said the routine scanned whatever address was typed here, and nothing has
          read it since 4 Aug 2026. Capture is a Google Apps Script running inside one
          mailbox — GmailApp only ever reads its own owner's mail — and that script
          refuses to run at all if it finds itself in a different account, deliberately,
          so it can never attribute one person's mail to another. Changing a box here
          could not have moved it, and the box said otherwise for seven weeks.
          What replaces it is the truth, read back from what capture actually reported. */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium mb-2">
          Mail capture <span className="text-xs text-mav-muted font-normal">· not a setting</span>
          <InfoTip text="Not a setting. Mail is captured by an Apps Script living inside the mailbox itself, so the mailbox is chosen by where that script is installed — not here. To add one, install a copy under that account." />
        </label>
        <div className="bg-mav-dark/40 border border-mav-line rounded-md px-3 py-2 text-sm">
          {capture === null
            ? <span className="text-mav-muted">Checking…</span>
            : capture
              ? <><span className="text-mav-fg">{capture.mailbox}</span>
                  <span className="text-mav-muted"> · last pull {new Date(capture.at).toLocaleString()}</span></>
              : <span className="text-amber-300">No capture run recorded — mail is not arriving.</span>}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-4">
          <button onClick={save} className="rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm">Save settings</button>
          {status && <span className="text-sm text-mav-muted">{status}</span>}
        </div>
      )}
      {updated && <p className="text-xs text-mav-muted">Last updated {new Date(updated).toLocaleString()}</p>}
    </div>
    </Panel>
  )
}

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

  const inp = 'bg-mav-dark border border-mav-line rounded-md px-3 py-2 text-sm text-mav-fg placeholder:text-mav-fg/35 outline-none focus:border-mav-yellow'

  return (
    <Panel title="PM Team access"
      info={`Admins see every PM’s scorecard and can edit Settings. A PM without admin sees only their own scorecard, and anyone who is neither sees none of it. Everything else in the dashboard is open to all ${ALLOWED_DOMAINS.join(' and ')} accounts. Only the super admin, ${OWNER_EMAIL}, can change this list.`}
      right={<span className="font-mono text-xs text-mav-muted">{rows.length + 1} admins</span>}>
      <div className="border border-mav-line rounded-lg overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr><th className="px-4 py-2 font-medium">Admin</th><th className="px-4 py-2 font-medium">Why</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-mav-line/60">
              <td className="px-4 py-3">{OWNER_EMAIL}</td>
              <td className="px-4 py-3 text-mav-muted">Super admin — always an admin, cannot be removed</td>
              <td></td>
            </tr>
            {rows.map(r => (
              <tr key={r.email} className="border-b border-mav-line/60">
                <td className="px-4 py-3">{r.email}</td>
                <td className="px-4 py-3 text-mav-muted">{r.note || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => drop(r.email)} disabled={busy}
                    className="rounded-full border border-red-500/50 text-red-400 px-3 py-1 text-xs hover:bg-red-500/10 inline-flex items-center gap-1 disabled:opacity-50" aria-label={`Remove ${r.email}`}>
                    <Trash2 size={13} /> Remove
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
          className="rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm disabled:opacity-60">
          {busy ? 'Saving…' : 'Add admin'}
        </button>
        {status && <span className="text-sm text-mav-muted">{status}</span>}
      </div>
    </Panel>
  )
}

// The sections of Settings, one at a time. Access is the owner's alone, so it is only
// offered to the owner — the panel renders nothing for anyone else.
type Tab = 'general' | 'appearance' | 'access' | 'directory' | 'fx' | 'experts' | 'contractors'
const TABS: { id: Tab; label: string; ownerOnly?: boolean }[] = [
  { id: 'general',     label: 'Data sources' },
  { id: 'appearance',  label: 'Appearance' },
  { id: 'access',      label: 'PM Team access', ownerOnly: true },
  { id: 'directory',   label: 'PM directory' },
  { id: 'fx',          label: 'Currency' },
  { id: 'experts',     label: 'Experts' },
  { id: 'contractors', label: 'Contractors' },
]

export default function Admin() {
  const { profile, email } = useAuth()
  // Super admin or admin may edit; everyone else reads.
  const canEdit = !!profile?.is_admin
  // Contractors are the one list a PM maintains too, so the panel needs to know whether
  // this viewer is in the PM directory. Checked against the directory rather than the
  // email domain: being a colleague is not the same as owning deals.
  const [isPm, setIsPm] = useState(false)
  useEffect(() => { getDirectoryMember(email).then(m => setIsPm(!!m)) }, [email])
  const role = isOwner(email) ? 'Super admin' : canEdit ? 'Admin' : 'View only'
  const tabs = TABS.filter(t => !t.ownerOnly || isOwner(email))
  // A #section in the address opens that section, so "Settings → PM directory" can be linked.
  const [tab, setTab] = useState<Tab>('general')
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab
    if (TABS.some(t => t.id === h)) setTab(h)
  }, [])
  const pick = (t: Tab) => {
    setTab(t)
    try { window.history.replaceState(null, '', `#${t}`) } catch { /* not worth failing over */ }
  }
  const shown = tabs.some(t => t.id === tab) ? tab : 'general'

  return (
    <div>
      {/* The chip says plainly which role the viewer is being treated as. Without it
          there is no way to tell whether the page is read-only by design or because
          something went wrong. */}
      <Header title="Settings" chip={role} subtitle="Point the routine at a sheet and an inbox — no code change needed"
        actions={<span className="text-xs text-mav-muted">Signed in as <span className="text-mav-fg">{email}</span></span>} />

      <Segments<Tab> items={tabs.map(t => ({ id: t.id, label: t.label }))} value={shown} onChange={pick} />

      {/* User access used to live here. Access is now decided by Google sign-in
          and the email domain (lib/access.ts), so there is no list to manage. */}
      {shown === 'general' && <SettingsForm canEdit={canEdit} />}
      {/* Appearance is the one everybody has an opinion about, and the only one a
          non-admin can act on. */}
      {shown === 'appearance' && <ThemePanel canEdit={canEdit} />}
      {shown === 'access' && <AdminsPanel />}
      {shown === 'directory' && <PmDirectoryPanel canEdit={canEdit} />}
      {shown === 'fx' && <FxRatesPanel canEdit={canEdit} actor={email || OWNER_EMAIL} />}
      {shown === 'experts' && (
        <PickListPanel kind="expert" canEdit={canEdit} title="Experts"
          blurb="Who builds the work — the options on the Expert dropdown when a deal is confirmed, and on the ledger. Listed A–Z. Contractor is on the list deliberately: it is the sheet's own marker for work built outside, and choosing it asks who the contractor was and what they cost." />
      )}
      {/* PMs can maintain this one, so it is not gated on canEdit. The database allows a
          registered PM or an admin, and the panel matches that rather than being stricter
          and quietly sending people to ask somebody. */}
      {shown === 'contractors' && <ContractorsPanel canEdit={canEdit || isPm} actor={email || OWNER_EMAIL} />}
    </div>
  )
}
