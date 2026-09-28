'use client'
import { useEffect, useMemo, useState } from 'react'
import { useUnit } from '@/components/BusinessUnitProvider'
import { inUnit, unitOf } from '@/lib/business-unit'
import {
  getBookingsFull, getOpportunities, getOpportunityDepts, getQuotes, getPmFeedback, getEmailSignals,
  getClientOwners, getClientDepts, clientKey,
  type BookingRow, type Opportunity, type Quote, type PmFeedbackRow, type EmailSignal,
} from '@/lib/supabase'
import { buildPmStats } from '@/lib/pm-metrics'

/**
 * Everything a scorecard is computed from, already scoped to the department switch.
 *
 * Shared by the team grid and the one-PM page so the two can never disagree about which
 * rows count. Bookings carry their department on the line; opportunities are placed by
 * opportunity_dept_mv. Quotes, feedback and email signals carry no department at all, so
 * they are placed by their CLIENT's department — the same derivation Delights and
 * Critical Escalations use. Before this the grid filtered bookings and email deals but
 * not the Quotes tab or feedback, so one Total mixed a filtered Growth with an unfiltered
 * Q2C and Feedback.
 */
export function usePmData() {
  const { unit } = useUnit()
  const [bookingsAll, setBookings] = useState<BookingRow[]>([])
  const [oppsAll, setOpps] = useState<Opportunity[]>([])
  const [oppDepts, setOppDepts] = useState<Map<number, string>>(new Map())
  const [quotesAll, setQuotes] = useState<Quote[]>([])
  const [fbAll, setFb] = useState<PmFeedbackRow[]>([])
  const [sigsAll, setSigs] = useState<EmailSignal[]>([])
  const [clientDepts, setClientDepts] = useState<Map<string, string>>(new Map())
  // Who owns each client. Feedback is credited to the client's owner rather than to
  // whoever typed the row up, so a shared account lands on the right scorecard.
  const [owners, setOwners] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getBookingsFull(), getOpportunities(), getQuotes(), getPmFeedback(), getEmailSignals(), getClientOwners(), getOpportunityDepts()])
      .then(([b, o, qs, f, sg, ow, od]) => { setBookings(b); setOpps(o); setQuotes(qs); setFb(f); setSigs(sg); setOwners(ow); setOppDepts(od) })
      .finally(() => setLoading(false))
    // Separate so a slow client-context read never holds the scorecard back.
    getClientDepts().then(setClientDepts).catch(() => {})
  }, [])

  const deptOfClient = useMemo(() => (name?: string) => clientDepts.get(clientKey(name)), [clientDepts])
  const bookings = useMemo(() => bookingsAll.filter(b => inUnit(b.service_name, unit)), [bookingsAll, unit])
  const opps = useMemo(() => oppsAll.filter(o => inUnit(oppDepts.get(Number(o.id)), unit)), [oppsAll, oppDepts, unit])
  const quotes = useMemo(() => quotesAll.filter(q => inUnit(deptOfClient(q.agency), unit)), [quotesAll, deptOfClient, unit])
  const fb = useMemo(() => fbAll.filter(f => inUnit(deptOfClient(f.agency), unit)), [fbAll, deptOfClient, unit])
  const sigs = useMemo(() => sigsAll.filter(s => inUnit(deptOfClient(s.company_name), unit)), [sigsAll, deptOfClient, unit])

  // Rows that could not be placed in either unit, stated on the page rather than hidden.
  const unplaced = useMemo(() => {
    if (unit === 'all') return 0
    return quotesAll.filter(q => unitOf(deptOfClient(q.agency)) === null).length
      + fbAll.filter(f => unitOf(deptOfClient(f.agency)) === null).length
  }, [quotesAll, fbAll, deptOfClient, unit])

  const stats = useMemo(() => buildPmStats(bookings, opps, quotes, fb, sigs, undefined, owners), [bookings, opps, quotes, fb, sigs, owners])
  return { stats, loading, unplaced, unit }
}
