// sheet-ingest — receives sheet tab rows pushed by the Google Apps Script and
// upserts them into Supabase. No "publish to web" needed: the Apps Script reads
// the PRIVATE sheet (authenticated as the owner) and POSTs the raw rows here.
//
// Body: { tab: 'quotes'|'sql'|'esc'|'feedback', rows: string[][] }  (rows[0] = header)
// Safety: an empty/garbled payload NEVER wipes a table — the table is only
// replaced when the push contains real rows.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "ingestWebHub_a7c2e9";
// Tabs of the OLD spreadsheet whose pushes are refused — see the 410 below.
const FROZEN_TABS = new Set(["quotes", "feedback"]);
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function h(s: string): string { let x = 5381; for (let i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); x = x >>> 0; } return x.toString(16); }
function num(s: string | undefined): number | null { if (!s) return null; const v = parseFloat(String(s).replace(/[$,\s]/g, "")); return isNaN(v) ? null : v; }
function intval(s: string | undefined): number | null { if (!s) return null; const v = parseInt(String(s).replace(/[^0-9-]/g, ""), 10); return isNaN(v) ? null : v; }
function pdate(s: string | undefined): string | null { if (!s) return null; s = String(s).trim(); let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${String(m[1]).padStart(2, "0")}`; } m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; return null; }
function pmonth(s: string | undefined): string | null { if (!s) return null; const m = String(s).trim().match(/^([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})$/); if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) { let y = m[2]; if (y.length === 2) y = "20" + y; return `${y}-${mo}-01`; } } return null; }

// Turn a 2-D array (header row + data rows) into objects keyed by trimmed header.
// Each row is returned with its TRUE sheet position, captured here before any
// filtering: +1 for the header row, +1 because spreadsheets are 1-based. The row
// object itself is left pristine, because src_row_hash hashes JSON.stringify(r)
// and quote_key derives 'r:N' from that hash — adding a field would re-key every
// quote that has no Quote ID and orphan its opportunity.
function toObjects(rows: string[][]): { r: Record<string, string>; sheetRow: number }[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((x) => (x ?? "").toString().trim());
  return rows.slice(1).map((row, j) => {
    const o: Record<string, string> = {};
    headers.forEach((hh, i) => { o[hh] = (row[i] ?? "").toString().trim(); });
    return { r: o, sheetRow: j + 2 };
  });
}

// Some escalation sheet rows carry an extra leading "Business Unit" column
// (values "Digital BU" / "MarTech"). When present it shifts EVERY field one to
// the left: company_name holds the BU, the real company lands in geo, geo lands
// in deal_type, the category lands in email_subject, and the real subject lands
// in link. Detect that signature and realign so the dashboard stays correct on
// every sync (the table is fully re-inserted each push, so a one-off DB patch
// would just get wiped — this fix has to live at ingest).
const ESC_GEO_NORM: Record<string, string> = { "us/canada": "US / Canada", "us / canada": "US / Canada", "anz": "ANZ", "uk": "UK", "generic": "Generic" };
function escCompanyCanon(name: string): string {
  const s = (name || "").toLowerCase();
  if (s.includes("hummingbird")) return "Hummingbird Ideas";
  if (s.startsWith("cazenove") || s.includes("cazloyd")) return "Cazloyd";
  if (s.includes("view from here") || s.startsWith("theviewfromhere")) return "view from here";
  if (s.includes("marston")) return "Project Centre Ltd";
  if (s.startsWith("zulu")) return "ZULU 8";
  if (s.startsWith("apple print") || s.startsWith("appleprint")) return "Appleprint";
  if (s.includes("enphase")) return "Enphase Energy";
  return name;
}
function fixEscDrift(o: Record<string, unknown>): Record<string, unknown> {
  const cn = String(o.company_name ?? "").toLowerCase().trim();
  if (!(cn.startsWith("digital bu") || cn === "martech" || cn === "martech bu")) return o;
  const geoRaw = String(o.deal_type ?? "").toLowerCase().trim();
  return {
    ...o,
    company_name: escCompanyCanon(String(o.geo ?? "")),
    geo: ESC_GEO_NORM[geoRaw] ?? (o.deal_type ?? null),
    deal_type: o.email_subject ?? null,
    email_subject: o.link ?? null,
    link: o.project_name ?? null,
    project_name: o.reference_id ?? null,
    reference_id: o.situation_type ?? null,
    situation_type: o.source ?? null,
    source: o.escalation_type ?? null,
    escalation_type: o.business_impact ?? null,
    business_impact: null,
  };
}

const TABLE: Record<string, string> = { quotes: "quotes", sql: "sql_leads", esc: "escalations", feedback: "feedback" };
const KEEP: Record<string, (r: Record<string, string>) => boolean> = {
  quotes: (r) => !!(r["Added Date"] || r["Agency"] || r["Client Email"] || r["Status"] || r["Estimated Cost"]),
  sql: (r) => !!(r["Email Address"] || r["Company Name"] || r["Date"]),
  esc: (r) => !!(r["Name"] || r["Company Name"] || r["Tracking Date"]),
  feedback: (r) => !!(r["Added Date"] || r["Agency"] || r["Client Email"] || r["Comments"]),
};
const MAP: Record<string, (r: Record<string, string>, i: number, sheetRow: number) => Record<string, unknown>> = {
  quotes: (r, i, sheetRow) => ({
    quote_id: r["Quote ID"] || null, added_date: pdate(r["Added Date"]), service_dept: r["Service Department"] || null, technology: r["Technology"] || null,
    subject_project: r["Email Subject Line / Project Name"] || null, agency: r["Agency"] || null, client_email: r["Client Email"] || null, pc_sme: r["PC/SME"] || null,
    project_type: r["Project Type"] || null, currency_type: r["Currency Type"] || null, estimated_cost: num(r["Estimated Cost"]), usd_value: num(r["USD Conversion"]),
    status: r["Status"] || null, notes: r["Notes"] || null, geo: r["GEO"] || null, business_type: r["Business Type"] || null, sales_person: r["Account/Sales Person"] || null,
    confirmed_in_days: intval(r["Confirmed in Days"]), src_row_hash: "Q:" + h(JSON.stringify(r)) + ":" + i, sheet_row: sheetRow,
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

// The swap is ONE call to replace_sheet_tab(), which does the delete and the insert inside
// one transaction with a per-table advisory lock.
//
// It used to be delete() then insert() as two separate HTTP round trips, and both halves
// of that bit through September 2026:
//   • a timeout between them left the table EMPTY until the next hourly push — every
//     'Error: feedback: Gateway Timeout' in sync_runs is that;
//   • two overlapping pushes each deleted and then inserted the same src_row_hash values,
//     which is the only way a hash ending in its own row index can collide. 13 Sep
//     12:50:09 and 12:50:19, sql_leads and escalations, nine seconds apart in one run.
// Now a failed insert rolls the delete back with it, and a second push for the same tab
// waits its turn instead of racing.
async function replaceTab(sb: any, table: string, rows: any[]): Promise<number> {
  const { data, error } = await sb.rpc("replace_sheet_tab", { p_table: table, p_rows: rows });
  if (error) throw new Error(table + ": " + error.message);
  return typeof data === "number" ? data : rows.length;
}

/** Retry the transient ones. A gateway timeout says nothing about whether the work landed,
 *  but the swap is idempotent now, so asking again is safe. A duplicate key or a bad type
 *  will fail identically every time and is returned on the first attempt. */
async function replaceTabWithRetry(sb: any, table: string, rows: any[]): Promise<number> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await replaceTab(sb, table, rows);
    } catch (e) {
      last = e;
      const msg = String(e);
      const transient = /timeout|timed out|gateway|502|503|504|ECONNRESET|fetch failed/i.test(msg);
      if (!transient || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw last;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Held outside the try so the failure log can name the tab. It used to log only the
  // error string under source 'sheet-ingest', which meant a red row said what broke but
  // not which tab it belonged to, and the per-tab '<tab>-appscript' row simply never
  // appeared — so the dashboard showed the tab's LAST GOOD push as its status.
  let tabName = "unknown";
  try {
    const body = await req.json();
    const tab = String(body?.tab || "");
    tabName = tab || "unknown";
    if (!MAP[tab]) return new Response(JSON.stringify({ ok: false, error: "unknown tab: " + tab }), { status: 400, headers: { "Content-Type": "application/json" } });
    // THE OLD SHEET IS FROZEN. Rahul, 6 Oct 2026: "old sheet is entirely frozen feedback
    // quotes webhublp completely." Since 1 Oct the dashboard is the record: quotes are
    // entered there or found in mail, feedback is logged there, and the sheet-writer
    // fills the NEW spreadsheet from it. A push from the old sheet's script would now
    // overwrite the quotes and feedback tables with a stale copy, so it is refused. The
    // Apps Script trigger in the old sheet still fires until somebody deletes it; every
    // run gets this answer and nothing changes. Escalations and SQLs are other sheets and
    // still land. Nothing is logged to sync_runs: a refused push is not a sync, and a row
    // an hour saying so would only bury the real ones.
    if (FROZEN_TABS.has(tab)) {
      return new Response(JSON.stringify({ ok: false, frozen: true, tab, message: "The old sheet is frozen since 1 Oct 2026 — the dashboard is the record now. Delete this trigger in the old spreadsheet." }),
        { status: 410, headers: { "Content-Type": "application/json" } });
    }
    const objs = toObjects(body?.rows || []).filter((x) => KEEP[tab](x.r));
    let mapped = objs.map((x, i) => MAP[tab](x.r, i, x.sheetRow));
    if (tab === "esc") mapped = mapped.map(fixEscDrift);
    // Guard: never let an empty/garbled push delete a populated table.
    if (mapped.length === 0) {
      await sb.from("sync_runs").insert({ source: tab + "-appscript", ok: false, rows_upserted: 0, message: "empty payload — table preserved" });
      return new Response(JSON.stringify({ ok: false, tab, inserted: 0, note: "empty payload, table left unchanged" }), { headers: { "Content-Type": "application/json" } });
    }
    const table = TABLE[tab];
    await replaceTabWithRetry(sb, table, mapped);
    await sb.from("sync_runs").insert({ source: tab + "-appscript", ok: true, rows_upserted: mapped.length, message: "app script push" });
    // Refresh derived clients + sentiment after escalations/feedback change.
    // NB: supabase-js v2's query builder is thenable but has no .catch() — must
    // await inside try/catch, or a refresh failure 500s an otherwise-good ingest.
    if (tab === "esc" || tab === "feedback") {
      try { await sb.rpc("rebuild_clients"); } catch (_) { /* refresh best-effort */ }
      try { await sb.rpc("compute_client_sentiment"); } catch (_) { /* refresh best-effort */ }
    }
    return new Response(JSON.stringify({ ok: true, tab, inserted: mapped.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    // Two rows: one under the tab's own source so the tab reads as FAILED rather than
    // silently keeping its last success, and one under 'sheet-ingest' for the raw error.
    await sb.from("sync_runs").insert([
      { source: tabName + "-appscript", ok: false, rows_upserted: 0, message: "push failed — table preserved · " + String(e).slice(0, 300) },
      { source: "sheet-ingest", ok: false, message: tabName + ": " + String(e) },
    ]);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
