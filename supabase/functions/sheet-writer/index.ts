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

async function buildRevenue(sb: any): Promise<string[][]> {
  const { data: fx } = await sb.from("fx_rates").select("currency, rate_to_usd");
  const rates: Record<string, number> = {};
  for (const r of fx || []) rates[String(r.currency).toUpperCase()] = Number(r.rate_to_usd);

  const { data: hdr } = await sb.from("sheet_raw_header").select("headers").eq("tab", "revenue").maybeSingle();
  const headers: string[] = hdr?.headers || [];
  if (!headers.length) throw new Error("no raw header for the revenue tab — run sheet-raw first");

  const grid: string[][] = [headers];

  // 1. The source tab, verbatim, in its own row order.
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("sheet_raw").select("values")
      .eq("tab", "revenue").order("row_index").range(from, from + 999);
    if (error) throw new Error("sheet_raw: " + error.message);
    if (!data?.length) break;
    for (const r of data) {
      const vals: string[] = (r.values || []).map(s);
      while (vals.length < headers.length) vals.push("");
      grid.push(vals.slice(0, headers.length));
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
  // The tab's last column has an EMPTY header and repeats Month-Year. It cannot be found
  // by name, so it is addressed as the last column — and only when it really is nameless,
  // so that naming it one day does not start overwriting a real column.
  const trailingMonth = (headers[headers.length - 1] || "").trim() === "" ? headers.length - 1 : -1;

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
  const grid: string[][] = [QUOTE_HEADERS];

  const { data: qs, error } = await sb.from("quotes")
    .select("quote_id, added_date, service_dept, technology, subject_project, agency, client_email, pc_sme, project_type, currency_type, estimated_cost, usd_value, status, notes, geo, business_type, sales_person, confirmed_in_days")
    .order("id");
  if (error) throw new Error("quotes: " + error.message);
  for (const q of qs || []) {
    grid.push([
      s(q.quote_id), sheetDate(q.added_date), s(q.service_dept), s(q.technology), s(q.subject_project),
      s(q.agency), s(q.client_email), s(q.pc_sme), s(q.project_type), s(q.currency_type), money(q.estimated_cost),
      money(q.usd_value), s(q.status), s(q.notes), s(q.geo), s(q.business_type), s(q.sales_person),
      q.confirmed_in_days === null || q.confirmed_in_days === undefined ? "" : String(q.confirmed_in_days),
    ]);
  }

  // Deals that exist only here — entered by hand or found in email. Sheet-origin rows are
  // excluded because they are already above, from the quotes table itself.
  const { data: opps, error: oe } = await sb.from("opportunities")
    .select("quote_key, quote_id, source_date, service_dept, technology, source_subject, company_name, contact_email, pm_owner, project_type, currency, local_value, est_value, status, gist, geo, business_type, sales_person, origin")
    .in("origin", ["pm", "email", "recurring"]);
  if (oe) throw new Error("opportunities: " + oe.message);
  for (const o of opps || []) {
    grid.push([
      s(o.quote_id) || s(o.quote_key), sheetDate(o.source_date), s(o.service_dept), s(o.technology), s(o.source_subject),
      s(o.company_name), s(o.contact_email), s(o.pm_owner), s(o.project_type), s(o.currency || "USD"),
      money(o.local_value ?? o.est_value), money(o.est_value), s(o.status), s(o.gist), geoRegion(o.geo),
      s(o.business_type), s(o.sales_person), "",
    ]);
  }
  return grid;
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

    const tabs: Record<string, string[][]> = {
      "Web, Hub & LP": await buildRevenue(sb),
      "Quotes": await buildQuotes(sb),
      "Feedback": await buildFeedback(sb),
    };
    const counts = Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length - 1]));

    if (dry) return json({ ok: true, dry_run: true, service_account: sa.client_email, rows: counts });

    const tok = await accessToken(sa);
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
