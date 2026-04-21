import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwApiRaw, gwGet, gwPost } from './api';
import { useGwAuth } from './AuthCtx';

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="gw-copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }}>
      {done ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
      {done ? 'Copied' : label}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="gw-code-wrap">
      <pre className="gw-code"><code>{children}</code></pre>
      <Copy text={children} />
    </div>
  );
}

export default function GwDocs() {
  const { refresh } = useGwAuth();
  const [token, setToken] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [settingsActive, setSettingsActive] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<{ ok?: string; err?: string }>({});
  const [tokenCopied, setTokenCopied] = useState(false);

  const loadAll = async () => {
    try {
      const [t, s] = await Promise.all([
        gwGet('/auth/token').catch(() => ({})),
        gwGet('/settings/').catch(() => ({})),
      ]);
      setToken(t?.api_token || '');
      setCreated(t?.api_token_created_at || null);
      setSettingsActive(!!s?.is_active);
    } finally {
      setSettingsLoaded(true);
    }
  };
  useEffect(() => { loadAll(); }, []);

  const generate = async () => {
    setBusy(true); setTokenMsg({});
    try {
      const r = await gwPost('/auth/generate-token');
      setToken(r.api_token);
      setCreated(r.api_token_created_at || new Date().toISOString());
      setConfirmRegen(false);
      setShow(true);
      setTokenMsg({ ok: 'API token generated. Keep it safe — it will not be shown in full again automatically.' });
      refresh().catch(() => {});
    } catch (e: any) {
      setTokenMsg({ err: e?.message || 'Failed to generate token' });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {}
  };

  const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/gateway';
  const tokenForCode = token || 'YOUR_API_TOKEN';
  const masked = token ? token.slice(0, 5) + '••••••••' + token.slice(-4) : '';

  const createCurl = `curl -X POST '${baseUrl}/create-order' \\
  -H 'Authorization: Bearer ${tokenForCode}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "amount": 199.00,
    "currency": "INR",
    "client_order_id": "ORD-1001",
    "customer_reference": "user_42",
    "callback_url": "https://your-site.com/payment/callback",
    "note": "Order #1001"
  }'`;

  const checkCurl = `curl -X POST '${baseUrl}/check-order' \\
  -H 'Authorization: Bearer ${tokenForCode}' \\
  -H 'Content-Type: application/json' \\
  -d '{ "order_id": 123 }'`;

  const jsCode = `const res = await fetch('${baseUrl}/create-order', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${tokenForCode}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amount: 199, currency: 'INR', client_order_id: 'ORD-1001' }),
});
const data = await res.json();
console.log(data.data.payment_link);`;

  const pyCode = `import requests

r = requests.post(
    '${baseUrl}/create-order',
    headers={'Authorization': 'Bearer ${tokenForCode}'},
    json={'amount': 199, 'currency': 'INR', 'client_order_id': 'ORD-1001'},
    timeout=20,
)
print(r.json())`;

  const phpCode = `<?php
$ch = curl_init('${baseUrl}/create-order');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Authorization: Bearer ${tokenForCode}',
  'Content-Type: application/json',
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
  'amount' => 199, 'currency' => 'INR', 'client_order_id' => 'ORD-1001'
]));
echo curl_exec($ch);`;

  const createResp = `{
  "success": true,
  "message": "Order created",
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260420101501123ABCD1234",
    "client_order_id": "ORD-1001",
    "amount": 199,
    "currency": "INR",
    "status": "pending",
    "payment_link": "upi://pay?pa=merchant@paytm&pn=Brand&am=199.00&cu=INR&tr=...",
    "upi_payload": "upi://pay?pa=...",
    "public_token": "9k3mZpQ2vR8sT1xY4nL6Aw",
    "payment_page_url": "https://your-domain.com/pay/9k3mZpQ2vR8sT1xY4nL6Aw",
    "qr_image_url": "/api/pay/9k3mZpQ2vR8sT1xY4nL6Aw/qr.png",
    "created_at": "2026-04-20T10:15:01.000Z",
    "expires_at": "2026-04-20T10:45:01.000Z",
    "callback_url": "https://your-site.com/payment/callback"
  }
}`;

  const checkResp = `{
  "success": true,
  "message": "Order status loaded",
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260420101501123ABCD1234",
    "amount": 199,
    "currency": "INR",
    "status": "paid",
    "gateway_txn_id": "20260420...",
    "bank_rrn": "412345678901",
    "verified_at": "2026-04-20T10:18:23.000Z",
    "payment_received": true,
    "callback_sent": true,
    "callback_status": "success"
  }
}`;

  const pendingResp = `{
  "success": true,
  "message": "Order status loaded",
  "data": {
    "order_id": 123,
    "status": "pending",
    "payment_received": false,
    "callback_sent": false
  }
}`;

  const errResp = `{
  "success": false,
  "message": "Invalid API token",
  "code": "INVALID_API_TOKEN",
  "details": {}
}`;

  const settingsMissingResp = `{
  "success": false,
  "message": "Gateway not configured. Save UPI settings first.",
  "code": "SETTINGS_MISSING",
  "details": {}
}`;

  const invalidEndpointResp = `{
  "success": false,
  "message": "Invalid endpoint or method",
  "code": "GATEWAY_ROUTE_NOT_FOUND",
  "details": {
    "path": "/api/gateway",
    "method": "GET",
    "hint": "Use the documented gateway API endpoints with the correct HTTP method. See API Docs after login."
  }
}`;

  const callbackPayload = `{
  "order_id": 123,
  "client_order_id": "ORD-1001",
  "txn_ref": "GW20260420101501123ABCD1234",
  "amount": 199,
  "currency": "INR",
  "status": "paid",
  "gateway_txn_id": "20260420...",
  "bank_rrn": "412345678901",
  "customer_reference": "user_42",
  "verified_at": "2026-04-20T10:18:23.000Z"
}`;

  return (
    <div className="gw-page">
      {/* Quick start */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Quick start
          </h3>
        </div>
        <ol className="gw-steps">
          <li>Save your Paytm UPI settings on the <Link to="/gateway/settings">UPI Settings</Link> page.</li>
          <li>Generate your API token in the panel below.</li>
          <li>Call <code>POST /create-order</code> to start a payment.</li>
          <li>Show the returned <code>payment_link</code> (UPI string) or QR to your customer.</li>
          <li>Poll <code>POST /check-order</code> or wait for the callback to confirm payment.</li>
        </ol>
      </div>

      {/* Token panel */}
      <div className="gw-card feature">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Your API token
          </h3>
          {token && <span className="gw-badge ok">Active</span>}
        </div>

        {!settingsLoaded ? (
          <div className="gw-loading">Loading…</div>
        ) : !settingsActive && !token ? (
          <>
            <div className="gw-alert warn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Save valid Paytm UPI settings first — once your gateway is active you can generate an API token.</span>
            </div>
            <div className="gw-token-empty">
              <h4>No token yet</h4>
              <p>Tokens stay locked until your gateway is configured.</p>
              <Link to="/gateway/settings" className="gw-btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
                Go to UPI Settings
              </Link>
            </div>
          </>
        ) : !token ? (
          <>
            {tokenMsg.err && <div className="gw-alert error"><span>{tokenMsg.err}</span></div>}
            <div className="gw-token-empty">
              <h4>Generate your API token</h4>
              <p>This will create a unique token used to authenticate all public API requests.</p>
              <button className="gw-btn-primary" disabled={busy} onClick={generate}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 2 13 10 21 10"/><path d="M21 10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8z"/></svg>
                {busy ? 'Generating…' : 'Generate API token'}
              </button>
            </div>
          </>
        ) : (
          <div className="gw-token-card">
            {tokenMsg.ok && <div className="gw-alert ok"><span>{tokenMsg.ok}</span></div>}
            {tokenMsg.err && <div className="gw-alert error"><span>{tokenMsg.err}</span></div>}

            <div className="gw-token-display">{show ? token : masked}</div>
            <div className="gw-token-actions">
              <button className="gw-btn-ghost sm" onClick={() => setShow(!show)}>
                {show ? 'Hide' : 'Show'}
              </button>
              <button className="gw-btn-primary sm" onClick={copyToken}>
                {tokenCopied ? 'Copied ✓' : 'Copy token'}
              </button>
              <button className="gw-btn-danger sm" disabled={busy} onClick={() => setConfirmRegen(true)}>
                Regenerate
              </button>
            </div>

            {confirmRegen && (
              <div className="gw-alert warn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div style={{ flex: 1 }}>
                  <strong>Regenerate API token?</strong>
                  <div style={{ marginTop: 4, color: 'var(--gw-text-mute)', fontWeight: 400 }}>Your current token will stop working immediately. Update any integrations using it.</div>
                  <div className="gw-actions" style={{ marginTop: 10 }}>
                    <button className="gw-btn-danger sm" disabled={busy} onClick={generate}>{busy ? 'Working…' : 'Yes, regenerate'}</button>
                    <button className="gw-btn-ghost sm" disabled={busy} onClick={() => setConfirmRegen(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {created && <p className="gw-muted" style={{ fontSize: 12 }}>Created: {new Date(created).toLocaleString()}</p>}

            <p className="gw-muted">
              Send the token as <code>Authorization: Bearer YOUR_TOKEN</code> header (recommended).
              <br />Header <code>X-Api-Token</code>, query <code>?api_token=</code>, and JSON body field <code>api_token</code> are also supported.
            </p>
          </div>
        )}

        <div className="gw-base-row">
          <b>Base URL</b>
          <code>{baseUrl}</code>
          <Copy text={baseUrl} />
        </div>
      </div>

      {/* Method overview */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
            Two ways to accept payments
          </h3>
        </div>
        <div className="gw-method-grid">
          <div className="gw-method-tile">
            <div className="gw-method-tag">Method 1 · API only</div>
            <h4>Server-to-server</h4>
            <p>Call <code>create-order</code>, render the returned <code>upi_payload</code> as your own QR/button, then poll <code>check-order</code> or wait for the webhook callback.</p>
          </div>
          <div className="gw-method-tile">
            <div className="gw-method-tag">Method 2 · Hosted page</div>
            <h4>Online payment link</h4>
            <p>Same <code>create-order</code> call now also returns a <code>payment_page_url</code>. Send that link to your customer — they get a polished checkout page with QR, status updates and confirmation, no UI work on your side.</p>
          </div>
        </div>
      </div>

      {/* Test Console — only when token is ready */}
      {token && settingsActive && <TestConsole apiToken={token} baseUrl={baseUrl} />}

      {/* Method 2 hosted page docs */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Method 2 — Hosted Payment Page
          </h3>
          <span className="gw-badge ok">New</span>
        </div>
        <p className="gw-muted">
          Every order created via <code>POST /create-order</code> now includes a <code>payment_page_url</code>. Open it in a browser to get a fully-branded checkout page that shows the QR code, lets the customer pay from any UPI app, and polls status in real-time until the payment is confirmed.
        </p>

        <div className="gw-h4">Extra fields in the create-order response</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>public_token</td><td>string</td><td>Hard-to-guess identifier (~22 chars). Safe to share publicly.</td></tr>
              <tr><td>payment_page_url</td><td>string</td><td>Fully-qualified URL of the hosted checkout page. Send to your customer.</td></tr>
              <tr><td>qr_image_url</td><td>string</td><td>Direct PNG QR code endpoint. Useful if you embed the QR in your own UI.</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Public endpoints (no API token required)</div>
        <ul className="gw-list">
          <li><code>GET {baseUrl.replace('/api/gateway','')}/pay/&lt;public_token&gt;</code> <span className="gw-muted">— hosted checkout page</span></li>
          <li><code>GET /api/pay/&lt;public_token&gt;</code> <span className="gw-muted">— JSON snapshot of public-safe order fields</span></li>
          <li><code>POST /api/pay/&lt;public_token&gt;/refresh</code> <span className="gw-muted">— re-verifies with Paytm and returns the latest status</span></li>
          <li><code>GET /api/pay/&lt;public_token&gt;/qr.png</code> <span className="gw-muted">— PNG QR for the order's UPI payload</span></li>
        </ul>

        <div className="gw-h4">How status updates</div>
        <ol className="gw-steps">
          <li>The page loads order details from <code>GET /api/pay/&lt;token&gt;</code>.</li>
          <li>While the order is <code>pending</code>, the page silently calls the refresh endpoint every 4 seconds (paused when the tab is hidden, capped at 15 minutes).</li>
          <li>The refresh endpoint re-verifies with Paytm, persists the new status, fires your webhook callback if configured, and returns the updated snapshot.</li>
          <li>Polling stops automatically when the status becomes <code>paid</code>, <code>failed</code>, or <code>expired</code>, and the page swaps to the matching success / failure card.</li>
          <li>Customers never see internal IDs, your merchant key, or raw API errors — only public-safe fields.</li>
        </ol>

        <div className="gw-h4">Security model</div>
        <ul className="gw-list">
          <li>Each order has its own ~128-bit random token — no enumeration possible.</li>
          <li>The hosted page only exposes amount, currency, status, txn_ref, payee name, note and bank RRN. Merchant credentials stay server-side.</li>
          <li>Webhook callbacks still fire (with the same HMAC signature) when status flips via the hosted page.</li>
        </ul>
      </div>

      {/* Create Order */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>1. Create Order</h3>
          <span className="gw-method">POST</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>

        <div className="gw-h4">Parameters</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>amount</td><td>number</td><td>yes</td><td>Order amount in INR (e.g. 199.00)</td></tr>
              <tr><td>currency</td><td>string</td><td>no</td><td>Currency code, default INR</td></tr>
              <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your unique order id (deduped per user)</td></tr>
              <tr><td>customer_reference</td><td>string</td><td>no</td><td>Your internal customer ref</td></tr>
              <tr><td>callback_url</td><td>string</td><td>no</td><td>HTTPS URL we POST to once payment is verified</td></tr>
              <tr><td>note</td><td>string</td><td>no</td><td>Short description shown in UPI app</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Example — cURL</div><Code>{createCurl}</Code>
        <div className="gw-h4">Example — JavaScript</div><Code>{jsCode}</Code>
        <div className="gw-h4">Example — Python</div><Code>{pyCode}</Code>
        <div className="gw-h4">Example — PHP</div><Code>{phpCode}</Code>
        <div className="gw-h4">Success response</div><Code>{createResp}</Code>
        <div className="gw-h4">Invalid token error</div><Code>{errResp}</Code>
        <div className="gw-h4">Settings missing error</div><Code>{settingsMissingResp}</Code>
      </div>

      {/* Check Order */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>2. Check Order</h3>
          <span className="gw-method">POST / GET</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>

        <div className="gw-h4">Parameters (any one)</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>order_id</td><td>integer</td><td>Order id returned by Create Order</td></tr>
              <tr><td>txn_ref</td><td>string</td><td>Transaction reference returned by Create Order</td></tr>
              <tr><td>client_order_id</td><td>string</td><td>Your own client order id</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Example</div><Code>{checkCurl}</Code>
        <div className="gw-h4">Pending response</div><Code>{pendingResp}</Code>
        <div className="gw-h4">Paid response</div><Code>{checkResp}</Code>
        <div className="gw-h4">Invalid endpoint response</div><Code>{invalidEndpointResp}</Code>
      </div>

      {/* Callback */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Callback payload
          </h3>
        </div>
        <p className="gw-muted">
          When an order is verified as paid, we POST this JSON body to your <code>callback_url</code>.
          Reply with HTTP 2xx to acknowledge. If delivery fails, we automatically retry on every subsequent Check Order call until it succeeds.
        </p>
        <Code>{callbackPayload}</Code>

        <div className="gw-h4">Verifying the signature</div>
        <p className="gw-muted">
          Each callback includes an <code>X-Gateway-Signature</code> header — an HMAC-SHA256 hex digest of the raw request body using <b>your API token as the secret</b>. Always verify it before trusting the payload.
        </p>
        <Code>{`// Node.js example
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', YOUR_API_TOKEN).update(rawBody).digest('hex');
if (expected !== req.headers['x-gateway-signature']) throw new Error('bad signature');`}</Code>
      </div>

      {/* Statuses */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Order statuses
          </h3>
        </div>
        <ul className="gw-list">
          <li><span className="gw-badge warn" style={{ minWidth: 78, justifyContent: 'center' }}>pending</span> <span className="gw-muted">order created, awaiting payment</span></li>
          <li><span className="gw-badge ok" style={{ minWidth: 78, justifyContent: 'center' }}>paid</span> <span className="gw-muted">payment received and verified with Paytm</span></li>
          <li><span className="gw-badge bad" style={{ minWidth: 78, justifyContent: 'center' }}>failed</span> <span className="gw-muted">payment failed or amount mismatch</span></li>
          <li><span className="gw-badge bad" style={{ minWidth: 78, justifyContent: 'center' }}>cancelled</span> <span className="gw-muted">cancelled by you</span></li>
          <li><span className="gw-badge mute" style={{ minWidth: 78, justifyContent: 'center' }}>expired</span> <span className="gw-muted">not paid before <code>expires_at</code></span></li>
        </ul>
      </div>
    </div>
  );
}

function randomOrderId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TEST-${stamp}-${rand}`;
}

function pretty(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function TestConsole({ apiToken, baseUrl }: { apiToken: string; baseUrl: string }) {
  const [amount, setAmount] = useState('1.00');
  const [currency, setCurrency] = useState('INR');
  const [clientOrderId, setClientOrderId] = useState(randomOrderId());
  const [customerRef, setCustomerRef] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [note, setNote] = useState('Test order from API Docs');

  const [createBusy, setCreateBusy] = useState(false);
  const [createOut, setCreateOut] = useState<{ status: number; ok: boolean; body: any } | null>(null);

  const [lookupKind, setLookupKind] = useState<'order_id' | 'txn_ref' | 'client_order_id'>('order_id');
  const [lookupValue, setLookupValue] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkOut, setCheckOut] = useState<{ status: number; ok: boolean; body: any } | null>(null);

  const runCreate = async () => {
    setCreateBusy(true); setCreateOut(null);
    const body: any = {
      amount: parseFloat(amount),
      currency: currency.trim().toUpperCase() || 'INR',
    };
    if (clientOrderId.trim()) body.client_order_id = clientOrderId.trim();
    if (customerRef.trim()) body.customer_reference = customerRef.trim();
    if (callbackUrl.trim()) body.callback_url = callbackUrl.trim();
    if (note.trim()) body.note = note.trim();
    try {
      const r = await gwApiRaw('/create-order', apiToken, { method: 'POST', body });
      setCreateOut(r);
      if (r.ok && r.body?.data?.order_id) {
        setLookupKind('order_id');
        setLookupValue(String(r.body.data.order_id));
      }
    } catch (e: any) {
      setCreateOut({ status: 0, ok: false, body: { success: false, message: e?.message || 'Network error' } });
    } finally {
      setCreateBusy(false);
    }
  };

  const runCheck = async () => {
    if (!lookupValue.trim()) return;
    setCheckBusy(true); setCheckOut(null);
    try {
      const body: any = {};
      if (lookupKind === 'order_id') body.order_id = parseInt(lookupValue.trim(), 10);
      else body[lookupKind] = lookupValue.trim();
      const r = await gwApiRaw('/check-order', apiToken, { method: 'POST', body });
      setCheckOut(r);
    } catch (e: any) {
      setCheckOut({ status: 0, ok: false, body: { success: false, message: e?.message || 'Network error' } });
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <div className="gw-card feature">
      <div className="gw-card-h">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          Test Console
        </h3>
        <span className="gw-badge ok">Live</span>
      </div>
      <p className="gw-muted" style={{ marginTop: -6 }}>
        Hits the real <code>/create-order</code> and <code>/check-order</code> endpoints with your API token. Responses are written straight to your database — created orders will appear on the Transactions page.
      </p>

      <div className="gw-h4">Create a test order</div>
      <div className="gw-form">
        <label className="gw-field">
          <span>Amount (INR) <span className="gw-required">*</span></span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1.00" />
        </label>
        <label className="gw-field">
          <span>Currency</span>
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" />
        </label>
        <label className="gw-field">
          <span>client_order_id <small>your unique id</small></span>
          <div className="gw-field-pwd">
            <input value={clientOrderId} onChange={(e) => setClientOrderId(e.target.value)} placeholder="ORD-1001" autoCapitalize="off" />
            <button type="button" onClick={() => setClientOrderId(randomOrderId())} aria-label="Generate random id">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          </div>
        </label>
        <label className="gw-field">
          <span>customer_reference <small>optional</small></span>
          <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder="user_42" />
        </label>
        <label className="gw-field">
          <span>callback_url <small>optional, http(s)://</small></span>
          <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://your-site.com/payment/callback" inputMode="url" autoCapitalize="off" />
        </label>
        <label className="gw-field">
          <span>note <small>optional</small></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Test order" />
        </label>
        <div className="gw-actions">
          <button className="gw-btn-primary" onClick={runCreate} disabled={createBusy || !amount}>
            {createBusy ? 'Sending…' : 'Create test order'}
          </button>
          <button className="gw-btn-ghost" type="button" onClick={() => { setCreateOut(null); setClientOrderId(randomOrderId()); }}>Reset</button>
        </div>
      </div>

      {createOut && (
        <div style={{ marginTop: 14 }}>
          <div className="gw-base-row" style={{ marginBottom: 8 }}>
            <b>Response</b>
            <span className={`gw-badge ${createOut.ok ? 'ok' : 'bad'}`}>HTTP {createOut.status || 'ERR'}</span>
            {createOut.ok && createOut.body?.data?.order_id && (
              <Link to="/gateway/transactions" style={{ marginLeft: 'auto', fontSize: 13 }}>
                View in Transactions →
              </Link>
            )}
          </div>
          <Code>{pretty(createOut.body)}</Code>
        </div>
      )}

      <div className="gw-h4" style={{ marginTop: 18 }}>Check order status</div>
      <div className="gw-form">
        <label className="gw-field">
          <span>Lookup by</span>
          <div className="gw-select-wrap">
            <select value={lookupKind} onChange={(e) => setLookupKind(e.target.value as any)}>
              <option value="order_id">order_id</option>
              <option value="txn_ref">txn_ref</option>
              <option value="client_order_id">client_order_id</option>
            </select>
          </div>
        </label>
        <label className="gw-field">
          <span>Value</span>
          <input value={lookupValue} onChange={(e) => setLookupValue(e.target.value)} placeholder={lookupKind === 'order_id' ? '123' : lookupKind === 'txn_ref' ? 'GW…' : 'ORD-1001'} autoCapitalize="off" />
        </label>
        <div className="gw-actions">
          <button className="gw-btn-primary" onClick={runCheck} disabled={checkBusy || !lookupValue.trim()}>
            {checkBusy ? 'Checking…' : 'Check status'}
          </button>
          <button className="gw-btn-ghost" type="button" onClick={() => setCheckOut(null)}>Clear</button>
        </div>
      </div>

      {checkOut && (
        <div style={{ marginTop: 14 }}>
          <div className="gw-base-row" style={{ marginBottom: 8 }}>
            <b>Response</b>
            <span className={`gw-badge ${checkOut.ok ? 'ok' : 'bad'}`}>HTTP {checkOut.status || 'ERR'}</span>
            {checkOut.body?.data?.status && (
              <span className={`gw-badge ${checkOut.body.data.status === 'paid' ? 'ok' : checkOut.body.data.status === 'pending' ? 'warn' : 'bad'}`}>
                {checkOut.body.data.status}
              </span>
            )}
          </div>
          <Code>{pretty(checkOut.body)}</Code>
        </div>
      )}
    </div>
  );
}
