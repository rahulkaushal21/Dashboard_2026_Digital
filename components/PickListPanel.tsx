'use client'
import { useEffect, useState } from 'react'
import { getPickListAll, addPickItem, setPickItemActive, setPickItemSort, type PickItem } from '@/lib/supabase'

// The experts and the contractors, maintained here rather than in code.
//
// One component for both because they are the same thing: an ordered list of names a
// dropdown offers. Two panels would have been the same code twice and two places to fix
// the next bug in it.
//
// NOTHING IS DELETED. A person who has left is still named on every project they built,
// and removing their row would leave those rows pointing at a value the list no longer
// offers — which is how a dropdown silently reassigns somebody's work the next time that
// record is saved. Retiring stops them being offered on new deals and changes nothing
// that already happened.

export default function PickListPanel({ kind, title, blurb, canEdit }: {
  kind: 'expert' | 'contractor'; title: string; blurb: string; canEdit: boolean
}) {
  const [rows, setRows] = useState<PickItem[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const refresh = () => getPickListAll(kind).then(setRows).catch(() => setRows([]))
  useEffect(() => { refresh() }, [kind])

  const add = async () => {
    if (!name.trim()) { setStatus('A name is needed.'); return }
    setBusy(true); setStatus('')
    // New entries sort after everything on the list, so adding somebody never silently
    // reorders the names people are used to seeing in a fixed order.
    const res = await addPickItem(kind, name, Math.max(100, ...rows.map(r => r.sort)) + 10)
    setBusy(false)
    if (res.error) { setStatus(res.error); return }
    setName(''); setStatus(`${name.trim()} added.`); refresh()
  }

  const toggle = async (r: PickItem) => {
    setBusy(true); setStatus('')
    const res = await setPickItemActive(kind, r.value, !r.active)
    setBusy(false)
    setStatus(res.error || `${r.value} ${r.active ? 'retired' : 'restored'}.`)
    if (!res.error) refresh()
  }

  const move = async (r: PickItem, dir: -1 | 1) => {
    const list = rows.filter(x => x.active)
    const i = list.findIndex(x => x.value === r.value)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    setBusy(true)
    // Swap the two sort values rather than renumbering the list: one pair of writes, and
    // nothing else on the list moves.
    await setPickItemSort(kind, r.value, list[j].sort)
    await setPickItemSort(kind, list[j].value, r.sort)
    setBusy(false); refresh()
  }

  const active = rows.filter(r => r.active)
  const retired = rows.filter(r => !r.active)
  const inp = 'bg-mav-dark border border-white/20 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-mav-yellow'

  return (
    <div>
      <h2 className="text-base font-semibold mb-1">{title}</h2>
      <p className="text-sm text-mav-muted mb-4">{blurb}</p>

      <div className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden mb-3">
        <table className="w-full text-sm">
          <tbody>
            {active.map((r, i) => (
              <tr key={r.value} className="border-b border-mav-line/60 last:border-0">
                <td className="px-4 py-2.5 w-8 text-white/35 text-xs">{i + 1}</td>
                <td className="px-2 py-2.5">{r.value}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => move(r, -1)} disabled={busy || i === 0}
                        className="text-white/50 hover:text-white disabled:opacity-20 px-1" aria-label={`Move ${r.value} up`}>↑</button>
                      <button onClick={() => move(r, 1)} disabled={busy || i === active.length - 1}
                        className="text-white/50 hover:text-white disabled:opacity-20 px-1 mr-2" aria-label={`Move ${r.value} down`}>↓</button>
                      <button onClick={() => toggle(r)} disabled={busy}
                        className="text-xs text-mav-muted hover:text-amber-300 disabled:opacity-50">Retire</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {active.length === 0 && <tr><td className="px-4 py-3 text-mav-muted">Nobody on this list yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Add a name" className={`${inp} w-56`} />
          <button onClick={add} disabled={busy} className="bg-mav-yellow text-black font-medium rounded-md px-4 py-2 text-sm disabled:opacity-60">
            {busy ? 'Saving…' : 'Add'}
          </button>
          {status && <span className="text-sm text-mav-muted">{status}</span>}
        </div>
      )}

      {retired.length > 0 && (
        <div>
          <button onClick={() => setShowRetired(v => !v)} className="text-xs text-mav-muted hover:text-white">
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired
          </button>
          {showRetired && (
            <div className="mt-2 flex flex-wrap gap-2">
              {retired.map(r => (
                <span key={r.value} className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border border-mav-line text-mav-muted">
                  {r.value}
                  {canEdit && <button onClick={() => toggle(r)} disabled={busy} className="text-mav-yellow hover:underline">restore</button>}
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-white/45 mt-2 max-w-xl">
            Retired names stay on every project they already built. They are only removed from the dropdown for new work.
          </p>
        </div>
      )}
    </div>
  )
}
