'use client'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import { Panel } from '@/components/PageParts'
import DateCell from '@/components/DateCell'
import { useAuth } from '@/components/AuthProvider'
import {
  saveVendorCalculation, getVendorCalculations, deleteVendorCalculation, type VendorCalculation,
} from '@/lib/supabase'

// The Vendor Calculator, ported from the owner's standalone tool (calculator.js) so PMs
// price a vendor quote without leaving the dashboard. The engine below is that file's
// logic line for line — two directions, the 65% auto-fill, the live USD→INR rate — only
// the DOM writes became state. Change the maths there and here together.
//
//   LEFT → RIGHT  vendor / client / rates typed → derive margin
//   RIGHT → LEFT  margin % typed → back-calculate the client price

const DEFAULT_MARGIN = 65

/* ── helpers (as in calculator.js) ─────────────────────────────────────── */

/** An input's number; blank, non-numeric and zero all mean "not given". */
function parse(s: string): number | null {
  const v = parseFloat(s)
  return (s.trim() === '' || isNaN(v) || v === 0) ? null : v
}
function parseVal(s: string): number | null {
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

/** Indian rupee grouping — ₹1,12,000 — whole number, no decimals. */
function inr(val: number | null): string {
  if (val === null) return '—'
  const neg = val < 0
  const s = Math.round(Math.abs(val)).toString()
  let out = '', rem = s
  if (rem.length > 3) {
    out = rem.slice(-3)
    rem = rem.slice(0, rem.length - 3)
    while (rem.length > 2) {
      out = rem.slice(-2) + ',' + out
      rem = rem.slice(0, rem.length - 2)
    }
    out = rem + ',' + out
  } else {
    out = rem
  }
  return (neg ? '-' : '') + '₹' + out
}
function usd(val: number | null): string {
  if (val === null) return '—'
  return (val < 0 ? '-' : '') + '$' +
    Math.round(Math.abs(val)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function aud(val: number | null): string {
  if (val === null) return '—'
  return (val < 0 ? '-' : '') + '$' +
    Math.round(Math.abs(val)).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/* ── state ─────────────────────────────────────────────────────────────── */

interface Fields { vendor: string; client: string; conv: string; aud: string; pct: string }
type Tone = 'none' | 'loss' | 'critical' | 'below' | 'on' | 'excellent'
interface Out {
  vendorUSD: string; vendorAUD: string; clientUSD: string; clientAUD: string
  marginINR: string; status: string; tone: Tone; loss: boolean; hasAUD: boolean
}
/** The elements that flash when their value changes — the tool's "it just updated" cue. */
type FlashKey = 'vendorUSD' | 'vendorAUD' | 'clientUSD' | 'clientAUD' | 'marginINR' | 'clientInput' | 'pctInput'
interface Calc { f: Fields; o: Out; manual: boolean; flash: FlashKey[] }

const INIT_FIELDS: Fields = { vendor: '', client: '', conv: '', aud: '1.48', pct: '' }
const INIT_OUT: Out = {
  vendorUSD: '—', vendorAUD: '—', clientUSD: '—', clientAUD: '—',
  // The status line starts empty, as in the original, until the first calculation runs.
  marginINR: '—', status: '', tone: 'none', loss: false, hasAUD: true,
}

/** Builds the output writer shared by both directions: `put` only flashes on a real change. */
function writer(o: Out, flash: FlashKey[]) {
  const put = (k: 'vendorUSD' | 'vendorAUD' | 'clientUSD' | 'clientAUD' | 'marginINR', text: string) => {
    if (o[k] !== text) { o[k] = text; flash.push(k) }
  }
  const vendorOutputs = (vINR: number | null, conv: number | null, audRate: number | null, hasAUD: boolean, hasConv: boolean) => {
    let vUSD: number | null = null, vAUD: number | null = null
    if (vINR !== null && hasConv) {
      vUSD = vINR / (conv as number)
      if (hasAUD) vAUD = vUSD * (audRate as number)
    }
    put('vendorUSD', usd(vUSD))
    if (hasAUD) put('vendorAUD', aud(vAUD))
  }
  const clientOutputs = (cUSD: number | null, audRate: number | null, hasAUD: boolean) => {
    let cAUD: number | null = null
    if (cUSD !== null && hasAUD) cAUD = cUSD * (audRate as number)
    put('clientUSD', usd(cUSD))
    if (hasAUD) put('clientAUD', aud(cAUD))
  }
  const marginPanel = (mPct: number | null) => {
    if (mPct === null) {
      o.loss = false
      put('marginINR', '—')
      o.status = 'Enter costs to calculate'; o.tone = 'none'
      return
    }
    o.loss = mPct < 65
    if (mPct < 0) { o.status = 'Loss — vendor > client'; o.tone = 'loss' }
    else if (mPct < 35) { o.status = 'Critical — far below 65%'; o.tone = 'critical' }
    else if (mPct < 65) { o.status = 'Below target (< 65%)'; o.tone = 'below' }
    else if (mPct < 85) { o.status = 'On target (≥ 65%)'; o.tone = 'on' }
    else { o.status = 'Excellent margin'; o.tone = 'excellent' }
  }
  return { put, vendorOutputs, clientOutputs, marginPanel }
}

/**
 * LEFT → RIGHT. Vendor typed → auto-fill the client at 65% unless the client price was
 * typed by hand, then derive the margin from the client price.
 */
function calcFromLeft(fIn: Fields, oIn: Out, manualIn: boolean, pctFocused: boolean): Calc {
  const f = { ...fIn }, o = { ...oIn }, flash: FlashKey[] = []
  let manual = manualIn
  const { put, vendorOutputs, clientOutputs, marginPanel } = writer(o, flash)

  const vINR = parse(f.vendor)
  const conv = parseFloat(f.conv)
  const audRate = parseFloat(f.aud)
  const hasConv = !isNaN(conv) && conv > 0
  const hasAUD = !isNaN(audRate) && audRate > 0
  o.hasAUD = hasAUD

  vendorOutputs(vINR, conv, audRate, hasAUD, hasConv)

  // Vendor cleared → reset everything.
  if (vINR === null) {
    f.client = ''
    f.pct = ''
    manual = false
    clientOutputs(null, audRate, hasAUD)
    put('marginINR', '—')
    marginPanel(null)
    return { f, o, manual, flash }
  }

  // Only honour the existing % if the client cost was set by hand.
  const existingPct = parseVal(f.pct)
  const targetPct = (manual && existingPct !== null) ? existingPct : DEFAULT_MARGIN

  let cUSDraw: number | null
  if (!manual && hasConv) {
    const cINRauto = vINR / (1 - targetPct / 100)
    cUSDraw = Math.round(cINRauto / conv)
    f.client = String(cUSDraw)
    if (!pctFocused) f.pct = String(targetPct)
    flash.push('clientInput')
  } else {
    const raw = parseFloat(f.client)
    cUSDraw = (!isNaN(raw) && raw > 0) ? raw : null
  }

  const cINRderived = (cUSDraw !== null && hasConv) ? cUSDraw * conv : null
  clientOutputs(cUSDraw, audRate, hasAUD)

  if (cINRderived !== null && cINRderived > 0) {
    const mINR = cINRderived - vINR
    const mPct = (mINR / cINRderived) * 100
    if (!pctFocused) {
      f.pct = String(Math.round(mPct))
      flash.push('pctInput')
    }
    put('marginINR', inr(mINR))
    marginPanel(mPct)
  } else {
    if (!pctFocused) f.pct = ''
    clientOutputs(null, audRate, hasAUD)
    put('marginINR', '—')
    marginPanel(null)
  }
  return { f, o, manual, flash }
}

/** RIGHT → LEFT. Margin % typed → back-calculate the client price. */
function calcFromRight(fIn: Fields, oIn: Out, manual: boolean): Calc {
  const f = { ...fIn }, o = { ...oIn }, flash: FlashKey[] = []
  const { put, vendorOutputs, clientOutputs, marginPanel } = writer(o, flash)

  const vINR = parse(f.vendor)
  const conv = parse(f.conv)
  const audRate = parse(f.aud)
  const hasAUD = audRate !== null && audRate > 0
  const hasConv = conv !== null && conv > 0
  const targetPct = parseVal(f.pct)
  o.hasAUD = hasAUD

  vendorOutputs(vINR, conv, audRate, hasAUD, hasConv)

  if (vINR !== null && targetPct !== null && targetPct < 100 && hasConv) {
    const cINR = vINR / (1 - targetPct / 100)
    const cUSD = Math.round(cINR / (conv as number))
    f.client = String(cUSD)
    flash.push('clientInput')
    clientOutputs(cUSD, audRate, hasAUD)
    put('marginINR', inr(cINR - vINR))
    marginPanel(targetPct)
  } else {
    if (vINR === null) f.client = ''
    clientOutputs(null, audRate, hasAUD)
    put('marginINR', '—')
    marginPanel(targetPct !== null ? targetPct : null)
  }
  return { f, o, manual, flash }
}

const TONE: Record<Tone, string> = {
  none: 'text-mav-muted', loss: 'text-red-400', critical: 'text-red-400',
  below: 'text-amber-400', on: 'text-green-400', excellent: 'text-green-400 font-bold',
}

/* ── page ──────────────────────────────────────────────────────────────── */

const field = 'bg-mav-panel border border-mav-line rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-mav-yellow'
const label = 'font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted'
const round2 = (n: number) => Math.round(n * 100) / 100

export default function VendorCalculatorPage() {
  const { profile, email } = useAuth()
  const isAdmin = !!profile?.is_admin

  const [f, setF] = useState<Fields>(INIT_FIELDS)
  const [o, setO] = useState<Out>(INIT_OUT)
  const [convPlaceholder, setConvPlaceholder] = useState('—')
  const [live, setLive] = useState(false)
  // Whether the client price was typed by hand — decides auto-fill vs keep.
  const manual = useRef(false)
  // Mirrors for the live-rate fetch, which resolves after the render that started it.
  const fRef = useRef(f); fRef.current = f
  const oRef = useRef(o); oRef.current = o
  const placeholderRef = useRef(convPlaceholder); placeholderRef.current = convPlaceholder

  const pctRef = useRef<HTMLInputElement>(null)
  const els = useRef<Partial<Record<FlashKey, HTMLElement | null>>>({})
  const pendingFlash = useRef<FlashKey[]>([])
  const reg = (k: FlashKey) => (el: HTMLElement | null) => { els.current[k] = el }

  // Restart the fade on every element that changed — remove, force a reflow, re-add.
  useEffect(() => {
    const keys = pendingFlash.current
    if (!keys.length) return
    pendingFlash.current = []
    for (const k of Array.from(new Set(keys))) {
      const el = els.current[k]
      if (!el) continue
      el.classList.remove('vc-flash')
      void el.offsetWidth
      el.classList.add('vc-flash')
    }
  })

  const apply = (r: Calc) => {
    manual.current = r.manual
    pendingFlash.current.push(...r.flash)
    setF(r.f); setO(r.o)
  }
  const pctFocused = () => typeof document !== 'undefined' && document.activeElement === pctRef.current

  const onLeft = (k: 'vendor' | 'conv' | 'aud', v: string) =>
    apply(calcFromLeft({ ...f, [k]: v }, o, manual.current, pctFocused()))

  // Client typed: mark as manual; cleared (or zero) → back to auto-fill mode.
  const onClient = (v: string) => {
    const raw = parseFloat(v)
    const isManual = !isNaN(raw) && raw > 0
    apply(calcFromLeft({ ...f, client: isManual ? v : '' }, o, isManual, pctFocused()))
  }
  const onPct = (v: string) => apply(calcFromRight({ ...f, pct: v }, o, manual.current))

  // Live USD → INR (open.er-api.com, no key). Fills the field only if the user has not
  // typed a rate; the placeholder always shows the live figure. Failure is silent.
  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD')
        const data = await res.json()
        if (gone || !data?.rates?.INR) return
        const rate = parseFloat(data.rates.INR).toFixed(2)
        const cur = fRef.current
        if (cur.conv.trim() === '' || cur.conv === placeholderRef.current) {
          const r = calcFromLeft({ ...cur, conv: rate }, oRef.current, manual.current, pctFocused())
          manual.current = r.manual
          pendingFlash.current.push(...r.flash)
          setF(r.f); setO(r.o)
        }
        setConvPlaceholder(rate)
        setLive(true)
      } catch { /* fall back quietly — the rate can be typed by hand */ }
    })()
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── save ── */
  const [meta, setMeta] = useState({ project: '', client: '', vendor: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState<VendorCalculation[] | null>(null)
  const [rowErr, setRowErr] = useState<string | null>(null)

  useEffect(() => { getVendorCalculations().then(setSaved) }, [])

  const vINR = parse(f.vendor)
  const conv = parse(f.conv)
  const cUSD = (() => { const v = parseFloat(f.client); return !isNaN(v) && v > 0 ? v : null })()
  const audRate = parse(f.aud)
  const canSave = vINR !== null && conv !== null && conv > 0 && cUSD !== null && !saving

  const save = async () => {
    if (!canSave || vINR === null || conv === null || cUSD === null) return
    const hasAUD = audRate !== null && audRate > 0
    const vendorUSD = vINR / conv
    const clientINR = cUSD * conv
    const t = (s: string) => s.trim() || null
    setSaving(true); setSaveMsg(null)
    const r = await saveVendorCalculation({
      project: t(meta.project), client: t(meta.client), vendor: t(meta.vendor), note: t(meta.note),
      vendor_inr: vINR, usd_inr: conv, aud_rate: hasAUD ? audRate : null,
      vendor_usd: round2(vendorUSD), vendor_aud: hasAUD ? round2(vendorUSD * (audRate as number)) : null,
      client_usd: cUSD, client_aud: hasAUD ? round2(cUSD * (audRate as number)) : null,
      margin_pct: round2(((clientINR - vINR) / clientINR) * 100), margin_inr: Math.round(clientINR - vINR),
    })
    setSaving(false)
    if (r.error || !r.row) { setSaveMsg({ ok: false, text: r.error || 'Could not save' }); return }
    setSaved(s => [r.row as VendorCalculation, ...(s || [])])
    setMeta({ project: '', client: '', vendor: '', note: '' })
    setSaveMsg({ ok: true, text: 'Saved' })
  }

  const remove = async (row: VendorCalculation) => {
    if (!window.confirm(`Remove this saved calculation${row.project ? ` for ${row.project}` : ''}?`)) return
    setRowErr(null)
    const r = await deleteVendorCalculation(row.id)
    if (!r.ok) { setRowErr(r.error || 'Could not remove'); return }
    setSaved(s => (s || []).filter(x => x.id !== row.id))
  }
  const canRemove = (row: VendorCalculation) =>
    isAdmin || (!!email && (row.created_by || '').toLowerCase() === email.toLowerCase())

  const chip = 'rounded-lg border border-mav-line bg-mav-dark px-3 py-2 text-lg font-bold tabular-nums text-mav-fg'
  const noAud = <p className="text-xs text-mav-muted leading-snug">Add AUD rate above<br />to see AUD value</p>
  const panelTone = o.loss ? 'bg-red-500/10 border-red-500/40' : 'bg-green-500/10 border-green-500/40'
  const pctTone = o.loss ? 'text-red-400' : 'text-green-400'

  return (
    <div>
      {/* The fade the original tool used to show a value just changed. */}
      <style>{`@keyframes vcflash{0%{opacity:1}30%{opacity:.3}100%{opacity:1}}.vc-flash{animation:vcflash .3s ease}`}</style>

      <Header title="Vendor Calculator"
        subtitle="Price a vendor quote: type the vendor's cost in rupees and the client price fills in at a 65% margin. Type your own client price to see the margin it gives, or type a margin % to get the client price that hits it." />

      {/* Rates */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-mav-muted">1 USD =</span>
          <input type="number" min="0" step="any" value={f.conv} placeholder={convPlaceholder}
            onChange={e => onLeft('conv', e.target.value)} className={`${field} w-24 tabular-nums`} aria-label="USD to INR rate" />
          <span className="text-mav-muted">INR</span>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-green-400"
              title={`Live rate: 1 USD = ${convPlaceholder} INR`}>
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
            </span>
          )}
        </label>
        <label className="flex items-center gap-2">
          <span className="text-mav-muted">1 USD =</span>
          <input type="number" min="0" step="any" value={f.aud} placeholder="1.52"
            onChange={e => onLeft('aud', e.target.value)} className={`${field} w-24 tabular-nums`} aria-label="USD to AUD rate" />
          <span className="text-mav-muted">AUD</span>
          <span className="text-xs text-mav-muted">(optional)</span>
        </label>
      </div>

      {/* Calculator: Cost | Vendor | Client | Margin */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-2">
        {/* Cost */}
        <div className="p-4 border-mav-line">
          <div className={`${label} mb-3`}>Cost</div>
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs font-semibold text-mav-fg mb-1">Vendor Cost</span>
              <span className="flex items-center gap-2">
                <span className="text-mav-muted w-3">₹</span>
                <input type="number" min="0" step="any" value={f.vendor} placeholder="e.g. 112,000" aria-label="Vendor cost in INR"
                  onChange={e => onLeft('vendor', e.target.value)} className={`${field} w-full text-base tabular-nums`} />
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-mav-fg mb-1">Client Cost</span>
              <span className="flex items-center gap-2">
                <span className="text-mav-muted w-3">$</span>
                <input ref={reg('clientInput')} type="number" min="0" step="any" value={f.client} placeholder="e.g. 3,200" aria-label="Client cost in USD"
                  onChange={e => onClient(e.target.value)} className={`${field} w-full text-base tabular-nums`} />
              </span>
            </label>
          </div>
        </div>

        {/* Vendor */}
        <div className="p-4 border-t sm:border-t-0 sm:border-l border-mav-line">
          <div className={`${label} mb-3`}>Vendor</div>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-semibold text-mav-muted mb-1">USD</div>
              <div ref={reg('vendorUSD')} className={chip}>{o.vendorUSD}</div>
            </div>
            {o.hasAUD ? (
              <div>
                <div className="text-[11px] font-semibold text-mav-muted mb-1">AUD</div>
                <div ref={reg('vendorAUD')} className={chip}>{o.vendorAUD}</div>
              </div>
            ) : noAud}
          </div>
        </div>

        {/* Client */}
        <div className="p-4 border-t lg:border-t-0 lg:border-l border-mav-line">
          <div className={`${label} mb-3`}>Client</div>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-semibold text-mav-muted mb-1">USD</div>
              <div ref={reg('clientUSD')} className={chip}>{o.clientUSD}</div>
            </div>
            {o.hasAUD ? (
              <div>
                <div className="text-[11px] font-semibold text-mav-muted mb-1">AUD</div>
                <div ref={reg('clientAUD')} className={chip}>{o.clientAUD}</div>
              </div>
            ) : noAud}
          </div>
        </div>

        {/* Margin — green on or above 65%, red below */}
        <div className={`p-4 border-t-4 sm:border-l lg:border-t-0 lg:border-l-4 transition-colors ${panelTone}`}>
          <div className={`${label} mb-3`}>Margin</div>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-full">
              <div className={`text-[11px] font-semibold mb-1 ${pctTone}`}>%</div>
              <div className={`flex items-center justify-center rounded-lg border-2 bg-mav-dark px-2 py-1 ${o.loss ? 'border-red-500/50' : 'border-green-500/50'}`}>
                <input ref={el => { pctRef.current = el; els.current.pctInput = el }} type="number" min="0" max="100" step="any"
                  value={f.pct} placeholder="—" aria-label="Target margin percentage" onChange={e => onPct(e.target.value)}
                  className={`w-24 bg-transparent text-center text-[28px] font-extrabold tabular-nums outline-none ${pctTone}`} />
                <span className={`text-[22px] font-extrabold ${pctTone}`}>%</span>
              </div>
            </div>
            <div className="w-full">
              <div className={`text-[11px] font-semibold mb-1 ${pctTone}`}>INR</div>
              <div ref={reg('marginINR')} className={`text-base font-bold tabular-nums ${pctTone}`}>{o.marginINR}</div>
            </div>
            <div className={`text-xs font-semibold ${TONE[o.tone]}`}>{o.status}</div>
          </div>
        </div>
      </section>
      <p className="flex items-center gap-2 text-xs text-mav-muted mb-6">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />Live — values update instantly as you type
      </p>

      {/* Save */}
      <Panel className="mb-6" title="Save calculation"
        info={'Keeps this calculation — every input and the result, with the exchange rate it was worked out at. Saved calculations are also written to a hidden "Vendor Calculator" tab in the output spreadsheet each hour.'}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {(['project', 'client', 'vendor'] as const).map(k => (
            <label key={k} className="block">
              <span className={`block ${label} mb-1`}>{k === 'vendor' ? 'Vendor name' : k[0].toUpperCase() + k.slice(1)}</span>
              <input value={meta[k]} onChange={e => setMeta(m => ({ ...m, [k]: e.target.value }))}
                placeholder="Optional" className={`${field} w-full`} />
            </label>
          ))}
        </div>
        <label className="block mb-3">
          <span className={`block ${label} mb-1`}>Note</span>
          <input value={meta.note} onChange={e => setMeta(m => ({ ...m, note: e.target.value }))}
            placeholder="Optional" className={`${field} w-full`} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!canSave}
            title={canSave ? undefined : 'Enter the vendor cost, the USD rate and a client price first'}
            className="rounded-full bg-mav-fill text-black font-semibold px-4 py-2 text-sm hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : 'Save calculation'}
          </button>
          {saveMsg && <span className={`text-sm ${saveMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{saveMsg.text}</span>}
        </div>
      </Panel>

      {/* Saved */}
      <Panel flush title={<>Saved calculations <span className="normal-case tracking-normal">· {saved ? saved.length : '…'}</span></>}
        info={'Newest first. Anyone signed in can see them; the person who saved one, or an admin, can remove it. Also written to a hidden "Vendor Calculator" tab in the output spreadsheet each hour.'}
        right={rowErr ? <span className="text-xs text-red-400">{rowErr}</span> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Project</th>
                <th className="px-3 py-2.5">Client</th>
                <th className="px-3 py-2.5">Vendor</th>
                <th className="px-3 py-2.5 text-right">Vendor ₹</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-3 py-2.5 text-right">Client $</th>
                <th className="px-3 py-2.5 text-right">Margin %</th>
                <th className="px-3 py-2.5 text-right">Margin ₹</th>
                <th className="px-3 py-2.5">By</th>
                <th className="px-3 py-2.5 sticky-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {saved === null && <tr><td colSpan={11} className="px-3 py-6 text-center text-mav-muted">Loading…</td></tr>}
              {saved && saved.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-mav-muted">No saved calculations yet</td></tr>}
              {saved?.map(r => {
                const m = r.margin_pct
                return (
                  <tr key={r.id} className="border-t border-mav-line/60">
                    <td className="px-3 py-2.5"><DateCell d={r.created_at} /></td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate" title={r.note ? `${r.project || ''}\nNote: ${r.note}` : r.project || undefined}>
                      {r.project || <span className="text-mav-muted">—</span>}
                      {r.note && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-mav-muted">Note</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.client || undefined}>{r.client || <span className="text-mav-muted">—</span>}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.vendor || undefined}>{r.vendor || <span className="text-mav-muted">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inr(Number(r.vendor_inr))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{Number(r.usd_inr).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{usd(Number(r.client_usd))}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${m == null ? 'text-mav-muted' : m < 65 ? 'text-red-400' : 'text-green-400'}`}>
                      {m == null ? '—' : `${Math.round(Number(m))}%`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.margin_inr == null ? '—' : inr(Number(r.margin_inr))}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate text-mav-muted" title={r.created_by || undefined}>{(r.created_by || '—').split('@')[0]}</td>
                    <td className="px-3 py-2.5 sticky-action">
                      {canRemove(r) && (
                        <button type="button" onClick={() => remove(r)}
                          className="rounded-full border border-red-500/50 text-red-400 px-3 py-1 text-xs hover:bg-red-500/10">Remove</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
