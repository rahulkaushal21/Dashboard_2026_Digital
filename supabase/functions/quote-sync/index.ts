// quote-sync — mirror the Custom Dashboard API (quote.uplers.net) into Supabase.
//
// Four endpoints, one funnel: GetOpportunity → GetRFQ → GetQuote → GetInvoices.
// See migration 093 for why the join key is a timestamp suffix and why "pipeline raised"
// and "RFQ raised" are two independent facts rather than two steps.
//
// ---------------------------------------------------------------------------
// WHY THIS RE-PULLS INSTEAD OF SYNCING INCREMENTALLY
//
// The API takes FROMDATE and TODATE and nothing else. There is no "modified since", no
// cursor, no ETag. A record's STATUS changes long after its date — an invoice raised in
// April is paid in June and goes overdue in July, and none of that moves it out of the
// April window. So an incremental sync keyed on date would capture every invoice exactly
// once, in the state it was born in, and never learn that it was paid. Which is the one
// thing this integration exists to know.
//
// Hence a rolling re-pull: WINDOW_DAYS back from today, every run, upserting on the
// natural key. Six months of invoices is ~7.6 MB, so the cost of being correct here is
// trivial and the cost of being clever is wrong data.
//
// GET ?token=…                 → rolling window (default 120 days)
// GET ?token=…&days=400        → wider window
// GET ?token=…&from=01/04/2026&to=30/09/2026  → explicit range, for a backfill
//
// ---------------------------------------------------------------------------
// THE API TOKEN
//
// QUOTE_API_TOKEN is a shared static credential — the same value for all four endpoints
// and, as far as the API is concerned, for everyone who holds it. It is read from the
// environment and never logged, never echoed, and never returned in a response body. It
// is checked for SHAPE only: a variable is only as trustworthy as its contents, and
// printing one to prove what it holds is how a credential ends up in a log.
//
// It must never reach the browser. This dashboard is a static export — anything in the
// bundle is public — which is the whole reason this runs server-side.
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const INGEST_TOKEN = "ingestQuoteApi_5d1b83";
const HOST = "https://quote.uplers.net/CustomDashboard";
const WINDOW_DAYS = 120;
const CHUNK = 500;

/** Present and plausibly a token. Never printed — only accepted or not. */
function apiToken(): string | null {
  const v = (Deno.env.get("QUOTE_API_TOKEN") || "").trim();
  if (!v) return null;
  if (v.length < 16 || v.length > 256 || /\s/.test(v)) return null;
  return v;
}

// -- parsing -----------------------------------------------------------------
// The payload carries three date formats and uses "" rather than null for absent.
//   '28/09/2026 07:39:26 PM'   most fields
//   '31/01/2027'               DealCloseDate
//   '2026-09-28T19:42:21.053'  RenewedDate
const s = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return t === "" || t === " - " ? null : t;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const b = (v: unknown): boolean | null =>
  v === true || v === false ? v : v === "Yes" ? true : v === "No" ? false : null;

function ts(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return new Date(t).toISOString();
  const m = t.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M))?$/i,
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss, ap] = m;
  let h = hh ? parseInt(hh, 10) : 0;
  if (ap) {
    const pm = ap.toUpperCase() === "PM";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  // The API reports wall-clock with no zone. Stored as UTC so the same string always
  // yields the same instant; a wrong zone would shift dates across a month boundary and
  // quietly move revenue between months.
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, h, mi ? +mi : 0, ss ? +ss : 0))
    .toISOString();
}
const dt = (v: unknown): string | null => ts(v)?.slice(0, 10) ?? null;

const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${
    String(d.getUTCMonth() + 1).padStart(2, "0")
  }/${d.getUTCFullYear()}`;

async function fetchAll(ep: string, token: string, from: string, to: string) {
  const r = await fetch(`${HOST}/${ep}`, {
    method: "POST",
    headers: { "Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ FROMDATE: from, TODATE: to }),
  });
  if (!r.ok) throw new Error(`${ep} returned HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.IsSuccess) throw new Error(`${ep} reported failure: ${s(j?.Message) ?? "no message"}`);
  return (j.Data ?? []) as Record<string, unknown>[];
}

// -- mapping -----------------------------------------------------------------

const mapOpp = (x: Record<string, unknown>) => ({
  opportunity_no: s(x.OpportunityNumber),
  company_name: s(x.HSCompanyName),
  project_name: s(x.ProjectName),
  client_email: s(x.ClientEmail),
  service: s(x.Service),
  bu_type: s(x.BUType),
  geo: s(x.GEO),
  am: s(x.AM),
  geo_head: s(x.GEOHead),
  technology: s(x.Technology),
  engagement_model: s(x.EngagementModel),
  currency: s(x.Currency),
  amount: n(x.Amount),
  amount_usd: n(x.AmountInUSD),
  status: s(x.Status),
  stage: s(x.Stage),
  final_stage: s(x.FinalStage),
  deal_created_at: ts(x.DealCreatedDate),
  deal_at: ts(x.DealDate),
  deal_close_on: dt(x.DealCloseDate),
  pipeline_at: ts(x.PipelineDate),
  rfq_created_at: ts(x.RFQCreatedDate),
  dead_at: ts(x.OpportunityDeadDate),
  deleted_at: ts(x.DeletedDate),
  deleted_by: s(x.DeletedBy),
  renewed_at: ts(x.RenewedDate),
  payload: x,
  synced_at: new Date().toISOString(),
});

// RFQ and Quote are ONE row. GetRFQ is applied first and carries the money — the Quote
// endpoint returns Amount 0.0 on records the RFQ prices at 170.00, so taking the quote's
// figure would zero out live deals. The quote then fills in only what it alone knows.
const mapRfq = (x: Record<string, unknown>) => ({
  quote_no: s(x.QuoteNumber),
  rfq_no: s(x.RFQNumber),
  company_name: s(x.CompanyName),
  project_name: s(x.ProjectName),
  client_email: s(x.ClientEmail),
  service: s(x.Service),
  bu_type: s(x.BUType),
  geo: s(x.GEO),
  am: s(x.AM),
  geo_head: s(x.GEOHeadName),
  pc: s(x.PC),
  sme: s(x.SME),
  type_of_work: s(x.TypeOfWork),
  engagement_model: s(x.EngagementModel),
  currency: s(x.Currency),
  amount: n(x.Amount),
  amount_usd: n(x.AmountInUSD),
  status: s(x.Status),
  created_at: ts(x.CreatedByDatetime),
  modified_at: ts(x.LastModifiedDatetime),
  rfq_cancelled_at: ts(x.RFQCancelledDate),
  payload: x,
  synced_at: new Date().toISOString(),
});

// Only what the quote endpoint alone knows. Deliberately NOT company/amount/status:
// those come from the RFQ pass, and GetQuote reports Amount 0.0 on live priced deals.
const mapQuote = (x: Record<string, unknown>) => ({
  quote_no: s(x.QuoteNumber),
  quote_payload: x,
  authorized_at: ts(x.QuoteAuthorizeDate),
  approved_at: ts(x.QuoteApprovedDate),
  declined_at: ts(x.QuoteDeclineDate),
  synced_at: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// AN INVOICE IS NOT A ROW
//
// GetInvoices returns ONE ROW PER LINE ITEM, with every invoice-level field repeated on
// each line. September: 577 rows, 489 invoices, one of them carrying 11 lines.
//
// Checked over six months (4,382 rows): Status, TotalInvoiceAmountInUSD, ProjectId,
// DueDate, PaidDate, QuoteNumber, BUType and Currency NEVER vary within one
// InvoiceNumber, so they are safe as header fields. Service, ServiceAmount,
// ServiceAmountInUSD, ProjectName, UniqueId and StartDate differ per line.
//
// Getting this wrong costs money in two directions:
//   - summing the repeated invoice total doubles it ($1,953,497 vs a true $963,211)
//   - 29 of 58 multi-line invoices mix one of our services with another, so our share is
//     the sum of OUR LINES ($1,294,168) and not the invoice totals ($1,659,764) — a 28%
//     overstatement over six months.
// ---------------------------------------------------------------------------

const mapInvHeader = (x: Record<string, unknown>) => ({
  invoice_no: s(x.InvoiceNumber),
  project_id: s(x.ProjectId),
  order_project_id: s(x.OrderProjectID),
  quote_no: s(x.QuoteNumber),
  // The invoice record has no CompanyName field at all — only the two CRM-side names.
  company_name: s(x.HSCompany) ?? s(x.ZohoCompany),
  client_email: s(x.ZohoEmailId),
  bu_type: s(x.BUType),
  geo: s(x.GEO),
  sales_person: s(x.SalesPerson),
  pc: s(x.PC),
  engagement_model: s(x.EngagementModel),
  zoho_company: s(x.ZohoCompany),
  zoho_invoice_no: s(x.ZohoInvoiceNumber),
  status: s(x.Status),
  currency: s(x.Currency),
  conversion_rate: n(x.ConversionRate),
  total_usd: n(x.TotalInvoiceAmountInUSD),
  partially_paid_usd: n(x.PartiallyPaidAmountUSD),
  write_off_usd: n(x.WriteOffAmountUSD),
  is_partial: b(x.IsPartialInvoice),
  invoice_pattern: s(x.InvoicePattern),
  payment_term: s(x.PaymentTerm),
  created_at: ts(x.CreatedDate),
  invoice_at: ts(x.InvoiceDate),
  booking_at: ts(x.InvoiceBookingDate),
  sent_at: ts(x.InvoiceSentDate),
  due_at: ts(x.DueDate),
  paid_at: ts(x.PaidDate),
  void_at: ts(x.VoidDate),
  refund_at: ts(x.RefundDate),
  archived_at: ts(x.ArchieveDate),
  payload: x,
  synced_at: new Date().toISOString(),
});

const mapInvLine = (x: Record<string, unknown>, line_key: string) => ({
  line_key,
  invoice_no: s(x.InvoiceNumber),
  unique_id: s(x.UniqueId),
  service: s(x.Service),
  project_name: s(x.ProjectName),
  technology: s(x.Technology),
  type_of_work: s(x.Typeofwork),
  amount: n(x.ServiceAmount),
  amount_usd: n(x.ServiceAmountInUSD),
  outsource_amount: n(x.OutSourceAmount),
  execution_type: s(x.ExecutionType),
  frequency: s(x.FrequencyPeriod),
  start_at: dt(x.StartDate),
  end_at: dt(x.EndDate),
  payload: x,
  synced_at: new Date().toISOString(),
});

/**
 * invoice | uniqueId | service, plus an ordinal.
 *
 * UniqueId is '<lineId>_<invoiceId>' and is ALMOST unique — the exceptions are lines
 * carrying line id 0, where only Service tells them apart (a $105 'Paypal Fee' beside a
 * $3,000 'Wallet'). Adding Service resolves all but one case in six months: two distinct
 * 'Reimbursement for MacBook Display' lines of $865.52 each on one invoice. Both are real
 * money, so they cannot be deduped away — hence the ordinal, assigned after sorting the
 * group by its serialised body so the same pull always yields the same keys no matter
 * what order the API returns them in.
 */
function lineKeys(rows: Record<string, unknown>[]): [Record<string, unknown>, string][] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = `${s(r.InvoiceNumber)}|${s(r.UniqueId) ?? ""}|${s(r.Service) ?? ""}`;
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(r);
  }
  const out: [Record<string, unknown>, string][] = [];
  for (const [k, g] of groups) {
    if (g.length === 1) { out.push([g[0], k]); continue; }
    g.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    g.forEach((r, i) => out.push([r, `${k}|${i}`]));
  }
  return out;
}

/** Last write wins within a batch — the API can return the same key twice. */
function dedupe<T extends Record<string, unknown>>(rows: T[], key: string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = r[key];
    if (typeof k === "string" && k) m.set(k, r);
  }
  return [...m.values()];
}

async function upsert(
  db: ReturnType<typeof createClient>,
  table: string,
  rows: Record<string, unknown>[],
  key: string,
) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), {
      onConflict: key,
    });
    if (error) throw new Error(`${table}: ${error.message}`);
    done += Math.min(CHUNK, rows.length - i);
  }
  return done;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== INGEST_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  const token = apiToken();
  if (!token) {
    // Says whether it is set and usable, not what it contains.
    return new Response(
      JSON.stringify({
        ok: false,
        error: "QUOTE_API_TOKEN is not set, or does not have the shape of a token",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const days = Number(url.searchParams.get("days") || WINDOW_DAYS);
  const now = new Date();
  const from = url.searchParams.get("from") ??
    ddmmyyyy(new Date(now.getTime() - days * 86400000));
  const to = url.searchParams.get("to") ?? ddmmyyyy(now);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const out: Record<string, unknown> = { window: { from, to } };
  try {
    const [opps, rfqs, quotes, invs] = await Promise.all([
      fetchAll("GetOpportunity", token, from, to),
      fetchAll("GetRFQ", token, from, to),
      fetchAll("GetQuote", token, from, to),
      fetchAll("GetInvoices", token, from, to),
    ]);

    out.fetched = {
      opportunities: opps.length,
      rfqs: rfqs.length,
      quotes: quotes.length,
      invoice_lines: invs.length,
    };

    out.opportunities = await upsert(
      db, "quote_api_opportunities",
      dedupe(opps.map(mapOpp).filter((r) => r.opportunity_no), "opportunity_no"),
      "opportunity_no",
    );
    // RFQ first (it carries the amounts), then the quote's own dates on top.
    out.rfqs = await upsert(
      db, "quote_api_quotes",
      dedupe(rfqs.map(mapRfq).filter((r) => r.quote_no), "quote_no"),
      "quote_no",
    );
    out.quotes = await upsert(
      db, "quote_api_quotes",
      dedupe(quotes.map(mapQuote).filter((r) => r.quote_no), "quote_no"),
      "quote_no",
    );
    // Header first — the lines carry a foreign key to it.
    out.invoices = await upsert(
      db, "quote_api_invoices",
      dedupe(invs.map(mapInvHeader).filter((r) => r.invoice_no), "invoice_no"),
      "invoice_no",
    );
    out.invoice_lines = await upsert(
      db, "quote_api_invoice_lines",
      lineKeys(invs.filter((x) => s(x.InvoiceNumber)))
        .map(([x, k]) => mapInvLine(x, k)),
      "line_key",
    );

    await db.from("sync_runs").insert({
      source: "quote-sync",
      ok: true,
      rows_upserted: (out.opportunities as number) + (out.rfqs as number) +
        (out.quotes as number) + (out.invoices as number) +
        (out.invoice_lines as number),
      message: JSON.stringify(out).slice(0, 2000),
    });
    out.ok = true;
    return new Response(JSON.stringify(out), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("sync_runs").insert({
      source: "quote-sync", ok: false, message: msg.slice(0, 2000),
    });
    return new Response(JSON.stringify({ ...out, ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
