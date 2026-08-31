import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Loads one historical revenue spreadsheet into revenue_history.
//
// Unlike sync-web-revenue there is no hardcoded CSV_URL: the source, its URL and
// its per-sheet column mapping all come from the revenue_sources registry, so
// adding the next year is a row of config rather than a code change. Call with
// ?source=<key>, or with no argument to run every enabled source.
//
// Replace is scoped to the source being loaded — loading 2023 can never touch
// another year's rows.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

// Same statuses sync-web-revenue drops, so the two datasets mean the same thing
// either side of the April-2025 seam.
const EXCLUDE_STATUS = new Set(["pending", "on hold", "cancelled", "awaiting information"]);

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The Web / HUB / LP split the business reports on. The historical sheet has no
// Service Department column (the live sheet does), so it is derived from
// Technology. Banner work belongs to LP: folding it into Web left LP $145k short
// and Web $122k over against the reported FY24-25 figures, which is how this rule
// was established rather than assumed.
function serviceDept(tech: string): string {
  const t = (tech || "").toLowerCase();
  if (t.includes("hubspot")) return "HUB";
  if (t.startsWith("lp") || t.includes("banner")) return "LP";
  return "Web";
}

const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
// Handles "Jan 23", "Jan-23", "January 2023".
function parseMonth(s: string): string | null {
  const m = (s || "").trim().match(/^([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{2,4})$/);
  if (!m) return null;
  const mm = MON[m[1].toLowerCase()];
  if (!mm) return null;
  let y = m[2];
  if (y.length === 2) y = "20" + y;
  return `${y}-${mm}-01`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const wanted = new URL(req.url).searchParams.get("source");

    let q = supa.from("revenue_sources").select("*").eq("enabled", true);
    if (wanted) q = q.eq("key", wanted);
    const { data: sources, error: srcErr } = await q;
    if (srcErr) throw new Error("registry: " + srcErr.message);
    if (!sources?.length) throw new Error(wanted ? `no enabled source '${wanted}'` : "no enabled sources");

    const results: any[] = [];
    for (const src of sources) results.push(await loadSource(supa, src));
    return new Response(JSON.stringify({ ok: true, sources: results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});

async function loadSource(supa: any, src: any) {
  const res = await fetch(src.csv_url);
  if (!res.ok) throw new Error(`${src.key}: CSV fetch failed ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error(`${src.key}: got HTML — sheet not published as CSV?`);
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error(`${src.key}: empty CSV`);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const map = src.column_map || {};
  // A mapping entry is either a column index or a header name.
  const col = (name: string): number => {
    const v = map[name];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const exact = header.indexOf(v.toLowerCase());
      return exact >= 0 ? exact : header.findIndex((h) => h.includes(v.toLowerCase()));
    }
    return -1;
  };
  const cAgency = col("agency"), cClient = col("client_name"), cMonth = col("month");
  const cAmount = col("amount"), cModel = col("model"), cTech = col("technology");
  const cGeo = col("geo"), cPid = col("project_id"), cStatus = col("status");

  // Guards. A missing amount column would otherwise parse every row to 0 and
  // report success — the quiet way to delete a year of revenue.
  if (cAmount < 0) throw new Error(`${src.key}: no amount column in column_map`);
  if (cMonth < 0) throw new Error(`${src.key}: no month column in column_map`);
  if (cAgency < 0 && cClient < 0) throw new Error(`${src.key}: no client column in column_map`);

  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
  const out: any[] = [];
  let padding = 0, excluded = 0, noMonth = 0, noClient = 0, droppedValue = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawAmt = cell(r, cAmount);
    const company = cell(r, cAgency) || cell(r, cClient);
    const model = cell(r, cModel);
    // Sheets carry formula-filled trailing rows that are blank in every real
    // field (1,736 of them in the first source). Skip them rather than storing
    // thousands of empty clients.
    if (!company && !rawAmt && !model) { padding++; continue; }

    const status = cell(r, cStatus).toLowerCase();
    if (EXCLUDE_STATUS.has(status)) { excluded++; continue; }

    const month = parseMonth(cell(r, cMonth));
    const amt = parseFloat(rawAmt.replace(/[$,\s]/g, "")) || 0;
    if (!month) { noMonth++; droppedValue += amt; continue; }
    if (!company) { noClient++; droppedValue += amt; continue; }

    out.push({
      source_key: src.key,
      company_name: company,
      booking_month: month,
      booking_amount: amt,
      engagement_model: model || null,
      technology: cell(r, cTech) || null,
      service_dept: serviceDept(cell(r, cTech)),
      geo: cell(r, cGeo) || null,
      project_id: cell(r, cPid) || null,
      project_status: cell(r, cStatus) || null,
      client_name: cell(r, cClient) || null,
      src_row_hash: `${src.key}|${i}`,
    });
  }

  if (!out.length) throw new Error(`${src.key}: no usable rows — refusing to clear existing data`);
  const total = out.reduce((s, r) => s + r.booking_amount, 0);
  if (total <= 0) throw new Error(`${src.key}: parsed total is 0 — refusing to load`);
  // A verified historical year must not move underneath us.
  if (src.immutable && src.last_total != null && Math.abs(Number(src.last_total) - total) > 0.5) {
    throw new Error(`${src.key} is immutable: total changed ${src.last_total} -> ${total.toFixed(2)}`);
  }

  const { error: delErr } = await supa.from("revenue_history").delete().eq("source_key", src.key);
  if (delErr) throw new Error(`${src.key} clear: ${delErr.message}`);
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await supa.from("revenue_history").insert(out.slice(i, i + 500));
    if (error) throw new Error(`${src.key} insert: ${error.message}`);
  }

  const months = out.map((r) => r.booking_month).sort();
  const message = `${padding} padding · ${excluded} excluded by status · ${noMonth} no-month · ${noClient} no-client · dropped $${Math.round(droppedValue)}`;
  await supa.from("revenue_sources").update({
    last_synced_at: new Date().toISOString(), last_rows: out.length,
    last_total: Number(total.toFixed(2)), last_message: message,
  }).eq("key", src.key);
  await supa.from("sync_runs").insert({ source: "revenue-history:" + src.key, rows_upserted: out.length, ok: true, message });

  return {
    source: src.key, rows: out.length, total: Math.round(total),
    first_month: months[0], last_month: months[months.length - 1],
    clients: new Set(out.map((r) => r.company_name.toLowerCase())).size,
    padding_skipped: padding, excluded_by_status: excluded, dropped_rows: noMonth + noClient, dropped_value: Math.round(droppedValue),
  };
}
