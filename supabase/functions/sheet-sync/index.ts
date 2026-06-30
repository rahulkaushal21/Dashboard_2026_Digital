// sheet-sync — syncs ONLY the Bookings master tab (gid=0, published) into the
// `bookings` table, then rebuilds derived clients + sentiment.
//
// quotes / sql_leads / escalations / feedback are NO LONGER handled here — they
// are pushed from the private sheet by the Apps Script via the `sheet-ingest`
// function (no "publish to web" needed). This function never touches them, so it
// can't wipe what the Apps Script pushes.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "syncWebHubLP_8f3a91";
const BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSjBN77fcEk8mE4ANcG7ZgddzYMnbB1UUrjHSdWsWeYC0etjmAg6qjtZTEeHp344GxLjX2s3t7Q07W6";
const BOOK_GID = "0";
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } } else { cur += c; } }
    else { if (c === '"') { inQ = true; } else if (c === ',') { row.push(cur); cur = ""; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; } else if (c === '\r') { /* skip */ } else { cur += c; } } }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}
function h(s: string): string { let x = 5381; for (let i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); x = x >>> 0; } return x.toString(16); }
function num(s: string | undefined): number | null { if (!s) return null; const v = parseFloat(s.replace(/[$,\s]/g, "")); return isNaN(v) ? null : v; }
function pdate(s: string | undefined): string | null { if (!s) return null; s = s.trim(); let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${String(m[1]).padStart(2, "0")}`; } m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; return null; }
function pmonth(s: string | undefined): string | null { if (!s) return null; const m = s.trim().match(/^([A-Za-z]{3})[a-z]*-(\d{4})$/); if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) return `${m[2]}-${mo}-01`; } return null; }

// Returns null when the tab is not reachable as CSV (not published -> 401 HTML).
async function fetchRows(gid: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(`${BASE}/pub?gid=${gid}&single=true&output=csv`);
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) return null;
  const grid = parseCsv(text); if (!grid.length) return [];
  const headers = grid[0].map((x) => x.trim());
  return grid.slice(1).map((r) => { const o: Record<string, string> = {}; headers.forEach((hh, i) => { o[hh] = (r[i] ?? "").trim(); }); return o; });
}
async function insertBatches(sb: any, table: string, rows: any[]) { for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from(table).insert(rows.slice(i, i + 500)); if (error) throw new Error(table + ": " + error.message); } }

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Record<string, unknown> = {};
  try {
    const braw = await fetchRows(BOOK_GID);
    if (braw) {
      const books = braw.filter((r) => (r["Project Id"] || "").startsWith("PRJ")).map((r, i) => ({
        invoice_number: r["Invoice No"] || null, order_number: r["Project Id"] || null, invoice_date: null, order_date: pdate(r["Start Date"]),
        booking_date: pdate(r["Confirmation Date"]), booking_month: pmonth(r["Month-Year"]) || (pdate(r["Confirmation Date"]) ? pdate(r["Confirmation Date"])!.slice(0, 7) + "-01" : null),
        company_name: r["Agency"] || r["Client Name"] || null, contact_email: r["Client Email"] || null,
        booking_amount: num(r["USD Conversion"]) ?? num(r["Confirmed Price"]), service_name: r["Service Department"] || null,
        sales_person: r["Account/Sales Person"] || null, geo_head: null, engagement_model: r["Project Type"] || null, geo: r["Geo"] || null, sme: r["PC/SME"] || null,
        src_row_hash: "PRJ:" + h(JSON.stringify(r)) + ":" + i,
      }));
      // Guard: only replace when the fetch actually returned rows.
      if (books.length) { await sb.from("bookings").delete().neq("id", 0); await insertBatches(sb, "bookings", books); out.bookings = books.length; } else { out.bookings = "skipped (empty)"; }
    } else { out.bookings = "skipped (unpublished)"; }

    const { error: rcErr } = await sb.rpc("rebuild_clients"); if (rcErr) throw new Error("rebuild_clients: " + rcErr.message);
    const { error: csErr } = await sb.rpc("compute_client_sentiment"); if (csErr) throw new Error("compute_client_sentiment: " + csErr.message);

    out.ok = true;
    await sb.from("sync_runs").insert({ source: "sheet-sync", rows_upserted: typeof out.bookings === "number" ? out.bookings : 0, ok: true });
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "sheet-sync", ok: false, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e), partial: out }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
