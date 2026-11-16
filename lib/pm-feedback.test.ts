// Run with: npx -y tsx lib/pm-feedback.test.ts
//
// The Feedback KPI, and the three ways praise went missing from it.
//
// Every case here is a real row that showed on the Delights page with a PM's name
// against it and scored that PM nothing. Rahul, 16 Nov 2026: "why malay numbers is
// still 0 in last quarter all, it should be 2". It was two, and they were lost twice
// over — one to a free-text signal type, one to a client name with a bracket in it.

import assert from 'node:assert/strict'
import { buildPmStats, isPraise, ownerKeys } from './pm-metrics'
import type { BookingRow, EmailSignal, ManualFeedback, Opportunity, PmFeedbackRow, Quote } from './supabase'

// Malay owns Underdog Digital on both sources — and is spelled differently on each.
const BOOKINGS: BookingRow[] = [
  { company_name: 'Underdog Digital', sme: 'Malay Srivastava', booking_month: '2026-08-01', booking_amount: 1050 },
  { company_name: 'Underdog Digital', sme: 'Malay Srivastava', booking_month: '2026-05-01', booking_amount: 2400 },
  { company_name: 'Underdog Digital', sme: 'Nitin Mishra', booking_month: '2026-03-01', booking_amount: 5600 },
] as BookingRow[]
const QUOTES: Quote[] = [
  { id: 1, agency: 'Underdog Digital', pc_sme: 'Malay Shrivastava' },
  { id: 2, agency: 'Underdog Digital', pc_sme: 'Malay Shrivastava' },
] as Quote[]

const sig = (p: Partial<EmailSignal>): EmailSignal =>
  ({ id: Math.floor(Math.random() * 1e6), sentiment: 'Positive', ...p } as EmailSignal)

// Q2 FY2026 is Jul–Sep 2026, the quarter Rahul was looking at.
const Q2 = { fy: 2026, q: 2 }
const TODAY = new Date('2026-11-16T00:00:00Z')

const malayQ2 = (signals: EmailSignal[], manual: ManualFeedback[] = []) =>
  buildPmStats(BOOKINGS, [] as Opportunity[], QUOTES, [] as PmFeedbackRow[], signals, TODAY, undefined, manual)
    .get('malay-shrivastava')!.quarter(Q2)

const tests: [string, () => void][] = [

  // ── isPraise: the scan writes a label, not one of five fixed strings ────────────
  ['the five original types still count', () => {
    for (const t of ['praise', 'feedback', 'positive_feedback', 'delight', 'testimonial'])
      assert.equal(isPraise(sig({ signal_type: t })), true, t)
  }],

  ['THE UNDERDOG ROW: a free-text praise label counts', () => {
    assert.equal(isPraise(sig({ signal_type: 'praise — recovered account' })), true)
    assert.equal(isPraise(sig({ signal_type: 'Project praise' })), true)
  }],

  ['capitalisation is not a category', () => {
    assert.equal(isPraise(sig({ signal_type: 'Praise' })), true)
    assert.equal(isPraise(sig({ signal_type: 'Feedback' })), true)
  }],

  ['a pipeline note is still not praise, however positive', () => {
    for (const t of ['upsell', 'Expansion', 'sales', 'commercial', 'new business', 'referral'])
      assert.equal(isPraise(sig({ signal_type: t })), false, t)
  }],

  ['a type that mentions both is read as pipeline', () => {
    // "positive feedback on the quote" is the client liking a price, not the work.
    assert.equal(isPraise(sig({ signal_type: 'feedback on quote' })), false)
  }],

  ['sentiment still has to be positive', () => {
    assert.equal(isPraise(sig({ signal_type: 'praise', sentiment: 'Negative' })), false)
    assert.equal(isPraise(sig({ signal_type: 'praise', sentiment: undefined })), false)
  }],

  // ── ownerKeys: the scan names the thread, which carries a bracket ───────────────
  ['THE BRACKET: both sides of "Agency (End client)" are tried', () => {
    assert.deepEqual(ownerKeys('Underdog Digital (PAH)'), ['underdogdigitalpah', 'underdogdigital', 'pah'])
  }],

  ['a plain name yields exactly one key', () => {
    assert.deepEqual(ownerKeys('Underdog Digital'), ['underdogdigital'])
  }],

  ['punctuation and spacing are not identity', () => {
    assert.deepEqual(ownerKeys('ZULU 8'), ownerKeys('Zulu8'))
    assert.deepEqual(ownerKeys('Cazenove+Loyd'), ['cazenoveloyd'])
  }],

  ['nothing in, nothing out', () => {
    assert.deepEqual(ownerKeys(undefined), [])
    assert.deepEqual(ownerKeys('   '), [])
  }],

  // ── The two rows that should have been Malay's ─────────────────────────────────
  ['THE ANSWER: Malay scores 2 in Q2, not 0', () => {
    const q = malayQ2([
      sig({ company_name: 'Underdog Digital (PAH)', signal_type: 'praise', source_date: '2026-07-02' }),
      sig({ company_name: 'Underdog Digital', signal_type: 'praise — recovered account', source_date: '2026-09-16' }),
    ])
    assert.equal(q.feedback, 2)
    assert.equal(q.feedbackFromEmail, 2)
  }],

  ['each of the two fails on its own account', () => {
    // The bracket one would be lost to attribution even with the type fixed…
    assert.equal(malayQ2([sig({ company_name: 'Underdog Digital (PAH)', signal_type: 'praise', source_date: '2026-07-02' })]).feedback, 1)
    // …and the free-text one to the type even with the name plain.
    assert.equal(malayQ2([sig({ company_name: 'Underdog Digital', signal_type: 'praise — recovered account', source_date: '2026-09-16' })]).feedback, 1)
  }],

  ['a spelling split must not hand the client to a co-owner', () => {
    // Malay: 2 quotes as "Shrivastava" + 2 bookings as "Srivastava". Nitin: 1 booking.
    // Counted as three separate people, Malay's four votes become 2 and 2 — still ahead
    // here, but the tie this creates is how a client ends up on the wrong scorecard.
    const q = malayQ2([sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-08-01' })])
    assert.equal(q.feedback, 1, 'credited to Malay, not split away to Nitin')
  }],

  // ── The quarter window itself ──────────────────────────────────────────────────
  ['praise outside the quarter does not count', () => {
    const q = malayQ2([
      sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-06-30' }), // Q1
      sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-10-01' }), // Q3
    ])
    assert.equal(q.feedback, 0, 'Jul–Sep and nothing else')
  }],

  ['the quarter edges are inclusive at both ends', () => {
    const q = malayQ2([
      sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-07-01' }),
      sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-09-30' }),
    ])
    assert.equal(q.feedback, 2)
  }],

  // ── Manual feedback ────────────────────────────────────────────────────────────
  ['APPROVED hand-added praise reaches the scorecard', () => {
    const m = {
      id: 11, company_name: 'Underdog Digital', quote: 'A small tear…', channel: 'Other',
      happened_on: '2026-08-14', status: 'approved', submitted_by: 'x', submitted_at: '',
    } as ManualFeedback
    const q = malayQ2([], [m])
    assert.equal(q.feedback, 1)
    assert.equal(q.feedbackFromManual, 1)
  }],

  ['pending and rejected rows do not', () => {
    const base = {
      id: 12, company_name: 'Underdog Digital', quote: 'x', channel: 'Slack',
      happened_on: '2026-08-14', submitted_by: 'x', submitted_at: '',
    }
    for (const status of ['pending', 'rejected'] as const)
      assert.equal(malayQ2([], [{ ...base, status } as ManualFeedback]).feedback, 0, status)
  }],

  ['a manual row is placed by the day it HAPPENED', () => {
    // happened_on is the whole point of the table: it is the only source that records
    // when the client said it rather than when somebody got round to typing it up.
    const m = {
      id: 13, company_name: 'Underdog Digital', quote: 'x', channel: 'Call',
      happened_on: '2026-10-23', status: 'approved', submitted_by: 'x', submitted_at: '',
    } as ManualFeedback
    assert.equal(malayQ2([], [m]).feedback, 0, 'October is Q3, not Q2')
  }],

  ['the three sources add up and are reported separately', () => {
    const q = malayQ2(
      [sig({ company_name: 'Underdog Digital', signal_type: 'praise', source_date: '2026-08-01' })],
      [{ id: 14, company_name: 'Underdog Digital', quote: 'x', channel: 'Call',
         happened_on: '2026-08-02', status: 'approved', submitted_by: 'x', submitted_at: '' } as ManualFeedback])
    assert.equal(q.feedbackFromEmail, 1)
    assert.equal(q.feedbackFromManual, 1)
    assert.equal(q.feedbackFromSheet, 0)
    assert.equal(q.feedback, 2)
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ok   ${name}`) }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`) }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\n${tests.length} passed`)
process.exit(failed ? 1 : 0)
