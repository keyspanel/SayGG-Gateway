import React, { useEffect, useState } from 'react';
import { gwGet, gwPost } from './api';

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="gw-copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }}>{done ? 'Copied' : 'Copy'}</button>
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
  const [token, setToken] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await gwGet('/auth/token');
    setToken(d.api_token || '');
    setCreated(d.api_token_created_at || null);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const regen = async () => {
    if (!confirm('Regenerate API token? Your old token will stop working immediately.')) return;
    setBusy(true);
    try {
      const r = await gwPost('/auth/regenerate-token');
      setToken(r.api_token);
      setCreated(new Date().toISOString());
    } finally { setBusy(false); }
  };

  const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/gateway';
  const masked = token ? token.slice(0, 6) + '••••••••••••••••' + token.slice(-4) : '';

  const createCurl = `curl -X POST '${baseUrl}/create-order' \\
  -H 'Authorization: Bearer ${token || 'YOUR_API_TOKEN'}' \\
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
  -H 'Authorization: Bearer ${token || 'YOUR_API_TOKEN'}' \\
  -H 'Content-Type: application/json' \\
  -d '{ "order_id": 123 }'`;

  const jsCode = `const res = await fetch('${baseUrl}/create-order', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${token || 'YOUR_API_TOKEN'}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amount: 199, currency: 'INR', client_order_id: 'ORD-1001' }),
});
const data = await res.json();
console.log(data.payment_link);`;

  const pyCode = `import requests

r = requests.post(
    '${baseUrl}/create-order',
    headers={'Authorization': 'Bearer ${token || 'YOUR_API_TOKEN'}'},
    json={'amount': 199, 'currency': 'INR', 'client_order_id': 'ORD-1001'},
    timeout=20,
)
print(r.json())`;

  const phpCode = `<?php
$ch = curl_init('${baseUrl}/create-order');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Authorization: Bearer ${token || 'YOUR_API_TOKEN'}',
  'Content-Type: application/json',
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
  'amount' => 199, 'currency' => 'INR', 'client_order_id' => 'ORD-1001'
]));
echo curl_exec($ch);`;

  const createResp = `{
  "success": true,
  "order_id": 123,
  "txn_ref": "GW20260420101501123ABCD1234",
  "client_order_id": "ORD-1001",
  "amount": 199,
  "currency": "INR",
  "status": "pending",
  "payment_link": "upi://pay?pa=merchant@paytm&pn=Brand&am=199.00&cu=INR&tr=...",
  "upi_payload": "upi://pay?pa=...",
  "created_at": "2026-04-20T10:15:01.000Z",
  "expires_at": "2026-04-20T10:45:01.000Z",
  "callback_url": "https://your-site.com/payment/callback"
}`;

  const checkResp = `{
  "success": true,
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
}`;

  const errResp = `{ "success": false, "error": "Invalid API token" }`;

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
      <div className="gw-card">
        <div className="gw-card-h"><h3>Quick start</h3></div>
        <ol className="gw-steps">
          <li><b>Step 1</b> — Save your Paytm UPI settings on the UPI Settings page.</li>
          <li><b>Step 2</b> — Copy your API token from below.</li>
          <li><b>Step 3</b> — Call the Create Order API to start a payment.</li>
          <li><b>Step 4</b> — Show the returned <code>payment_link</code> (UPI string) or QR to your customer.</li>
          <li><b>Step 5</b> — Poll Check Order API or wait for the callback to confirm payment.</li>
        </ol>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>Your API token</h3></div>
        <div className="gw-token-row">
          <code className="gw-token">{token ? (show ? token : masked) : 'No token yet'}</code>
          <button className="gw-btn-ghost sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          {token && <Copy text={token} />}
          <button className="gw-btn-danger sm" disabled={busy} onClick={regen}>{busy ? 'Working…' : 'Regenerate'}</button>
        </div>
        {created && <p className="gw-muted">Created: {new Date(created).toLocaleString()}</p>}
        <p className="gw-muted">Authentication: send the token as <code>Authorization: Bearer YOUR_TOKEN</code> header. Header is the recommended method. The header <code>X-Api-Token</code>, query param <code>?api_token=</code> and JSON body field <code>api_token</code> are also supported.</p>
        <div className="gw-base-row"><b>Base URL</b><code>{baseUrl}</code><Copy text={baseUrl} /></div>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>1. Create Order</h3><span className="gw-method post">POST</span></div>
        <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>
        <h4>Parameters</h4>
        <table className="gw-params">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>amount</td><td>number</td><td>yes</td><td>Order amount in INR (e.g. 199.00)</td></tr>
            <tr><td>currency</td><td>string</td><td>no</td><td>Currency code, default INR</td></tr>
            <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your own unique order id (deduped per user)</td></tr>
            <tr><td>customer_reference</td><td>string</td><td>no</td><td>Your internal customer ref</td></tr>
            <tr><td>callback_url</td><td>string</td><td>no</td><td>HTTPS URL we POST to once payment is verified</td></tr>
            <tr><td>note</td><td>string</td><td>no</td><td>Short description shown in UPI app</td></tr>
          </tbody>
        </table>
        <h4>Example — cURL</h4><Code>{createCurl}</Code>
        <h4>Example — JavaScript</h4><Code>{jsCode}</Code>
        <h4>Example — Python</h4><Code>{pyCode}</Code>
        <h4>Example — PHP</h4><Code>{phpCode}</Code>
        <h4>Success response</h4><Code>{createResp}</Code>
        <h4>Error response</h4><Code>{errResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>2. Check Order</h3><span className="gw-method post">POST/GET</span></div>
        <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>
        <h4>Parameters (any one)</h4>
        <table className="gw-params">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>order_id</td><td>integer</td><td>Order id returned by Create Order</td></tr>
            <tr><td>txn_ref</td><td>string</td><td>Transaction reference returned by Create Order</td></tr>
            <tr><td>client_order_id</td><td>string</td><td>Your own client order id</td></tr>
          </tbody>
        </table>
        <h4>Example</h4><Code>{checkCurl}</Code>
        <h4>Success response</h4><Code>{checkResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>Callback payload</h3></div>
        <p>When an order is verified as paid, we POST this JSON body to your <code>callback_url</code>. Reply with HTTP 2xx to acknowledge. If delivery fails, we automatically retry on every subsequent Check Order call until it succeeds.</p>
        <Code>{callbackPayload}</Code>
        <h4>Verifying the signature</h4>
        <p>Each callback includes an <code>X-Gateway-Signature</code> header — an HMAC-SHA256 hex digest of the raw request body using <b>your API token as the secret</b>. Always verify it before trusting the payload.</p>
        <Code>{`// Node.js example
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', YOUR_API_TOKEN).update(rawBody).digest('hex');
if (expected !== req.headers['x-gateway-signature']) throw new Error('bad signature');`}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>Order statuses</h3></div>
        <ul className="gw-list">
          <li><span className="gw-badge warn">pending</span> — order created, awaiting payment</li>
          <li><span className="gw-badge ok">paid</span> — payment received and verified with Paytm</li>
          <li><span className="gw-badge bad">failed</span> — payment failed or amount mismatch</li>
          <li><span className="gw-badge bad">cancelled</span> — cancelled by you</li>
          <li><span className="gw-badge mute">expired</span> — not paid before <code>expires_at</code></li>
        </ul>
      </div>
    </div>
  );
}
