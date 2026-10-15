'use client'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'

// The Vendor Calculator, ported from the owner's standalone tool (calculator.js) so PMs
// price a vendor quote without leaving the dashboard. The engine below is that file's
// logic — the 65% auto-fill, the live rates — only the DOM writes became state.
//
// THREE DIRECTIONS NOW. The original always started from the vendor's rupee cost, which
// is the wrong end when the client has already named a budget: a PM told "we have $1,200
// for this" had to guess vendor figures until the margin landed on 65. Rahul, 15 Oct
// 2026 — "it should also work reverse from client cost to find out the vendor cost as
// per the margin".
//
//   VENDOR-LED  vendor ₹ typed  → client price auto-fills at 65%
//               client $ typed  → the margin that price actually gives
//               margin % typed  → the client price that hits it
//   CLIENT-LED  client $ + margin % typed → THE MOST THE VENDOR MAY COST
//
// In client-led the vendor box stops being an input and becomes the answer, which is the
// whole point: it is a ceiling to negotiate under, not a number to type.

const DEFAULT_MARGIN = 65
/** Seeds, used until the live rates land and whenever the fetch fails. */
const SEED_AUD = '1.48'
const SEED_GBP = '0.79'

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
const money = (sym: string, locale: string) => (val: number | null): string => {
  if (val === null) return '—'
  return (val < 0 ? '-' : '') + sym +
    Math.round(Math.abs(val)).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
const usd = money('$', 'en-US')
const aud = money('$', 'en-AU')
const gbp = money('£', 'en-GB')

/* ── state ─────────────────────────────────────────────────────────────── */

type Mode = 'vendor' | 'client'
interface Fields { vendor: string; client: string; conv: string; aud: string; gbp: string; pct: string }
type Tone = 'none' | 'loss' | 'critical' | 'below' | 'on' | 'excellent'
interface Out {
  vendorUSD: string; vendorAUD: string; vendorGBP: string
  clientUSD: string; clientAUD: string; clientGBP: string
  marginINR: string; status: string; tone: Tone; loss: boolean
  hasAUD: boolean; hasGBP: boolean
}
/** The elements that flash when their value changes — the tool's "it just updated" cue. */
type FlashKey = 'vendorUSD' | 'vendorAUD' | 'vendorGBP' | 'clientUSD' | 'clientAUD' | 'clientGBP'
  | 'marginINR' | 'clientInput' | 'pctInput' | 'vendorInput'
type OutKey = 'vendorUSD' | 'vendorAUD' | 'vendorGBP' | 'clientUSD' | 'clientAUD' | 'clientGBP' | 'marginINR'
interface Calc { f: Fields; o: Out; manual: boolean; flash: FlashKey[] }

const INIT_FIELDS: Fields = { vendor: '', client: '', conv: '', aud: SEED_AUD, gbp: SEED_GBP, pct: '' }
const INIT_OUT: Out = {
  vendorUSD: '—', vendorAUD: '—', vendorGBP: '—', clientUSD: '—', clientAUD: '—', clientGBP: '—',
  // The status line starts empty, as in the original, until the first calculation runs.
  marginINR: '—', status: '', tone: 'none', loss: false, hasAUD: true, hasGBP: true,
}

/** Builds the output writer shared by every direction: `put` only flashes on a real change. */
function writer(o: Out, flash: FlashKey[]) {
  const put = (k: OutKey, text: string) => {
    if (o[k] !== text) { o[k] = text; flash.push(k as FlashKey) }
  }
  // One USD figure fans out to every currency the rates allow.
  const fanOut = (
    valUSD: number | null, audRate: number | null, gbpRate: number | null,
    keys: [OutKey, OutKey, OutKey],
  ) => {
    put(keys[0], usd(valUSD))
    if (o.hasAUD) put(keys[1], aud(valUSD !== null && audRate !== null ? valUSD * audRate : null))
    if (o.hasGBP) put(keys[2], gbp(valUSD !== null && gbpRate !== null ? valUSD * gbpRate : null))
  }
  const vendorOutputs = (vINR: number | null, conv: number | null, audRate: number | null, gbpRate: number | null, hasConv: boolean) =>
    fanOut(vINR !== null && hasConv ? vINR / (conv as number) : null, audRate, gbpRate,
      ['vendorUSD', 'vendorAUD', 'vendorGBP'])
  const clientOutputs = (cUSD: number | null, audRate: number | null, gbpRate: number | null) =>
    fanOut(cUSD, audRate, gbpRate, ['clientUSD', 'clientAUD', 'clientGBP'])
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

/** The three exchange rates, read off the fields once per calculation. */
function rates(f: Fields, o: Out) {
  const conv = parseFloat(f.conv)
  const audRate = parseFloat(f.aud)
  const gbpRate = parseFloat(f.gbp)
  o.hasAUD = !isNaN(audRate) && audRate > 0
  o.hasGBP = !isNaN(gbpRate) && gbpRate > 0
  return {
    conv: isNaN(conv) ? null : conv,
    audRate: o.hasAUD ? audRate : null,
    gbpRate: o.hasGBP ? gbpRate : null,
    hasConv: !isNaN(conv) && conv > 0,
  }
}

/**
 * VENDOR-LED. Vendor typed → auto-fill the client at 65% unless the client price was
 * typed by hand, then derive the margin from the client price.
 */
function calcFromLeft(fIn: Fields, oIn: Out, manualIn: boolean, pctFocused: boolean): Calc {
  const f = { ...fIn }, o = { ...oIn }, flash: FlashKey[] = []
  let manual = manualIn
  const { put, vendorOutputs, clientOutputs, marginPanel } = writer(o, flash)

  const vINR = parse(f.vendor)
  const { conv, audRate, gbpRate, hasConv } = rates(f, o)

  vendorOutputs(vINR, conv, audRate, gbpRate, hasConv)

  // Vendor cleared → reset everything.
  if (vINR === null) {
    f.client = ''
    f.pct = ''
    manual = false
    clientOutputs(null, audRate, gbpRate)
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
    cUSDraw = Math.round(cINRauto / (conv as number))
    f.client = String(cUSDraw)
    if (!pctFocused) f.pct = String(targetPct)
    flash.push('clientInput')
  } else {
    const raw = parseFloat(f.client)
    cUSDraw = (!isNaN(raw) && raw > 0) ? raw : null
  }

  const cINRderived = (cUSDraw !== null && hasConv) ? cUSDraw * (conv as number) : null
  clientOutputs(cUSDraw, audRate, gbpRate)

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
    clientOutputs(null, audRate, gbpRate)
    put('marginINR', '—')
    marginPanel(null)
  }
  return { f, o, manual, flash }
}

/** VENDOR-LED, from the margin box. Margin % typed → back-calculate the client price. */
function calcFromRight(fIn: Fields, oIn: Out, manual: boolean): Calc {
  const f = { ...fIn }, o = { ...oIn }, flash: FlashKey[] = []
  const { put, vendorOutputs, clientOutputs, marginPanel } = writer(o, flash)

  const vINR = parse(f.vendor)
  const { conv, audRate, gbpRate, hasConv } = rates(f, o)
  const targetPct = parseVal(f.pct)

  vendorOutputs(vINR, conv, audRate, gbpRate, hasConv)

  if (vINR !== null && targetPct !== null && targetPct < 100 && hasConv) {
    const cINR = vINR / (1 - targetPct / 100)
    const cUSD = Math.round(cINR / (conv as number))
    f.client = String(cUSD)
    flash.push('clientInput')
    clientOutputs(cUSD, audRate, gbpRate)
    put('marginINR', inr(cINR - vINR))
    marginPanel(targetPct)
  } else {
    if (vINR === null) f.client = ''
    clientOutputs(null, audRate, gbpRate)
    put('marginINR', '—')
    marginPanel(targetPct !== null ? targetPct : null)
  }
  return { f, o, manual, flash }
}

/**
 * CLIENT-LED. The client's price and the margin are the given; the vendor cost is the
 * answer — the most the vendor may cost and still leave that margin.
 *
 * Deliberately the same arithmetic as calcFromRight read the other way round, so the two
 * directions can never disagree: client ₹ x (1 - margin) is vendor ₹, and vendor ₹ /
 * (1 - margin) is client ₹.
 */
function calcFromClient(fIn: Fields, oIn: Out, manual: boolean): Calc {
  const f = { ...fIn }, o = { ...oIn }, flash: FlashKey[] = []
  const { put, vendorOutputs, clientOutputs, marginPanel } = writer(o, flash)

  const cUSD = parse(f.client)
  const { conv, audRate, gbpRate, hasConv } = rates(f, o)
  const typedPct = parseVal(f.pct)
  // A blank margin means the house target, and the box says so rather than sitting empty.
  const targetPct = typedPct === null ? DEFAULT_MARGIN : typedPct
  if (typedPct === null) { f.pct = String(DEFAULT_MARGIN); flash.push('pctInput') }

  clientOutputs(cUSD, audRate, gbpRate)

  if (cUSD !== null && hasConv && targetPct < 100) {
    const cINR = cUSD * (conv as number)
    const vINR = cINR * (1 - targetPct / 100)
    const rounded = String(Math.round(vINR))
    if (f.vendor !== rounded) { f.vendor = rounded; flash.push('vendorInput') }
    vendorOutputs(vINR, conv, audRate, gbpRate, hasConv)
    put('marginINR', inr(cINR - vINR))
    marginPanel(targetPct)
  } else {
    // A margin of 100% or more has no vendor cost that satisfies it, so say nothing
    // rather than print a zero that looks like an answer.
    if (f.vendor !== '') { f.vendor = ''; flash.push('vendorInput') }
    vendorOutputs(null, conv, audRate, gbpRate, hasConv)
    put('marginINR', '—')
    marginPanel(cUSD !== null && targetPct >= 100 ? targetPct : null)
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

export default function VendorCalculatorPage() {
  const [mode, setMode] = useState<Mode>('vendor')
  const [f, setF] = useState<Fields>(INIT_FIELDS)
  const [o, setO] = useState<Out>(INIT_OUT)
  const [ph, setPh] = useState({ conv: '—', aud: SEED_AUD, gbp: SEED_GBP })
  const [live, setLive] = useState(false)
  // Whether the client price was typed by hand — decides auto-fill vs keep.
  const manual = useRef(false)
  // Rates the person has edited. The live fetch leaves those alone.
  const touched = useRef<Set<'conv' | 'aud' | 'gbp'>>(new Set())
  // Mirrors for the live-rate fetch, which resolves after the render that started it.
  const fRef = useRef(f); fRef.current = f
  const oRef = useRef(o); oRef.current = o
  const modeRef = useRef(mode); modeRef.current = mode

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

  /** Recalculate in whichever direction is running. */
  const recalc = (next: Fields, m: Mode = mode) =>
    m === 'client' ? calcFromClient(next, o, manual.current)
                   : calcFromLeft(next, o, manual.current, pctFocused())

  const onRate = (k: 'conv' | 'aud' | 'gbp', v: string) => {
    touched.current.add(k)
    apply(recalc({ ...f, [k]: v }))
  }
  const onVendor = (v: string) => apply(calcFromLeft({ ...f, vendor: v }, o, manual.current, pctFocused()))

  // Client typed: in vendor-led this marks the price as manual; cleared (or zero) → back
  // to auto-fill. In client-led it is simply the input.
  const onClient = (v: string) => {
    if (mode === 'client') { apply(calcFromClient({ ...f, client: v }, o, manual.current)); return }
    const raw = parseFloat(v)
    const isManual = !isNaN(raw) && raw > 0
    apply(calcFromLeft({ ...f, client: isManual ? v : '' }, o, isManual, pctFocused()))
  }
  const onPct = (v: string) =>
    apply(mode === 'client'
      ? calcFromClient({ ...f, pct: v }, o, manual.current)
      : calcFromRight({ ...f, pct: v }, o, manual.current))

  // Switching direction keeps the figures and re-reads them the other way, so a quote you
  // were part way through does not vanish.
  const switchMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    manual.current = m === 'client'
    apply(m === 'client'
      ? calcFromClient(f, o, true)
      : calcFromLeft(f, o, true, false))
  }

  // Live rates (open.er-api.com, no key): INR, AUD and GBP in one call. A rate the person
  // has typed is never overwritten; the placeholder always shows the live figure. Failure
  // is silent and the seeded AUD/GBP stand.
  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD')
        const data = await res.json()
        if (gone || !data?.rates?.INR) return
        const got = {
          conv: parseFloat(data.rates.INR).toFixed(2),
          aud: data.rates.AUD ? parseFloat(data.rates.AUD).toFixed(4) : SEED_AUD,
          gbp: data.rates.GBP ? parseFloat(data.rates.GBP).toFixed(4) : SEED_GBP,
        }
        setPh(got)
        const cur = fRef.current
        const next = { ...cur }
        if (!touched.current.has('conv')) next.conv = got.conv
        if (!touched.current.has('aud')) next.aud = got.aud
        if (!touched.current.has('gbp')) next.gbp = got.gbp
        const r = modeRef.current === 'client'
          ? calcFromClient(next, oRef.current, manual.current)
          : calcFromLeft(next, oRef.current, manual.current, pctFocused())
        manual.current = r.manual
        pendingFlash.current.push(...r.flash)
        setF(r.f); setO(r.o)
        setLive(true)
      } catch { /* fall back quietly — the rates can be typed by hand */ }
    })()
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A one-off pricing tool: nothing is saved (Pratik, 28 Sep 2026). Reset clears the
  // figures for the next quote and keeps the exchange rates, which are the same all day.
  const reset = () => {
    manual.current = false
    const blank = { ...INIT_FIELDS, conv: f.conv, aud: f.aud, gbp: f.gbp }
    apply(mode === 'client' ? { f: blank, o: INIT_OUT, manual: false, flash: [] }
                            : calcFromLeft(blank, INIT_OUT, false, false))
  }
  const dirty = f.vendor !== '' || f.client !== '' || f.pct !== ''

  const chip = 'rounded-lg border border-mav-line bg-mav-dark px-3 py-2 text-lg font-bold tabular-nums text-mav-fg'
  const missing = (cur: string) => <p className="text-xs text-mav-muted leading-snug">Add {cur} rate above<br />to see {cur} value</p>
  const panelTone = o.loss ? 'bg-red-500/10 border-red-500/40' : 'bg-green-500/10 border-green-500/40'
  const pctTone = o.loss ? 'text-red-400' : 'text-green-400'
  const clientLed = mode === 'client'

  const rateBox = (k: 'conv' | 'aud' | 'gbp', unit: string, note?: string) => (
    <label className="flex items-center gap-2">
      <span className="text-mav-muted">1 USD =</span>
      <input type="number" min="0" step="any" value={f[k]} placeholder={ph[k]}
        onChange={e => onRate(k, e.target.value)} className={`${field} w-24 tabular-nums`}
        aria-label={`USD to ${unit} rate`} />
      <span className="text-mav-muted">{unit}</span>
      {note && <span className="text-xs text-mav-muted">{note}</span>}
    </label>
  )

  return (
    <div>
      {/* The fade the original tool used to show a value just changed. */}
      <style>{`@keyframes vcflash{0%{opacity:1}30%{opacity:.3}100%{opacity:1}}.vc-flash{animation:vcflash .3s ease}`}</style>

      <Header title="Vendor Calculator"
        subtitle={clientLed
          ? 'The client has named a price. Type it with the margin you need and the vendor cost below is the most you may pay and still hit it. Nothing is saved — Reset clears it for the next quote.'
          : 'Price a vendor quote: type the vendor’s cost in rupees and the client price fills in at a 65% margin. Type your own client price to see the margin it gives, or type a margin % to get the client price that hits it. Nothing is saved — Reset clears it for the next quote.'}
        actions={
          <button type="button" onClick={reset} disabled={!dirty}
            className="rounded-full border border-mav-yellow/50 text-mav-yellow px-4 py-2 text-sm font-semibold hover:bg-mav-yellow/10 disabled:opacity-40 disabled:cursor-not-allowed">
            Reset
          </button>
        } />

      {/* Which end you are starting from. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={label}>Start from</span>
        {([['vendor', 'Vendor cost ₹'], ['client', 'Client price $']] as [Mode, string][]).map(([m, text]) => (
          <button key={m} type="button" onClick={() => switchMode(m)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              mode === m ? 'bg-mav-yellow text-black border-mav-yellow font-medium'
                         : 'border-mav-line text-mav-muted hover:text-mav-fg'}`}>
            {text}
          </button>
        ))}
      </div>

      {/* Rates */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 text-sm">
        <span className="flex items-center gap-2">
          {rateBox('conv', 'INR')}
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-green-400"
              title={`Live: 1 USD = ${ph.conv} INR, ${ph.aud} AUD, ${ph.gbp} GBP`}>
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
            </span>
          )}
        </span>
        {rateBox('aud', 'AUD', '(optional)')}
        {rateBox('gbp', 'GBP', '(optional)')}
      </div>

      {/* Calculator: Cost | Vendor | Client | Margin */}
      <section className="bg-mav-panel border border-mav-line rounded-xl overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-2">
        {/* Cost */}
        <div className="p-4 border-mav-line">
          <div className={`${label} mb-3`}>Cost</div>
          <div className="space-y-3">
            {/* In client-led the vendor box is the ANSWER, so it is read-only and says so
                — a figure you may type and a figure the tool worked out should never look
                the same. */}
            <label className="block">
              <span className="block text-xs font-semibold text-mav-fg mb-1">
                Vendor Cost {clientLed && <span className="text-mav-yellow font-normal">— most you may pay</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-mav-muted w-3">₹</span>
                <input ref={reg('vendorInput')} type="number" min="0" step="any" value={f.vendor}
                  placeholder={clientLed ? '—' : 'e.g. 112,000'} aria-label="Vendor cost in INR"
                  readOnly={clientLed} onChange={e => onVendor(e.target.value)}
                  className={`${field} w-full text-base tabular-nums ${
                    clientLed ? 'bg-mav-dark border-mav-yellow/40 text-mav-yellow font-bold cursor-default' : ''}`} />
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-mav-fg mb-1">Client Cost</span>
              <span className="flex items-center gap-2">
                <span className="text-mav-muted w-3">$</span>
                <input ref={reg('clientInput')} type="number" min="0" step="any" value={f.client}
                  placeholder="e.g. 3,200" aria-label="Client cost in USD"
                  onChange={e => onClient(e.target.value)}
                  className={`${field} w-full text-base tabular-nums ${
                    clientLed ? 'border-mav-yellow/40' : ''}`} />
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
            ) : missing('AUD')}
            {o.hasGBP ? (
              <div>
                <div className="text-[11px] font-semibold text-mav-muted mb-1">GBP</div>
                <div ref={reg('vendorGBP')} className={chip}>{o.vendorGBP}</div>
              </div>
            ) : missing('GBP')}
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
            ) : missing('AUD')}
            {o.hasGBP ? (
              <div>
                <div className="text-[11px] font-semibold text-mav-muted mb-1">GBP</div>
                <div ref={reg('clientGBP')} className={chip}>{o.clientGBP}</div>
              </div>
            ) : missing('GBP')}
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
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        {clientLed
          ? 'Live — the vendor ceiling updates instantly as you type'
          : 'Live — values update instantly as you type'}
      </p>

    </div>
  )
}
