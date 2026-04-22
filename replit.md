# Payment Gateway

## Overview
Standalone Payment Gateway website with an Express API, React/Vite frontend, and Replit PostgreSQL database.

## Architecture
- Backend: Express server in `server/`, served on port 5000.
- Frontend: React app in `client/`, built by Vite into `client/dist` and served by Express.
- Database: Replit PostgreSQL using `DATABASE_URL`; startup migrations create `gw_users`, `gw_settings`, and `gw_orders`.

## Runtime
- Main preview workflow runs `npm run dev`.
- `npm run dev` builds the frontend and starts `server/index.ts` with `tsx`.
- `JWT_SECRET` is required in production; development preview uses a temporary fallback when it is not set.

## Deployment targets
- **Replit / local:** `server/index.ts` listens on port 5000, serves `client/dist`, runs the in-process reconciler timer (`startReconciler`). This file is the only thing that does any of those.
- **Vercel:** the catch-all serverless function `api/[...all].ts` wraps `server/app.ts` (the same Express app, minus listen/static/timers). The Vite build output `client/dist` is served by Vercel's CDN. The reconciler is triggered by an external free scheduler (e.g. cron-job.org) hitting `/api/cron/reconcile` every minute (gated by `CRON_SECRET`) — Vercel Hobby's once-per-day cron is too slow. See `DEPLOY_VERCEL.md` for the full guide, env vars, scheduler setup, and verification checklist.

## Current UI/API Notes
- Gateway UI is scoped under `client/src/*` and `client/src/gateway.css` with a mobile-first payment-console design.
- Frontend API helper unwraps standardized `{ success, message, data }` responses for app screens.
- Gateway API responses use `{ success: true, message, data }` for success and `{ success: false, message, code, details }` for errors.
- Gateway namespace has explicit JSON 404, 405, and global API error handling to avoid raw Express text/HTML responses.
