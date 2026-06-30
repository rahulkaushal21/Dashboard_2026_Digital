// sheet-ingest — receives sheet tab rows pushed by the Google Apps Script and
// upserts them into Supabase. No "publish to web" needed: the Apps Script reads
// the PRIVATE sheet (authenticated as the owner) and POSTs the raw rows here.
//
// Body: { tab: 'quotes'|'sql'|'esc'|'feedback', rows: string[][] }  (rows[0] = header)
// Safety: an empty/garbled payload NEVER wipes a table — the table is only
// replaced when the push contains real rows.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "ingestWebHub_a7c2e9";
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function h(s: string): string { let x = 5381; for (let i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); x = x >>> 0; } return x.toString(16); }
function num(s: string | undefined): number | null { if (!s) return null; const v = parseFloat(String(s).replace(/[$,\s]/g, "")); return isNaN(v) ? null : v; }
function intval(s: string | undefined): number | null { if (!s) return null; const v = parseInt(String(s).replace(/[^0-9-]/g, ""), 10); return isNaN(v) ? null : v; }
function pdate(s: string | undefined): string | null { if (!s) return null; s = String(s).trim(); let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${String(m[1]).padStart(2, "0")}`; } m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; return null; }
function pmonth(s: string | undefined): string | null { if (!s) return null; const m = String(s).trim().match(/^([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})$/); if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) { let y = m[2]; if (y.length === 2) y = "20" + y; return `${y}-${mo}-01`; } } return null; }

// Turn a 2-D array (header row + data rows) into objects keyed by trimmed header.
function toObjects(rows: string[][]): Record<string, string>[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((x) => (x ?? "").toString().trim());
  return rows.slice(1).map((r) => { const o: Record<string, string> = {}; headers.forEach((hh, i) => { o[hh] = (r[i] ?? "").toString().trim(); }); return o; });
}

const TABLE: Record<string, string> = { quotes: "quotes", sql: "sql_leads", esc: "escalations", feedback: "feedback" };
const KEEP: Record<string, (r: Record<string, string>) => boolean> = {
  quotes: (r) => !!(r["Added Date"] || r["Agency"] || r["Client Email"] || r["Status"] || r["Estimated Cost"]),
  sql: (r) => !!(r["Email Address"] || r["Company Name"] || r["Date"]),
  esc: (r) => !!(r["Name"] || r["Company Name"] || r["Tracking Date"]),
  feedback: (r) => !!(r["Added Date"] || r["Agency"] || r["Client Email"] || r["Comments"]),
};
const MAP: Record<string, (r: Record<string, string>, i: number) => Record<string, unknown>> = {
  quotes: (r, i) => ({
    quote_id: r["Quote ID"] || null, added_date: pdate(r["Added Date"]), service_dept: r["Service Department"] || null, technology: r["Technology"] || null,
    subject_project: r["Email Subject Line / Project Name"] || null, agency: r["Agency"] || null, client_email: r["Client Email"] || null, pc_sme: r["PC/SME"] || null,
    project_type: r["Project Type"] || null, currency_type: r["Currency Type"] || null, estimated_cost: num(r["Estimated Cost"]), usd_value: num(r["USD Conversion"]),
    status: r["Status"] || null, notes: r["Notes"] || null, geo: r["GEO"] || null, business_type: r["Business Type"] || null, sales_person: r["Account/Sales Person"] || null,
    confirmed_in_days: intval(r["Confirmed in Days"]), src_row_hash: "Q:" + h(JSON.stringify(r)) + ":" + i,
  }),
  sql: (r, i) => ({
    month: r["Month"] || null, year: intval(r["Year"]), venture: r["Venture"] || null, lead_date: pdate(r["Date"]), email_address: r["Email Address"] || null,
    industry: r["Industry"] || null, persona: r["Persona"] || null, prospect_city: r["Prospect City"] || null, prospect_region: r["Prospect Region"] || null,
    assigned_to: r["Assigned to"] || null, company_name: r["Company Name"] || null, employees: r["No of Employees"] || null, query_about: r["Querry About"] || null,
    services_bifurcation: r["Services Bifurcations for a sales team"] || null, esp: r["ESP"] || null, comment: r["Comment"] || null, src_row_hash: "SQL:" + h(JSON.stringify(r)) + ":" + i,
  }),
  esc: (r, i) => ({
    raised_by: r["Name"] || null, tracking_date: pdate(r["Tracking Date"]), month: r["Month"] || null, week: r["Week"] || null, service_type: r["Uplers Service Type"] || null,
    company_name: r["Company Name"] || null, geo: r["Geo"] || null, deal_type: r["Deal Type/Client Category/Service Type"] || null, email_subject: r["Email Subject Line"] || null,
    link: r["HubSpot Link/Chat Link"] || null, project_name: r["Project Name"] || null, reference_id: r["Project / Reference ID"] || null,
    situation_type: r["Type of Situation"] || null, source: r["Source"] || null, escalation_type: r["Escalation Type"] || null, business_impact: r["Business Impact"] || null,
    src_row_hash: "ESC:" + h(JSON.stringify(r)) + ":" + i,
  }),
  feedback: (r, i) => ({
    added_date: pdate(r["Added Date"]), service_dept: r["Service Department"] || null, pc_sme: r["PC/SME"] || null, feedback_type: r["Feedback Type"] || null,
    visibility: r["Feedback Visibility"] || null, nature: r["Nature"] || null, agency: r["Agency"] || null, geo: r["GEO"] || null, client_email: r["Client Email"] || null,
    project_names: r["Project Names"] || null, comments: r["Comments"] || null, month_year: pmonth(r["Month year"]), evidence: r["Proof/Screenshot"] || null,
    src_row_hash: "FB:" + h(JSON.stringify(r)) + ":" + i,
  }),
};

async function insertBatches(sb: any, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from(table).insert(rows.slice(i, i + 500)); if (error) throw new Error(table + ": " + error.message); }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json();
    const tab = String(body?.tab || "");
    if (!MAP[tab]) return new Response(JSON.stringify({ ok: false, error: "unknown tab: " + tab }), { status: 400, headers: { "Content-Type": "application/json" } });
    const objs = toObjects(body?.rows || []).filter(KEEP[tab]);
    const mapped = objs.map(MAP[tab]);
    // Guard: never let an empty/garbled push delete a populated table.
    if (mapped.length === 0) {
      await sb.from("sync_runs").insert({ source: tab + "-appscript", ok: false, rows_upserted: 0, message: "empty payload — table preserved" });
      return new Response(JSON.stringify({ ok: false, tab, inserted: 0, note: "empty payload, table left unchanged" }), { headers: { "Content-Type": "application/json" } });
    }
    const table = TABLE[tab];
    await sb.from(table).delete().not("src_row_hash", "is", null);
    await insertBatches(sb, table, mapped);
    await sb.from("sync_runs").insert({ source: tab + "-appscript", ok: true, rows_upserted: mapped.length, message: "app script push" });
    // Refresh derived clients + sentiment after escalations/feedback change.
    if (tab === "esc" || tab === "feedback") { await sb.rpc("rebuild_clients").catch(() => {}); await sb.rpc("compute_client_sentiment").catch(() => {}); }
    return new Response(JSON.stringify({ ok: true, tab, inserted: mapped.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "sheet-ingest", ok: false, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
