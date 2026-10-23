// sheet-verify — does the spreadsheet actually hold every row the dashboard has?
//
// WHY THIS EXISTS. On 23 Oct 2026 the October total read $134,238.97 on the dashboard and
// $133,565.21 on the sheet. Three confirmed deals were missing from the tab, one of them
// ZULU 8's CBHS WeMoney banners at $673.76 — which is the figure the user spotted by
// hand. The writer had run every half hour throughout, reporting ok and, eight minutes
// before a forced run wrote those three rows, "nothing changed — the spreadsheet was left
// alone". Nothing in the data had changed between the two runs.
//
// The writer decides what to add by COMPARING LENGTHS: added = grid.length -
// existing.length, row i against row i. That is fast and it is usually right, but it can
// only ever answer "is the sheet the same shape as the grid", never "is every row I meant
// to write actually there". When the answer to the first is yes and the second is no, it
// reports a clean run and the gap sits there until somebody adds up a column by hand.
//
// So this does not touch the writing. It reads the sheet back afterwards and checks the
// one thing the writer cannot: SET MEMBERSHIP. Every row carries a ref in its last
// column — `raw:<row_index>` for a line that came from the source tab, `opp:<id>` for a
// deal confirmed on the dashboard. The refs the sheet holds must contain every ref the
// database expects. Anything missing is named, counted, and written to sync_runs as a
// FAILED run, so the Daily Pulse chip goes red instead of staying green over a hole.
//
// It is deliberately a separate function. The writer works; the thing it lacks is a
// witness, and a witness that shares the code it is checking is not a witness.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "verifyWebHub_9b4e27";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TAB = "Web, Hub & LP";

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
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

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const sheetId = Deno.env.get("TARGET_SHEET_ID");
    const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!sheetId || !saRaw) throw new Error("TARGET_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON is not set");
    const sa = JSON.parse(saRaw);
    const tok = await accessToken(sa);

    // ---- what the sheet holds -------------------------------------------------
    // The ref is the LAST column of the tab, wherever that falls, so the header row
    // decides the index rather than a number written here that would rot.
    const meta = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${TAB}'`)}`,
      { headers: { Authorization: `Bearer ${tok}` } },
    );
    const body = await meta.json();
    if (!meta.ok) throw new Error("sheets read failed: " + (body?.error?.message || meta.status));
    const rows = (body.values || []) as unknown[][];
    if (!rows.length) throw new Error("the tab read back empty — refusing to call that a verification");
    const refCol = (rows[0] || []).length - 1;
    const found = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const v = (rows[i]?.[refCol] ?? "").toString().trim();
      if (v) found.add(v);
    }

    // ---- what the database expects ---------------------------------------------
    const expected = new Set<string>();
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from("sheet_raw").select("row_index")
        .eq("tab", "revenue").order("row_index").range(from, from + 999);
      if (error) throw new Error("sheet_raw: " + error.message);
      if (!data?.length) break;
      for (const r of data) expected.add(`raw:${r.row_index}`);
      if (data.length < 1000) break;
      from += 1000;
    }
    // The same three conditions the writer uses to decide a deal belongs on the tab.
    // If those ever diverge this check starts lying, so they are named here in full
    // rather than hidden behind a view.
    from = 0;
    const oppRow = new Map<string, { company: string; usd: number | null; at: string | null }>();
    for (;;) {
      const { data, error } = await sb.from("opportunities")
        .select("id, company_name, est_value, confirmed_at")
        .eq("won", true).not("confirmed_by", "is", null).is("rolled_into", null)
        .order("id").range(from, from + 999);
      if (error) throw new Error("opportunities: " + error.message);
      if (!data?.length) break;
      for (const o of data) {
        expected.add(`opp:${o.id}`);
        oppRow.set(`opp:${o.id}`, { company: o.company_name || "—", usd: o.est_value, at: o.confirmed_at });
      }
      if (data.length < 1000) break;
      from += 1000;
    }

    // ---- rows too new to blame the writer for ----------------------------------
    // The writer runs at :17 and :47. A deal confirmed at :26 is legitimately not on the
    // tab at :31 — it is waiting, not lost. The very first run of this check fired on
    // exactly that: a deal confirmed 26 seconds after the last write. An alarm that
    // cannot tell waiting from lost gets ignored within a week, and then it is worse
    // than nothing, so anything touched inside the last 40 minutes is PENDING.
    const GRACE_MIN = 40;
    const pendingIds = new Set<number>();
    {
      const cutoff = new Date(Date.now() - GRACE_MIN * 60_000).toISOString();
      const { data } = await sb.from("opportunity_events")
        .select("opportunity_id, at").gte("at", cutoff);
      for (const e of data || []) pendingIds.add(Number(e.opportunity_id));
    }

    // ---- the comparison ---------------------------------------------------------
    const missing: string[] = [];
    const pending: string[] = [];
    for (const ref of expected) {
      if (found.has(ref)) continue;
      const id = ref.startsWith("opp:") ? Number(ref.slice(4)) : NaN;
      if (Number.isFinite(id) && pendingIds.has(id)) pending.push(ref); else missing.push(ref);
    }
    // A ref in the sheet that the database no longer expects is worth knowing too, but
    // it is not an error: a line deleted on the dashboard this minute has not been
    // removed from the tab yet, and the next writer run will take it.
    let extra = 0;
    for (const ref of found) if (!expected.has(ref)) extra++;

    // Money is what makes this readable. A count of missing rows says something is
    // wrong; the dollars say how wrong, and that is the number that gets acted on.
    const missingUsd = missing.reduce((s, r) => s + (oppRow.get(r)?.usd || 0), 0);
    const sample = missing.slice(0, 8).map((r) => {
      const o = oppRow.get(r);
      return o ? `${o.company} ${o.usd == null ? "(no value)" : "$" + Math.round(o.usd)}` : r;
    });

    const ok = missing.length === 0;
    await sb.from("sync_runs").insert({
      source: "sheet-verify", ok,
      rows_upserted: expected.size,
      message: ok
        ? `every one of the ${expected.size} rows the dashboard expects is on the tab${pending.length ? ` · ${pending.length} confirmed in the last ${GRACE_MIN} minutes and still waiting for the writer` : ""}${extra ? ` · ${extra} on the tab the dashboard no longer has` : ""}`
        : `${missing.length} row${missing.length === 1 ? "" : "s"} missing from the tab, $${Math.round(missingUsd).toLocaleString("en-US")} between them — ${sample.join("; ")}${missing.length > 8 ? " …" : ""}${pending.length ? ` · a further ${pending.length} confirmed in the last ${GRACE_MIN} minutes, not counted` : ""}`,
    });

    return json({ ok, expected: expected.size, found: found.size, missing: missing.length, missing_usd: Math.round(missingUsd), pending: pending.length, extra, sample });
  } catch (e) {
    // A verifier that fails silently is worse than no verifier: it is a green light with
    // nothing behind it. Any failure is recorded as a failed run.
    await sb.from("sync_runs").insert({ source: "sheet-verify", ok: false, message: "verification could not run: " + String(e) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
