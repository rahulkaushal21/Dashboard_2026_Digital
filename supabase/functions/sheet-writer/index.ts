// sheet-writer — write the dashboard's record INTO a Google Sheet.
//
// This is the first thing here that writes to Google rather than reading from it, and it
// is the step that closes the loop: from 1 Oct the dashboard is the record and the
// spreadsheet is its dump.
//
// IT WRITES TO A NEW, SEPARATE SPREADSHEET. It must never be pointed at the existing
// business sheet: that one is still an INPUT (sync-web-revenue and the Apps Script read
// it), and writing to a sheet we also read would create a feedback loop where the
// system's own output becomes its next input.
//
// AUTH: verify_jwt is OFF and must stay off. pg_cron calls this over plain HTTP with no
// Authorization header; the TOKEN query parameter below is the authentication. Deploying
// with verify_jwt on returns 401 to the cron job and the sheet silently stops updating.
//
// THREE TABS, each a full replace:
//   Web, Hub & LP — the source tab verbatim from sheet_raw (40 columns, every row),
//                    plus everything confirmed in the dashboard mapped into the same
//                    columns.
//   Quotes        — the quotes table, plus dashboard-origin deals the sheet has no line for.
//   Feedback      — the feedback table.
//
// Full replace rather than append because these are DUMPS. An append would need to know
// what it wrote last time, and any disagreement between that memory and the sheet leaves
// duplicates nobody can untangle. Replacing is idempotent: run it twice, get the same
// sheet. It also means a hand edit to the new sheet is overwritten within the hour —
// which is the point: the dashboard is the record, this is its output.
//
// SETUP: see supabase/functions/README-sheet-writer.md

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "writeWebHub_5c1d73";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d2 = (n: number) => String(n).padStart(2, "0");
// The sheet writes dates as 21-Sep-2026 and months as Sep-2026. Matching that exactly
// matters: a column that mixes formats stops sorting and stops matching on lookup.
function sheetDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${d2(d.getUTCDate())}-${MONS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
function sheetMonth(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${MONS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
// "Sep 2026 Week 3". Read off the sheet's own rows rather than assumed: the week runs
// from the START DATE, not the confirmation date, and the boundaries are days 1-7, 8-14,
// 15-21, 22-end — a plain ceil(day/7), not ISO week numbering, which would disagree with
// every existing row as soon as a month began mid-week.
function sheetWeek(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${MONS[d.getUTCMonth()]} ${d.getUTCFullYear()} Week ${Math.ceil(d.getUTCDate() / 7)}`;
}
// Money is written to TWO DECIMALS. The current export rounds to whole dollars, which is
// why monthly totals in the dashboard sit a dollar or two under the sheet's own figures
// and have prompted more than one "which is right?" conversation. Both were right; one
// was rounded.
const money = (n: unknown): string => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "";
};
const s = (v: unknown) => (v === null || v === undefined) ? "" : String(v);

// The dashboard stores a short geo code; the sheet writes the region. Both are right for
// their own side, so the translation happens here, on the way out. Anything unrecognised
// is passed through untouched rather than guessed — a wrong region is silently wrong on
// every regional total, which is worse than an odd-looking one.
const GEO_REGION: Record<string, string> = {
  US: "US/Canada", UK: "UK/EU", AU: "AU/NZ", OTHER: "Others",
};
const geoRegion = (v?: string | null): string => {
  const k = (v || "").trim();
  return k ? (GEO_REGION[k.toUpperCase()] || k) : "";
};

// ---- Google auth: service account -> signed JWT -> access token ------------
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  // A JSON key's private_key carries literal \n sequences when it has been through an
  // env var; both forms must work or setup fails with an opaque "invalid key".
  const body = pem.replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("google auth failed: " + JSON.stringify(j));
  return j.access_token;
}

// ---- Sheets API -----------------------------------------------------------
async function api(tok: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || JSON.stringify(j);
    // A 403 has two very different causes and guessing between them wastes real time.
    // An earlier version asserted "not shared" for every 403 and sent somebody to check
    // sharing that was already correct, when the API simply was not enabled. Read what
    // Google actually said; only claim a cause the message supports.
    if (res.status === 403) {
      if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
        throw new Error("Sheets API is not enabled on that Google Cloud project. Enable it, wait a minute, retry. (" + msg + ")");
      }
      if (/permission|caller does not have|forbidden/i.test(msg)) {
        throw new Error("No access to that spreadsheet — share it with the service account as Editor. (" + msg + ")");
      }
      throw new Error("Sheets 403: " + msg);
    }
    if (res.status === 404) throw new Error("Spreadsheet not found — check TARGET_SHEET_ID is the id from the URL and nothing else. (" + msg + ")");
    throw new Error(`Sheets ${res.status}: ${msg}`);
  }
  return j;
}

async function ensureTabs(tok: string, id: string, names: string[]) {
  const meta = await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`);
  const have = new Set((meta.sheets || []).map((x: any) => x.properties.title));
  const add = names.filter((n) => !have.has(n)).map((title) => ({ addSheet: { properties: { title } } }));
  if (add.length) {
    await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests: add }),
    });
  }
}

async function writeTab(tok: string, id: string, tab: string, grid: string[][]) {
  const range = encodeURIComponent(`'${tab}'`);
  await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:clear`, { method: "POST", body: "{}" });
  // RAW, not USER_ENTERED: a project name beginning with '=' or '+' would otherwise be
  // parsed as a formula, and a leading-zero reference would lose its zero.
  await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values: grid }),
  });
  return grid.length - 1;
}

// ---- Tab builders ---------------------------------------------------------

// Column positions in the Web, Hub & LP tab, read from its own header row rather than
// hard-coded: if somebody inserts a column in the source, a fixed index would silently
// write every later field one place to the left.
// The far-right column the writer stamps so it can find a row again next run. Named, not
// hidden: a mystery column people delete is worse than one they can see a reason for.
const REF_HEADER = "Dashboard Ref";

// Two more columns the team never types into. A line removed in the dashboard is MARKED
// here rather than dropped from the tab: the money is already out of every figure (it is
// out of web_project_ledger, which the whole dashboard is built on), and what is left is
// the evidence — what was removed, by whom, and why. A row that silently vanished from
// the only copy people can read for themselves is indistinguishable from one that was
// never written, which is not a thing to be vague about when nobody can check by editing.
const DELETED_HEADER = "Deleted";
const DELETED_NOTE_HEADER = "Deleted Note";

// Which lines are hidden right now, keyed by the same ref the writer stamps.
//
// Read from web_ledger_deletions_in_force, NOT from ledger_deletions: a deletion lapses
// when the sheet row it was made against moves (see migration 059), and that rule lives
// in the database. Reading the raw table here would be a second opinion about what is
// deleted, free to drift from the first, and this file would be the one nobody checks.
async function readDeletions(sb: any): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await sb.from("web_ledger_deletions_in_force")
    .select("row_key, reason, deleted_by, deleted_at");
  // A failed read must not mark every line deleted, nor stop the sheet being written.
  if (error || !data) return out;
  for (const d of data) {
    const when = s(d.deleted_at).slice(0, 10);
    const parts = [when, s(d.deleted_by), s(d.reason)].filter(Boolean);
    out.set(String(d.row_key), parts.join(" \u00b7 "));
  }
  return out;
}

function indexOfHeader(headers: string[], name: string): number {
  const want = name.trim().toLowerCase();
  return headers.findIndex((h) => (h || "").trim().toLowerCase() === want);
}

// Conversion to USD, from the same fx_rates table Settings edits, so the sheet and the
// dashboard can never book the same contractor invoice at two different dollar figures.
// An unknown currency converts 1:1 rather than to zero: wrong by the spread is
// recoverable, silently zero is not.
function toUsd(amount: number, currency: string, rates: Record<string, number>): number {
  const k = (currency || "USD").toUpperCase();
  const rate = k === "USD" ? 1 : (rates[k === "EURO" ? "EUR" : k] ?? 1);
  return Number(amount) * rate;
}

// ---- The three columns the accounts team owns ------------------------------
//
// Invoice No, Invoice Currency and Invoice Amount are filled in by hand, in the
// spreadsheet, after everything else about a line is settled. The dashboard has no
// opinion about them and never will.
//
// That is a problem for a writer that CLEARS the tab and rewrites it every run: anything
// typed into those cells on a dashboard-origin row would survive until the next sync and
// then vanish, with no trace of who lost what. So those three columns run the other way —
// the sheet is the source and this writer copies them forward.
//
// Rows are matched on a "Dashboard Ref" column the writer stamps on every line
// (raw:<row index> or opp:<id>). Position cannot be used: the dashboard rows come back
// from Postgres in no guaranteed order, so row 812 one hour is not row 812 the next. Nor
// can the project name, which people edit.
//
// Everything read is also kept in sheet_invoice_entries, and that copy is the floor: a
// failed read, a hand-cleared tab or a tab recreated from scratch falls back to it rather
// than writing blanks over somebody's work.
type Invoice = { no: string; cur: string; amt: string };

async function readInvoiceColumns(
  sb: any, tok: string | null, sheetId: string, tab: string,
): Promise<Map<string, Invoice>> {
  const out = new Map<string, Invoice>();

  // The durable copy first, so it is never worse than last time.
  {
    let from = 0;
    for (;;) {
      const { data } = await sb.from("sheet_invoice_entries")
        .select("ref, invoice_no, invoice_currency, invoice_amount").order("ref").range(from, from + 999);
      if (!data?.length) break;
      for (const r of data) {
        out.set(String(r.ref), { no: s(r.invoice_no), cur: s(r.invoice_currency), amt: s(r.invoice_amount) });
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  if (!tok) return out;

  // Then whatever is in the sheet right now, which wins where it has a value.
  let grid: string[][] = [];
  try {
    const range = encodeURIComponent(`'${tab}'`);
    const j = await api(tok, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`);
    grid = (j.values || []) as string[][];
  } catch {
    // First run, or the tab does not exist yet. The stored copy stands.
    return out;
  }
  if (grid.length < 2) return out;

  const hdr = (grid[0] || []).map(s);
  const iRef = indexOfHeader(hdr, REF_HEADER);
  const iNo = indexOfHeader(hdr, "Invoice No");
  const iCur = indexOfHeader(hdr, "Invoice Currency");
  const iAmt = indexOfHeader(hdr, "Invoice Amount");
  if (iRef < 0) return out;  // written before the ref column existed

  const touched: (Invoice & { ref: string })[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const ref = s(row[iRef]);
    if (!ref) continue;
    const v: Invoice = {
      no: iNo >= 0 ? s(row[iNo]) : "",
      cur: iCur >= 0 ? s(row[iCur]) : "",
      amt: iAmt >= 0 ? s(row[iAmt]) : "",
    };
    if (!v.no && !v.cur && !v.amt) continue;
    const prev = out.get(ref);
    // Field by field: clearing one cell must not drop the other two.
    out.set(ref, {
      no: v.no || prev?.no || "",
      cur: v.cur || prev?.cur || "",
      amt: v.amt || prev?.amt || "",
    });
    touched.push({ ref, ...(out.get(ref) as Invoice) });
  }

  if (touched.length) {
    // Chunked, because one upsert of several thousand rows is a request Postgrest will
    // refuse and a failure here must not stop the sheet being written.
    for (let i = 0; i < touched.length; i += 500) {
      const chunk = touched.slice(i, i + 500).map((t) => ({
        ref: t.ref, invoice_no: t.no || null, invoice_currency: t.cur || null,
        invoice_amount: t.amt || null, seen_at: new Date().toISOString(),
      }));
      await sb.from("sheet_invoice_entries").upsert(chunk, { onConflict: "ref" });
    }
  }
  return out;
}

async function buildRevenue(sb: any, tok: string | null, sheetId: string): Promise<string[][]> {
  const { data: fx } = await sb.from("fx_rates").select("currency, rate_to_usd");
  const rates: Record<string, number> = {};
  for (const r of fx || []) rates[String(r.currency).toUpperCase()] = Number(r.rate_to_usd);

  const { data: hdr } = await sb.from("sheet_raw_header").select("headers").eq("tab", "revenue").maybeSingle();
  const baseHeaders: string[] = hdr?.headers || [];
  if (!baseHeaders.length) throw new Error("no raw header for the revenue tab — run sheet-raw first");

  // Worked out BEFORE the ref column is appended, or the nameless trailing column stops
  // being last and every Month-Year would be written into the wrong cell.
  const trailingMonth = (baseHeaders[baseHeaders.length - 1] || "").trim() === "" ? baseHeaders.length - 1 : -1;

  // One extra column at the far right, so a row can be recognised again next run. It is
  // the only thing in this tab the team should never type into.
  const headers: string[] = [...baseHeaders, DELETED_HEADER, DELETED_NOTE_HEADER, REF_HEADER];
  const refCol = headers.length - 1;
  const delCol = indexOfHeader(headers, DELETED_HEADER);
  const delNoteCol = indexOfHeader(headers, DELETED_NOTE_HEADER);

  const deletions = await readDeletions(sb);
  // Applied on every row, both the sheet-origin ones and the dashboard-origin ones, so a
  // mistaken entry is marked wherever it came from. Blank is the normal case.
  const markDeleted = (row: string[], ref: string) => {
    const note = deletions.get(ref);
    // Written either way. A source row with more cells than its header has would
    // otherwise leave a stray value sitting in a column that says "Deleted", and a
    // restored line has to lose the mark rather than keep it from last run.
    if (delCol >= 0) row[delCol] = note === undefined ? "" : "Deleted";
    if (delNoteCol >= 0) row[delNoteCol] = note ?? "";
  };

  const invoices = await readInvoiceColumns(sb, tok, sheetId, "Web, Hub & LP");

  // Applied LAST on every row, so it beats both the sheet_raw value and any dashboard
  // override. Only non-empty values are copied: a blank in the sheet means nobody has
  // invoiced yet, not "erase what the dashboard knows".
  const inv = { no: -1, cur: -1, amt: -1 };
  const keepInvoice = (row: string[], ref: string) => {
    const v = invoices.get(ref);
    if (!v) return;
    if (v.no && inv.no >= 0) row[inv.no] = v.no;
    if (v.cur && inv.cur >= 0) row[inv.cur] = v.cur;
    if (v.amt && inv.amt >= 0) row[inv.amt] = v.amt;
  };
  inv.no = indexOfHeader(headers, "Invoice No");
  inv.cur = indexOfHeader(headers, "Invoice Currency");
  inv.amt = indexOfHeader(headers, "Invoice Amount");

  const grid: string[][] = [headers];

  // 1. The source tab, verbatim, in its own row order — with whatever the team has
  //    filled in on this page laid over the top.
  //
  //    A sheet line's blanks (Project Id, Quote ID, Expert…) are edited in the dashboard
  //    into sheet_row_overrides, because sheet_raw is re-synced from the spreadsheet and
  //    an edit written there would vanish at the next sync. If they were not applied
  //    here, the new spreadsheet would keep showing the blanks the team had already
  //    filled in — and they would go and fill them in again.
  //
  //    Read from web_sheet_rows rather than the overrides table directly, so the
  //    fingerprint guard (an override stops applying if its sheet row moved) is honoured
  //    in exactly one place instead of being reimplemented here and drifting.
  const overrides = new Map<number, Record<string, string>>();
  {
    let o = 0;
    for (;;) {
      const { data, error } = await sb.from("web_sheet_rows")
        .select("id, has_override, project_id, quote_id, expert, project_status, start_date, delivery_date, internal_delivery, internal_hrs, actual_hrs, integration, invoice_no, invoice_currency, invoice_amount, outsource_price")
        .eq("has_override", true).order("id").range(o, o + 999);
      if (error) throw new Error("web_sheet_rows: " + error.message);
      if (!data?.length) break;
      for (const r of data) {
        overrides.set(Number(r.id), {
          "Project Id": s(r.project_id),
          "Quote ID": s(r.quote_id),
          "Expert": s(r.expert),
          "Project Status": s(r.project_status),
          "Start Date": sheetDate(r.start_date),
          "Delivery Date": sheetDate(r.delivery_date),
          "Internal Delivery": sheetDate(r.internal_delivery),
          "Internal hrs": s(r.internal_hrs),
          "Actual hrs": s(r.actual_hrs),
          "Integration (only for LP)": s(r.integration),
          "Invoice No": s(r.invoice_no),
          "Invoice Currency": s(r.invoice_currency),
          "Invoice Amount": s(r.invoice_amount),
          "Outsource Price": s(r.outsource_price),
        });
      }
      if (data.length < 1000) break;
      o += 1000;
    }
  }

  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("sheet_raw").select("id, row_index, values")
      .eq("tab", "revenue").order("row_index").range(from, from + 999);
    if (error) throw new Error("sheet_raw: " + error.message);
    if (!data?.length) break;
    for (const r of data) {
      const vals: string[] = (r.values || []).map(s);
      while (vals.length < headers.length) vals.push("");
      const row = vals.slice(0, headers.length);
      const ov = overrides.get(Number(r.id));
      if (ov) {
        for (const [name, value] of Object.entries(ov)) {
          // Only write what the override actually holds. An empty one means "nobody
          // filled this in", not "blank it" — otherwise saving a Project Id would wipe
          // every other column on that line.
          if (!value) continue;
          const i = indexOfHeader(headers, name);
          if (i >= 0) row[i] = value;
        }
      }
      const ref = `raw:${r.row_index}`;
      row[refCol] = ref;
      keepInvoice(row, ref);
      markDeleted(row, ref);
      grid.push(row);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  // 2. Everything confirmed in the dashboard that the source tab has no line for.
  const col = {
    projectId: indexOfHeader(headers, "Project Id"),
    quote: indexOfHeader(headers, "Quote ID"),
    dept: indexOfHeader(headers, "Service Department"),
    project: indexOfHeader(headers, "Project Name"),
    ptype: indexOfHeader(headers, "Project Type"),
    tech: indexOfHeader(headers, "Technology"),
    conf: indexOfHeader(headers, "Confirmation Date"),
    start: indexOfHeader(headers, "Start Date"),
    delivery: indexOfHeader(headers, "Delivery Date"),
    status: indexOfHeader(headers, "Project Status"),
    stype: indexOfHeader(headers, "Service Type"),
    dtype: indexOfHeader(headers, "Delivery Type"),
    sme: indexOfHeader(headers, "PC/SME"),
    agency: indexOfHeader(headers, "Agency"),
    clientName: indexOfHeader(headers, "Client Name"),
    email: indexOfHeader(headers, "Client Email"),
    clientType: indexOfHeader(headers, "Client Type"),
    geo: indexOfHeader(headers, "Geo"),
    cur: indexOfHeader(headers, "Currency Type"),
    quotePrice: indexOfHeader(headers, "Quote Price"),
    confPrice: indexOfHeader(headers, "Confirmed Price"),
    usd: indexOfHeader(headers, "USD Conversion"),
    btype: indexOfHeader(headers, "Business Type"),
    am: indexOfHeader(headers, "Account/Sales Person"),
    intDelivery: indexOfHeader(headers, "Internal Delivery"),
    intHrs: indexOfHeader(headers, "Internal hrs"),
    actHrs: indexOfHeader(headers, "Actual hrs"),
    optimisation: indexOfHeader(headers, "Optimization"),
    expert: indexOfHeader(headers, "Expert"),
    integration: indexOfHeader(headers, "Integration (Only for LP)"),
    outsource: indexOfHeader(headers, "Outsource Price"),
    outsourceUsd: indexOfHeader(headers, "Outsource Price (USD)"),
    feedbackStatus: indexOfHeader(headers, "Feedback Status"),
    invoiceNo: indexOfHeader(headers, "Invoice No"),
    invoiceCur: indexOfHeader(headers, "Invoice Currency"),
    invoiceAmt: indexOfHeader(headers, "Invoice Amount"),
    month: indexOfHeader(headers, "Month-Year"),
    week: indexOfHeader(headers, "Week Start"),
  };
  // trailingMonth is computed above, against the headers as the source tab has them —
  // the tab's last column has an EMPTY header and repeats Month-Year, and it can only be
  // addressed by position.

  const { data: opps, error: oe } = await sb.from("opportunities")
    .select("id, quote_key, project_id, quote_id, company_name, source_subject, client_name, contact_email, client_type, service_dept, service_type, delivery_type, delivery_status, project_type, technology, geo, pm_owner, sales_person, business_type, currency, quote_price, local_value, est_value, start_date, delivery_date, confirmed_at, source_date, origin, expert, internal_delivery, internal_hrs, actual_hrs, integration, outsource_price, outsource_currency, contractor_name, invoice_no, invoice_currency, invoice_amount, feedback_status")
    .eq("won", true).not("confirmed_by", "is", null);
  if (oe) throw new Error("opportunities: " + oe.message);

  for (const o of opps || []) {
    const row = new Array(headers.length).fill("");
    const put = (i: number, v: string) => { if (i >= 0) row[i] = v; };
    // A recurring entry is added in one month FOR another; source_date holds the month it
    // belongs to. Using confirmed_at would file October's retainers under September.
    const monthOf = o.origin === "recurring" ? (o.source_date || o.confirmed_at) : (o.confirmed_at || o.source_date);

    // Project Id is written ONLY if somebody typed one. It was derived here before, as
    // PRJ + the quote digits or PRJ-D<id>, but the real ones follow a format this system
    // cannot reproduce — so a generated value was a plausible wrong id in a column people
    // match on. A blank cell is visibly waiting for someone; a wrong id is not.
    put(col.projectId, s(o.project_id));
    // Quote ID falls back to quote_key only where that key is a real QUT reference. A
    // hand-entered deal's key is 'pm:<uuid>', which is internal identity, not a quote
    // number, and does not belong in a column people read.
    const qk = s(o.quote_key);
    put(col.quote, s(o.quote_id) || (/^QUT/i.test(qk) ? qk : ""));
    put(col.dept, s(o.service_dept));
    put(col.project, s(o.source_subject));
    put(col.ptype, s(o.project_type));
    put(col.tech, s(o.technology));
    put(col.conf, sheetDate(o.confirmed_at));
    put(col.start, sheetDate(o.start_date));
    put(col.delivery, sheetDate(o.delivery_date));
    put(col.status, s(o.delivery_status) || "Under Development");
    put(col.stype, s(o.service_type));
    put(col.dtype, s(o.delivery_type));
    put(col.sme, s(o.pm_owner));
    put(col.agency, s(o.company_name));
    put(col.clientName, s(o.client_name));
    put(col.email, s(o.contact_email));
    put(col.clientType, s(o.client_type));
    put(col.geo, geoRegion(o.geo));
    put(col.cur, s(o.currency || "USD"));
    // Quote Price is what was quoted BEFORE negotiation. Left blank where there was no
    // formal quote rather than copied from the confirmed figure, which would erase the
    // discount by making every deal look like it closed at the asking price.
    put(col.quotePrice, o.quote_price == null ? "" : money(o.quote_price));
    put(col.confPrice, money(o.local_value ?? o.est_value));
    put(col.usd, money(o.est_value));
    put(col.btype, s(o.business_type));
    put(col.am, s(o.sales_person));
    // Filled in after the fact, from the ledger, by delivery and by finance. Blank until
    // then — which is the honest state, not a gap to paper over.
    //
    // The Expert column says "Contractor" on outsourced work, matching what the tab's own
    // 3,106 filled rows already say. WHICH contractor is held in the dashboard only: the
    // tab has no column for it, and inventing one would break a paste back into the
    // source spreadsheet.
    put(col.expert, s(o.expert));
    put(col.intDelivery, sheetDate(o.internal_delivery));
    put(col.intHrs, o.internal_hrs == null ? "" : String(o.internal_hrs));
    put(col.actHrs, o.actual_hrs == null ? "" : String(o.actual_hrs));
    // Arithmetic on the two hour columns, so it is computed rather than carried. It can
    // never disagree with them, and there is nothing to keep in step.
    put(col.optimisation,
        (o.internal_hrs != null && o.actual_hrs != null && Number(o.internal_hrs) > 0)
          ? `${Math.round(((Number(o.internal_hrs) - Number(o.actual_hrs)) / Number(o.internal_hrs)) * 100)}%`
          : "");
    put(col.integration, s(o.integration));
    put(col.feedbackStatus, s(o.feedback_status));
    put(col.invoiceNo, s(o.invoice_no));
    put(col.invoiceCur, s(o.invoice_currency));
    put(col.invoiceAmt, o.invoice_amount == null ? "" : money(o.invoice_amount));
    // What an outsourced build cost. The sheet keeps the local figure and a USD one but
    // no currency column, so the conversion has to happen here or the two disagree the
    // moment a contractor invoices in anything but dollars.
    put(col.outsource, o.outsource_price == null ? "" : money(o.outsource_price));
    // The USD column is 99.8% zero in the source, so an unset cost books as zero rather
    // than blank — that is what every existing row does.
    put(col.outsourceUsd, money(toUsd(o.outsource_price ?? 0, o.outsource_currency || "USD", rates)));
    put(col.month, sheetMonth(monthOf));
    put(col.week, sheetWeek(o.start_date));
    if (trailingMonth >= 0) row[trailingMonth] = sheetMonth(monthOf);
    // Stamped last, and the invoice columns after it: from 1 October these are the rows
    // that only exist because somebody confirmed a deal here, so they are the ones whose
    // invoice cells would otherwise be wiped on every run.
    const ref = `opp:${o.id}`;
    row[refCol] = ref;
    keepInvoice(row, ref);
    markDeleted(row, ref);
    grid.push(row);
  }
  return grid;
}

const QUOTE_HEADERS = [
  "Quote ID", "Added Date", "Service Department", "Technology", "Email Subject Line / Project Name",
  "Agency", "Client Email", "PC/SME", "Project Type", "Currency Type", "Estimated Cost",
  "USD Conversion", "Status", "Notes", "GEO", "Business Type", "Account/Sales Person", "Confirmed in Days",
];

async function buildQuotes(sb: any): Promise<string[][]> {
  const rows: { date: string; cells: string[] }[] = [];

  const { data: qs, error } = await sb.from("quotes")
    .select("quote_id, added_date, service_dept, technology, subject_project, agency, client_email, pc_sme, project_type, currency_type, estimated_cost, usd_value, status, notes, geo, business_type, sales_person, confirmed_in_days")
    .order("id");
  if (error) throw new Error("quotes: " + error.message);
  for (const q of qs || []) {
    rows.push({ date: s(q.added_date), cells: [
      s(q.quote_id), sheetDate(q.added_date), s(q.service_dept), s(q.technology), s(q.subject_project),
      s(q.agency), s(q.client_email), s(q.pc_sme), s(q.project_type), s(q.currency_type), money(q.estimated_cost),
      money(q.usd_value), s(q.status), s(q.notes), s(q.geo), s(q.business_type), s(q.sales_person),
      q.confirmed_in_days === null || q.confirmed_in_days === undefined ? "" : String(q.confirmed_in_days),
    ] });
  }

  // Deals that exist only here — entered by hand or found in email, open ones included.
  // Sheet-origin rows are excluded because they are already above, from the quotes table.
  //
  // Read from web_dashboard_quotes, not from `opportunities` directly. Three columns on
  // a scanned deal are empty or wrong at source and are resolved in that view, where the
  // resolution can be checked with a query instead of being buried in here:
  //   • Quote ID was printing the row's internal key — "email:19f7d75088b8b0a8", a Gmail
  //     thread id. In a column people match on, that is worse than a blank.
  //   • Client Email is never set by the scan; it comes from the client record, then from
  //     the address the scan actually read the deal from.
  //   • Service Department is never set either; it comes from the PM's team, so Nitin and
  //     Madhav's deals read LP/HUB.
  const { data: dash, error: de } = await sb.from("web_dashboard_quotes")
    .select("quote_id, added_date, service_dept, technology, subject_project, agency, client_email, pc_sme, project_type, currency_type, estimated_cost, usd_value, status, notes, geo, business_type, sales_person, confirmed_in_days");
  if (de) throw new Error("web_dashboard_quotes: " + de.message);
  for (const q of dash || []) {
    rows.push({ date: s(q.added_date), cells: [
      s(q.quote_id), sheetDate(q.added_date), s(q.service_dept), s(q.technology), s(q.subject_project),
      s(q.agency), s(q.client_email), s(q.pc_sme), s(q.project_type), s(q.currency_type), money(q.estimated_cost),
      money(q.usd_value), s(q.status), s(q.notes), s(q.geo), s(q.business_type), s(q.sales_person),
      q.confirmed_in_days === null || q.confirmed_in_days === undefined ? "" : String(q.confirmed_in_days),
    ] });
  }

  // NEWEST FIRST, across both sources. Until now the tab was two blocks in two different
  // orders — the quotes table by row id, then the dashboard's deals — so the dates ran
  // forwards, stopped, and started again. Sorted on the ISO date rather than the printed
  // one, because "21-Sep-2026" sorts alphabetically and nonsensically. Rows with no date
  // go last: they are not the oldest, they are undated.
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return [QUOTE_HEADERS, ...rows.map((r) => r.cells)];
}

const FEEDBACK_HEADERS = [
  "Added Date", "Service Department", "PC/SME", "Feedback Type", "Feedback Visibility", "Nature",
  "Agency", "GEO", "Client Email", "Project Names", "Comments", "Month year", "Proof/Screenshot",
];

async function buildFeedback(sb: any): Promise<string[][]> {
  const grid: string[][] = [FEEDBACK_HEADERS];
  const { data, error } = await sb.from("feedback")
    .select("added_date, service_dept, pc_sme, feedback_type, visibility, nature, agency, geo, client_email, project_names, comments, month_year, evidence")
    .order("id");
  if (error) throw new Error("feedback: " + error.message);
  for (const f of data || []) {
    grid.push([
      sheetDate(f.added_date), s(f.service_dept), s(f.pc_sme), s(f.feedback_type), s(f.visibility), s(f.nature),
      s(f.agency), s(f.geo), s(f.client_email), s(f.project_names), s(f.comments), sheetMonth(f.month_year), s(f.evidence),
    ]);
  }

  // Praise the mail scan found — what the Delights board shows.
  //
  // These have never reached a spreadsheet. The feedback table is filled in by hand, and
  // a client writing "this was brilliant, thank you" in a reply is never typed into it —
  // so the best evidence we have of clients being happy lived on one screen and nowhere
  // else. It goes in the same columns as the rest.
  //
  // Nature is 'Positive' because that is the only sentiment selected here; Feedback Type
  // says Email so a reader can tell at a glance which rows somebody logged deliberately
  // and which the scan picked up.
  const { data: sigs, error: se } = await sb.from("email_signals")
    .select("company_name, client_email, summary, source_subject, source_date, signal_type")
    .eq("sentiment", "Positive").order("source_date");
  if (se) throw new Error("email_signals: " + se.message);
  for (const g of sigs || []) {
    grid.push([
      sheetDate(g.source_date), "", "", "Email", "", "Positive",
      s(g.company_name), "", s(g.client_email), s(g.source_subject), s(g.summary),
      sheetMonth(g.source_date), "",
    ]);
  }
  return grid;
}

// ---- Entry point ----------------------------------------------------------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b, null, 2), { status, headers: { "Content-Type": "application/json" } });

  try {
    const sheetId = Deno.env.get("TARGET_SHEET_ID");
    const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    // NEVER echo the value of either. The point of a setup check is that a variable may
    // not hold what its name says — printing it to prove that is how a private key ends
    // up in a log. Report only whether it is set, and its shape.
    if (!sheetId || !saRaw) {
      return json({
        ok: false,
        error: "not configured yet",
        needed: {
          TARGET_SHEET_ID: sheetId ? "set" : "MISSING — the new spreadsheet's id from its URL",
          GOOGLE_SERVICE_ACCOUNT_JSON: saRaw ? "set" : "MISSING — the service account JSON key, whole",
        },
        then: "share the spreadsheet with the service account's client_email as Editor",
      }, 400);
    }
    // A sheet id is a short opaque string. Anything long or multi-line is the wrong
    // value in the wrong variable — which has happened, with a private key.
    if (sheetId.length > 120 || /\s/.test(sheetId)) {
      return json({ ok: false, error: "TARGET_SHEET_ID does not look like a spreadsheet id (too long, or contains whitespace). Set it to just the id from the URL." }, 400);
    }

    let sa: any;
    try { sa = JSON.parse(saRaw); }
    catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the whole key file, from { to }"); }
    if (!sa.client_email || !sa.private_key) throw new Error("service account JSON has no client_email/private_key");

    // A dry run proves the data is right before anything is written to Google.
    const dry = url.searchParams.get("dry") === "1";

    // The token is taken BEFORE the tabs are built, because buildRevenue has to read the
    // invoice columns out of the target sheet before anything clears it. A dry run takes
    // one too — it reads, and reading is the point of a dry run.
    const tok = await accessToken(sa);

    const tabs: Record<string, string[][]> = {
      "Web, Hub & LP": await buildRevenue(sb, tok, sheetId),
      "Quotes": await buildQuotes(sb),
      "Feedback": await buildFeedback(sb),
    };
    const counts = Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length - 1]));

    if (dry) return json({ ok: true, dry_run: true, service_account: sa.client_email, rows: counts });

    await ensureTabs(tok, sheetId, Object.keys(tabs));
    const written: Record<string, number> = {};
    for (const [name, grid] of Object.entries(tabs)) written[name] = await writeTab(tok, sheetId, name, grid);

    await sb.from("sync_runs").insert({
      source: "sheet-writer", ok: true,
      rows_upserted: Object.values(written).reduce((a, b) => a + b, 0),
      message: Object.entries(written).map(([k, v]) => `${k}:${v}`).join(" · "),
    });
    return json({ ok: true, sheet: sheetId, written });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "sheet-writer", ok: false, message: String(e) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
