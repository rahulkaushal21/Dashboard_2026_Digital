// sheet-raw — keep the source tabs VERBATIM, so they can be reproduced elsewhere.
//
// WHY THIS EXISTS: the existing feeds are lossy by design. sync-web-revenue takes 11
// fields out of the Web, Hub & LP tab's 39 and AGGREGATES, grouping by
// company|month|service|technology|engagement — 3,223 sheet rows become ~2,474. That is
// the right shape for reporting and the wrong shape for writing the tab into a new
// spreadsheet, which needs the original rows and every column.
//
// Deliberately a SEPARATE function rather than a change to sync-web-revenue: that one
// feeds every revenue figure in the dashboard, and adding to it to serve a different
// purpose risks the numbers for no gain. This one only ever writes sheet_raw.
//
// GET ?token=…&tab=revenue   → pull the source tab and store it
// POST ?token=…  {tab, rows} → store rows pushed by the Apps Script
//
// ---------------------------------------------------------------------------
// TWO WAYS TO READ THE SOURCE, AND ONLY ONE OF THEM CARRIES THE CENTS
//
// The published CSV exports what each cell DISPLAYS. The USD column is formatted as whole
// dollars, so every one of the 3,234 rows arrives already rounded — checked, and not one
// of them contains a decimal point; they come through as "$994". The spreadsheet's own
// pivot adds up the true values and rounds once at the end. Rounding 21 lines and then
// adding is not the same as adding and then rounding, which is the whole of the "$62,989
// here, $62,988 in the sheet" and the $1–$4 per person per quarter.
//
// The Sheets API with valueRenderOption=UNFORMATTED_VALUE returns the underlying numbers,
// so the two agree exactly. It needs the source spreadsheet shared with the service
// account, and its id in SOURCE_SHEET_ID. Until that is set this falls back to the CSV
// and behaves exactly as before — no cutover, nothing to coordinate.
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "ingestWebHub_a7c2e9";
const CSV: Record<string, string> = {
  revenue: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSjBN77fcEk8mE4ANcG7ZgddzYMnbB1UUrjHSdWsWeYC0etjmAg6qjtZTEeHp344GxLjX2s3t7Q07W6/pub?gid=0&single=true&output=csv",
};
// The tab each key lives in, by name, for the API path. The CSV path addresses it by gid.
const TAB_NAME: Record<string, string> = { revenue: "Web, Hub & LP" };

// A spreadsheet id, never a secret. Checked for shape because a variable is only ever as
// trustworthy as its contents: a private key once lived in a variable named for an id,
// and the cost of finding out was a key in a log. Never printed, only accepted or not.
function sourceSheetId(): string | null {
  const v = (Deno.env.get("SOURCE_SHEET_ID") || "").trim();
  if (!v) return null;
  if (v.length > 120 || /\s/.test(v)) return null;
  return v;
}

// Quoted-field CSV parser. The revenue tab carries commas and newlines inside project
// names, so splitting on commas loses rows silently.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---- Reading the source through the Sheets API ----------------------------
//
// Same service-account dance sheet-writer does. Kept here rather than shared, because a
// shared module between two edge functions is a deploy coupling, and these two are
// deployed for different reasons.
function b64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(): Promise<string> {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("token exchange failed: " + (j.error_description || res.status));
  return j.access_token as string;
}

async function readViaApi(sheetId: string, tabName: string): Promise<string[][]> {
  const tok = await accessToken();
  const range = encodeURIComponent(`'${tabName}'`);
  // UNFORMATTED_VALUE is the entire point: the number, not the way the cell is dressed.
  // SERIAL_NUMBER dates would be worse than the display ones — the rest of the pipeline
  // parses date TEXT — so dates stay formatted and only the numbers come through raw.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`
    + `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await res.json();
  if (!res.ok) throw new Error("Sheets API: " + (j?.error?.message || res.status));
  return ((j.values || []) as unknown[][]).map((row) => (row || []).map((c) => (c ?? "").toString()));
}

async function store(sb: any, tab: string, rows: string[][], via: string) {
  if (!rows?.length) throw new Error("empty grid");
  const headers = (rows[0] || []).map((x) => (x ?? "").toString());

  const data = rows.slice(1)
    .map((row, i) => ({ tab, row_index: i + 2, values: (row || []).map((c) => (c ?? "").toString()) }))
    // Trailing blank rows are an artefact of the grid, not data.
    .filter((r) => (r.values as string[]).some((c) => c.trim() !== ""));

  // Never let a bad pull empty the stored copy. Same guard sheet-ingest uses, and for
  // the same reason: a transient fetch returning a login page should cost nothing.
  if (!data.length) throw new Error("no data rows — stored copy left untouched");

  await sb.from("sheet_raw_header").upsert({
    tab, headers, col_count: headers.length, synced_at: new Date().toISOString(),
  }, { onConflict: "tab" });

  await sb.from("sheet_raw").delete().eq("tab", tab);
  for (let i = 0; i < data.length; i += 500) {
    const { error } = await sb.from("sheet_raw").insert(data.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { rows: data.length, cols: headers.length, via };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

  try {
    let tab: string;
    let grid: string[][];
    let via = "csv";

    if (req.method === "POST") {
      const body = await req.json();
      tab = String(body?.tab || "");
      grid = body?.rows || [];
      via = "push";
      if (!tab) throw new Error("tab is required");
    } else {
      tab = url.searchParams.get("tab") || "revenue";
      const id = sourceSheetId();
      const tabName = TAB_NAME[tab];

      if (id && tabName) {
        // The exact numbers. Falling back on failure would be worse than failing: it
        // would silently go back to rounded values and put the $1 back without saying so.
        grid = await readViaApi(id, tabName);
        via = "api";
      } else {
        const src = CSV[tab];
        if (!src) throw new Error("no published CSV for tab: " + tab);
        const res = await fetch(src);
        if (!res.ok) throw new Error("CSV fetch failed: " + res.status);
        const text = await res.text();
        // A published tab that has been unpublished returns a Google login page, not a 404.
        if (text.trimStart().startsWith("<")) throw new Error("got HTML — tab not published?");
        grid = parseCSV(text);
      }
    }

    const out = await store(sb, tab, grid, via);
    await sb.from("sync_runs").insert({
      source: "sheet-raw-" + tab, ok: true, rows_upserted: out.rows,
      message: out.cols + " columns kept verbatim, via " + out.via
        + (out.via === "csv" ? " (values rounded to whole dollars by the sheet's own formatting)" : " (exact values)"),
    });
    return json({ ok: true, tab, ...out });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "sheet-raw", ok: false, message: String(e) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
