'use client'
import { useEffect, useState } from 'react'
import { getContractors, saveContractor, setContractorActive, type Contractor } from '@/lib/supabase'
import { CURRENCIES } from '@/lib/deal-fields'

// Outsourcing partners.
//
// Records rather than names, because a contractor has an agency, a currency they invoice
// in and an address. Held as a list of strings, the currency would have to be retyped on
// every project — and would be wrong on some of them.
//
// PMs can add here as well as admins. The PM placing the work is the one who knows who it
// went to; making them raise a request first is how a list goes stale and names start
// appearing in notes fields instead. The database enforces the same rule.
//
// Nothing is deleted, only retired: a contractor is named on every project they built,
// and dropping the row would leave those pointing at a name the dropdown no longer
// offers.

const blank = { name: '', agency: '', default_currency: 'USD', email: '' }

export default function ContractorsPanel({ canEdit, actor }: { canEdit: boolean; actor: string }) {
  const [rows, setRows] = useState<Contractor[]>([])
  const [draft, setDraft] = useState({ ...blank })
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const refresh = () => getContractors(true).then(setRows).catch(() => setRows([]))
  useEffect(() => { refresh() }, [])

  const save = async () => {
    if (!draft.name.trim()) { setStatus('A name is needed.'); return }
    setBusy(true); setStatus('')
    const res = await saveContractor(draft, actor)
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setStatus(`${draft.name.trim()} saved.`)
    setDraft({ ...blank }); setEditing(null); refresh()
  }

  const edit = (c: Contractor) => {
    setEditing(c.name)
    setDraft({ name: c.name, agency: c.agency || '', default_currency: c.default_currency || 'USD', email: c.email || '' })
  }

  const toggle = async (c: Contractor) => {
    setBusy(true); setStatus('')
    const res = await setContractorActive(c.name, !c.active)
    setBusy(false)
    setStatus(res.error || `${c.name} ${c.active ? 'retired' : 'restored'}.`)
    if (!res.error) refresh()
  }

  const active = rows.filter(r => r.active)
  const retired = rows.filter(r => !r.active)
  const inp = 'bg-mav-dark border border-white/20 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-mav-yellow'

  return (
    <div className="mb-10">
      <h2 className="text-base font-semibold mb-1">Contractors</h2>
      <p className="text-sm text-mav-muted mb-4">
        Who outsourced work goes to. Offered once a deal&rsquo;s Expert is set to <span className="text-white">Contractor</span>,
        and their cost lands in the sheet&rsquo;s Outsource Price column. Choosing one sets the cost currency to whatever
        they invoice in. <span className="text-white">Any PM or admin can add one</span> &mdash; you do not need to raise a request.
      </p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-x-auto mb-3">
        <table className="w-full text-sm">
          <thead className="text-left text-white/70 border-b border-mav-line">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Agency</th>
              <th className="px-4 py-2 font-medium">Invoices in</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {active.map(c => (
              <tr key={c.name} className="border-b border-mav-line/60 last:border-0">
                <td className="px-4 py-2.5">{c.name}</td>
                <td className="px-4 py-2.5 text-white/60">{c.agency || '—'}</td>
                <td className="px-4 py-2.5">{c.default_currency}</td>
                <td className="px-4 py-2.5 text-white/60">{c.email || '—'}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => edit(c)} className="text-xs text-mav-yellow hover:underline mr-3">Edit</button>
                      <button onClick={() => toggle(c)} disabled={busy}
                        className="text-xs text-mav-muted hover:text-amber-300 disabled:opacity-50">Retire</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-3 text-mav-muted">No contractors yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="bg-mav-panel border border-mav-line rounded-xl p-4 mb-3">
          <div className="text-sm font-medium mb-3">{editing ? `Editing ${editing}` : 'Add a contractor'}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-white/85">Name</span>
              {/* The name is the key, so renaming means adding a new record. Locked while
                  editing rather than silently creating a second contractor. */}
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                readOnly={!!editing} placeholder="Who you send the work to"
                className={`${inp} w-full mt-1 ${editing ? 'opacity-60 cursor-not-allowed' : ''}`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-white/85">Agency <span className="text-white/45">(optional)</span></span>
              <input value={draft.agency} onChange={e => setDraft({ ...draft, agency: e.target.value })}
                className={`${inp} w-full mt-1`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-white/85">Default currency</span>
              <select value={draft.default_currency} onChange={e => setDraft({ ...draft, default_currency: e.target.value })}
                className={`${inp} w-full mt-1`}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-white/85">Email</span>
              <input type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })}
                className={`${inp} w-full mt-1`} />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={save} disabled={busy}
              className="bg-mav-yellow text-black font-medium rounded-md px-4 py-2 text-sm disabled:opacity-60">
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add contractor'}
            </button>
            {editing && (
              <button onClick={() => { setEditing(null); setDraft({ ...blank }) }}
                className="text-xs px-3 py-2 rounded-md border border-white/20 text-white/70 hover:text-white">Cancel</button>
            )}
            {status && <span className="text-sm text-mav-muted">{status}</span>}
          </div>
        </div>
      )}

      {retired.length > 0 && (
        <div>
          <button onClick={() => setShowRetired(v => !v)} className="text-xs text-mav-muted hover:text-white">
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired
          </button>
          {showRetired && (
            <div className="mt-2 flex flex-wrap gap-2">
              {retired.map(c => (
                <span key={c.name} className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border border-mav-line text-mav-muted">
                  {c.name}
                  {canEdit && <button onClick={() => toggle(c)} disabled={busy} className="text-mav-yellow hover:underline">restore</button>}
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-white/45 mt-2 max-w-xl">
            Retired contractors stay named on every project they already built. They are only removed from the dropdown for new work.
          </p>
        </div>
      )}
    </div>
  )
}
