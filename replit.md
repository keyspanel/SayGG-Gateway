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

## VPS Operations
- `scripts/manage.sh` — single entry point on the VPS. Run with no args for an interactive menu, or pass a command (`deploy`, `restart`, `status`, `logs`, `doctor`, `clean-restart`, `backup`, `restore <file>`, `subdomain`).
- `scripts/backup-db.sh` — `pg_dump | gzip` of the gateway DB, rotates daily/weekly archives under `/var/backups/saygg-gateway/`.
- `scripts/setup-backups.sh` — installs the cron entry that runs the backup nightly at 02:30.
- `scripts/change-subdomain.sh` — interactive helper that rewrites the Nginx vhost, validates DNS, and (re)issues the Let's Encrypt cert. Cloudflare proxy must be in DNS-only mode while certbot runs.

## Current UI/API Notes
- Gateway UI is scoped under `client/src/*` and `client/src/gateway.css` with a mobile-first payment-console design.
- Default theme is **dark** (saved in `localStorage.gw_theme`); a sun/moon toggle in the top bar switches to light at any time. The bootstrap script in `client/index.html` sets `data-theme="dark"` before React mounts to avoid first-paint flash.
- Owner Panel pages use a `.gw-owner` wrapper class with elevated padding/spacing, sticky tab strip, and lifted stat cards (CSS lives at the bottom of `client/src/gateway.css`).
- Frontend API helper unwraps standardized `{ success, message, data }` responses for app screens.
- Gateway API responses use `{ success: true, message, data }` for success and `{ success: false, message, code, details }` for errors.
- Gateway namespace has explicit JSON 404, 405, and global API error handling to avoid raw Express text/HTML responses.
- Billing checkout pages (`BillingCheckoutDetails.tsx`, `BillingCheckoutConfirm.tsx`) share a single premium `CheckoutSummaryMini` card. The component accepts an extended plan shape (description, features, is_featured, price, discount_price are optional) and renders an itemised price breakdown, savings percentage, included features, total-due block, and trust footer; styles live under `.gw-checkout-mini` / `.gw-co-mini-*` in `client/src/gateway.css` and stay responsive at the 540px breakpoint.
