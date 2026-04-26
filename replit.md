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

## Current UI/API Notes
- Gateway UI is scoped under `client/src/*` and `client/src/gateway.css` with a mobile-first payment-console design.
- Frontend API helper unwraps standardized `{ success, message, data }` responses for app screens.
- Gateway API responses use `{ success: true, message, data }` for success and `{ success: false, message, code, details }` for errors.
- Gateway namespace has explicit JSON 404, 405, and global API error handling to avoid raw Express text/HTML responses.

## Theme
- Single premium SaaS theme — no dark/light toggle. Theme toggle code fully removed from Layout.tsx.
- Brand color: #6d4aff (purple). Background: linear-gradient(135deg, #f8f7ff, #f4f1ff, #eefaff) fixed.
- Cards use glassmorphism (rgba white + backdrop-filter blur). Sidebar and topbar are frosted glass.
- Buttons use purple gradient with glow shadows. Code blocks use dark premium #12111f background.
- All CSS variables defined once in `:root` — no data-theme overrides remain.
