'use client'
import { useEffect, useState } from 'react'
import { confirmOpportunityFull, opportunityMissingFields, getFxRates, toUsd, type FxRate, type Opportunity } from '@/lib/supabase'
import { SERVICE_DEPTS, CURRENCIES, PROJECT_TYPES, GEOS } from '@/lib/deal-fields'

// Confirming a deal — the moment it becomes revenue.
//
// Because the spreadsheet stops being the record on 1 Oct, there is no later pass where
// somebody fills in the gaps. So this asks for everything the revenue record needs and
// refuses while any of it is absent. The refusal is enforced in the database; this form
// exists to make it easy to satisfy rather than to be the rule.

export default function ConfirmDealDialog({ deal, onClose, onConfirmed }: {
  deal: Opportunity; onClose: () => void; onConfirmed: () => void
}) {
  // The figure shown is the one as QUOTED. A deal already converted to USD keeps its
  // local figure in local_value; older rows only have est_value, which for a USD deal is
  // the same number anyway.
  const [localValue, setLocalValue] = useState(
    deal.local_value != null ? String(deal.local_value) : deal.est_value != null ? String(deal.est_value) : '')
  const [currency, setCurrency] = useState(deal.currency || 'USD')
  const [subject, setSubject] = useState(deal.source_subject || '')
  const [quoteDate, setQuoteDate] = useState((deal.source_date || '').slice(0, 10))
  const [serviceDept, setServiceDept] = useState(deal.service_dept || '')
  const [projectType, setProjectType] = useState(deal.project_type || '')
  const [salesPerson, setSalesPerson] = useState(deal.sales_person || '')
  const [pmOwner, setPmOwner] = useState(deal.pm_owner || '')
  const [geo, setGeo] = useState(deal.geo || '')
  const [confirmedOn, setConfirmedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const [rates, setRates] = useState<FxRate[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Ask the database what is missing rather than recomputing it here. One definition, so
  // the checklist cannot disagree with the rule that actually refuses the write.
  useEffect(() => { opportunityMissingFields(deal.id).then(setMissing) }, [deal.id])
  useEffect(() => { getFxRates().then(setRates) }, [])

  const amt = localValue === '' ? null : Number(localValue)
  const usd = toUsd(amt, currency, rates)
  const converted = currency.toUpperCase() !== 'USD' && usd != null

  const save = async () => {
    setSaving(true); setError('')
    const res = await confirmOpportunityFull(deal.id, {
      est_value: amt, currency, subject, quote_date: quoteDate || null,
      service_dept: serviceDept, project_type: projectType, sales_person: salesPerson,
      pm_owner: pmOwner, geo, confirmed_on: confirmedOn, note,
    })
    setSaving(false)
    if (res.ok) { onConfirmed(); return }
    setError(res.error || 'Could not confirm')
    if (res.missing) setMissing(res.missing)
  }

  const inputCls = 'mt-1 w-full bg-mav-dark border border-mav-line rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-mav-yellow/60'
  const F = ({ label, children, need }: { label: string; children: React.ReactNode; need?: boolean }) => (
    <label className="block">
      <span className={`text-xs ${need ? 'text-amber-300' : 'text-mav-muted'}`}>{label}{need ? ' · needed' : ''}</span>
      {children}
    </label>
  )
  const needs = (f: string) => missing.includes(f)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-lg font-semibold">Confirm {deal.company_name || 'this deal'}</h2>
          <button onClick={onClose} className="text-mav-muted hover:text-white text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-mav-muted mb-4">This books the deal as revenue. Everything below has to be filled in first — there is no second pass in the sheet any more.</p>

        {missing.length > 0 ? (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Still needed: {missing.join(', ')}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-300">
            Everything needed is here — ready to confirm.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* An email-sourced deal inherits the mail's subject line, which is rarely what
              the project should be called. Editable here, where someone is looking anyway. */}
          <div className="sm:col-span-2">
            <F label="Project title"><input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What this project is called" /></F>
          </div>

          <F label="Value" need={needs('Value')}>
            <input type="number" className={inputCls} value={localValue} onChange={e => setLocalValue(e.target.value)} />
          </F>
          <F label="Currency" need={needs('Currency')}>
            <select className={inputCls} value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </F>

          {/* Say what will actually be booked. Everything downstream adds up USD, so a
              GBP quote stored raw would overstate the pipeline by a third — showing the
              converted figure here means nobody discovers that later. */}
          {converted && (
            <div className="sm:col-span-2 -mt-1 text-xs text-mav-muted">
              Books as <span className="text-white">${usd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> USD
              <span className="ml-1">· rate {(rates.find(r => r.currency.toUpperCase() === (currency.toUpperCase() === 'EURO' ? 'EUR' : currency.toUpperCase()))?.rate_to_usd ?? 1)} per {currency.toUpperCase()}, from Settings</span>
            </div>
          )}

          <F label="Quote date" need={needs('Quote date')}><input type="date" className={inputCls} value={quoteDate} onChange={e => setQuoteDate(e.target.value)} /></F>
          <F label="Confirmed on"><input type="date" className={inputCls} value={confirmedOn} onChange={e => setConfirmedOn(e.target.value)} /></F>

          <F label="Service / dept" need={needs('Service / dept')}>
            <select className={inputCls} value={serviceDept} onChange={e => setServiceDept(e.target.value)}>
              <option value="">—</option>
              {SERVICE_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              {/* An older row may hold a department no longer on the list. Keep it selectable
                  so confirming does not silently retag the deal as something else. */}
              {deal.service_dept && !SERVICE_DEPTS.includes(deal.service_dept as any) && (
                <option value={deal.service_dept}>{deal.service_dept} (existing)</option>
              )}
            </select>
          </F>
          <F label="Project type" need={needs('Project type')}>
            <select className={inputCls} value={projectType} onChange={e => setProjectType(e.target.value)}>
              <option value="">—</option>{PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </F>
          <F label="Account manager" need={needs('Account manager')}><input className={inputCls} value={salesPerson} onChange={e => setSalesPerson(e.target.value)} /></F>
          <F label="PM owner" need={needs('PM owner')}><input className={inputCls} value={pmOwner} onChange={e => setPmOwner(e.target.value)} /></F>
          <F label="Geography" need={needs('Geography')}>
            <select className={inputCls} value={geo} onChange={e => setGeo(e.target.value)}>
              <option value="">—</option>{GEOS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </F>
          <div className="sm:col-span-2"><F label="Note (optional)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="How it was confirmed" /></F></div>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">{error}</div>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="text-xs px-4 py-1.5 rounded-md bg-green-500 text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
            {saving ? 'Confirming…' : 'Confirm as won'}
          </button>
        </div>
      </div>
    </div>
  )
}
