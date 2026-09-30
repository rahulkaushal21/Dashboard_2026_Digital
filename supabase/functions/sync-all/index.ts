// sync-all — one press, the whole chain, in dependency order.
//
// WHY THIS FUNCTION EXISTS AT ALL
//
// The dashboard's "Sync now" button used to call sync-web-revenue and nothing else, so
// it refreshed one of six feeds and left the rest on their cron schedule. From 1 Oct 2026
// the direction reverses — the dashboard is the record and the project sheet is its dump
// (see README-sheet-writer.md) — which makes the ORDER of the steps load-bearing: writing
// the sheet before the inbound pulls have landed publishes yesterday's numbers.
//
// It cannot be a Next.js API route. The site is a static export on GitHub Pages
// (next.config.js, DEPLOY_TARGET=github) and has no server runtime, so there is nowhere
// in the app to keep a token. sheet-raw, sheet-sync, quote-sync and sheet-writer are all
// token-only; putting those tokens in the browser bundle would publish them. So the
// orchestration lives here, server-side, and the browser presents only the anon key —
// exactly the arrangement sync-lnd already uses.
//
// WHAT IT DOES NOT DO
//
// It does not widen anyone's rights. Every downstream function keeps its own token; this
// one holds them and is itself anon-callable, which means a full resync is a button
// anybody with the public anon key could press. That is a cost question, not a data one:
// every step is an idempotent full replace, so running it twice produces the same state.
// The 60-second floor below is what stops a stuck tab or a double-click from stampeding.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// This function's own token, for cron. The browser uses the anon key instead.
const TOKEN = "syncAllHub_9b4e27";

// Downstream tokens. Held here so they never reach a browser bundle. Never echoed:
// README-sheet-writer.md records what happened the one time a diagnostic printed one back.
// `method` is per function and is NOT cosmetic. The first dry run POSTed to all four:
// sheet-raw's POST branch expects a {tab, rows} body pushed by the Apps Script and died on
// "Unexpected end of JSON input", and quote-sync returned 401 because its token was left
// null. Its pull is the GET branch in both cases.
const FN = {
  sheetRaw: { path: "sheet-raw?tab=revenue", token: "ingestWebHub_a7c2e9", method: "GET" },
  sheetSync: { path: "sheet-sync", token: "syncWebHubLP_8f3a91", method: "POST" },
  quoteSync: { path: "quote-sync", token: "ingestQuoteApi_5d1b83", method: "GET" },
  sheetWriter: { path: "sheet-writer", token: "writeWebHub_5c1d73", method: "GET" },
  webRevenue: { path: "sync-web-revenue", token: null as string | null, method: "POST" },
};

const BASE = () => (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "") + "/functions/v1/";

type Step = { step: string; ok: boolean; ms: number; detail?: unknown; error?: string; skipped?: string };

/** Call one edge function and summarise it. A step never throws — a failed step is data. */
async function call(name: string, spec: { path: string; token: string | null; method?: string }, extra = ""): Promise<Step> {
  const t0 = Date.now();
  const sep = spec.path.includes("?") ? "&" : "?";
  const qs = [spec.token ? `token=${spec.token}` : "", extra].filter(Boolean).join("&");
  const url = BASE() + spec.path + (qs ? sep + qs : "");
  try {
    const res = await fetch(url, {
      method: spec.method || "POST",
      headers: {
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
        Authorization: "Bearer " + (Deno.env.get("SUPABASE_ANON_KEY") || ""),
      },
    });
    const body = await res.json().catch(() => null);
    const ok = res.ok && (body == null || body.ok !== false);
    return {
      step: name,
      ok,
      ms: Date.now() - t0,
      detail: body ?? undefined,
      // res.statusText only, never the body of an auth failure — it can carry the URL.
      error: ok ? undefined : body?.error ? String(body.error) : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { step: name, ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

/** Run a DB function through PostgREST with the service role. */
async function rpc(sb: string, key: string, fn: string): Promise<Step> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${sb}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await res.json().catch(() => null);
    return { step: fn, ok: res.ok, ms: Date.now() - t0, detail: body ?? undefined, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { step: fn, ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const presented = req.headers.get("apikey") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(url.searchParams.get("token") === TOKEN || (!!anon && presented === anon))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const SB = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SB || !SRK) return json({ ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" }, 500);

  // `dry=1` runs the inbound pulls and the derive chain but asks sheet-writer to report
  // what it WOULD change without touching Google. Use it the first time after any change
  // to the writer or the tab layout.
  const dry = url.searchParams.get("dry") === "1";
  // `pull=0` skips the inbound sheet reads for the day the source sheet is retired —
  // see the note in the reply where this was built. Default is to pull.
  const pull = url.searchParams.get("pull") !== "0";

  // ---- 60-second floor ----------------------------------------------------
  // Two people on the page, or one impatient double-click, otherwise means two full
  // chains racing: sheet-writer would be replacing tabs while the pulls behind it are
  // still writing rows, and the sheet would land half from each run.
  const recent = await fetch(
    `${SB}/rest/v1/sync_runs?source=eq.sync-all&order=ran_at.desc&limit=1&select=ran_at`,
    { headers: { apikey: SRK, Authorization: "Bearer " + SRK } },
  ).then((r) => r.json()).catch(() => null);
  const lastAt = Array.isArray(recent) && recent[0]?.ran_at ? Date.parse(recent[0].ran_at) : 0;
  const sinceMs = lastAt ? Date.now() - lastAt : Infinity;
  if (url.searchParams.get("force") !== "1" && sinceMs < 60_000) {
    return json({
      ok: true,
      throttled: true,
      message: `A full sync finished ${Math.round(sinceMs / 1000)}s ago — showing that one rather than running it again.`,
      steps: [],
    });
  }

  const t0 = Date.now();
  const steps: Step[] = [];

  // ---- PHASE 1: inbound pulls, in parallel --------------------------------
  // None of these reads another's output, so they run together. Ordering them serially
  // only made the button slower.
  if (pull) {
    steps.push(
      ...(await Promise.all([
        call("sheet-raw (revenue tab, verbatim)", FN.sheetRaw),
        call("sync-web-revenue", FN.webRevenue),
        call("sheet-sync (quotes, esc, feedback, sql)", FN.sheetSync),
        call("quote-sync (quote API)", FN.quoteSync),
      ])),
    );
  } else {
    steps.push({ step: "inbound sheet pulls", ok: true, ms: 0, skipped: "pull=0 — source sheet retired" });
  }

  // ---- PHASE 2: derive, strictly after the pulls ---------------------------
  // ONE call, not six. run_refresh_chain() holds the order and keeps rebuild_clients and
  // compute_client_sentiment in one transaction, so a failure between them cannot leave the
  // board showing zero At Risk clients.
  //
  // It needs service_role.statement_timeout raised above 8s to finish. PostgREST connects
  // as `authenticator`, which carries statement_timeout=8s, and every rpc inherits it —
  // the chain died at 8.3s on two dry runs. Raising it inside the function does NOT work,
  // because statement_timeout is armed when the top-level statement begins:
  //   alter role service_role set statement_timeout = '240s';
  // If this step ever returns 57014 again, that role setting is the first thing to check.
  steps.push(await rpc(SB, SRK, "run_refresh_chain"));

  // ---- PHASE 3: outbound, last -------------------------------------------
  // The whole reason this function exists. sheet-writer dumps the dashboard into the
  // project sheet's three visible tabs (Web Hub & LP, Quotes, Feedback) plus the hidden
  // Vendor Calculator. It runs LAST so it writes what the pulls and the derive chain just
  // produced. On cron it sits at :47, six minutes behind sheet-raw-revenue at :41, for
  // the same reason.
  //
  // It is skipped when an earlier step failed: publishing a sheet built on a half-loaded
  // database is worse than publishing nothing, because the sheet looks authoritative.
  const upstreamOk = steps.every((s) => s.ok);
  if (upstreamOk) {
    steps.push(await call(dry ? "sheet-writer (dry run)" : "sheet-writer → project sheet", FN.sheetWriter, dry ? "dry=1" : ""));
  } else {
    steps.push({
      step: "sheet-writer → project sheet",
      ok: true,
      ms: 0,
      skipped: "an earlier step failed — not publishing a sheet built on partial data",
    });
  }

  const failed = steps.filter((s) => !s.ok);
  const ok = failed.length === 0;
  const ms = Date.now() - t0;

  const summary = ok
    ? `Synced ${steps.filter((s) => !s.skipped).length} steps in ${(ms / 1000).toFixed(1)}s`
    : `${failed.length} of ${steps.length} steps failed: ${failed.map((s) => s.step).join(", ")}`;

  await fetch(`${SB}/rest/v1/sync_runs`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "sync-all",
      ok,
      rows_upserted: 0,
      message: (dry ? "DRY RUN · " : "") + summary,
    }),
  }).catch(() => {});

  // 200 even on a partial failure: the body says what broke, and a non-2xx here made the
  // button report "unreachable" for a run that did most of its work.
  return json({ ok, dry_run: dry || undefined, ms, summary, steps });
});
