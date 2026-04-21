import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet, gwPost } from './api';
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
