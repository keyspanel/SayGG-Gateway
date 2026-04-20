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
