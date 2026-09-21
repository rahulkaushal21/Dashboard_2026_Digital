'use client'
import { useEffect, useState } from 'react'
import { addOpportunity, findPossibleDuplicates, type DuplicateHit } from '@/lib/supabase'

// Adding a deal the email scan did not catch — a referral, an upsell raised on a call,
// work that came out of an event.
//
// Only the client name is required. Everything else can be filled in later, because a
// deal you half-know is still worth recording: the alternative is it living in somebody's
// head until it is won, which is the gap this whole change exists to close. The
// completeness gate on CONFIRMING is what keeps the revenue record honest, so entry can
// afford to be forgiving.

const CHANNELS = ['referral', 'linkedin', 'upsell', 'event', 'inbound', 'other']
const GEOS = ['US', 'UK', 'AU']
const PROJECT_TYPES = ['New Development', 'Ad-hoc', 'Maintanance', 'Additional Pages', 'Dedicated', 'Partial Dedicated', 'Ballpark']

const money = (n?: number) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`

export default function AddOpportunityDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const [company, setCompany] = useState('')
  const [channel, setChannel] = useState('referral')
  const [value, setValue] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [serviceDept, setServiceDept] = useState('')
  const [projectType, setProjectType] = useState('')
  const [technology, setTechnology] = useState('')
  const [salesPerson, setSalesPerson] = useState('')
  const [pmOwner, setPmOwner] = useState('')
  const [geo, setGeo] = useState('')
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState('')

  const [dupes, setDupes] = useState<DuplicateHit[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Set when the database refused on same-client-and-value. Re-submitting then passes
  // force, so the second click is a deliberate "yes, these really are two deals" rather
  // than the same mistake going through on a retry.
  const [needsForce, setNeedsForce] = useState(false)

  const valueN = value === '' ? null : Number(value)

  // Warn about possible duplicates while typing, debounced. This never blocks: the
  // useful match is on VALUE, and a value collision between two genuinely different
  // deals is common in a business that quotes round numbers.
  useEffect(() => {
    if (!company.trim()) { setDupes([]); return }
    const t = setTimeout(() => {
      findPossibleDuplicates(company, Number.isNaN(valueN as number) ? null : valueN).then(setDupes)
    }, 400)
    return () => clearTimeout(t)
  }, [company, value])

  const save = async () => {
    setSaving(true); setError('')
    const res = await addOpportunity({
      company, channel, est_value: valueN, currency, quote_date: quoteDate,
      service_dept: serviceDept, project_type: projectType, technology,
      sales_person: salesPerson, pm_owner: pmOwner, geo, subject, note,
      force: needsForce,
    })
    setSaving(false)
    if (res.error) {
      setError(res.error)
      // The database refuses a same-client-same-value repeat once; saying so turns the
      // next click into an explicit override instead of a silently different action.
      if (/already has a live deal/i.test(res.error)) setNeedsForce(true)
      return
    }
    if (res.id) onAdded(res.id)
  }

  const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block">
      <span className="text-xs text-mav-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-mav-muted mt-0.5">{hint}</span>}
    </label>
  )
  const inputCls = 'mt-1 w-full bg-mav-dark border border-mav-line rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-mav-yellow/60'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Add an opportunity</h2>
            <p className="text-xs text-mav-muted mt-0.5">For a deal email did not catch. Only the client is required — the rest can wait until you confirm it.</p>
          </div>
          <button onClick={onClose} className="text-mav-muted hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <F label="Client *">
              <input className={inputCls} value={company} onChange={e => { setCompany(e.target.value); setNeedsForce(false) }} placeholder="Company name" autoFocus />
            </F>
          </div>
          <F label="Where it came from"><select className={inputCls} value={channel} onChange={e => setChannel(e.target.value)}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></F>
          <F label="Quote date"><input type="date" className={inputCls} value={quoteDate} onChange={e => setQuoteDate(e.target.value)} /></F>
          <F label="Value"><input type="number" className={inputCls} value={value} onChange={e => { setValue(e.target.value); setNeedsForce(false) }} placeholder="0" /></F>
          <F label="Currency"><input className={inputCls} value={currency} onChange={e => setCurrency(e.target.value)} /></F>
          <F label="Service / dept"><input className={inputCls} value={serviceDept} onChange={e => setServiceDept(e.target.value)} placeholder="Web" /></F>
          <F label="Project type"><select className={inputCls} value={projectType} onChange={e => setProjectType(e.target.value)}><option value="">—</option>{PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></F>
          <F label="Technology"><input className={inputCls} value={technology} onChange={e => setTechnology(e.target.value)} placeholder="Shopify, WordPress…" /></F>
          <F label="Geography"><select className={inputCls} value={geo} onChange={e => setGeo(e.target.value)}><option value="">—</option>{GEOS.map(g => <option key={g} value={g}>{g}</option>)}</select></F>
          <F label="Account manager"><input className={inputCls} value={salesPerson} onChange={e => setSalesPerson(e.target.value)} /></F>
          <F label="PM owner" hint="Whoever is named here can confirm the deal later."><input className={inputCls} value={pmOwner} onChange={e => setPmOwner(e.target.value)} /></F>
          <div className="sm:col-span-2"><F label="Subject / project"><input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} /></F></div>
          <div className="sm:col-span-2"><F label="Note"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth knowing about this deal" /></F></div>
        </div>

        {dupes.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <div className="text-xs font-semibold text-amber-300">{dupes.length} live deal{dupes.length > 1 ? 's' : ''} look similar — check this is not already recorded</div>
            <div className="text-[11px] text-mav-muted mt-0.5">An email deal is often named for the end client while a hand-entered one is named for the agency, so the names can differ on the same deal. The value is the reliable signal.</div>
            <div className="mt-2 space-y-1">
              {dupes.slice(0, 5).map(d => (
                <div key={d.id} className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate">{d.company_name || '—'} <span className="text-mav-muted">· {d.status || 'Open'} · {d.origin}</span></span>
                  <span className="whitespace-nowrap text-mav-muted">{money(d.est_value)} · {d.why}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
            {error}
            {needsForce && <div className="text-mav-muted mt-1">Click Add again to record it anyway as a separate deal.</div>}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !company.trim()}
            className="text-xs px-4 py-1.5 rounded-md bg-mav-yellow text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
            {saving ? 'Adding…' : needsForce ? 'Add anyway' : 'Add opportunity'}
          </button>
        </div>
      </div>
    </div>
  )
}
