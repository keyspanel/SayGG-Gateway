import React, { useEffect, useState } from 'react';
import { gwGet, gwPost } from './api';

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="gw-copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }}>
      {done ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      )}
      {done ? 'Copied' : 'Copy'}
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
  const [token, setToken] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const load = async () => {
    const d = await gwGet('/auth/token');
    setToken(d.api_token || '');
    setCreated(d.api_token_created_at || null);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const regen = async () => {
    setBusy(true);
    try {
      const r = await gwPost('/auth/regenerate-token');
      setToken(r.api_token);
      setCreated(new Date().toISOString());
      setConfirmRegen(false);
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
console.log(data.data.payment_link);`;

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
    "available_endpoints": {
      "create_order": "/api/gateway/create-order",
      "check_order": "/api/gateway/check-order"
    }
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
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            Quick start
          </h3>
        </div>
        <ol className="gw-steps">
          <li>Save your Paytm UPI settings on the UPI Settings page.</li>
          <li>Copy your API token from below.</li>
          <li>Call the Create Order API to start a payment.</li>
          <li>Show the returned <code>payment_link</code> (UPI string) or QR to your customer.</li>
          <li>Poll Check Order API or wait for the callback to confirm payment.</li>
        </ol>
      </div>

      <div className="gw-card" style={{border: '1px solid var(--gw-primary)'}}>
        <div className="gw-card-h">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Your API token
          </h3>
        </div>
        <div className="gw-token-row">
          <code className="gw-token">{token ? (show ? token : masked) : 'No token yet'}</code>
          <button className="gw-btn-ghost sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          {token && <button className="gw-btn-primary sm" onClick={async () => {
            try { await navigator.clipboard.writeText(token); } catch {}
          }}>Copy</button>}
          <button className="gw-btn-danger sm" disabled={busy} onClick={() => setConfirmRegen(true)}>{busy ? 'Working…' : 'Regenerate'}</button>
        </div>
        {confirmRegen && (
          <div className="gw-alert error" style={{alignItems: 'flex-start'}}>
            <div>
              <strong>Regenerate API token?</strong>
              <div style={{marginTop: '4px'}}>Your old token will stop working immediately.</div>
              <div className="gw-actions" style={{marginTop: '12px'}}>
                <button className="gw-btn-danger sm" disabled={busy} onClick={regen}>{busy ? 'Working…' : 'Yes, regenerate'}</button>
                <button className="gw-btn-ghost sm" disabled={busy} onClick={() => setConfirmRegen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        {created && <p className="gw-muted" style={{fontSize: '12px', marginTop: '-4px', marginBottom: '16px'}}>Created: {new Date(created).toLocaleString()}</p>}
        <p className="gw-muted">Authentication: send the token as <code>Authorization: Bearer YOUR_TOKEN</code> header. Header is the recommended method. The header <code>X-Api-Token</code>, query param <code>?api_token=</code> and JSON body field <code>api_token</code> are also supported.</p>
        <div className="gw-base-row"><b>Base URL</b><code>{baseUrl}</code><Copy text={baseUrl} /></div>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>1. Create Order</h3><span className="gw-method post">POST</span></div>
        <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>
        <h4 style={{marginTop: '24px', marginBottom: '8px'}}>Parameters</h4>
        <div style={{overflowX: 'auto'}}>
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
        </div>
        <h4 style={{marginTop: '24px'}}>Example — cURL</h4><Code>{createCurl}</Code>
        <h4 style={{marginTop: '24px'}}>Example — JavaScript</h4><Code>{jsCode}</Code>
        <h4 style={{marginTop: '24px'}}>Example — Python</h4><Code>{pyCode}</Code>
        <h4 style={{marginTop: '24px'}}>Example — PHP</h4><Code>{phpCode}</Code>
        <h4 style={{marginTop: '24px'}}>Success response</h4><Code>{createResp}</Code>
        <h4 style={{marginTop: '24px'}}>Invalid token error</h4><Code>{errResp}</Code>
        <h4 style={{marginTop: '24px'}}>Settings missing error</h4><Code>{settingsMissingResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>2. Check Order</h3><span className="gw-method post">POST/GET</span></div>
        <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>
        <h4 style={{marginTop: '24px', marginBottom: '8px'}}>Parameters (any one)</h4>
        <div style={{overflowX: 'auto'}}>
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>order_id</td><td>integer</td><td>Order id returned by Create Order</td></tr>
              <tr><td>txn_ref</td><td>string</td><td>Transaction reference returned by Create Order</td></tr>
              <tr><td>client_order_id</td><td>string</td><td>Your own client order id</td></tr>
            </tbody>
          </table>
        </div>
        <h4 style={{marginTop: '24px'}}>Example</h4><Code>{checkCurl}</Code>
        <h4 style={{marginTop: '24px'}}>Pending response</h4><Code>{pendingResp}</Code>
        <h4 style={{marginTop: '24px'}}>Paid response</h4><Code>{checkResp}</Code>
        <h4 style={{marginTop: '24px'}}>Invalid endpoint response</h4><Code>{invalidEndpointResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            Callback payload
          </h3>
        </div>
        <p className="gw-muted" style={{lineHeight: 1.6, marginBottom: '16px'}}>When an order is verified as paid, we POST this JSON body to your <code>callback_url</code>. Reply with HTTP 2xx to acknowledge. If delivery fails, we automatically retry on every subsequent Check Order call until it succeeds.</p>
        <Code>{callbackPayload}</Code>
        <h4 style={{marginTop: '24px', marginBottom: '8px'}}>Verifying the signature</h4>
        <p className="gw-muted" style={{lineHeight: 1.6, marginBottom: '16px'}}>Each callback includes an <code>X-Gateway-Signature</code> header — an HMAC-SHA256 hex digest of the raw request body using <b>your API token as the secret</b>. Always verify it before trusting the payload.</p>
        <Code>{`// Node.js example
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', YOUR_API_TOKEN).update(rawBody).digest('hex');
if (expected !== req.headers['x-gateway-signature']) throw new Error('bad signature');`}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Order statuses
          </h3>
        </div>
        <ul className="gw-list">
          <li><span className="gw-badge warn" style={{width: '80px', justifyContent: 'center'}}>pending</span> <span className="gw-muted">order created, awaiting payment</span></li>
          <li><span className="gw-badge ok" style={{width: '80px', justifyContent: 'center'}}>paid</span> <span className="gw-muted">payment received and verified with Paytm</span></li>
          <li><span className="gw-badge bad" style={{width: '80px', justifyContent: 'center'}}>failed</span> <span className="gw-muted">payment failed or amount mismatch</span></li>
          <li><span className="gw-badge bad" style={{width: '80px', justifyContent: 'center'}}>cancelled</span> <span className="gw-muted">cancelled by you</span></li>
          <li><span className="gw-badge mute" style={{width: '80px', justifyContent: 'center'}}>expired</span> <span className="gw-muted">not paid before <code>expires_at</code></span></li>
        </ul>
      </div>
    </div>
  );
}
