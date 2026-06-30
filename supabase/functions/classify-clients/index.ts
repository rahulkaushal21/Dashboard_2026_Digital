// classify-clients — server side of the "Agency industry deep dive".
// Lets a headless Claude routine do client classification WITHOUT the Supabase
// MCP connector: the routine just curls this function (token-protected).
//   GET  ?token=…           -> { unclassified: [{company_name, ltv}], remaining }
//   POST ?token=…  body { rows:[{company_name, industry, ai_focus, website}] }
//        -> upserts client_industry (reviewed=true), returns { upserted }
// The service-role key stays inside the function (never in the routine prompt).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "deepdive_b3f7a2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("unauthorized", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (req.method === "GET") {
      const { data: wc, error: e1 } = await sb.from("web_clients").select("company_name, ltv_usd");
      if (e1) throw new Error("web_clients: " + e1.message);
      const { data: ci, error: e2 } = await sb.from("client_industry").select("company_name");
      if (e2) throw new Error("client_industry: " + e2.message);
      const done = new Set((ci || []).map((r: any) => r.company_name));
      const pending = (wc || []).filter((w: any) => !done.has(w.company_name))
        .sort((a: any, b: any) => (b.ltv_usd || 0) - (a.ltv_usd || 0));
      const unclassified = pending.slice(0, 15).map((w: any) => ({ company_name: w.company_name, ltv: Math.round(w.ltv_usd || 0) }));
      return Response.json({ ok: true, unclassified, remaining: pending.length });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const rows = (body?.rows || []).filter((r: any) => r && r.company_name).map((r: any) => ({
        company_name: String(r.company_name),
        industry: r.industry || "Marketing & Creative Agency",
        ai_focus: !!r.ai_focus,
        website: r.website || null,
        reviewed: true,
      }));
      if (!rows.length) return Response.json({ ok: true, upserted: 0, note: "no rows" });
      const { error } = await sb.from("client_industry").upsert(rows, { onConflict: "company_name" });
      if (error) throw new Error("upsert: " + error.message);
      return Response.json({ ok: true, upserted: rows.length });
    }
    return new Response("method not allowed", { status: 405 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
