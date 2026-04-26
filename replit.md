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
- Billing checkout pages (`BillingCheckoutDetails.tsx`, `BillingCheckoutConfirm.tsx`) share a single premium `CheckoutSummaryMini` card. The component accepts an extended plan shape (description, features, is_featured, price, discount_price are optional) and renders an itemised price breakdown, savings percentage, included features, total-due block, and trust footer; styles live under `.gw-checkout-mini` / `.gw-co-mini-*` in `client/src/gateway.css` and stay responsive at the 540px breakpoint.
