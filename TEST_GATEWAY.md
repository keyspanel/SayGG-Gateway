# Payment Gateway — Real Manual Testing Guide

End-to-end manual test plan for the standalone Payment Gateway (Express + PostgreSQL + React). Every step uses the live project — no mocks, no fake data.

> Replace `<BASE>` below with your live origin, e.g. `https://<your-replit-domain>` or `http://localhost:5000`. The API base path is **always** `<BASE>/api/gateway`.

---

## 0. What you need

- Your live project URL (the running app)
- A working Paytm UPI handle, Merchant ID (MID) and Merchant Key
- A terminal (for cURL) **OR** Postman **OR** just the in-app **Test Console** on the API Docs page

All flows can be done either via the **website UI** or via the **public API**. The Test Console on the Docs page hits the same real APIs your customers would.

---

## 1. Website flow (UI)

### 1.1 Register
1. Open `<BASE>/gateway/register`
2. Fill username (3–32 chars, letters/digits/_), email, password (min 8), confirm password
3. Submit → you'll be logged in and redirected to **UPI Settings**

### 1.2 Login (existing user)
1. Open `<BASE>/gateway/login`
2. Sign in with username **or** email + password

### 1.3 Save UPI Settings
On `<BASE>/gateway/settings`:
- **Paytm UPI ID** — e.g. `merchant@paytm`
- **Paytm Merchant ID (MID)**
- **Paytm Merchant Key** (stored encrypted; masked after save)
- **Payee display name** (optional, shown in customer's UPI app)
- **Environment** — `production` or `staging`

Save → the page should show **Active** and a CTA to generate your API token.

### 1.4 Generate API Token
1. Open `<BASE>/gateway/docs`
2. In the **Your API token** card, click **Generate API token**
3. Copy the token (format: `pg_` + 16 chars). Keep it safe — treat it like a password.

> If you didn't save settings first, the page will block token generation and link you back to UPI Settings. Expected behavior.

### 1.5 Transactions page
- `<BASE>/gateway/transactions`
- Empty state on a new account; orders appear here as soon as you create them via API or Test Console
- Each card shows: **Txn ID**, **Order ID**, **Gateway Txn ID**, **Bank RRN**, **Amount**, **Status**, **Created**, **Verified**, **Callback delivery**
- Pending orders include a **Refresh status** button that re-queries Paytm

---

## 2. In-app Test Console (recommended)

On `<BASE>/gateway/docs` (after you've saved settings + generated a token), scroll to **Test Console**.

### 2.1 Create a test order
Fields:
- `amount` (required, INR; e.g. `1.00`)
- `currency` (defaults to `INR`)
- `client_order_id` (auto-filled with a unique `TEST-…` id; click the refresh icon to re-roll)
- `customer_reference` (optional)
- `callback_url` (optional, must start with `http://` or `https://`)
- `note` (optional)

Click **Create test order** → you'll see:
- HTTP status pill (200 on success)
- The full JSON response from the real API
- A **View in Transactions →** link

### 2.2 Check order status
The `order_id` from the previous step is auto-filled.
- Choose lookup field: `order_id`, `txn_ref`, or `client_order_id`
- Click **Check status** → you'll see the live JSON, including `status`, `gateway_txn_id`, `bank_rrn`, `payment_received`, `callback_sent`.

If the order is still `pending`, the server tries a fresh verification with Paytm before responding.

---

## 3. Public API flow (cURL / Postman / your code)

All endpoints live under `<BASE>/api/gateway`. Always send your token as `Authorization: Bearer <YOUR_API_TOKEN>`.

### 3.1 Auth — Register
```bash
curl -X POST '<BASE>/api/gateway/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "merchant_co",
    "email": "you@example.com",
    "password": "supersecret",
    "confirm_password": "supersecret"
  }'
```
Response includes a `token` (session JWT). Save it for further dashboard calls.

### 3.2 Auth — Login
```bash
curl -X POST '<BASE>/api/gateway/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{ "username": "merchant_co", "password": "supersecret" }'
```

### 3.3 Save UPI Settings (uses session token)
```bash
curl -X PUT '<BASE>/api/gateway/settings/' \
  -H 'Authorization: Bearer <SESSION_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "paytm_upi_id": "merchant@paytm",
    "paytm_merchant_id": "YOUR_MID",
    "paytm_merchant_key": "YOUR_MERCHANT_KEY",
    "paytm_env": "production",
    "payee_name": "Your Brand"
  }'
```

### 3.4 Generate API Token (session token required, settings must be active)
```bash
curl -X POST '<BASE>/api/gateway/auth/generate-token' \
  -H 'Authorization: Bearer <SESSION_TOKEN>'
```
Response contains `api_token` — this is what your backend integrations use.

### 3.5 Create Order (public API — uses API token)
```bash
curl -X POST '<BASE>/api/gateway/create-order' \
  -H 'Authorization: Bearer <YOUR_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": 199.00,
    "currency": "INR",
    "client_order_id": "ORD-1001",
    "customer_reference": "user_42",
    "callback_url": "https://your-site.com/payment/callback",
    "note": "Order #1001"
  }'
```

Expected success response:
```json
{
  "success": true,
  "message": "Order created",
  "data": {
    "order_id": 123,
    "txn_ref": "GW...",
    "client_order_id": "ORD-1001",
    "amount": 199,
    "currency": "INR",
    "status": "pending",
    "payment_link": "upi://pay?pa=...",
    "upi_payload": "upi://pay?pa=...",
    "expires_at": "..."
  }
}
```

Show `payment_link` to your customer (UPI deep link or QR). They pay from any UPI app to your UPI handle.

### 3.6 Check Order (public API — uses API token)
By `order_id`:
```bash
curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer <YOUR_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "order_id": 123 }'
```
By `txn_ref`:
```bash
curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer <YOUR_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "txn_ref": "GW..." }'
```
By `client_order_id`:
```bash
curl -X POST '<BASE>/api/gateway/check-order' \
  -H 'Authorization: Bearer <YOUR_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{ "client_order_id": "ORD-1001" }'
```
GET also works: `GET <BASE>/api/gateway/check-order?order_id=123`.

---

## 4. Postman quick start

1. Create a new collection variable `BASE = https://<your-domain>`
2. Create another `API_TOKEN = pg_xxxxxxxxxxxxxxxx`
3. Import these requests:

| Name           | Method | URL                                  | Auth                              |
|----------------|--------|--------------------------------------|-----------------------------------|
| Create Order   | POST   | `{{BASE}}/api/gateway/create-order`  | Bearer Token = `{{API_TOKEN}}`    |
| Check Order    | POST   | `{{BASE}}/api/gateway/check-order`   | Bearer Token = `{{API_TOKEN}}`    |
| Health         | GET    | `{{BASE}}/api/health`                | none                              |

Body type: `raw` → `JSON`. Paste the JSON shown in section 3.

---

## 5. JavaScript fetch example

```js
const BASE = 'https://<your-domain>';
const TOKEN = 'pg_xxxxxxxxxxxxxxxx';

const r = await fetch(`${BASE}/api/gateway/create-order`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: 1.0,
    currency: 'INR',
    client_order_id: `ORD-${Date.now()}`,
    note: 'Smoke test',
  }),
});
const json = await r.json();
console.log(json);
```

---

## 6. Verifying end-to-end

After step 3.5 / 3.6 (or Test Console), confirm:

| Check                               | Where to look                                                           |
|-------------------------------------|-------------------------------------------------------------------------|
| Order stored in DB                  | `<BASE>/gateway/transactions` — order card appears at the top           |
| Status starts as `pending`          | Status badge on the transaction card                                    |
| Status flips to `paid` after payment| Customer pays from UPI app → call Check Order or click **Refresh status** |
| Callback delivery                   | Your callback endpoint receives the JSON shown in API Docs              |
| Callback signature                  | Verify HMAC-SHA256 of raw body using your API token (see API Docs)      |
| Dashboard counts                    | `<BASE>/gateway/` — stats reflect total / paid / pending / failed       |

---

## 7. Expected error shapes

All gateway errors share one short, secure shape:

```json
{
  "success": false,
  "message": "Provide a valid API token to access this resource.",
  "code": "API_TOKEN_REQUIRED",
  "details": {
    "path": "/api/gateway/create-order",
    "method": "POST",
    "hint": "Provide a valid API token to access this resource."
  }
}
```

Common codes you may see while testing:
- `API_TOKEN_REQUIRED`, `INVALID_API_TOKEN` — bad/missing token
- `SETTINGS_MISSING` — UPI settings not saved or inactive
- `VALIDATION_ERROR` — missing/invalid field (see `details.field`)
- `ORDER_ALREADY_EXISTS` — duplicate `client_order_id` (`details` includes the existing `order_id` and `txn_ref`)
- `ORDER_NOT_FOUND` — wrong `order_id` / `txn_ref` / `client_order_id`
- `GATEWAY_ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED` — wrong URL or HTTP verb

---

## 8. Quick smoke checklist

- [ ] Register a new user via UI
- [ ] Login works
- [ ] Save UPI settings → page shows **Active**
- [ ] Generate API token → token shown
- [ ] Test Console: create test order with amount `1.00` → 200 OK + JSON
- [ ] Transactions page lists the new order
- [ ] Test Console: check order by `order_id` → JSON shows `pending`
- [ ] Pay the UPI link from your phone → re-check → status `paid`, `gateway_txn_id` and `bank_rrn` populated
- [ ] Set a `callback_url` and confirm your endpoint receives the signed POST
