'use client'
import { useEffect, useState } from 'react'
import { updateProjectFields, getPickList, getContractors, CONTRACTOR, type LedgerRow, type Contractor } from '@/lib/supabase'
import { CURRENCIES } from '@/lib/deal-fields'

// The columns somebody fills in AFTER the deal is won.
//
// These are not fields a PM is withholding at confirmation — they are genuinely not
// known yet. Nobody can name the Expert or the actual hours on the day a client says
// yes, and finance raises the invoice weeks later. Asking for them in the confirm dialog
// would have produced a required field people answer with anything to get past it.
//
// So they live here instead, on the row, editable by whoever does know. Nothing in this
// form can change what the deal is worth, who owns it, or whether it is won: the RPC
// behind it reaches these columns and no others, which is a stronger guarantee than a
// form that merely declines to show the rest.

const STATUSES = ['Under Development', 'Delivered', 'On Hold', 'Cancelled', 'Under Review', 'Awaiting Information']

export default function EditLedgerRowDialog({ row, onClose, onSaved }: {
  row: LedgerRow; onClose: () => void; onSaved: () => void
}) {
  const [projectId, setProjectId] = useState(row.project_id || '')
  const [quoteId, setQuoteId] = useState(row.quote_id || '')
  const [status, setStatus] = useState(row.delivery_status || '')
  const [startDate, setStartDate] = useState((row.start_date || '').slice(0, 10))
  const [deliveryDate, setDeliveryDate] = useState((row.delivery_date || '').slice(0, 10))
  const [internalDelivery, setInternalDelivery] = useState((row.internal_delivery || '').slice(0, 10))
  const [expert, setExpert] = useState(row.expert || '')
  const [contractorName, setContractorName] = useState(row.contractor_name || '')
  const [outsourceCur, setOutsourceCur] = useState(row.outsource_currency || 'USD')
  const [experts, setExperts] = useState<string[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [internalHrs, setInternalHrs] = useState(row.internal_hrs != null ? String(row.internal_hrs) : '')
  const [actualHrs, setActualHrs] = useState(row.actual_hrs != null ? String(row.actual_hrs) : '')
  const [integration, setIntegration] = useState(row.integration || '')
  const [outsource, setOutsource] = useState(row.outsource_price != null ? String(row.outsource_price) : '')
  const [invoiceNo, setInvoiceNo] = useState(row.invoice_no || '')
  const [invoiceCur, setInvoiceCur] = useState(row.invoice_currency || '')
  const [invoiceAmt, setInvoiceAmt] = useState(row.invoice_amount != null ? String(row.invoice_amount) : '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getPickList('expert').then(setExperts); getContractors().then(setContractors) }, [])

  // The sheet shows this as a percentage and it is pure arithmetic, so it is computed
  // rather than typed — one less field to get wrong, and it updates as the hours are
  // entered so a transposed figure is visible immediately.
  const ih = Number(internalHrs), ah = Number(actualHrs)
  const optimisation = (Number.isFinite(ih) && ih > 0 && Number.isFinite(ah) && actualHrs !== '')
    ? `${Math.round(((ih - ah) / ih) * 100)}%` : null

  const num = (v: string) => v === '' ? null : Number(v)

  const save = async () => {
    setSaving(true); setError('')
    const res = await updateProjectFields(row.source_id, {
      project_id: projectId, quote_id: quoteId, expert, integration,
      contractor_name: contractorName, outsource_currency: outsourceCur,
      delivery_status: status, invoice_no: invoiceNo, invoice_currency: invoiceCur,
      internal_delivery: internalDelivery || null,
      start_date: startDate || null, delivery_date: deliveryDate || null,
      internal_hrs: num(internalHrs), actual_hrs: num(actualHrs),
      outsource_price: num(outsource), invoice_amount: num(invoiceAmt),
    })
    setSaving(false)
    if (res.ok) { onSaved(); return }
    setError(res.error || 'Could not save')
  }

  const ctl = `mt-1 w-full bg-mav-dark border border-white/20 rounded-md px-3 py-2 text-sm text-white
    placeholder:text-white/35 focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors`
  const F = ({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) => (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-medium text-white/85">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/50">{hint}</span>}
    </label>
  )
  const Group = ({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) => (
    <section className="border-t border-mav-line pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[11px] text-white/55 mt-0.5 mb-3">{blurb}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </section>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-mav-panel border border-mav-line rounded-xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 border-b border-mav-line flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{row.company_name || 'This row'}</h2>
            <p className="text-xs text-white/60 mt-0.5">
              {row.project_name || 'No project name'} · {(row.booking_month || '').slice(0, 7)}
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          <Group title="Identifiers" blurb="The sheet's own labels for this project.">
            <F label="Project Id"><input className={ctl} value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="PRJ…" /></F>
            <F label="Quote ID"><input className={ctl} value={quoteId} onChange={e => setQuoteId(e.target.value)} placeholder="QUT…" /></F>
          </Group>

          <Group title="Delivery" blurb="Filled in as the work is scheduled and done.">
            <F label="Project status">
              <select className={ctl} value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">— choose —</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                {status && !STATUSES.includes(status) && <option value={status}>{status} (not in list)</option>}
              </select>
            </F>
            <F label="Expert">
              <select className={ctl} value={expert} onChange={e => setExpert(e.target.value)}>
                <option value="">— choose —</option>
                {experts.map(x => <option key={x} value={x}>{x}</option>)}
                {/* A retired expert is still named on the projects they built, so their
                    own row must stay selectable or saving anything else here would
                    quietly reassign the work. */}
                {expert && !experts.includes(expert) && <option value={expert}>{expert} (not in list)</option>}
              </select>
            </F>
            <F label="Start date"><input type="date" className={ctl} value={startDate} onChange={e => setStartDate(e.target.value)} /></F>
            <F label="Delivery date"><input type="date" className={ctl} value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} /></F>
            <F label="Internal delivery"><input type="date" className={ctl} value={internalDelivery} onChange={e => setInternalDelivery(e.target.value)} /></F>
            <F label="Integration" hint="LP work only."><input className={ctl} value={integration} onChange={e => setIntegration(e.target.value)} /></F>
            <F label="Internal hrs"><input type="number" className={ctl} value={internalHrs} onChange={e => setInternalHrs(e.target.value)} /></F>
            <F label="Actual hrs" hint={optimisation ? `Optimization: ${optimisation}` : 'Optimization is worked out from these two.'}>
              <input type="number" className={ctl} value={actualHrs} onChange={e => setActualHrs(e.target.value)} />
            </F>
          </Group>

          <Group title="Invoicing" blurb="Filled in by finance, usually weeks later. Blank is normal — about a quarter of projects never get an invoice number.">
            {/* Only meaningful on an outsourced build; the database clears all three if
                the expert changes back to somebody in-house. */}
            {expert === CONTRACTOR && (
              <>
                <F label="Contractor" hint="Managed in Settings.">
                  {/* Picking a contractor sets the cost currency to the one they invoice
                      in — right by default rather than right if someone remembers. */}
                  <select className={ctl} value={contractorName} onChange={e => {
                    setContractorName(e.target.value)
                    const c = contractors.find(x => x.name === e.target.value)
                    if (c?.default_currency) setOutsourceCur(c.default_currency)
                  }}>
                    <option value="">— choose —</option>
                    {contractors.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                    {contractorName && !contractors.some(x => x.name === contractorName) &&
                      <option value={contractorName}>{contractorName} (not in list)</option>}
                  </select>
                </F>
                <F label="Contractor cost" hint="The sheet's Outsource Price.">
                  <input type="number" className={ctl} value={outsource} onChange={e => setOutsource(e.target.value)} placeholder="0" />
                </F>
                <F label="Cost currency">
                  <select className={ctl} value={outsourceCur} onChange={e => setOutsourceCur(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </F>
              </>
            )}
            <F label="Invoice no"><input className={ctl} value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} /></F>
            <F label="Invoice currency">
              <select className={ctl} value={invoiceCur} onChange={e => setInvoiceCur(e.target.value)}>
                <option value="">—</option>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                {invoiceCur && !CURRENCIES.includes(invoiceCur as any) && <option value={invoiceCur}>{invoiceCur} (not in list)</option>}
              </select>
            </F>
            <F label="Invoice amount"><input type="number" className={ctl} value={invoiceAmt} onChange={e => setInvoiceAmt(e.target.value)} /></F>
          </Group>

          {error && <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t border-mav-line flex items-center justify-between gap-3">
          <span className="text-[11px] text-white/60">Value, owner and month are set at confirmation and cannot be changed here.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving}
              className="text-xs px-4 py-1.5 rounded-md bg-mav-yellow text-black font-medium disabled:opacity-40 hover:brightness-110 transition">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
