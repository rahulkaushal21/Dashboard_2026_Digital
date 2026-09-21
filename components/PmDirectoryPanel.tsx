'use client'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { listDirectory, addDirectoryMember, updateDirectoryMember, removeDirectoryMember, type DirectoryMember, type PmTeam } from '@/lib/supabase'
import { ALLOWED_DOMAINS, isAllowedDomain } from '@/lib/access'
import { PM_TEAMS } from '@/lib/deal-fields'

// The PM directory, managed here instead of in code.
//
// This is what decides WHO MAY CONFIRM A DEAL, so it is an authorisation list, not a
// contact list. Two things about it are easy to get wrong and are called out in the UI
// rather than left in a comment nobody reads:
//
//   1. ALIASES ARE THE MATCH. Owner columns are free text typed by hand, so a person
//      appears under several spellings. A missing alias means their own deals do not
//      resolve to them and they cannot confirm their own work. A careless one — a bare
//      first name two people share — hands one person's deals to the other.
//
//   2. THE POD IS A LABEL, NOT A PERMISSION. Tagging somebody WEB-UK groups them for
//      reporting; it does not widen or narrow what they can confirm. Only the aliases
//      do that. Leaving it blank costs nothing.

export default function PmDirectoryPanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<DirectoryMember[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; team: PmTeam | ''; aliases: string; active: boolean } | null>(null)

  const [nName, setNName] = useState('')
  const [nEmail, setNEmail] = useState('')
  const [nTeam, setNTeam] = useState<PmTeam | ''>('')
  const [nAliases, setNAliases] = useState('')

  const refresh = () => listDirectory().then(setRows).catch(() => setRows([]))
  useEffect(() => { refresh() }, [])

  // Suggest aliases from the name, since the full name and the bare first name are what
  // the owner columns almost always contain. Editable, because the safe set is a
  // judgement call — see the warning below.
  useEffect(() => {
    if (!nName.trim()) { setNAliases(''); return }
    const full = nName.trim().toLowerCase().replace(/\s+/g, ' ')
    const first = full.split(' ')[0]
    setNAliases(first && first !== full ? `${full}, ${first}` : full)
  }, [nName])

  const aliasList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

  // Does a proposed bare alias collide with somebody already here? This is the exact
  // mistake the codebase has warned about from the start: two people share a first name,
  // and an alias that matches both silently moves deals — and the right to confirm them.
  const collisions = aliasList(nAliases).filter(a => rows.some(r => r.aliases.includes(a)))

  const add = async () => {
    setBusy(true); setStatus('')
    const res = await addDirectoryMember({ email: nEmail, name: nName, team: nTeam || null, aliases: aliasList(nAliases) }, 'settings')
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setNName(''); setNEmail(''); setNTeam(''); setStatus('Added.'); refresh()
  }

  const startEdit = (r: DirectoryMember) => {
    setEditing(r.email)
    setDraft({ name: r.name, team: r.team || '', aliases: r.aliases.join(', '), active: r.active })
  }

  const saveEdit = async () => {
    if (!editing || !draft) return
    setBusy(true); setStatus('')
    const res = await updateDirectoryMember(editing, { name: draft.name, team: draft.team || null, aliases: aliasList(draft.aliases), active: draft.active })
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setEditing(null); setDraft(null); setStatus('Saved.'); refresh()
  }

  const drop = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the directory?\n\nDeactivating is usually better for someone who has left — their past deals keep a resolvable owner, so nothing they confirmed becomes unattributable.`)) return
    setBusy(true); setStatus('')
    const res = await removeDirectoryMember(email)
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setStatus('Removed.'); refresh()
  }

  const inp = 'bg-mav-panel border border-mav-line rounded-md px-3 py-2 text-sm outline-none focus:border-mav-yellow'


  return (
    <div>
      <h2 className="text-base font-semibold mb-1">PM directory</h2>
      <p className="text-sm text-mav-muted mb-4">
        The PM team, and who may confirm a deal. A person here can confirm the deals they are named on as PM; an admin can
        confirm anything; everyone else on {ALLOWED_DOMAINS.join(' or ')} can look but not change. The pod is a label for
        grouping the team — it does not affect what anyone can confirm.
      </p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="text-left text-mav-muted border-b border-mav-line">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Pod</th>
              <th className="px-4 py-2 font-medium">Matches on</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => editing === r.email && draft ? (
              <tr key={r.email} className="border-b border-mav-line/60 bg-mav-dark/40">
                <td className="px-4 py-2"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={`${inp} w-40`} /></td>
                <td className="px-4 py-2 text-mav-muted">{r.email}</td>
                <td className="px-4 py-2">
                  <select value={draft.team} onChange={e => setDraft({ ...draft, team: e.target.value as PmTeam | '' })} className={`${inp} w-32`}>
                    <option value="">— untagged</option>
                    {PM_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2"><input value={draft.aliases} onChange={e => setDraft({ ...draft, aliases: e.target.value })} className={`${inp} w-full`} /></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <label className="text-xs text-mav-muted mr-3">
                    <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} className="mr-1 align-middle" />active
                  </label>
                  <button onClick={saveEdit} disabled={busy} className="text-xs text-mav-yellow hover:underline mr-2">Save</button>
                  <button onClick={() => { setEditing(null); setDraft(null) }} className="text-xs text-mav-muted hover:text-white">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={r.email} className={`border-b border-mav-line/60 ${r.active ? '' : 'opacity-50'}`}>
                <td className="px-4 py-3">{r.name}{!r.active && <span className="ml-2 text-xs text-mav-muted">(inactive)</span>}</td>
                <td className="px-4 py-3 text-mav-muted">
                  {r.email}
                  {/* A directory row for an address that cannot sign in is inert: the person
                      can be NAMED as an owner but can never confirm anything themselves. */}
                  {!isAllowedDomain(r.email) && (
                    <span className="ml-2 text-xs text-amber-300" title={`Sign-in is limited to ${ALLOWED_DOMAINS.join(' and ')}`}>⚠ cannot sign in</span>
                  )}
                </td>
                <td className="px-4 py-3">{r.team
                  ? <span className="text-xs px-2 py-0.5 rounded-full border border-blue-400/40 text-blue-300">{r.team}</span>
                  : <span className="text-xs text-mav-muted">untagged</span>}</td>
                <td className="px-4 py-3 text-mav-muted text-xs">{r.aliases.join(', ')}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {canEdit && (<>
                    <button onClick={() => startEdit(r)} className="text-xs text-mav-muted hover:text-white mr-3">Edit</button>
                    <button onClick={() => drop(r.email)} disabled={busy} className="text-mav-muted hover:text-red-400 disabled:opacity-50 align-middle" aria-label={`Remove ${r.email}`}><Trash2 size={15} /></button>
                  </>)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-mav-muted">Nobody in the directory yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={nName} onChange={e => setNName(e.target.value)} placeholder="Full name" className={`${inp} w-48`} />
            <input value={nEmail} onChange={e => setNEmail(e.target.value)} placeholder="name@mavlers.com" className={`${inp} w-56`} />
            <select value={nTeam} onChange={e => setNTeam(e.target.value as PmTeam | '')} className={`${inp} w-36`}>
              <option value="">— untagged</option>
              {PM_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={nAliases} onChange={e => setNAliases(e.target.value)} placeholder="spellings, comma separated" className={`${inp} w-72`} />
            <button onClick={add} disabled={busy || !nName.trim() || !nEmail.trim()}
              className="bg-mav-yellow text-black font-medium rounded-md px-4 py-2 text-sm disabled:opacity-60">
              {busy ? 'Saving…' : 'Add to directory'}
            </button>
          </div>
          <p className="text-xs text-mav-muted">
            Spellings are how their deals are found, matched exactly. Include every way their name is typed in the sheet —
            miss one and those deals will not resolve to them.
          </p>
          {collisions.length > 0 && (
            <p className="text-xs text-amber-300">
              ⚠ &ldquo;{collisions.join('", "')}&rdquo; already belongs to somebody else here. Two people sharing a spelling
              means whoever is matched first gets the other&rsquo;s deals — and the right to confirm them. Use the full name instead.
            </p>
          )}
          {nEmail.trim() && !isAllowedDomain(nEmail) && (
            <p className="text-xs text-amber-300">
              ⚠ {nEmail.trim()} is not on a domain that can sign in ({ALLOWED_DOMAINS.join(', ')}). They can be named as an
              owner, but they will not be able to confirm anything themselves until that changes.
            </p>
          )}
          {status && <p className="text-sm text-mav-muted">{status}</p>}
        </div>
      )}
    </div>
  )
}
