import type { Client, Opportunity, RevenueRow } from './supabase'
export const mockClients: Client[] = [
  { company_name: 'HexaGroup', client_type: 'Agency', industry: 'Energy', geo: 'US/Canada', pc_sme: 'Gagandeep Singh', sales_person: 'Tanuj Gupta', ltv_usd: 182000, sentiment: 'Positive', rag_status: 'Green', client_status: 'active' },
  { company_name: 'Milk Digital', client_type: 'Agency', industry: 'Healthcare', geo: 'AU/NZ', pc_sme: 'Pritpal Singh', sales_person: 'Kalgi Shah', ltv_usd: 96000, sentiment: 'Positive', rag_status: 'Green', client_status: 'active' },
  { company_name: 'AVASO Technologies', client_type: 'Enterprise', industry: 'IT Services', geo: 'India', pc_sme: 'Devanshu Kumar', sales_person: 'Devanshu Kumar', ltv_usd: 41000, sentiment: 'Neutral', rag_status: 'Amber', client_status: 'active' },
  { company_name: 'Compass', client_type: 'Direct/End', industry: 'Real Estate', geo: 'US', pc_sme: 'Sourya Ghosh', sales_person: 'Tanuj Gupta', ltv_usd: 22000, sentiment: 'Negative', rag_status: 'Red', client_status: 'on-notice' },
  { company_name: 'Vericast', client_type: 'Direct/End', industry: 'Marketing', geo: 'US', pc_sme: 'Nitin Mishra', sales_person: 'Tanuj Gupta', ltv_usd: 134000, sentiment: 'Positive', rag_status: 'Green', client_status: 'active' },
]
export const mockOpportunities: Opportunity[] = [
  { id: 1, company_name: 'Live Dubai Real Estate', is_new_client: true, rfq: true, rfq_status: 'pending', geo: 'Others', sales_person: 'Devanshu Kumar', source_subject: 'Website design + UX enquiry', source_date: '2026-06-03', summary: 'New inbound, awaiting scope' },
  { id: 2, company_name: 'AVASO Technologies', is_new_client: false, rfq: true, rfq_status: 'quoted', geo: 'India', sales_person: 'Devanshu Kumar', source_subject: 'Global website revamp', source_date: '2026-06-09', summary: 'Enterprise revamp, quote shared' },
  { id: 3, company_name: 'Southern Cross Wealth', is_new_client: true, rfq: true, rfq_status: 'received', geo: 'AUS', sales_person: 'Aman Acharya', source_subject: 'Mortgage broker site', source_date: '2026-06-05', summary: 'Quote requested' },
]
const months = ['2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-06-01']
export const mockRevenue: RevenueRow[] = months.flatMap((m, i) =>
  mockClients.map(c => ({ client_name: c.company_name, month: m, amount_usd: Math.round((c.ltv_usd! / 12) * (0.8 + i * 0.05)) }))
)
import type { Quote, QuoteConversion, SqlLead, Escalation } from './supabase'
export const mockQuotes: Quote[] = [
  { id:1, quote_id:'QUT0407', added_date:'2026-06-02', agency:'kal.agency', usd_value:1400, status:'Waiting for Final Approval', business_type:'New', geo:'US/Canada', sales_person:'Ayush Rathi', confirmed_in_days:0, technology:'Wordpress' },
  { id:2, quote_id:'QUT0415', added_date:'2026-06-04', agency:'StayinFront', usd_value:3200, status:'Quote Shared', business_type:'New', geo:'UK/EU', sales_person:'Devanshu Kumar', confirmed_in_days:0, technology:'Wordpress' },
  { id:3, quote_id:'QUT0403', added_date:'2026-06-06', agency:'Raare Solutions', usd_value:399, status:'Cancelled', business_type:'Repeat', geo:'US/Canada', sales_person:'Sourya Ghosh', confirmed_in_days:0, technology:'LP' },
  { id:4, quote_id:'QUT0510', added_date:'2026-06-10', agency:'HexaGroup', usd_value:2100, status:'Confirmed', business_type:'Repeat', geo:'US/Canada', sales_person:'Tanuj Gupta', confirmed_in_days:6, technology:'Hubspot' },
]
export const mockConversions: QuoteConversion[] = [
  { id:1, company_name:'HexaGroup', outcome:'won', amount_usd:2100, decided_at:'2026-06-16' },
  { id:2, company_name:'StayinFront', outcome:'lost', lost_reason:'Client chose in-house team', amount_usd:3200, decided_at:'2026-06-18' },
  { id:3, company_name:'Raare Solutions', outcome:'lost', lost_reason:'Client not responding', amount_usd:399, decided_at:'2026-06-12' },
]
export const mockSqlLeads: SqlLead[] = [
  { id:1, month:'June', year:2026, venture:'Mavlers', industry:'Real Estate', persona:'No Job title', company_name:'Live Dubai', prospect_region:'Generic', assigned_to:'Devanshu Kumar' },
  { id:2, month:'June', year:2026, venture:'Uplers', industry:'Digital Agency', persona:'Founder', company_name:'Spark Quest AI', prospect_region:'AUS', assigned_to:'Aman Acharya' },
  { id:3, month:'June', year:2026, venture:'Mavlers Agency', industry:'Finance', persona:'Managing Director', company_name:'Southern Cross', prospect_region:'AUS', assigned_to:'Aman Acharya' },
  { id:4, month:'June', year:2026, venture:'Mavlers Agency', industry:'IT Services', persona:'Marketing', company_name:'AVASO', prospect_region:'India', assigned_to:'Devanshu Kumar' },
  { id:5, month:'June', year:2026, venture:'Mavlers', industry:'Real Estate', persona:'Marketer', company_name:'Sydney AV', prospect_region:'AUS', assigned_to:'Aman Acharya' },
]
export const mockEscalations: Escalation[] = [
  { id:1, company_name:'Chief Executives Org', geo:'US/Canada', situation_type:'Functional', escalation_type:'Major', business_impact:'Medium', month:'June', email_subject:'Re: LP: Ski Courchevel' },
  { id:2, company_name:'QBFoxhc', geo:'UK', situation_type:'Technical', escalation_type:'Major', business_impact:'Low', month:'June', email_subject:'Re: Project delivery - Banner' },
  { id:3, company_name:'Connelly Partners', geo:'US/Canada', situation_type:'Functional', escalation_type:'Major', business_impact:'High', month:'June', email_subject:'Mavlers Feedback' },
]
