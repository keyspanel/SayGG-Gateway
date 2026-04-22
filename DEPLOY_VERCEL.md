# Vercel Deployment Guide

This project ships with a single Vercel-ready architecture that runs both the
frontend and the backend on one Vercel project.

## Architecture

| Concern | Where it lives in production |
|---|---|
| Static frontend (Vite SPA) | Built into `client/dist`, served by Vercel's CDN |
| API (`/api/*`) | A single catch-all serverless function: `api/[...all].ts`, which mounts the same Express app used locally (`server/app.ts`) |
| SPA route refresh | `vercel.json` `rewrites` send any non-API, non-asset path to `/index.html` |
| Background reconciler | Triggered by an **external free scheduler** (e.g. cron-job.org) hitting `/api/cron/reconcile` every minute. Vercel's Hobby plan only allows once-per-day cron, so the schedule lives outside Vercel. |
| Database | Standard `pg.Pool`, `max=5`, SSL auto-enabled for managed providers |
| Migrations | Run lazily on the first request after every cold start (idempotent SQL) |

The local entry (`server/index.ts`, run by `tsx`) is preserved untouched in
behavior — it adds the `app.listen`, the static file server, and the in-process
reconciler timer that Vercel does not need.

## Files added or changed

| File | Purpose |
|---|---|
| `vercel.json` | Build command, output dir, function config, SPA rewrite, cron schedule |
| `api/[...all].ts` | Vercel catch-all function — wraps the Express app |
| `server/app.ts` | Pure Express app factory (no listen / static / timers) + `ensureMigrations` + `/api/cron/reconcile` route |
| `server/index.ts` | Slimmed down to local-dev entry only (listen + static + `startReconciler`) |
| `server/reconciler.ts` | New `runReconcileTick()` export so cron can run one pass |
| `server/db.ts` | SSL auto-enabled for managed Postgres, `max=5` for serverless |
| `package.json` | Added `vercel-build` script |
| `.vercelignore` | Excludes Replit + local-only files from the deployment bundle |

## Required environment variables

Set these in **Vercel → Project → Settings → Environment Variables** for the
**Production** environment (and **Preview** if you use preview deploys):

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Use a managed provider that supports many short-lived connections (Neon, Supabase pooled endpoint, Railway, etc.). Should normally include `?sslmode=require`. |
| `JWT_SECRET` | yes | Long random string. Server refuses to boot in production without it. |
| `CRON_SECRET` | yes | Long random string. The `/api/cron/reconcile` handler requires `Authorization: Bearer ${CRON_SECRET}`. You will paste the same value into the external scheduler's request-header config (see "Schedule the reconciler" below). |
| `NODE_ENV` | optional | Vercel sets this to `production` automatically. |

## Vercel project settings

When importing the repo in the Vercel dashboard:

- **Framework Preset:** *Other* (handled by `vercel.json`)
- **Root Directory:** *(leave at repo root)*
- **Build Command:** *(inherited from `vercel.json` → `npm run vercel-build`)*
- **Output Directory:** *(inherited from `vercel.json` → `client/dist`)*
- **Install Command:** *(default `npm install` — fine)*
- **Node.js Version:** 20.x

## Schedule the reconciler (external free scheduler)

Vercel Hobby caps cron jobs at **once per day**, which is too slow for order
expiry / webhook retries. Instead, schedule the same endpoint from any free
external pinger that supports custom request headers. Pick one:

- **cron-job.org** (recommended — free, 1-minute granularity, custom headers).
- **Cloudflare Workers Cron Triggers** (free, 1-minute, very reliable).
- **UptimeRobot** (free, 5-minute minimum — acceptable, just means expiry runs slightly less often).

Configure one job:

| Field | Value |
|---|---|
| URL | `https://<your-domain>/api/cron/reconcile` |
| Method | `GET` (or `POST` — both work) |
| Schedule | every 1 minute |
| Header | `Authorization: Bearer <your CRON_SECRET>` |

A successful run returns:

```json
{ "ok": true, "expired": 0, "verified": 1, "callbacks": 0 }
```

A 401 means the header is missing or `CRON_SECRET` does not match what's set
in Vercel.

## Routing behavior (final)

- `/api/cron/reconcile` → `api/[...all].ts` → Express route, gated by `CRON_SECRET`
- `/api/health`, `/api/gateway/*`, `/api/pay/*` → `api/[...all].ts` → Express
- `/assets/*`, `/payment-apps/*`, `/favicon.ico`, `/robots.txt` → static file from `client/dist`
- Everything else → rewritten to `/index.html` (SPA refresh works)

## Deploy

```bash
# one-time
npm i -g vercel
vercel login
vercel link            # link this folder to a Vercel project

# deploy a preview
vercel

# deploy to production
vercel --prod
```

Or push to a Git branch connected to the Vercel project — Vercel will build
and deploy automatically.

To verify the build the way Vercel runs it, before deploying:

```bash
vercel build           # produces .vercel/output/
vercel dev             # local emulator: serves /api + static + rewrites
```

## Post-deploy verification checklist

1. `GET https://<your-domain>/api/health` → `{ "ok": true, "service": "payment-gateway" }`
2. Open `https://<your-domain>/` → SPA loads (no blank page, no 404 in DevTools)
3. Hard-refresh `https://<your-domain>/gateway/login` → SPA route still loads (SPA fallback works)
4. Static assets: `https://<your-domain>/payment-apps/google-pay.svg` returns the SVG
5. Sign in → dashboard loads, settings save, an order can be created via the public API
6. Hosted pay page (`/pay/<token>`): QR renders, supported-apps carousel rolls, "Download QR Code" works, status updates via polling
7. After ~1 minute check your external scheduler's run history (e.g. cron-job.org → Job → "Execution history") — you should see HTTP 200 responses; the body returned is `{ ok: true, expired, verified, callbacks }`. Vercel → Logs will also show the corresponding function invocations.
8. In the database, confirm a new test order's `status` transitions correctly (`pending` → `paid` / `expired`) — proves the cron-driven reconciler is doing the same work the local timer used to do
