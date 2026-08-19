import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// "AI First Capability Development Intervention Mastersheet | L&D | Web | Digital",
// published to web as an entire document. Tabs are DISCOVERED from the published
// index rather than hard-coded, so a new level tab is picked up without a redeploy.
const PUB_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSugFnqoV8DI5eNIjyksc8squVEFQN5AwepNsDPNwqLqCOH5BzISij1xEM-i4A62bK6eD_dlmUGJn2k";
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

function parseSnapshotDate(s: string, fyYear: string): string | null {
  const t = (s || "").replace(/DATA\s+Updated\s+on/i, "").trim();
  const m = t.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3})[A-Za-z]*\.?\s*(\d{4})?$/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3] || fyYear}-${mm}-${m[1].padStart(2, "0")}`;
}

// Summary tab: "24-Jun-2026". Dashes mean "never".
function parseActivity(s: string): string | null {
  const t = (s || "").trim();
  if (!t || t === "-" || t === "–" || t === "—") return null;
  const m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

// Module tabs use US order: "06-24-2026" is 24 June, confirmed against the summary
// tab's own last-activity dates for the same learners.
function parseUsDate(s: string): string | null {
  const t = (s || "").trim();
  if (!t || t === "-" || t === "–" || t === "—") return null;
  const m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function toInt(s: string): number {
  const n = parseInt((s || "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function toPct(s: string): number | null {
  const m = (s || "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const flatKey = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (s: string) => new Set((s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1));

// "Pre - Assessment" and "Pre - assessment" are the same course spelled two ways;
// left alone they split every chart in two. Only this known pair is folded — the
// rest are stored as written, because title-casing everything would wreck
// "NodeJS", "GraphQL" and "AWS CLI and SDK Training".
function canonCourse(raw: string): string {
  const c = (raw || "").trim().replace(/\s+/g, " ");
  if (/^pre\s*-?\s*assessment$/i.test(c)) return "Pre-Assessment";
  return c;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  // Two ways in. The private token is for cron and Apps Script. The dashboard's
  // "Sync now" button presents the public anon key instead, because shipping the
  // token in the browser bundle would publish it.
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const presented = req.headers.get("apikey") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(url.searchParams.get("token") === TOKEN || (!!anon && presented === anon))) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const fyYear = url.searchParams.get("year") || String(new Date().getUTCFullYear());
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // ---- discover tabs -----------------------------------------------------
    const idx = await fetch(`${PUB_BASE}/pubhtml`);
    if (!idx.ok) throw new Error("tab index fetch failed: " + idx.status);
    const idxHtml = await idx.text();
    const gids = [...new Set([...idxHtml.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
    if (!gids.length) throw new Error("no published tabs found — is the document still published?");

    const { data: exRows } = await supa.from("lnd_excluded_learners").select("learner_key");
    const excluded = new Set((exRows || []).map((r: { learner_key: string }) => r.learner_key));

    type Snap = {
      snapshot_date: string; level: string; learner_name: string; reporting_manager: string | null;
      total_modules: number; completed: number; in_progress: number; not_started: number;
      sheet_progress: number | null; last_activity: string | null; remarks: string | null; src_row_hash: string;
      learner_key?: string; learner_full_name?: string;
    };
    type Mod = {
      learner_key: string | null; learner_full_name: string; user_id: string | null; email: string | null;
      sub_department: string | null; reporting_manager: string | null; level: string | null;
      track: string | null; stream: string | null; program_year: string | null;
      course: string; module_name_raw: string; status: string | null; completion_pct: number | null;
      is_complete: boolean | null; started_on: string | null; last_accessed_on: string | null;
      completed_on: string | null; source_gid: string;
    };

    const snaps = new Map<string, Snap>();
    const modsRaw: (Omit<Mod, "learner_key"> & { learner_key?: string | null })[] = [];
    const tabsRead: string[] = [];
    const tabsSkipped: string[] = [];
    let skippedExcluded = 0;

    for (const gid of gids) {
      const r = await fetch(`${PUB_BASE}/pub?gid=${gid}&single=true&output=csv`);
      if (!r.ok) { tabsSkipped.push(`${gid} (HTTP ${r.status})`); continue; }
      const txt = await r.text();
      if (txt.trimStart().startsWith("<")) { tabsSkipped.push(`${gid} (not a grid)`); continue; }
      const rows = parseCSV(txt);
      if (rows.length < 2) { tabsSkipped.push(`${gid} (empty)`); continue; }

      // Header-driven, because the two module tabs order their columns differently
      // (one puts Email before Sub-department, the other after).
      const headerRow = rows.find((row) => row.some((c) => /module\s*name/i.test(c || "")) && row.some((c) => /full\s*name/i.test(c || "")));

      if (headerRow) {
        tabsRead.push(`${gid} (modules)`);
        const head = headerRow.map((h) => (h || "").trim().toLowerCase());
        const col = (...names: string[]) => {
          for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
          for (const n of names) { const i = head.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
          return -1;
        };
        const c = {
          name: col("full name"), uid: col("user id"), email: col("email"),
          dept: col("sub-department", "sub department"), mod: col("module name"),
          started: col("started on"), accessed: col("last accessed on"),
          status: col("module status"), pct: col("completion percentage"),
          done: col("completed on"), isDone: col("is complete"), mgr: col("reporting manager name", "reporting manager"),
        };
        const start = rows.indexOf(headerRow) + 1;
        for (let i = start; i < rows.length; i++) {
          const row = rows[i];
          const full = (row[c.name] || "").trim();
          const modName = (row[c.mod] || "").trim();
          if (!full || !modName) continue;
          if (excluded.has(flatKey(full))) { skippedExcluded++; continue; }
          const seg = modName.split("|").map((s) => s.trim());
          const pct = c.pct >= 0 ? toPct(row[c.pct] || "") : null;
          modsRaw.push({
            learner_full_name: full,
            user_id: c.uid >= 0 ? (row[c.uid] || "").trim() || null : null,
            email: c.email >= 0 ? (row[c.email] || "").trim().toLowerCase() || null : null,
            sub_department: c.dept >= 0 ? (row[c.dept] || "").trim() || null : null,
            reporting_manager: c.mgr >= 0 ? (row[c.mgr] || "").trim() || null : null,
            level: seg[3] || null,
            track: seg[2] || null,
            stream: seg[1] || null,
            program_year: seg[4] || null,
            course: canonCourse(seg[0] || modName),
            module_name_raw: modName,
            status: c.status >= 0 ? (row[c.status] || "").trim() || null : null,
            completion_pct: pct,
            is_complete: c.isDone >= 0 ? /^y/i.test((row[c.isDone] || "").trim()) : null,
            started_on: c.started >= 0 ? parseUsDate(row[c.started] || "") : null,
            last_accessed_on: c.accessed >= 0 ? parseUsDate(row[c.accessed] || "") : null,
            completed_on: c.done >= 0 ? parseUsDate(row[c.done] || "") : null,
            source_gid: gid,
          });
        }
        continue;
      }

      // Otherwise treat it as the stacked weekly-summary tab.
      let hitSummary = false;
      let snapshot: string | null = null;
      let level: string | null = null;
      for (const row of rows) {
        const c0 = (row[0] || "").trim();
        if (/^DATA\s+Updated\s+on/i.test(c0)) { snapshot = parseSnapshotDate(c0, fyYear); level = null; hitSummary = true; continue; }
        if (/\bLevel\b/i.test(c0) && row.slice(1).every((x) => !(x || "").trim())) { level = c0.replace(/\s*Level\s*$/i, "").trim(); continue; }
        if (!/^\d+$/.test(c0)) continue;
        const name = (row[1] || "").trim();
        if (!name || !snapshot) continue;
        if (excluded.has(flatKey(name))) { skippedExcluded++; continue; }
        const key = `${snapshot}|${name.toLowerCase()}`;
        snaps.set(key, {
          snapshot_date: snapshot, level: level || "Unspecified", learner_name: name,
          reporting_manager: (row[2] || "").trim() || null,
          total_modules: toInt(row[3]), completed: toInt(row[4]),
          in_progress: toInt(row[5]), not_started: toInt(row[6]),
          sheet_progress: toPct(row[7] || ""), last_activity: parseActivity(row[8] || ""),
          remarks: (row[9] || "").trim() || null, src_row_hash: key,
        });
      }
      if (hitSummary) tabsRead.push(`${gid} (summary)`); else tabsSkipped.push(`${gid} (unrecognised layout)`);
    }

    const snapData = [...snaps.values()];
    if (!snapData.length) throw new Error("no summary rows parsed — refusing to touch lnd_snapshots");

    // ---- identity ----------------------------------------------------------
    // The module tabs' FULL LEGAL NAME is canonical; the weekly summary's short name
    // is only an alias. Resolving in this direction is what the L&D team asked for,
    // and it repairs a real fault: the summary tab renamed two people mid-programme
    // ("Divya Arora" -> "Arora Anilkumar", "Ketul Gajera" -> "Gajera Harsukhlal"),
    // so each was being counted as two learners with their first week orphaned.
    // Both aliases now fold onto the one full name.
    //
    // A match needs >= 2 shared name tokens AND exactly one candidate. Anything
    // ambiguous or unmatched keeps its own name and is reported — never guessed.
    const canon = [...new Set(modsRaw.map((m) => m.learner_full_name))]
      .map((n) => ({ full: n, key: flatKey(n), t: tokens(n) }));
    const unresolved: string[] = [];
    const resolve = (name: string): { key: string; full: string } | null => {
      const exact = canon.find((c) => c.key === flatKey(name));
      if (exact) return { key: exact.key, full: exact.full };
      const nt = tokens(name);
      const hits = canon.filter((c) => [...c.t].filter((x) => nt.has(x)).length >= 2);
      return hits.length === 1 ? { key: hits[0].key, full: hits[0].full } : null;
    };

    const mods: Mod[] = modsRaw.map((m) => ({ ...m, learner_key: flatKey(m.learner_full_name) }));

    for (const s of snapData) {
      const r = resolve(s.learner_name);
      if (r) { s.learner_key = r.key; s.learner_full_name = r.full; }
      else {
        s.learner_key = flatKey(s.learner_name);
        s.learner_full_name = s.learner_name;
        unresolved.push(s.learner_name);
      }
    }

    // ---- diff, so "Sync now" can say what actually moved -------------------
    const { data: beforeSnap } = await supa.from("lnd_snapshots").select("snapshot_date, learner_name, completed, in_progress, total_modules");
    const before = new Map<string, string>();
    (beforeSnap || []).forEach((b: any) => before.set(`${b.snapshot_date}|${String(b.learner_name).toLowerCase()}`, `${b.completed}/${b.in_progress}/${b.total_modules}`));
    let added = 0, changed = 0;
    for (const [key, d] of snaps) {
      const sig = `${d.completed}/${d.in_progress}/${d.total_modules}`;
      const prev = before.get(key);
      if (prev === undefined) added++; else if (prev !== sig) changed++;
    }
    const { count: beforeMods } = await supa.from("lnd_modules").select("*", { count: "exact", head: true });

    // ---- write -------------------------------------------------------------
    let upserted = 0;
    for (let i = 0; i < snapData.length; i += 500) {
      const chunk = snapData.slice(i, i + 500);
      const { error } = await supa.from("lnd_snapshots").upsert(chunk, { onConflict: "snapshot_date,learner_name" });
      if (error) throw new Error("snapshots upsert: " + error.message);
      upserted += chunk.length;
    }
    // The sheet can list the same learner+module twice (it did on 18 Aug 2026, and
    // every hourly sync failed from 13:23 with "ON CONFLICT DO UPDATE command cannot
    // affect row a second time" until this dedup landed). Postgres refuses an upsert
    // batch that carries one conflict key twice, so collapse to last-wins here and
    // report the count instead of letting a sheet typo stop the whole sync.
    const modByKey = new Map<string, typeof mods[number]>();
    for (const m of mods) modByKey.set(`${m.learner_full_name}|${m.module_name_raw}`, m);
    const dupModules = mods.length - modByKey.size;
    const modRows = [...modByKey.values()];
    let modUpserted = 0;
    if (modRows.length) {
      for (let i = 0; i < modRows.length; i += 500) {
        const chunk = modRows.slice(i, i + 500);
        const { error } = await supa.from("lnd_modules").upsert(chunk, { onConflict: "learner_full_name,module_name_raw" });
        if (error) throw new Error("modules upsert: " + error.message);
        modUpserted += chunk.length;
      }
    }

    const dates = [...new Set(snapData.map((d) => d.snapshot_date))].sort();
    const latest = dates[dates.length - 1];
    const cur = snapData.filter((d) => d.snapshot_date === latest);
    const modules = cur.reduce((s, d) => s + d.total_modules, 0);
    const done = cur.reduce((s, d) => s + d.completed, 0);
    const summary = (added || changed) ? `${added} new, ${changed} changed` : "no change";
    await supa.from("sync_runs").insert({
      source: "lnd-sync", rows_upserted: upserted + modUpserted, ok: true,
      message: `${summary} · ${tabsRead.length} tabs · ${dates.length} snapshots · latest ${latest} · ${cur.length} learners · ${done}/${modules} modules complete · ${modUpserted} module rows${dupModules ? ` · ${dupModules} DUPLICATE learner+module rows in sheet` : ""}${unresolved.length ? ` · ${unresolved.length} UNRESOLVED names` : ""}`,
    });

    return new Response(JSON.stringify({
      ok: true, rows: upserted, module_rows: modUpserted,
      module_rows_before: beforeMods ?? null,
      tabs_read: tabsRead, tabs_skipped: tabsSkipped,
      snapshots: dates, latest_snapshot: latest, learners_latest: cur.length,
      modules_total: modules, modules_completed: done,
      added, changed,
      unresolved_learner_names: [...new Set(unresolved)],
      skipped_excluded_learners: skippedExcluded,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    await supa.from("sync_runs").insert({ source: "lnd-sync", ok: false, rows_upserted: 0, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
