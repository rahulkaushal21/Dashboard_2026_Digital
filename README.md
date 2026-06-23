# Mavlers CRM Dashboard

Next.js 14 + Supabase, modelled on the reference dashboard. Static-export-ready
(GitHub Pages) or deploy straight to Vercel. Renders on sample data out of the
box, switches to live data automatically once Supabase env vars are set.

## What's built so far
- Full app shell: Mavlers branding (yellow `#FFDB2D`, dark, Montserrat), sidebar
  with all 8 sections, live/sample-data indicator.
- Fully built pages: **Dashboard** (KPIs, revenue trend, top clients),
  **Opportunities** (RFQ table), **Clients** (portfolio + health + search).
- Field-mapped stubs (ready to build out): Quotes, Industry Focus, Escalations,
  SQL/Leads, Business Trend, 20/80 Rule.
- Consolidated Supabase schema: `supabase/migrations/001_schema.sql`.
- The 2-hourly routine: `scripts/routine/` (+ `ROUTINE.md` setup guide).

## Run locally
```bash
npm install
cp .env.example .env.local   # optional — works on sample data without it
npm run dev
```

## Data flow
- **Business Sheet → Supabase** (`clients`, `revenue_monthly`): deterministic CSV
  pull, `scripts/routine/sync-business-sheet.mjs`.
- **Central inbox → Supabase** (`opportunities`, later escalations/SQL/quotes):
  Claude routine reads Gmail, classifies, writes. See `scripts/routine/ROUTINE.md`.
- **Frontend** reads Supabase with the public anon key + RLS; login via Supabase
  Auth (Google), gated by the `dashboard_users` allowlist.

## Deploy (GitHub Pages)
1. Create a repo named **Dashboard_2026_Digital** (the name must match `basePath`
   in `next.config.js`; change both if you use a different name).
2. Push this code to `main`.
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. The included workflow (`.github/workflows/deploy.yml`) builds the static export
   (`DEPLOY_TARGET=github`) and publishes it on every push to `main`.
5. Your site: `https://<user>.github.io/Dashboard_2026_Digital/`.
6. Add that URL to Supabase -> Authentication -> URL Configuration (Site URL +
   `https://<user>.github.io/Dashboard_2026_Digital/**`) so magic-link login works.

The Supabase URL + anon key are public (RLS-protected) and are baked in at build
time by the workflow. To point at a different project, set repo Variables
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Inputs needed to go live
See the chat — Supabase project URL + anon key, the Business Sheet column names
+ its published-CSV URL, the inbox address, and where to host.
