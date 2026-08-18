// client-dir-ingest — receives Client-Backup tab rows and upserts them into
// `client_directory`. Same auth convention as sheet-ingest (query token).
//
// Body: { rows: Array<Record<string, unknown>> }  — objects, not a grid.
// Upsert key: name_key, a stored generated column holding the company name with
// case and punctuation stripped, so a repeated push can never duplicate a client
// and "Bop Design, Inc." cannot land twice as "Bop Design Inc".
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "ingestWebHub_a7c2e9";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: false, error: "empty payload — table left unchanged" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    let n = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const { error } = await sb.from("client_directory").upsert(chunk, { onConflict: "name_key", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
      n += chunk.length;
    }
    await sb.from("sync_runs").insert({ source: "client-directory", ok: true, rows_upserted: n, message: "client backup push" });
    return new Response(JSON.stringify({ ok: true, upserted: n }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "client-directory", ok: false, message: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
