# Hosted Payment Page (QR Payment Link) — Real Manual Testing Guide

This guide walks you through testing the **Hosted Payment Page** end-to-end with **your own UPI credentials and a real payment**. Nothing in this flow is mocked — every request hits the live API and writes to your real database.

> Replace `<BASE>` with your live origin (e.g. `https://<your-replit-domain>` or `http://localhost:5000`).
> The API base path is always `<BASE>/api/gateway`.
> The hosted payment page lives at `<BASE>/pay/<public_token>`.

---

## What the Hosted Payment Page actually is

The Hosted Payment Page uses the same `POST /api/gateway/create-order` call you use for the Server-to-Server flow, but you also use the new fields in the response:

| Field | What it is |
|---|---|
| `public_token` | A ~22‑char random token for the order (safe to share). |
| `payment_page_url` | A fully‑qualified URL to the hosted checkout page. |
| `qr_image_url` | Direct PNG QR code endpoint for the order. |

You hand `payment_page_url` to your customer. They open it, see your branded checkout page with the QR + amount + countdown, pay from any UPI app, and the page auto‑updates to **paid** when the gateway confirms.

Public endpoints used by the hosted page (no API token required):

- `GET  <BASE>/pay/<public_token>` — the hosted React checkout page
- `GET  <BASE>/api/pay/<public_token>` — JSON snapshot of the order (public-safe fields)
- `POST <BASE>/api/pay/<public_token>/refresh` — re-verifies with Paytm and returns the latest snapshot
- `GET  <BASE>/api/pay/<public_token>/qr.png` — PNG QR for the UPI payload (`?size=160..800`)

---

## 1. Prepare your account (one-time)

### 1.1 Register / Login
- Go to `<BASE>/gateway/register` (or `/gateway/login` if you already have an account).
- After login you'll land on the dashboard.

### 1.2 Save your real Paytm UPI settings
Open `<BASE>/gateway/settings` and fill in:

- **Paytm UPI ID** — e.g. `yourhandle@paytm`
- **Paytm Merchant ID (MID)**
- **Paytm Merchant Key** (stored encrypted, masked after save)
- **Payee display name** (shown to the customer in their UPI app)
- **Environment** — `production` or `staging`

Save → the page should show **Active**.

### 1.3 Generate your API token
- Open `<BASE>/gateway/docs`.
- In **Your API token**, click **Generate API token**.
- Copy the token (`pg_…`) — it is your `Authorization: Bearer <token>` for every API call below.

---

## 2. Create a Hosted Payment Page order

### 2.1 Easiest path — in-app **Test Console** (recommended)
On `<BASE>/gateway/docs`, scroll to **Test Console** and:

1. Set **Amount** (e.g. `1.00` for a real ₹1 test).
2. Leave **Currency** as `INR`.
3. `client_order_id` is auto-filled (`TEST-…`); refresh icon re-rolls it.
4. Optional: `customer_reference`, `callback_url` (`https://…`), `note`.
5. Click **Create test order**.

You'll see the **full JSON response** plus three new buttons:
- **Open hosted payment page ↗** — opens `<BASE>/pay/<public_token>` in a new tab.
- **Copy payment link** — copies that URL for sharing on another device.
- **Open QR PNG ↗** — direct link to the raw QR image.

Plus the existing **View in Transactions →** link.

### 2.2 cURL equivalent

```bash
curl -X POST '<BASE>/api/gateway/create-order' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": 1.00,
    "currency": "INR",
    "client_order_id": "TEST-M2-0001",
    "customer_reference": "self-test",
    "callback_url": "https://webhook.site/your-unique-url",
    "note": "Hosted Payment Page manual test"
  }'
```

### 2.3 Sample success response

```json
{
  "success": true,
  "message": "Order created",
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260421101501123ABCD1234",
    "client_order_id": "TEST-M2-0001",
    "amount": 1,
    "currency": "INR",
    "status": "pending",
    "payment_link": "upi://pay?pa=yourhandle@paytm&pn=Brand&am=1.00&cu=INR&tr=...",
    "upi_payload": "upi://pay?pa=yourhandle@paytm&pn=Brand&am=1.00&cu=INR&tr=...",
    "public_token": "9k3mZpQ2vR8sT1xY4nL6Aw",
    "payment_page_url": "https://<your-domain>/pay/9k3mZpQ2vR8sT1xY4nL6Aw",
    "qr_image_url": "/api/pay/9k3mZpQ2vR8sT1xY4nL6Aw/qr.png",
    "created_at": "2026-04-21T10:15:01.000Z",
    "expires_at": "2026-04-21T10:45:01.000Z",
    "callback_url": "https://webhook.site/your-unique-url"
  }
}
```

> Order TTL is **30 minutes** (defined by `ORDER_TTL_MIN` in `server/routes-public-api.ts`).

---

## 3. Open the hosted payment page

You can do any of the following — they're all the same page:

- Click **Open hosted payment page ↗** in the Test Console.
- Open `payment_page_url` from the JSON in any browser.
- Send `payment_page_url` to your phone (WhatsApp/SMS/email) and open it there.

What you should see:

- **Header** — your `payee_name`, "Secure UPI checkout", a status pill (`Pending`).
- **Summary** — amount due, order reference, optional note, live **Expires in m:ss** countdown.
- **QR card** (only while `pending`) — the QR PNG, step instructions, **Pay with UPI app** button (deep-link `upi://…`), **Copy UPI link** button.
- **Auto-polling** — the page silently calls `POST /api/pay/<token>/refresh` every 4 s (paused when the tab is hidden, capped at 15 minutes).
- **Refresh status** button — forces an immediate poll.

---

## 4. Test the four payment outcomes

### 4.1 ✅ Paid (real payment)
1. Create the order, open the hosted page.
2. On a phone, scan the QR with any UPI app **OR** tap **Pay with UPI app** (works on mobile).
3. Approve the payment.
4. Within ~4 seconds the page should:
   - Switch the pill to **Paid** (green).
   - Show "Payment received successfully" with the **Bank RRN**.
   - Stop polling automatically.

### 4.2 ⏳ Pending (do nothing)
- Open the hosted page and just leave it.
- The countdown ticks down; the status stays **Pending**.
- The order row stays `status='pending'` in the DB.

### 4.3 ⌛ Expired
- Either wait the full 30 minutes after creation, **or** manually expire it for a fast test:

```sql
UPDATE gw_orders SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = <order_id>;
```

  Then either reload the hosted page **or** call `POST /api/pay/<token>/refresh`. Status flips to `expired` and the page swaps to "This payment link has expired".

### 4.4 ❌ Failed
- Triggered automatically when the gateway returns `payment_failed` or amount mismatch on a pending verification.
- For a forced visual test:

```sql
UPDATE gw_orders SET status = 'failed' WHERE id = <order_id>;
```

  Reload the hosted page → "Payment not confirmed" card.

---

## 5. Verify the order via the API

You can use the same Test Console (**Check order status** section) — the `order_id` is auto‑filled — or cURL:

```bash
# By order_id (from the create-order response)
curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "order_id": 123 }'

# Or by txn_ref / client_order_id
curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "txn_ref": "GW20260421101501123ABCD1234" }'

curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "client_order_id": "TEST-M2-0001" }'

# GET also works for quick browser tests
curl '<BASE>/api/gateway/check-order?order_id=123' \
  -H 'Authorization: Bearer YOUR_API_TOKEN'
```

### Sample responses

**Pending**
```json
{
  "success": true,
  "message": "Order status loaded",
  "data": {
    "order_id": 123,
    "client_order_id": "TEST-M2-0001",
    "txn_ref": "GW20260421101501123ABCD1234",
    "amount": 1,
    "currency": "INR",
    "status": "pending",
    "gateway_txn_id": null,
    "bank_rrn": null,
    "payment_received": false,
    "callback_sent": false,
    "callback_status": null,
    "expires_at": "2026-04-21T10:45:01.000Z"
  }
}
```

**Paid**
```json
{
  "success": true,
  "message": "Order status loaded",
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260421101501123ABCD1234",
    "amount": 1,
    "currency": "INR",
    "status": "paid",
    "gateway_txn_id": "20260421...",
    "bank_rrn": "412345678901",
    "verified_at": "2026-04-21T10:18:23.000Z",
    "payment_received": true,
    "callback_sent": true,
    "callback_status": "success"
  }
}
```

**Expired**
```json
{
  "success": true,
  "message": "Order status loaded",
  "data": { "order_id": 123, "status": "expired", "payment_received": false }
}
```

**Failed**
```json
{
  "success": true,
  "message": "Order status loaded",
  "data": { "order_id": 123, "status": "failed", "payment_received": false }
}
```

### Public snapshot (no API token, used by the hosted page)

```bash
curl '<BASE>/api/pay/<public_token>'
curl -X POST '<BASE>/api/pay/<public_token>/refresh'
```

These return only public-safe fields — no merchant key, no callback URL, no internal IDs.

---

## 6. Verify it appears in the website

1. Open `<BASE>/gateway/transactions`.
2. The order you just created appears at the top with:
   - **Txn ID** (`GW…`), **Order ID** (`TEST-M2-0001` or `#<id>`), Amount, **Status pill**, Created timestamp.
   - When paid: **Gateway** id, **Bank RRN**, **Verified** timestamp.
   - When `callback_url` is set: callback delivery row (`Callback sent · success` or `Callback pending`).
3. Pending rows have a **Refresh status** button that re-queries Paytm.

Also check `<BASE>/gateway` (Dashboard) — the totals (orders, paid, pending, revenue) update immediately.

---

## 7. End-to-end happy path checklist

Use this exact sequence to validate a real Hosted Payment Page flow:

- [ ] Login to `<BASE>/gateway/login`
- [ ] Save real UPI settings on `<BASE>/gateway/settings` (status = **Active**)
- [ ] Generate API token on `<BASE>/gateway/docs`
- [ ] In **Test Console**, create a `₹1.00` order with a fresh `client_order_id`
- [ ] Confirm response includes `public_token`, `payment_page_url`, `qr_image_url`
- [ ] Click **Open hosted payment page ↗** — page loads, pill = **Pending**, countdown is running
- [ ] QR PNG renders, **Pay with UPI app** deep-link works on mobile
- [ ] Pay ₹1 from your phone — within ~4 s the page flips to **Paid** with Bank RRN
- [ ] **Check order status** in Test Console returns `status: "paid"` and `payment_received: true`
- [ ] `<BASE>/gateway/transactions` shows the order as **Paid** with Bank RRN + Verified timestamp
- [ ] Dashboard counters (paid count + revenue) increased by 1 / by ₹1
- [ ] If `callback_url` was set, the row shows **Callback sent · success**

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `412 SETTINGS_MISSING` from create-order | UPI settings not saved or marked inactive | Save real Paytm settings on `/gateway/settings` |
| `401 INVALID_API_TOKEN` | Wrong/missing token header | Regenerate token, send as `Authorization: Bearer <token>` |
| `409 ORDER_ALREADY_EXISTS` | You reused the same `client_order_id` | Use a new id (Test Console refresh icon) |
| Hosted page stays **Pending** after you paid | Polling pauses when tab is hidden; or Paytm verification lag | Click **Refresh status** on the page, or call `POST /api/pay/<token>/refresh` |
| `404 PAYMENT_LINK_NOT_FOUND` | Wrong/typoed `public_token` | Re-copy `payment_page_url` from the create response |
| QR image won't load | Order has no `upi_payload` (very old order) | Create a new order |
| Callback shows pending forever | Your endpoint didn't return 2xx | Check your callback URL; it auto‑retries on every check-order call |

---

## 9. Files involved (for reference)

- `server/routes-public-api.ts` — `POST /create-order`, `GET|POST /check-order`
- `server/routes-pay.ts` — `GET /api/pay/:token`, `POST /api/pay/:token/refresh`, `GET /api/pay/:token/qr.png`
- `server/paytm.ts` — UPI payload + Paytm verification
- `server/callback.ts` — webhook delivery + HMAC signing
- `server/migrations.ts` — `gw_orders.public_token` column + unique index
- `client/src/PayPage.tsx` — hosted checkout page (route `/pay/:token`)
- `client/src/Docs.tsx` — Test Console with **Open hosted payment page** button
- `client/src/Transactions.tsx` — Transactions UI
