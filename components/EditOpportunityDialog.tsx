'use client'
import { useEffect, useState } from 'react'
import {
  updateOpportunityFields, getFxRates, toUsd, getTechnologyOptions, listDirectory, listAms,
  type FxRate, type DirectoryMember, type AmMember, type Opportunity,
} from '@/lib/supabase'
import { SERVICE_DEPTS, CURRENCIES, PROJECT_TYPES, GEOS, GEO_SHEET_LABEL, VOCAB_FALLBACK, normBusinessType } from '@/lib/deal-fields'

// Edit a deal that is still open.
//
// The email scan reads a client, a subject and sometimes a price. It cannot read costing
// in the client's currency, project type, business type, technology, geography or who the
// account manager is, so those arrive blank or guessed. This is where a person puts them
// right without having to confirm the deal first.
//
// Only what changed is sent, so saving never overwrites a field with the stale copy this
// form opened on. The database logs each change and marks the field as set by hand.

const inputCls = 'mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg placeholder:text-mav-fg/35 \
    focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors'

const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <span className="text-xs font-medium text-mav-fg/85">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-mav-fg/50 mt-0.5">{hint}</span>}
  </label>
)

// A dropdown that keeps whatever the deal already carries selectable, even when it is not
// on the list, so opening the form and saving never silently rewrites an old value.
const Sel = ({ value, onChange, options, labels }: {
  value: string; onChange: (v: string) => void; options: readonly string[]; labels?: Record<string, string>
}) => (
  <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">—</option>
    {options.map(o => <option key={o} value={o}>{labels?.[o] || o}</option>)}
    {value && !options.includes(value) && <option value={value}>{value} (existing)</option>}
  </select>
)

export default function EditOpportunityDialog({ deal, onClose, onSaved }: {
  deal: Opportunity; onClose: () => void; onSaved: () => void
}) {
  const start = {
    subject: deal.source_subject || '',
    value: deal.local_value != null ? String(deal.local_value) : (deal.est_value != null ? String(deal.est_value) : ''),
    currency: deal.currency || 'USD',
    win: deal.win_probability != null ? String(deal.win_probability) : '',
    serviceDept: deal.service_dept || '', projectType: deal.project_type || '',
    technology: deal.technology || '', businessType: normBusinessType(deal.business_type) || '',
    geo: deal.geo || '', salesPerson: deal.sales_person || '', pmOwner: deal.pm_owner || '',
    contactEmail: deal.contact_email || '', serviceType: deal.service_type || '',
    deliveryType: deal.delivery_type || '', clientType: deal.client_type || '',
  }
  const [f, setF] = useState(start)
  const set = (k: keyof typeof start) => (v: string) => setF(p => ({ ...p, [k]: v }))
  const [rates, setRates] = useState<FxRate[]>([])
  const [techOptions, setTechOptions] = useState<string[]>([])
  const [pms, setPms] = useState<DirectoryMember[]>([])
  const [ams, setAms] = useState<AmMember[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getFxRates().then(setRates)
    getTechnologyOptions().then(setTechOptions).catch(() => {})
    listDirectory().then(l => setPms(l.filter(m => m.active))).catch(() => {})
    listAms().then(setAms).catch(() => {})
  }, [])

  const valueN = f.value === '' ? null : Number(f.value)
  const usd = toUsd(valueN, f.currency, rates)
  const converted = f.currency.toUpperCase() !== 'USD' && usd != null && valueN != null && !Number.isNaN(valueN)
  const techList = techOptions.length ? techOptions : VOCAB_FALLBACK.technology

  const save = async () => {
    setError('')
    if (valueN != null && (Number.isNaN(valueN) || valueN <= 0)) { setError('The value has to be more than zero.'); return }
    const win = f.win === '' ? null : Number(f.win)
    if (win != null && (Number.isNaN(win) || win < 0 || win > 100)) { setError('Win probability is between 0 and 100.'); return }

    // Send a field only when it differs from what the form opened with.
    const edits: Record<string, any> = {}
    const text: [keyof typeof start, string][] = [
      ['subject', 'subject'], ['serviceDept', 'service_dept'], ['projectType', 'project_type'],
      ['technology', 'technology'], ['businessType', 'business_type'], ['geo', 'geo'],
      ['salesPerson', 'sales_person'], ['pmOwner', 'pm_owner'], ['contactEmail', 'contact_email'],
      ['serviceType', 'service_type'], ['deliveryType', 'delivery_type'], ['clientType', 'client_type'],
    ]
    for (const [k, col] of text) if (f[k] !== start[k]) edits[col] = f[k].trim()
    if (f.value !== start.value || f.currency !== start.currency) {
      if (valueN != null) { edits.local_value = valueN; edits.currency = f.currency }
      else if (f.currency !== start.currency) edits.currency = f.currency
    }
    if (f.win !== start.win && win != null) edits.win_probability = win
    if (!Object.keys(edits).length) { onClose(); return }

    setSaving(true)
    const res = await updateOpportunityFields(deal.id, edits)
    setSaving(false)
    if (!res.ok) { setError(res.error || 'Could not save.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Edit opportunity</h2>
            <p className="text-xs text-mav-fg/60 mt-0.5">
              {deal.company_name} · fill in what the email scan could not read. Everything you change is logged, and the scan will not write over it.
            </p>
          </div>
          <button onClick={onClose} className="text-mav-fg/60 hover:text-mav-fg text-xl leading-none">&times;</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <F label="Project name"><input className={inputCls} value={f.subject} onChange={e => set('subject')(e.target.value)} /></F>
          </div>

          <F label="Costing" hint="In the currency the client was quoted.">
            <input type="number" min="0" className={inputCls} value={f.value} onChange={e => set('value')(e.target.value)} placeholder="0" />
          </F>
          <F label="Currency">
            <select className={inputCls} value={f.currency} onChange={e => set('currency')(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              {!CURRENCIES.includes(f.currency as any) && <option value={f.currency}>{f.currency} (existing)</option>}
            </select>
          </F>
          {converted && (
            <div className="sm:col-span-2 -mt-1 text-xs text-mav-fg/70">
              Books as <span className="text-mav-fg">${usd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> USD · rate from Settings
            </div>
          )}

          <F label="Win probability (%)" hint="Needs a value.">
            <input type="number" min="0" max="100" className={inputCls} value={f.win} onChange={e => set('win')(e.target.value)} placeholder="—" />
          </F>
          <F label="Geography">
            <Sel value={f.geo} onChange={set('geo')} options={GEOS} labels={GEO_SHEET_LABEL} />
          </F>

          <F label="Service / dept"><Sel value={f.serviceDept} onChange={set('serviceDept')} options={SERVICE_DEPTS} /></F>
          <F label="Project type"><Sel value={f.projectType} onChange={set('projectType')} options={PROJECT_TYPES} /></F>

          <F label="Technology"><Sel value={f.technology} onChange={set('technology')} options={techList} /></F>
          <F label="Business type" hint="Repeat if we have worked with them before.">
            <Sel value={f.businessType} onChange={set('businessType')} options={VOCAB_FALLBACK.business_type} />
          </F>

          <F label="Service type"><Sel value={f.serviceType} onChange={set('serviceType')} options={VOCAB_FALLBACK.service_type} /></F>
          <F label="Delivery type"><Sel value={f.deliveryType} onChange={set('deliveryType')} options={VOCAB_FALLBACK.delivery_type} /></F>

          <F label="Client type"><Sel value={f.clientType} onChange={set('clientType')} options={VOCAB_FALLBACK.client_type} /></F>
          <F label="Client contact">
            <input className={inputCls} value={f.contactEmail} onChange={e => set('contactEmail')(e.target.value)} placeholder="name@client.com" />
          </F>

          <F label="Account manager">
            <select className={inputCls} value={f.salesPerson} onChange={e => set('salesPerson')(e.target.value)}>
              <option value="">— choose —</option>
              {ams.filter(a => a.active || a.name === f.salesPerson).map(a => <option key={a.slug} value={a.name}>{a.name}{a.active ? '' : ' (left)'}</option>)}
              {f.salesPerson && !ams.some(a => a.name === f.salesPerson) && <option value={f.salesPerson}>{f.salesPerson} (not in list)</option>}
            </select>
          </F>
          <F label="PM owner" hint="Whoever is named here can confirm the deal.">
            <select className={inputCls} value={f.pmOwner} onChange={e => set('pmOwner')(e.target.value)}>
              <option value="">— choose —</option>
              {pms.map(m => <option key={m.email} value={m.name}>{m.name}</option>)}
              {f.pmOwner && !pms.some(m => m.name === f.pmOwner) && <option value={f.pmOwner}>{f.pmOwner} (not in list)</option>}
            </select>
          </F>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">{error}</div>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-full border border-mav-yellow/50 text-mav-yellow hover:bg-mav-yellow/10 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="text-xs px-4 py-1.5 rounded-full bg-mav-fill text-black font-semibold disabled:opacity-40 hover:brightness-95 transition">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
