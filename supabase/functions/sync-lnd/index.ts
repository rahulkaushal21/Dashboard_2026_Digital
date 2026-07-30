import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Learning & Development program sheet, published to web.
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSugFnqoV8DI5eNIjyksc8squVEFQN5AwepNsDPNwqLqCOH5BzISij1xEM-i4A62bK6eD_dlmUGJn2k/pub?gid=1359518278&single=true&output=csv";
const TOKEN = "syncLndHub_4e8b21";

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

// "DATA Updated on 29th July" → 2026-07-29. The sheet omits the year, so it is
// supplied by FY_YEAR (the program runs inside one financial year). An explicit
// year in the banner wins if one ever appears.
function parseSnapshotDate(s: string, fyYear: string): string | null {
  const t = (s || "").replace(/DATA\s+Updated\s+on/i, "").trim();
  const m = t.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3})[A-Za-z]*\.?\s*(\d{4})?$/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  if (!mm) return null;
  const dd = m[1].padStart(2, "0");
  return `${m[3] || fyYear}-${mm}-${dd}`;
}

// "24-Jun-2026" / "1-Jul-2026" / "–" / "-" → ISO date or null.
function parseActivity(s: string): string | null {
  const t = (s || "").trim();
  if (!t || t === "-" || t === "–" || t === "—") return null;
  const m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

function toInt(s: string): number {
  const n = parseInt((s || "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function toPct(s: string): number | null {
  const m = (s || "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const fyYear = url.searchParams.get("year") || String(new Date().getUTCFullYear());
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error("CSV fetch failed: " + res.status);
    const text = await res.text();
    if (text.trimStart().startsWith("<")) throw new Error("CSV unavailable (got HTML — tab not published?)");
    const rows = parseCSV(text);
    if (rows.length < 3) throw new Error("empty CSV");

    // The tab stacks one block per weekly snapshot:
    //   "DATA Updated on <date>"  → then per level: "<Level> Level", a header row,
    //   then numbered learner rows. Blank rows separate blocks.
    type R = {
      snapshot_date: string; level: string; learner_name: string; reporting_manager: string | null;
      total_modules: number; completed: number; in_progress: number; not_started: number;
      sheet_progress: number | null; last_activity: string | null; remarks: string | null; src_row_hash: string;
    };
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // People who have left the program. The sheet keeps them in its older weekly
    // blocks forever, so without this they would reappear on every pull.
    const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const { data: exRows, error: exErr } = await supa.from("lnd_excluded_learners").select("learner_key");
    if (exErr) throw new Error("exclusions: " + exErr.message);
    const excluded = new Set((exRows || []).map((r: { learner_key: string }) => r.learner_key));

    const out = new Map<string, R>();
    let snapshot: string | null = null;
    let level: string | null = null;
    let skippedNoDate = 0;
    let skippedExcluded = 0;

    for (const row of rows) {
      const c0 = (row[0] || "").trim();
      if (/^DATA\s+Updated\s+on/i.test(c0)) {
        snapshot = parseSnapshotDate(c0, fyYear);
        level = null;
        continue;
      }
      if (/\bLevel\b/i.test(c0) && row.slice(1).every((c) => !(c || "").trim())) {
        level = c0.replace(/\s*Level\s*$/i, "").trim();
        continue;
      }
      if (!/^\d+$/.test(c0)) continue;            // header rows, blanks, notes
      const name = (row[1] || "").trim();
      if (!name) continue;
      if (excluded.has(nameKey(name))) { skippedExcluded++; continue; }
      if (!snapshot) { skippedNoDate++; continue; }

      // Last block wins on a duplicate (snapshot_date, learner) inside one pull.
      const key = `${snapshot}|${name.toLowerCase()}`;
      out.set(key, {
        snapshot_date: snapshot,
        level: level || "Unspecified",
        learner_name: name,
        reporting_manager: (row[2] || "").trim() || null,
        total_modules: toInt(row[3]),
        completed: toInt(row[4]),
        in_progress: toInt(row[5]),
        not_started: toInt(row[6]),
        sheet_progress: toPct(row[7] || ""),
        last_activity: parseActivity(row[8] || ""),
        remarks: (row[9] || "").trim() || null,
        src_row_hash: key,
      });
    }

    const data = [...out.values()];
    if (!data.length) throw new Error("no learner rows parsed — refusing to touch lnd_snapshots");

    // UPSERT, not full-replace: snapshots are history. A future pull that no longer
    // contains an old week must not delete that week. Corrections to a week already
    // loaded still land, because the key is (snapshot_date, learner_name).
    let upserted = 0;
    for (let i = 0; i < data.length; i += 500) {
      const chunk = data.slice(i, i + 500);
      const { error } = await supa.from("lnd_snapshots")
        .upsert(chunk, { onConflict: "snapshot_date,learner_name" });
      if (error) throw new Error("upsert: " + error.message);
      upserted += chunk.length;
    }

    const dates = [...new Set(data.map((d) => d.snapshot_date))].sort();
    const latest = dates[dates.length - 1];
    const cur = data.filter((d) => d.snapshot_date === latest);
    const modules = cur.reduce((s, d) => s + d.total_modules, 0);
    const done = cur.reduce((s, d) => s + d.completed, 0);
    await supa.from("sync_runs").insert({
      source: "lnd-sync", rows_upserted: upserted, ok: true,
      message: `${dates.length} snapshots · latest ${latest} · ${cur.length} learners · ${done}/${modules} modules complete · ${skippedExcluded} rows skipped (left the program)`,
    });

    return new Response(JSON.stringify({
      ok: true, rows: upserted, snapshots: dates, latest_snapshot: latest,
      learners_latest: cur.length, modules_total: modules, modules_completed: done,
      skipped_rows_without_snapshot_date: skippedNoDate,
      skipped_excluded_learners: skippedExcluded,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supa.from("sync_runs").insert({ source: "lnd-sync", ok: false, rows_upserted: 0, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
