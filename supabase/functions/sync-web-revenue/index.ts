import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSjBN77fcEk8mE4ANcG7ZgddzYMnbB1UUrjHSdWsWeYC0etjmAg6qjtZTEeHp344GxLjX2s3t7Q07W6/pub?gid=0&single=true&output=csv";
// Project Status values (column N) that are NOT yet realised revenue — excluded.
const EXCLUDE_STATUS = new Set(["pending", "on hold", "cancelled", "awaiting information"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
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

const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function parseMonth(s: string): string | null {
  const m = (s || "").trim().match(/^([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{2,4})$/);
  if (!m) return null;
  const mm = MON[m[1].toLowerCase()];
  if (!mm) return null;
  let yyyy = m[2];
  if (yyyy.length === 2) yyyy = "20" + yyyy;
  return `${yyyy}-${mm}-01`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error("CSV fetch failed: " + res.status);
    const text = await res.text();
    if (text.trimStart().startsWith("<")) throw new Error("CSV unavailable (got HTML — tab not published?)");
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("empty CSV");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => {
      for (const n of names) { const i = header.findIndex((h) => h === n.toLowerCase()); if (i >= 0) return i; }
      for (const n of names) { const i = header.findIndex((h) => h.includes(n.toLowerCase())); if (i >= 0) return i; }
      return -1;
    };
    const cAgency = idx(["agency"]);
    const cUsd = idx(["usd conversion", "usd"]);
    const cMonth = idx(["month-year", "month"]);
    const cEmail = idx(["client email", "email"]);
    const cGeo = idx(["geo"]);
    const cSme = idx(["pc/sme", "sme"]);
    const cSales = idx(["account/sales person", "sales"]);
    const cSvc = idx(["service department", "service"]);
    const cStatus = idx(["project status"]);
    if (cAgency < 0 || cMonth < 0) throw new Error("required columns not found");

    type R = { company_name: string; contact_email: string | null; booking_amount: number; booking_month: string; service_name: string | null; geo: string | null; sme: string | null; sales_person: string | null; src_row_hash: string };
    const agg = new Map<string, R>();
    let excluded = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const company = (row[cAgency] || "").trim();
      const month = parseMonth(row[cMonth] || "");
      if (!company || !month) continue;
      // Skip not-yet-realised revenue by Project Status (column N).
      const status = cStatus >= 0 ? (row[cStatus] || "").trim().toLowerCase() : "";
      if (EXCLUDE_STATUS.has(status)) { excluded++; continue; }
      const svc = cSvc >= 0 ? (row[cSvc] || "").trim() : "";
      const amtStr = cUsd >= 0 ? (row[cUsd] || "") : "";
      const amt = parseFloat(amtStr.replace(/[$,\s]/g, "")) || 0;
      const key = `${company}|${month}|${svc}`;
      const cur = agg.get(key);
      if (cur) cur.booking_amount += amt;
      else agg.set(key, {
        company_name: company, booking_month: month, service_name: svc || null,
        booking_amount: amt,
        contact_email: cEmail >= 0 ? ((row[cEmail] || "").trim() || null) : null,
        geo: cGeo >= 0 ? ((row[cGeo] || "").trim() || null) : null,
        sme: cSme >= 0 ? ((row[cSme] || "").trim() || null) : null,
        sales_person: cSales >= 0 ? ((row[cSales] || "").trim() || null) : null,
        src_row_hash: key,
      });
    }
    const data = [...agg.values()];
    if (!data.length) throw new Error("no rows after filtering — refusing to wipe web_revenue");

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // FULL REPLACE: clear the table, then insert the freshly-computed set. This
    // removes any orphaned rows (sheet rows since edited/removed) and applies the
    // status filter. We only reach here after a successful fetch+parse, so a bad
    // pull can never wipe the table.
    const { error: delErr } = await supa.from("web_revenue").delete().neq("id", 0);
    if (delErr) throw new Error("clear: " + delErr.message);
    let upserted = 0;
    for (let i = 0; i < data.length; i += 500) {
      const chunk = data.slice(i, i + 500);
      const { error } = await supa.from("web_revenue").insert(chunk);
      if (error) throw new Error("insert: " + error.message);
      upserted += chunk.length;
    }
    await supa.from("sync_runs").insert({ source: "web-revenue-sync", rows_upserted: upserted, ok: true, message: `full replace · ${excluded} excluded by status` });
    const total = data.reduce((s, d) => s + d.booking_amount, 0);
    const latest = data.map((d) => d.booking_month).sort().pop() || null;
    const agencies = new Set(data.map((d) => d.company_name.toLowerCase())).size;
    return new Response(JSON.stringify({ ok: true, rows: upserted, agencies, total: Math.round(total), latest_month: latest, excluded_by_status: excluded }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
