'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addOpportunity, findPossibleDuplicates, getFxRates, toUsd,
  getClientDefaults, searchClients, getDirectoryMember,
  type DuplicateHit, type FxRate, type ClientDefaults,
} from '@/lib/supabase'
import { SERVICE_DEPTS, CURRENCIES, PROJECT_TYPES, GEOS, CHANNELS } from '@/lib/deal-fields'
import { currentEmail } from '@/lib/access'

// Adding a deal the email scan did not catch — a referral, an upsell raised on a call,
// work that came out of an event.
//
// THE FORM FILLS ITSELF WHERE IT CAN. Type three characters of a client we have worked
// with and their currency, geography, account manager, PM, technology, department and
// engagement model come back from their own history. None of it is guessed: it is what
// that client's last deal and their revenue rows actually say. Everything stays editable,
// because the last time is not always this time.
//
// Only the client is required. A deal you half-know is still worth recording — the
// alternative is it living in somebody's head until it is won, which is the gap this
// whole change exists to close. The rigour belongs on CONFIRMING, where the completeness
// gate refuses anything incomplete.

const money = (n?: number) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`

export default function AddOpportunityDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const [company, setCompany] = useState('')
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
  const [contactEmail, setContactEmail] = useState('')
  const [note, setNote] = useState('')
  const [channel, setChannel] = useState('')

  const [clients, setClients] = useState<ClientDefaults[]>([])
  const [picked, setPicked] = useState<ClientDefaults | null>(null)
  const [showList, setShowList] = useState(false)
  const [rates, setRates] = useState<FxRate[]>([])
  const [dupes, setDupes] = useState<DuplicateHit[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Set when the database refused on same-client-and-value. Re-submitting then passes
  // force, so the second click is a deliberate "yes, these really are two deals" rather
  // than the same mistake going through on a retry.
  const [needsForce, setNeedsForce] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Which fields the last client pick filled in. Held in a ref rather than state because
  // nothing renders from it — it only needs to be right by the time the next pick runs.
  const fromClient = useRef<Set<string>>(new Set())

  useEffect(() => {
    getFxRates().then(setRates)
    getClientDefaults().then(setClients)
    // Default the PM to whoever is filling the form, when they are a PM. They are the
    // likeliest owner, and an owner is what decides who can confirm it later — a deal
    // saved with nobody on it can only be confirmed by an admin.
    getDirectoryMember(currentEmail()).then(m => { if (m) setPmOwner(prev => prev || m.name) })
  }, [])

  const matches = useMemo(() => searchClients(clients, company), [clients, company])

  // Once a client has been chosen there is nothing left to suggest, and the one entry the
  // search still returns is the client already in the box.
  //
  // This matters more than it sounds. onFocus reopens the list, so without this it
  // reopened on every click back into the field — offering only the name already typed,
  // and parked on top of Project name, which is the next thing anyone fills in. The list
  // was closing correctly; it was being reopened with nothing to say.
  const suggestions = useMemo(
    () => (picked && company.trim().toLowerCase() === picked.company_name.trim().toLowerCase()) ? [] : matches,
    [picked, company, matches])

  const pick = (c: ClientDefaults) => {
    setPicked(c)
    setCompany(c.company_name)
    setShowList(false)

    // Replace a field when it is empty, OR when the only reason it holds anything is that
    // a PREVIOUS pick put it there. Anything the person typed themselves is left alone.
    //
    // The earlier version only filled blanks, which is right the first time and wrong
    // every time after: changing the client left the last client's PM, contact email and
    // department sitting in the form, attached to the new client's name. The clearing
    // case matters just as much — if the new client has no contact email, the field must
    // go empty rather than keep the old one's.
    const prev = fromClient.current
    const now = new Set<string>()
    const apply = (key: string, incoming: string | undefined, current: string, set: (v: string) => void) => {
      if (!prev.has(key) && current.trim()) return
      const v = (incoming || '').trim()
      set(v)
      if (v) now.add(key)
    }
    // Currency is a select with no empty option, so it falls back to USD rather than ''.
    apply('currency', c.currency || 'USD', currency === 'USD' ? '' : currency, setCurrency)
    apply('geo', c.geo, geo, setGeo)
    apply('salesPerson', c.sales_person, salesPerson, setSalesPerson)
    apply('pmOwner', c.pm_owner, pmOwner, setPmOwner)
    apply('technology', c.technology, technology, setTechnology)
    apply('serviceDept', c.service_dept, serviceDept, setServiceDept)
    apply('projectType', c.project_type, projectType, setProjectType)
    apply('contactEmail', c.contact_email, contactEmail, setContactEmail)
    fromClient.current = now
  }

  const valueN = value === '' ? null : Number(value)

  // Warn about possible duplicates while typing. This never blocks: the useful match is
  // on VALUE, and a value collision between two genuinely different deals is common in a
  // business that quotes round numbers.
  useEffect(() => {
    if (!company.trim()) { setDupes([]); return }
    const t = setTimeout(() => {
      findPossibleDuplicates(company, Number.isNaN(valueN as number) ? null : valueN).then(setDupes)
    }, 400)
    return () => clearTimeout(t)
  }, [company, value])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowList(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const save = async () => {
    setSaving(true); setError('')
    const res = await addOpportunity({
      company, channel: channel || undefined, est_value: valueN, currency, quote_date: quoteDate,
      service_dept: serviceDept, project_type: projectType, technology,
      sales_person: salesPerson, pm_owner: pmOwner, geo, subject, note,
      contact_email: contactEmail || undefined, force: needsForce,
    })
    setSaving(false)
    if (res.error) {
      setError(res.error)
      if (/already has a live deal/i.test(res.error)) setNeedsForce(true)
      return
    }
    if (res.id) onAdded(res.id)
  }

  const inputCls = 'mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg placeholder:text-mav-fg/35 \
    focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors'
  const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block">
      <span className="text-xs font-medium text-mav-fg/85">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-mav-fg/50 mt-0.5">{hint}</span>}
    </label>
  )

  const usd = toUsd(valueN, currency, rates)
  const converted = currency.toUpperCase() !== 'USD' && usd != null && !Number.isNaN(valueN as number)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Add an opportunity</h2>
            <p className="text-xs text-mav-fg/60 mt-0.5">For a deal email did not catch. Start typing the client — if we have worked with them, the rest fills itself.</p>
          </div>
          <button onClick={onClose} className="text-mav-fg/60 hover:text-mav-fg text-xl leading-none">&times;</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2" ref={boxRef}>
            <F label="Client *">
              <div className="relative">
                <input className={inputCls} value={company} autoFocus placeholder="Start typing — three letters is enough"
                  onChange={e => { setCompany(e.target.value); setPicked(null); setNeedsForce(false); setShowList(true) }}
                  onFocus={() => { if (!picked) setShowList(true) }}
                  onKeyDown={e => { if (e.key === 'Escape' && showList) { e.stopPropagation(); setShowList(false) } }}
                  autoComplete="off" />
                {showList && suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-mav-panel border border-mav-fg/25 rounded-md shadow-2xl">
                    {suggestions.map(c => (
                      <button key={c.client_key} type="button" onClick={() => pick(c)}
                        className="w-full text-left px-3 py-2 hover:bg-mav-yellow/15 transition-colors border-b border-mav-fg/10 last:border-0">
                        <div className="text-sm">{c.company_name}</div>
                        <div className="text-[11px] text-mav-fg/55">
                          {c.is_existing_client
                            ? `${c.booking_months} month${c.booking_months === 1 ? '' : 's'} booked · ${money(c.lifetime_usd)} lifetime`
                            : `${c.deals} deal${c.deals === 1 ? '' : 's'}, never booked`}
                          {c.pm_owner ? ` · ${c.pm_owner}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </F>
            {/* Say which it is. "New client" is a real business fact, not a form state —
                it changes who should own the deal and how it is reported. */}
            {company.trim().length >= 3 && (
              picked ? (
                <div className="mt-1.5 text-[11px] text-green-300">
                  Known client — filled from their history. {picked.is_existing_client ? `${picked.booking_months} months booked, ${money(picked.lifetime_usd)} lifetime.` : 'Quoted before, never booked.'} Change anything that is different this time.
                </div>
              ) : matches.length === 0 ? (
                <div className="mt-1.5 text-[11px] text-mav-fg/60">No match — this will be recorded as a new client.</div>
              ) : null
            )}
          </div>

          <div className="sm:col-span-2">
            <F label="Project name"><input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What this project is called" /></F>
          </div>

          <F label="Value"><input type="number" className={inputCls} value={value} onChange={e => { setValue(e.target.value); setNeedsForce(false) }} placeholder="0" /></F>
          <F label="Currency"><select className={inputCls} value={currency} onChange={e => setCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></F>
          {converted && (
            <div className="sm:col-span-2 -mt-1 text-xs text-mav-fg/70">
              Books as <span className="text-mav-fg">${usd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> USD · rate from Settings
            </div>
          )}

          <F label="Quote date"><input type="date" className={inputCls} value={quoteDate} onChange={e => setQuoteDate(e.target.value)} /></F>
          <F label="Geography"><select className={inputCls} value={geo} onChange={e => setGeo(e.target.value)}><option value="">—</option>{GEOS.map(g => <option key={g} value={g}>{g}</option>)}</select></F>

          <F label="Service / dept">
            <select className={inputCls} value={serviceDept} onChange={e => setServiceDept(e.target.value)}>
              <option value="">—</option>
              {SERVICE_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              {serviceDept && !SERVICE_DEPTS.includes(serviceDept as any) && <option value={serviceDept}>{serviceDept} (existing)</option>}
            </select>
          </F>
          <F label="Project type">
            <select className={inputCls} value={projectType} onChange={e => setProjectType(e.target.value)}>
              <option value="">—</option>
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              {projectType && !PROJECT_TYPES.includes(projectType as any) && <option value={projectType}>{projectType} (existing)</option>}
            </select>
          </F>

          <F label="Technology"><input className={inputCls} value={technology} onChange={e => setTechnology(e.target.value)} placeholder="Shopify, WordPress…" /></F>
          <F label="Client contact"><input className={inputCls} value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="name@client.com" /></F>

          <F label="Account manager"><input className={inputCls} value={salesPerson} onChange={e => setSalesPerson(e.target.value)} /></F>
          <F label="PM owner" hint="Whoever is named here can confirm the deal later."><input className={inputCls} value={pmOwner} onChange={e => setPmOwner(e.target.value)} /></F>

          <div className="sm:col-span-2"><F label="Note"><textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth knowing about this deal" /></F></div>

          {/* Last, and optional. It is useful for reporting on where work comes from, and
              it is the least urgent thing on this form. */}
          <div className="sm:col-span-2">
            <F label="Where it came from (optional)">
              <select className={inputCls} value={channel} onChange={e => setChannel(e.target.value)}>
                <option value="">—</option>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
          </div>
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
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-mav-fg/20 text-mav-fg/70 hover:text-mav-fg hover:border-mav-fg/40 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !company.trim()}
            className="text-xs px-4 py-1.5 rounded-md bg-mav-fill text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
            {saving ? 'Adding…' : needsForce ? 'Add anyway' : 'Add opportunity'}
          </button>
        </div>
      </div>
    </div>
  )
}
