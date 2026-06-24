import { createClient } from '@supabase/supabase-js'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const supabase = url && anon ? createClient(url, anon, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
}) : null
export const isLive = !!supabase

export interface Client {
  company_name: string; client_type?: string; industry?: string; geo?: string
  pc_sme?: string; sales_person?: string; ltv_usd?: number; sentiment?: string
  rag_status?: string; client_status?: string; email?: string
  journey?: string; action_steps?: string; last_booking_month?: string
}
export interface Opportunity {
  id: number; company_name?: string; is_new_client?: boolean; rfq?: boolean
  rfq_status?: string; geo?: string; sales_person?: string; source_subject?: string
  source_date?: string; summary?: string
}
export interface RevenueRow { client_name: string; month: string; amount_usd: number }
export interface BookingRow { id: number; company_name?: string; booking_month?: string; booking_date?: string; booking_amount?: number; service_name?: string; geo?: string; sales_person?: string; contact_email?: string }
export interface Feedback { id: number; agency?: string; nature?: string; comments?: string; added_date?: string; project_names?: string; geo?: string; feedback_type?: string }
export interface EmailSignal { id: number; company_name?: string; client_email?: string; signal_type?: string; sentiment?: string; summary?: string; source_subject?: string; source_date?: string }

async function read<T>(table: string, cols = '*'): Promise<T[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from(table).select(cols).limit(10000)
  if (error || !data) return null
  return data as T[]
}

export async function getClients(): Promise<Client[]> {
  const live = await read<Client>('web_clients')
  return live && live.length ? live : (await import('./mockData')).mockClients
}
const isOpenQuote = (s?: string) => {
  const v = (s || '').trim().toLowerCase()
  return v !== '' && v !== 'confirmed' && v !== 'cancelled'
}
export async function getOpportunities(): Promise<Opportunity[]> {
  // Opportunities = email-sourced rows + open/pending rows from the Quotes tab.
  const emailOpps = (await read<Opportunity>('opportunities')) || []
  const quotes = (await read<any>('quotes',
    'id, quote_id, subject_project, technology, added_date, agency, usd_value, status, business_type, geo, sales_person')) || []
  const quoteOpps: Opportunity[] = quotes.filter(q => isOpenQuote(q.status)).map(q => ({
    id: 1000000 + (q.id || 0),
    company_name: q.agency,
    is_new_client: /new/i.test(q.business_type || ''),
    rfq: true,
    rfq_status: /shared|approval/i.test(q.status || '') ? 'quoted' : 'pending',
    geo: q.geo,
    sales_person: q.sales_person,
    source_subject: q.subject_project || q.technology || q.quote_id,
    source_date: q.added_date,
    summary: `Quote: ${q.status}${q.usd_value ? ' \u00b7 $' + Math.round(q.usd_value).toLocaleString() : ''}`,
  }))
  const all = [...emailOpps, ...quoteOpps]
  return all.length ? all : (await import('./mockData')).mockOpportunities
}
export async function getRevenue(): Promise<RevenueRow[]> {
  const live = await read<{ company_name: string; booking_month: string; booking_amount: number }>('web_revenue',
    'company_name, booking_month, booking_amount')
  if (live && live.length) return live.map(b => ({ client_name: b.company_name, month: b.booking_month, amount_usd: b.booking_amount }))
  return (await import('./mockData')).mockRevenue
}
export async function getBookingsFull(): Promise<BookingRow[]> { return (await read<BookingRow>('web_revenue', 'id, company_name, booking_month, booking_date, booking_amount, service_name, geo, sales_person, contact_email')) || [] }
export async function getFeedback(): Promise<Feedback[]> { return (await read<Feedback>('feedback', 'id, agency, nature, comments, added_date, project_names, geo, feedback_type')) || [] }
export async function getEmailSignals(): Promise<EmailSignal[]> { return (await read<EmailSignal>('email_signals', 'id, company_name, client_email, signal_type, sentiment, summary, source_subject, source_date')) || [] }

export interface Quote { id: number; quote_id?: string; added_date?: string; agency?: string; usd_value?: number; status?: string; business_type?: string; geo?: string; sales_person?: string; confirmed_in_days?: number; technology?: string; client_email?: string }
export interface QuoteConversion { id: number; company_name?: string; outcome?: string; lost_reason?: string; amount_usd?: number; decided_at?: string }
export interface SqlLead { id: number; month?: string; year?: number; venture?: string; industry?: string; persona?: string; company_name?: string; prospect_region?: string; assigned_to?: string; lead_date?: string }
export interface Escalation { id: number; company_name?: string; geo?: string; situation_type?: string; escalation_type?: string; business_impact?: string; month?: string; email_subject?: string; tracking_date?: string; project_name?: string }

export async function getQuotes(): Promise<Quote[]> { const l = await read<Quote>('quotes'); return l && l.length ? l : (await import('./mockData')).mockQuotes }
export async function getConversions(): Promise<QuoteConversion[]> { const l = await read<QuoteConversion>('quote_conversions'); return l && l.length ? l : (await import('./mockData')).mockConversions }
export async function getSqlLeads(): Promise<SqlLead[]> { const l = await read<SqlLead>('sql_leads'); return l && l.length ? l : (await import('./mockData')).mockSqlLeads }
export async function getEscalations(): Promise<Escalation[]> { const l = await read<Escalation>('escalations'); return l && l.length ? l : (await import('./mockData')).mockEscalations }
