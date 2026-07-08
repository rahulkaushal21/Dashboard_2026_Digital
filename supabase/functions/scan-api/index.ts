// scan-api — serverless bridge so a cloud Claude agent can run the account
// sense-check without the Supabase MCP. Token-protected; uses the service role.
//
// Actions (pass ?token=... on every call):
//   GET  ?action=health                      -> capture-feed health + unprocessed count
//   GET  ?action=queue&limit=40              -> unprocessed threads (latest body) + any
//                                               existing signal/opp per thread (for dedup)
//   POST {action:'write', signals:[], opportunities:[], feedback:[]}
//                                            -> partial upsert on thread_id (safe: only
//                                               provided columns change)
//   POST {action:'claim'}                    -> claim the latest pending scan_request (->running)
//   POST {action:'complete', message, rows}  -> mark ALL unprocessed processed + markScan
//                                               heartbeat + rebuild_clients + finish request
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "scanApiHub_5d9c31";
const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// Only these columns may be written, per table (guards against garbage/injection).
const COLS: Record<string, string[]> = {
  email_signals: ["company_name", "client_email", "signal_type", "sentiment", "summary", "source_subject", "source_sender", "source_date", "thread_id"],
  opportunities: ["company_name", "is_new_client", "rfq", "rfq_status", "geo", "sales_person", "source_subject", "source_sender", "source_date", "thread_id", "summary", "pm_owner", "gist", "win_probability", "win_reason", "company_note", "status", "won", "won_amount"],
  feedback: ["added_date", "agency", "geo", "client_email", "nature", "feedback_type", "comments", "evidence", "project_names", "thread_id", "source_sender"],
};
function clean(rows: Record<string, unknown>[], table: string): Record<string, unknown>[] {
  const allow = COLS[table];
  return (rows || []).filter((r) => r && typeof r === "object" && r.thread_id).map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of allow) if (k in r) o[k] = (r as Record<string, unknown>)[k];
    return o;
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return J({ ok: false, error: "unauthorized" }, 401);
  try {
    const action = url.searchParams.get("action") || (req.method === "POST" ? (await req.clone().json().catch(() => ({})))?.action : "");

    if (action === "health") {
      const { data: inbox } = await SB.from("email_inbox").select("inserted_at").order("inserted_at", { ascending: false }).limit(1);
      const { count } = await SB.from("email_inbox").select("*", { count: "exact", head: true }).eq("processed", false);
      const { data: gi } = await SB.from("sync_runs").select("ran_at, ok").eq("source", "gmail-ingest").order("ran_at", { ascending: false }).limit(1);
      const newest = inbox?.[0]?.inserted_at ?? null;
      const staleMin = newest ? (Date.now() - new Date(newest).getTime()) / 60000 : null;
      return J({ ok: true, newest_inbox: newest, stale_minutes: staleMin, unprocessed: count ?? 0, gmail_ingest: gi?.[0] ?? null });
    }

    if (action === "queue") {
      const limit = Math.min(80, Math.max(1, Number(url.searchParams.get("limit") || 40)));
      // newest unprocessed message per thread, external first
      const { data: rows } = await SB.from("email_inbox")
        .select("thread_id, from_addr, to_addrs, subject, msg_date, body, snippet, has_external, processed")
        .eq("processed", false).order("msg_date", { ascending: false }).limit(600);
      const seen = new Set<string>();
      const threads: Record<string, unknown>[] = [];
      for (const r of (rows || [])) {
        if (seen.has(r.thread_id)) continue;
        seen.add(r.thread_id);
        threads.push({
          thread_id: r.thread_id, from: r.from_addr, to: r.to_addrs, subject: r.subject,
          date: r.msg_date, has_external: r.has_external,
          body: String(r.body || r.snippet || "").replace(/\s+/g, " ").slice(0, 4000),
        });
        if (threads.length >= limit) break;
      }
      const ids = threads.map((t) => t.thread_id as string);
      const known: Record<string, unknown> = {};
      if (ids.length) {
        const { data: sg } = await SB.from("email_signals").select("thread_id, company_name, sentiment").in("thread_id", ids);
        const { data: op } = await SB.from("opportunities").select("thread_id, company_name, status, summary").in("thread_id", ids);
        for (const s of (sg || [])) known[s.thread_id] = { ...(known[s.thread_id] as object || {}), signal: s };
        for (const o of (op || [])) known[o.thread_id] = { ...(known[o.thread_id] as object || {}), opp: o };
      }
      return J({ ok: true, threads, known, returned: threads.length });
    }

    if (req.method !== "POST") return J({ ok: false, error: "POST only for this action" }, 405);
    const body = await req.json();

    if (body.action === "claim") {
      const { data: pend } = await SB.from("scan_requests").select("id").eq("status", "pending").order("requested_at", { ascending: true }).limit(1);
      if (!pend?.length) return J({ ok: true, claimed: null });
      await SB.from("scan_requests").update({ status: "running", started_at: new Date().toISOString() }).eq("id", pend[0].id);
      return J({ ok: true, claimed: pend[0].id });
    }

    if (body.action === "write") {
      const out: Record<string, unknown> = { ok: true };
      for (const table of ["email_signals", "opportunities", "feedback"]) {
        const key = table === "email_signals" ? "signals" : table === "opportunities" ? "opportunities" : "feedback";
        const rows = clean(body[key] || [], table);
        if (rows.length) {
          const { error } = await SB.from(table).upsert(rows, { onConflict: "thread_id" });
          if (error) return J({ ok: false, error: `${table}: ${error.message}` }, 400);
        }
        out[key] = rows.length;
      }
      return J(out);
    }

    if (body.action === "complete") {
      const { error: mErr } = await SB.from("email_inbox").update({ processed: true }).eq("processed", false);
      if (mErr) return J({ ok: false, error: "mark: " + mErr.message }, 400);
      await SB.from("sync_runs").insert({ source: "email-opportunities-scan", rows_upserted: Number(body.rows) || 0, ok: true, message: String(body.message || "serverless scan").slice(0, 900) });
      try { await SB.rpc("rebuild_clients"); } catch (_) { /* best effort */ }
      await SB.from("scan_requests").update({ status: "done", finished_at: new Date().toISOString(), note: String(body.message || "").slice(0, 300) }).eq("status", "running");
      return J({ ok: true, completed: true });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return J({ ok: false, error: String(e) }, 500);
  }
});
