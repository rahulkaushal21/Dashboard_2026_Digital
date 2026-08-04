// gmail-ingest — receives raw Gmail messages pushed by the Google Apps Script(s)
// and upserts them into the PRIVATE email_inbox table. Claude later reads unprocessed
// rows to deep-dive and classify (opportunities / feedback / escalations / sentiment).
//
// Body: { mailbox?, messages: [{ message_id, rfc_message_id?, mailbox?, thread_id,
//          subject, from_addr, to_addrs, cc_addrs, msg_date, snippet, body, has_external }] }
// Auth: ?token=... (shared secret).
//
// ── CROSS-MAILBOX DEDUP (v3) ────────────────────────────────────────────────────
// Gmail's message id is PER-MAILBOX: the same email sitting in web@ and in nitin@
// arrives with two different ids. Deduping on it was correct while exactly one
// mailbox fed this table; the moment a second one does, every thread two colleagues
// share would be stored twice and classified twice — producing duplicate
// opportunities, the same double-counting class we removed by hand on 4 Aug.
//
// So identity is now `dedup_key`:
//   • the RFC 5322 Message-ID header when the sender gives us one — globally unique
//     and IDENTICAL in every mailbox that holds the message;
//   • else 'gm:'||message_id, i.e. exactly the old per-mailbox behaviour.
// Never a synthetic subject+date key: bulk notifications sent in the same second
// would falsely merge, and silently losing a real RFQ is worse than storing it twice.
//
// Duplicates are filtered by an explicit pre-check on BOTH dedup_key and message_id
// rather than ON CONFLICT. A row stored before v3 carries a 'gm:' key, so re-pushing
// that same message once the script sends RFC ids yields a NEW dedup_key with an OLD
// message_id — which a single-target ON CONFLICT would fail on, not ignore.
//
// BACKFILL MODE: append ?backfill=1 to load historical mail. Backfilled rows are
// tagged archived=true so they are a separate stream from the live pipeline: still
// processed=false (classifiable into FY opportunities / client health) but excluded
// from the live daily-scan "queue must be 0" check.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "ingestWebHub_a7c2e9";

// Normalise an RFC 5322 Message-ID: strip the angle brackets and lowercase, so the
// same header formatted differently by two Gmail accounts still collapses to one key.
function normRfc(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
  return s && s.includes("@") ? s.slice(0, 250) : null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const backfill = url.searchParams.get("backfill") === "1";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json();
    const rows = Array.isArray(body?.messages) ? body.messages : [];
    const defaultMailbox = body?.mailbox ? String(body.mailbox).toLowerCase().slice(0, 200) : null;
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, note: "empty payload" }), { headers: { "Content-Type": "application/json" } });
    }
    // Keep only the columns we store; clamp body length so a giant thread can't blow up a row.
    const clean = rows.map((r: Record<string, unknown>) => {
      const mid = String(r.message_id ?? "").slice(0, 255);
      const rfc = normRfc(r.rfc_message_id);
      return {
        message_id: mid,
        dedup_key: rfc ?? `gm:${mid}`,
        mailbox: (r.mailbox ? String(r.mailbox).toLowerCase().slice(0, 200) : null) ?? defaultMailbox,
        thread_id: String(r.thread_id ?? ""),
        subject: r.subject ? String(r.subject).slice(0, 2000) : null,
        from_addr: r.from_addr ? String(r.from_addr).slice(0, 500) : null,
        to_addrs: r.to_addrs ? String(r.to_addrs).slice(0, 2000) : null,
        cc_addrs: r.cc_addrs ? String(r.cc_addrs).slice(0, 2000) : null,
        msg_date: r.msg_date ? new Date(String(r.msg_date)).toISOString() : null,
        snippet: r.snippet ? String(r.snippet).slice(0, 1000) : null,
        body: r.body ? String(r.body).slice(0, 60000) : null,
        has_external: !!r.has_external,
        processed: false,
        archived: backfill,
      };
    }).filter((r: { message_id: string }) => r.message_id);

    // Collapse repeats WITHIN the payload first — one push can carry the same message
    // twice when a thread is paged over, and Postgres rejects a batch that conflicts
    // with itself even under DO NOTHING.
    //
    // Must collapse on BOTH identities, not just dedup_key. If the RFC header reads on
    // one occurrence of a message and not on another, the two get DIFFERENT dedup_keys
    // ('<rfc@…>' vs 'gm:<id>'), both survive a dedup_key-only filter, and then collide
    // on the message_id primary key — which killed three backfill batches on 4 Aug.
    const seenKey = new Set<string>();
    const seenMid = new Set<string>();
    const batchUnique = clean.filter((r: { dedup_key: string; message_id: string }) => {
      if (seenKey.has(r.dedup_key) || seenMid.has(r.message_id)) return false;
      seenKey.add(r.dedup_key);
      seenMid.add(r.message_id);
      return true;
    });

    let inserted = 0, skippedExisting = 0, withRfc = 0;
    for (const r of batchUnique) if (!r.dedup_key.startsWith("gm:")) withRfc++;

    for (let i = 0; i < batchUnique.length; i += 200) {
      const chunk = batchUnique.slice(i, i + 200);
      // Anything already stored under EITHER identity is skipped, so a message we have
      // already classified is never reset to processed=false.
      const [byKey, byMid] = await Promise.all([
        sb.from("email_inbox").select("dedup_key").in("dedup_key", chunk.map((r) => r.dedup_key)),
        sb.from("email_inbox").select("message_id").in("message_id", chunk.map((r) => r.message_id)),
      ]);
      if (byKey.error) throw new Error(byKey.error.message);
      if (byMid.error) throw new Error(byMid.error.message);
      const haveKey = new Set((byKey.data ?? []).map((d: { dedup_key: string }) => d.dedup_key));
      const haveMid = new Set((byMid.data ?? []).map((d: { message_id: string }) => d.message_id));
      const fresh = chunk.filter((r) => !haveKey.has(r.dedup_key) && !haveMid.has(r.message_id));
      skippedExisting += chunk.length - fresh.length;
      if (!fresh.length) continue;
      const { error, count } = await sb.from("email_inbox").insert(fresh, { count: "exact" });
      if (error) throw new Error(error.message);
      inserted += count ?? fresh.length;
    }

    const src = backfill ? "gmail-backfill" : "gmail-ingest";
    const mbLabel = defaultMailbox ?? "unknown mailbox";
    await sb.from("sync_runs").insert({
      source: src,
      ok: true,
      rows_upserted: inserted,
      message: `${mbLabel}: pulled ${clean.length} msgs, ${inserted} new, ${skippedExisting} already held`
        + `, ${withRfc}/${batchUnique.length} with RFC Message-ID${backfill ? " (backfill)" : ""}`,
    });
    return new Response(JSON.stringify({
      ok: true, mailbox: defaultMailbox, received: clean.length, inserted,
      skipped_existing: skippedExisting, with_rfc_id: withRfc, backfill,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: backfill ? "gmail-backfill" : "gmail-ingest", ok: false, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
