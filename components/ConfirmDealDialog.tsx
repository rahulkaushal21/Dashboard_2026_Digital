'use client'
import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import {
  confirmOpportunityFull, opportunityMissingFields, getFxRates, toUsd,
  getSheetVocab, getSheetClientDefaults, sheetDefaultsFor, geoCodeFromSheet,
  type FxRate, type Opportunity, type SheetVocab, type SheetClientDefaults,
} from '@/lib/supabase'
import {
  SERVICE_DEPTS, CURRENCIES, PROJECT_TYPES, GEOS, GEO_SHEET_LABEL,
  VOCAB_FALLBACK, OPEN_ENDED_TYPES,
} from '@/lib/deal-fields'

// Confirming a deal — the moment it becomes revenue.
//
// This form fills 30 of the revenue sheet's 40 columns. That sounds like a lot to ask of
// a PM, and it would be, except that almost none of it is typed: the sheet has 3,218
// rows of history and 403 of its 405 clients can supply every one of the new answers
// from their own last project. So the job here is to CHECK a prefilled form, and the
// design follows from that — prefilled values are marked, and the eye is drawn to the
// few fields that are genuinely blank.
//
// Everything is required because after the 1 Oct cutover there is no second pass in the
// sheet where somebody fills the gaps. The database enforces that; this form exists to
// make it easy to satisfy rather than to be the rule. Two exceptions, both deliberate:
// Quote Price (15% of historical rows never had one) and, on retainer-shaped project
// types, Delivery Date (a Dedicated engagement is not delivered on a day).

export default function ConfirmDealDialog({ deal, onClose, onConfirmed }: {
  deal: Opportunity; onClose: () => void; onConfirmed: () => void
}) {
  // ---- what was sold
  const [subject, setSubject] = useState(deal.source_subject || '')
  const [serviceDept, setServiceDept] = useState(deal.service_dept || '')
  const [projectType, setProjectType] = useState(deal.project_type || '')
  const [serviceType, setServiceType] = useState(deal.service_type || '')
  const [technology, setTechnology] = useState(deal.technology || '')

  // ---- who it is for
  const [clientName, setClientName] = useState(deal.client_name || '')
  const [clientEmail, setClientEmail] = useState(deal.contact_email || '')
  const [clientType, setClientType] = useState(deal.client_type || '')
  const [geo, setGeo] = useState(deal.geo || '')
  const [businessType, setBusinessType] = useState(deal.business_type || '')

  // ---- money. The figure shown is the one as QUOTED: a deal already converted keeps its
  // local figure in local_value, and older rows only have est_value, which for a USD deal
  // is the same number anyway.
  const [localValue, setLocalValue] = useState(
    deal.local_value != null ? String(deal.local_value) : deal.est_value != null ? String(deal.est_value) : '')
  const [quotePrice, setQuotePrice] = useState(deal.quote_price != null ? String(deal.quote_price) : '')
  const [currency, setCurrency] = useState(deal.currency || 'USD')

  // ---- dates and delivery
  const [quoteDate, setQuoteDate] = useState((deal.source_date || '').slice(0, 10))
  const [confirmedOn, setConfirmedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [startDate, setStartDate] = useState(deal.start_date || '')
  const [deliveryDate, setDeliveryDate] = useState(deal.delivery_date || '')
  const [deliveryType, setDeliveryType] = useState(deal.delivery_type || '')
  const [deliveryStatus, setDeliveryStatus] = useState(deal.delivery_status || 'Under Development')

  // ---- people
  const [salesPerson, setSalesPerson] = useState(deal.sales_person || '')
  const [pmOwner, setPmOwner] = useState(deal.pm_owner || '')
  const [note, setNote] = useState('')

  const [rates, setRates] = useState<FxRate[]>([])
  const [vocab, setVocab] = useState<SheetVocab>(VOCAB_FALLBACK as SheetVocab)
  const [sheetClient, setSheetClient] = useState<SheetClientDefaults | undefined>()
  const [filled, setFilled] = useState<Set<string>>(new Set())
  // Values taken from what the sheet MOSTLY says, for a client with no history here.
  // Held apart from `filled` because they carry much less authority: "what this client
  // had last time" is evidence, "what 97% of all projects are" is only a starting point,
  // and a PM checking the form should be able to tell the two apart at a glance.
  const [assumed, setAssumed] = useState<Set<string>>(new Set())
  const [serverMissing, setServerMissing] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { opportunityMissingFields(deal.id).then(setServerMissing) }, [deal.id])
  useEffect(() => { getFxRates().then(setRates) }, [])
  useEffect(() => { getSheetVocab().then(setVocab) }, [])

  // Prefill from the client's own history — but only where the deal itself is silent.
  // A value already on the deal is what somebody decided about THIS project; the sheet
  // only knows what was true of the last one, so it must never overwrite.
  useEffect(() => {
    let live = true
    getSheetClientDefaults().then(map => {
      if (!live) return
      const d = sheetDefaultsFor(map, deal.company_name)
      setSheetClient(d)
      const used = new Set<string>()
      if (!d) {
        // A client the sheet has never seen — a genuinely new logo. Nothing about THEM
        // to go on, so fall back to the two answers that are near-universal: 97% of
        // projects are Development Only and 96% are Effort based. Marked as an
        // assumption, never as this client's own history.
        const guess = new Set<string>()
        if (!serviceType.trim()) { setServiceType(VOCAB_FALLBACK.service_type[0]); guess.add('serviceType') }
        if (!deliveryType.trim()) { setDeliveryType(VOCAB_FALLBACK.delivery_type[0]); guess.add('deliveryType') }
        setAssumed(guess)
        return
      }
      const fill = (
        key: string, current: string, value: string | undefined,
        set: (v: string) => void,
      ) => {
        if (current.trim() || !value?.trim()) return
        set(value.trim()); used.add(key)
      }
      fill('clientName', clientName, d.client_name, setClientName)
      fill('clientEmail', clientEmail, d.client_email, setClientEmail)
      fill('clientType', clientType, d.client_type, setClientType)
      fill('serviceType', serviceType, d.service_type, setServiceType)
      fill('deliveryType', deliveryType, d.delivery_type, setDeliveryType)
      fill('technology', technology, d.technology, setTechnology)
      fill('serviceDept', serviceDept, d.service_dept, setServiceDept)
      fill('projectType', projectType, d.project_type, setProjectType)
      fill('salesPerson', salesPerson, d.sales_person, setSalesPerson)
      fill('pmOwner', pmOwner, d.pc_sme, setPmOwner)
      // Currency is prefilled ONLY where the deal carries none at all. 'USD' in the form
      // may be a real decision or merely the default, and the two are indistinguishable
      // once loaded — switching a genuinely-USD deal to the client's last currency would
      // misbook it by whatever the rate is.
      if (!deal.currency?.trim()) fill('currency', '', d.currency, setCurrency)
      // Geo is stored as a short code and written to the sheet as a region, so the
      // sheet's 'US/Canada' has to be translated back before it can be prefilled.
      fill('geo', geo, geoCodeFromSheet(d.geo), setGeo)
      setFilled(used)
    })
    return () => { live = false }
    // Runs once: re-running on every keystroke would re-prefill a field just cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id])

  const amt = localValue === '' ? null : Number(localValue)
  const usd = toUsd(amt, currency, rates)
  const converted = currency.toUpperCase() !== 'USD' && usd != null
  const rate = rates.find(r => r.currency.toUpperCase() ===
    (currency.toUpperCase() === 'EURO' ? 'EUR' : currency.toUpperCase()))?.rate_to_usd ?? 1

  // A retainer has no delivery date; demanding one would make the monthly confirmation,
  // the highest-volume one there is, impossible to complete honestly.
  const openEnded = OPEN_ENDED_TYPES.includes(projectType)

  // Checked live, from what is on screen, so ticking the last box is instant rather than
  // waiting for a failed save to say so. The DATABASE is still the authority — it runs
  // the same rule inside confirm_opportunity and refuses regardless of what this says.
  const missing = useMemo(() => {
    const m: string[] = []
    const need = (label: string, ok: boolean) => { if (!ok) m.push(label) }
    need('Client', !!(deal.company_name || '').trim())
    need('Value', amt != null && amt > 0)
    need('Currency', !!currency.trim())
    need('Quote date', !!quoteDate)
    need('Service / dept', !!serviceDept.trim())
    need('Project type', !!projectType.trim())
    need('Service type', !!serviceType.trim())
    need('Technology', !!technology.trim())
    need('Client name', !!clientName.trim())
    need('Client type', !!clientType.trim())
    need('Geography', !!geo.trim())
    need('Delivery type', !!deliveryType.trim())
    need('Account manager', !!salesPerson.trim())
    need('PM owner', !!pmOwner.trim())
    need('Start date', !!startDate)
    need('Delivery date', openEnded || !!deliveryDate)
    return m
  }, [deal.company_name, amt, currency, quoteDate, serviceDept, projectType, serviceType,
      technology, clientName, clientType, geo, deliveryType, salesPerson, pmOwner,
      startDate, deliveryDate, openEnded])

  const ready = missing.length === 0

  const save = async () => {
    setSaving(true); setError('')
    const res = await confirmOpportunityFull(deal.id, {
      est_value: amt, currency, subject, quote_date: quoteDate || null,
      service_dept: serviceDept, project_type: projectType, sales_person: salesPerson,
      pm_owner: pmOwner, geo, confirmed_on: confirmedOn, note,
      client_name: clientName, client_type: clientType, service_type: serviceType,
      delivery_type: deliveryType, technology, contact_email: clientEmail,
      business_type: businessType,
      quote_price: quotePrice === '' ? null : Number(quotePrice),
      start_date: startDate || null, delivery_date: deliveryDate || null,
      delivery_status: deliveryStatus,
    })
    setSaving(false)
    if (res.ok) { onConfirmed(); return }
    setError(res.error || 'Could not confirm')
    if (res.missing) setServerMissing(res.missing)
  }

  // ---- presentation --------------------------------------------------------
  const ctl = 'mt-1 w-full bg-mav-dark border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-mav-yellow/60'

  /** One labelled control. `need` turns it amber; `auto` marks a value that was filled in. */
  const F = ({ label, need, auto, guess, hint, wide, children }: {
    label: string; need?: boolean; auto?: boolean; guess?: boolean; hint?: string; wide?: boolean
    children: React.ReactNode
  }) => (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="flex items-center gap-1.5 text-xs">
        <span className={need ? 'text-amber-300' : 'text-mav-muted'}>{label}</span>
        {need && <span className="text-amber-300">·</span>}
        {need && <span className="text-amber-300">needed</span>}
        {auto && !need && (
          <span title={`Filled in from ${deal.company_name}'s last project — check it`}
            className="inline-flex items-center gap-1 text-[10px] text-sky-300/90">
            <Sparkles size={10} /> prefilled
          </span>
        )}
        {guess && !auto && !need && (
          <span title="The usual answer across all projects — this client has no history here, so check it properly"
            className="inline-flex items-center gap-1 text-[10px] text-mav-muted">
            <Sparkles size={10} /> usual
          </span>
        )}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mav-muted/80">{hint}</span>}
    </label>
  )

  const border = (bad: boolean) => bad ? 'border-amber-500/50' : 'border-mav-line'
  const Section = ({ n, title, blurb, children }: {
    n: number; title: string; blurb: string; children: React.ReactNode
  }) => (
    <section className="border-t border-mav-line pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <div className="mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="grid place-items-center w-5 h-5 rounded-full bg-mav-dark border border-mav-line text-[10px] text-mav-muted">{n}</span>
          {title}
        </h3>
        <p className="text-[11px] text-mav-muted mt-1 ml-7">{blurb}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-0 sm:ml-7">{children}</div>
    </section>
  )

  /** A dropdown whose options come from the sheet, with whatever the deal already holds
   *  kept selectable — an older row may carry a spelling no longer in use, and confirming
   *  must not silently retag it as something else. */
  const Pick = ({ value, onChange, options, bad }: {
    value: string; onChange: (v: string) => void; options: readonly string[]; bad: boolean
  }) => (
    <select className={`${ctl} ${border(bad)}`} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— choose —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (existing)</option>}
    </select>
  )

  const has = (k: string) => filled.has(k)
  const guessed = (k: string) => assumed.has(k)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-3xl bg-mav-panel border border-mav-line rounded-xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header — stays put, so what is still needed is visible while scrolling. */}
        <div className="px-5 pt-5 pb-4 border-b border-mav-line">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Confirm {deal.company_name || 'this deal'}</h2>
              <p className="text-xs text-mav-muted mt-0.5">
                This books the deal as revenue and writes its row into the sheet.
              </p>
            </div>
            <button onClick={onClose} className="text-mav-muted hover:text-white text-xl leading-none">&times;</button>
          </div>

          {sheetClient && filled.size > 0 && (
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200 flex items-start gap-2">
              <Sparkles size={13} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{filled.size} field{filled.size === 1 ? '' : 's'} filled in</span> from{' '}
                {deal.company_name}&rsquo;s {sheetClient.sheet_projects} previous project{sheetClient.sheet_projects === 1 ? '' : 's'}.
                Please check them rather than trusting them — they describe the last project, not this one.
              </span>
            </div>
          )}

          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${ready
            ? 'border-green-500/40 bg-green-500/10 text-green-300'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
            {ready
              ? <span className="flex items-center gap-1.5"><Check size={13} /> Everything needed is here — ready to confirm.</span>
              : <><span className="font-medium">{missing.length} still needed:</span> {missing.join(', ')}</>}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          <Section n={1} title="The project" blurb="What was sold, and who builds it.">
            <F label="Project title" wide
              hint="An email-sourced deal inherits the mail's subject line — rename it to what the project is actually called.">
              <input className={`${ctl} ${border(false)}`} value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="What this project is called" />
            </F>
            <F label="Service / dept" need={missing.includes('Service / dept')} auto={has('serviceDept')}>
              <Pick value={serviceDept} onChange={setServiceDept} options={SERVICE_DEPTS}
                bad={missing.includes('Service / dept')} />
            </F>
            <F label="Project type" need={missing.includes('Project type')} auto={has('projectType')}>
              <Pick value={projectType} onChange={setProjectType} options={PROJECT_TYPES}
                bad={missing.includes('Project type')} />
            </F>
            <F label="Service type" need={missing.includes('Service type')} auto={has('serviceType')} guess={guessed('serviceType')}>
              <Pick value={serviceType} onChange={setServiceType} options={vocab.service_type}
                bad={missing.includes('Service type')} />
            </F>
            <F label="Technology" need={missing.includes('Technology')} auto={has('technology')}>
              <Pick value={technology} onChange={setTechnology} options={vocab.technology}
                bad={missing.includes('Technology')} />
            </F>
          </Section>

          <Section n={2} title="The client" blurb="The agency is the company; the client name is the person at it.">
            <F label="Agency">
              <input className={`${ctl} border-mav-line opacity-60`} value={deal.company_name || ''} readOnly
                title="The company this deal belongs to. Changing it would make it a different deal." />
            </F>
            <F label="Client name" need={missing.includes('Client name')} auto={has('clientName')}>
              <input className={`${ctl} ${border(missing.includes('Client name'))}`} value={clientName}
                onChange={e => setClientName(e.target.value)} placeholder="The person you deal with" />
            </F>
            <F label="Client email" auto={has('clientEmail')}>
              <input type="email" className={`${ctl} ${border(false)}`} value={clientEmail}
                onChange={e => setClientEmail(e.target.value)} />
            </F>
            <F label="Client type" need={missing.includes('Client type')} auto={has('clientType')}>
              <Pick value={clientType} onChange={setClientType} options={vocab.client_type}
                bad={missing.includes('Client type')} />
            </F>
            <F label="Geography" need={missing.includes('Geography')} auto={has('geo')}>
              <select className={`${ctl} ${border(missing.includes('Geography'))}`} value={geo}
                onChange={e => setGeo(e.target.value)}>
                <option value="">— choose —</option>
                {GEOS.map(g => <option key={g} value={g}>{GEO_SHEET_LABEL[g] || g}</option>)}
                {geo && !GEOS.includes(geo as any) && <option value={geo}>{geo} (existing)</option>}
              </select>
            </F>
            <F label="Business type" auto={has('businessType')}>
              <Pick value={businessType} onChange={setBusinessType} options={vocab.business_type} bad={false} />
            </F>
          </Section>

          <Section n={3} title="The money" blurb="What you quoted, and what it actually closed at.">
            <F label="Quoted price" hint="Before negotiation. Leave blank if it was never formally quoted.">
              <input type="number" className={`${ctl} ${border(false)}`} value={quotePrice}
                onChange={e => setQuotePrice(e.target.value)} placeholder="optional" />
            </F>
            <F label="Confirmed value" need={missing.includes('Value')}>
              <input type="number" className={`${ctl} ${border(missing.includes('Value'))}`} value={localValue}
                onChange={e => setLocalValue(e.target.value)} />
            </F>
            <F label="Currency" need={missing.includes('Currency')} auto={has('currency')}>
              <select className={`${ctl} ${border(missing.includes('Currency'))}`} value={currency}
                onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                {currency && !CURRENCIES.includes(currency as any) && <option value={currency}>{currency} (existing)</option>}
              </select>
            </F>
            {/* Say what will actually be booked. Everything downstream adds up USD, so a
                GBP quote stored raw would overstate the pipeline by a third — showing the
                converted figure here means nobody discovers that later. */}
            {converted && (
              <div className="sm:col-span-2 rounded-lg bg-mav-dark border border-mav-line px-3 py-2 text-xs text-mav-muted">
                Books as <span className="text-white font-medium">
                  ${usd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>
                <span className="ml-1">· 1 {currency.toUpperCase()} = ${rate} USD, from Settings</span>
              </div>
            )}
          </Section>

          <Section n={4} title="Dates" blurb="When it was quoted, when it was won, and when it runs.">
            <F label="Quote date" need={missing.includes('Quote date')}>
              <input type="date" className={`${ctl} ${border(missing.includes('Quote date'))}`} value={quoteDate}
                onChange={e => setQuoteDate(e.target.value)} />
            </F>
            <F label="Confirmed on">
              <input type="date" className={`${ctl} ${border(false)}`} value={confirmedOn}
                onChange={e => setConfirmedOn(e.target.value)} />
            </F>
            <F label="Start date" need={missing.includes('Start date')}>
              <input type="date" className={`${ctl} ${border(missing.includes('Start date'))}`} value={startDate}
                onChange={e => setStartDate(e.target.value)} />
            </F>
            <F label="Delivery date" need={missing.includes('Delivery date')}
              hint={openEnded ? `Not needed — ${projectType} work has no single delivery date.` : undefined}>
              <input type="date" className={`${ctl} ${border(missing.includes('Delivery date'))}`} value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)} />
            </F>
          </Section>

          <Section n={5} title="Delivery and owners" blurb="How it is scheduled, and who is accountable.">
            <F label="Delivery type" need={missing.includes('Delivery type')} auto={has('deliveryType')} guess={guessed('deliveryType')}>
              <Pick value={deliveryType} onChange={setDeliveryType} options={vocab.delivery_type}
                bad={missing.includes('Delivery type')} />
            </F>
            <F label="Project status" hint="A deal just confirmed is starting, not finished.">
              <Pick value={deliveryStatus} onChange={setDeliveryStatus} options={vocab.delivery_status} bad={false} />
            </F>
            <F label="PM owner" need={missing.includes('PM owner')} auto={has('pmOwner')}>
              <input className={`${ctl} ${border(missing.includes('PM owner'))}`} value={pmOwner}
                onChange={e => setPmOwner(e.target.value)} />
            </F>
            <F label="Account manager" need={missing.includes('Account manager')} auto={has('salesPerson')}>
              <input className={`${ctl} ${border(missing.includes('Account manager'))}`} value={salesPerson}
                onChange={e => setSalesPerson(e.target.value)} />
            </F>
            <F label="Note (optional)" wide>
              <input className={`${ctl} ${border(false)}`} value={note} onChange={e => setNote(e.target.value)}
                placeholder="How it was confirmed" />
            </F>
          </Section>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
              {error}
              {serverMissing.length > 0 && <div className="mt-1 opacity-80">Still missing: {serverMissing.join(', ')}</div>}
            </div>
          )}
        </div>

        {/* Footer — also fixed, so Confirm is reachable without scrolling to the bottom. */}
        <div className="px-5 py-3 border-t border-mav-line flex items-center justify-between gap-3">
          <span className="text-[11px] text-mav-muted">
            {ready ? 'Ready.' : `${missing.length} field${missing.length === 1 ? '' : 's'} left`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-md border border-mav-line text-mav-muted hover:text-white transition-colors">
              Cancel
            </button>
            {/* Not disabled when incomplete: the checklist above says what is missing, and
                a dead button with no explanation is the commonest way a form wastes
                somebody's afternoon. The database refuses either way. */}
            <button onClick={save} disabled={saving}
              className="text-xs px-4 py-1.5 rounded-md bg-green-500 text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
              {saving ? 'Confirming…' : 'Confirm as won'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
