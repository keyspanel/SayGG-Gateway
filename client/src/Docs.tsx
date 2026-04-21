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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
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

type TabKey = 'overview' | 'token' | 'endpoints' | 'hosted' | 'webhooks';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'token',     label: 'Token' },
  { key: 'endpoints', label: 'Endpoints' },
  { key: 'hosted',    label: 'Hosted Page' },
  { key: 'webhooks',  label: 'Webhooks' },
];

export default function GwDocs() {
  const { refresh } = useGwAuth();
  const [tab, setTab] = useState<TabKey>('overview');
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
      setTokenMsg({ ok: 'Token created. Save it now — it won\'t be shown in full again.' });
      refresh().catch(() => {});
    } catch (e: any) {
      setTokenMsg({ err: e?.message || 'Failed to create token' });
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
    "callback_url": "https://your-site.com/payment/callback"
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
  body: JSON.stringify({
    amount: 199, currency: 'INR', client_order_id: 'ORD-1001'
  }),
});
const { data } = await res.json();
console.log(data.payment_link);`;

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
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260420101501123ABCD1234",
    "amount": 199,
    "currency": "INR",
    "status": "pending",
    "payment_link": "upi://pay?pa=merchant@paytm&am=199.00&...",
    "public_token": "9k3mZpQ2vR8sT1xY4nL6Aw",
    "payment_page_url": "https://your-domain.com/pay/9k3mZpQ2vR8sT1xY4nL6Aw",
    "qr_image_url": "/api/pay/9k3mZpQ2vR8sT1xY4nL6Aw/qr.png",
    "expires_at": "2026-04-20T10:45:01.000Z"
  }
}`;

  const checkResp = `{
  "success": true,
  "data": {
    "order_id": 123,
    "status": "paid",
    "bank_rrn": "412345678901",
    "verified_at": "2026-04-20T10:18:23.000Z",
    "payment_received": true
  }
}`;

  const errResp = `{
  "success": false,
  "message": "Invalid API token",
  "code": "INVALID_API_TOKEN"
}`;

  const callbackPayload = `{
  "order_id": 123,
  "client_order_id": "ORD-1001",
  "txn_ref": "GW20260420101501123ABCD1234",
  "amount": 199,
  "currency": "INR",
  "status": "paid",
  "bank_rrn": "412345678901",
  "verified_at": "2026-04-20T10:18:23.000Z"
}`;

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>API Reference</h2>
          <p>Token, endpoints and examples.</p>
        </div>
      </div>

      <div className="gw-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`gw-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="gw-card">
            <div className="gw-card-h">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                Quick start
              </h3>
            </div>
            <ol className="gw-steps">
              <li>Save Paytm settings in <Link to="/gateway/settings">UPI Setup</Link>.</li>
              <li>Create your API token in the <button type="button" className="pp-link" onClick={() => setTab('token')}>Token</button> tab.</li>
              <li>Call <code>POST /create-order</code> to start a payment.</li>
              <li>Either share <code>payment_page_url</code> or render the returned UPI string yourself.</li>
              <li>Receive a webhook, or poll <code>POST /check-order</code>.</li>
            </ol>
          </div>

          <div className="gw-card">
            <div className="gw-card-h">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
                Two ways to accept
              </h3>
            </div>
            <div className="gw-method-grid">
              <div className="gw-method-tile">
                <div className="gw-method-tag">API only</div>
                <h4>Server-to-server</h4>
                <p>Render your own QR or UPI button from the response and poll status.</p>
              </div>
              <div className="gw-method-tile">
                <div className="gw-method-tag">Hosted page</div>
                <h4>Payment link</h4>
                <p>Share <code>payment_page_url</code>. We handle the checkout UI.</p>
              </div>
            </div>
          </div>

          <div className="gw-card">
            <div className="gw-card-h">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Order statuses
              </h3>
            </div>
            <ul className="gw-list">
              <li><span className="gw-badge warn" style={{ minWidth: 72, justifyContent: 'center' }}>pending</span> awaiting payment</li>
              <li><span className="gw-badge ok" style={{ minWidth: 72, justifyContent: 'center' }}>paid</span> verified with Paytm</li>
              <li><span className="gw-badge bad" style={{ minWidth: 72, justifyContent: 'center' }}>failed</span> bank declined or amount mismatch</li>
              <li><span className="gw-badge bad" style={{ minWidth: 72, justifyContent: 'center' }}>cancelled</span> cancelled by you</li>
              <li><span className="gw-badge mute" style={{ minWidth: 72, justifyContent: 'center' }}>expired</span> not paid before <code>expires_at</code></li>
            </ul>
          </div>

          <div className="gw-card">
            <div className="gw-base-row" style={{ margin: 0 }}>
              <b>Base URL</b>
              <code>{baseUrl}</code>
              <Copy text={baseUrl} />
            </div>
          </div>
        </>
      )}

      {tab === 'token' && (
        <>
          <div className="gw-card feature">
            <div className="gw-card-h">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                API token
              </h3>
              {token && <span className="gw-badge ok">Ready</span>}
            </div>

            {!settingsLoaded ? (
              <div className="gw-loading">Loading…</div>
            ) : !settingsActive && !token ? (
              <>
                <div className="gw-alert warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span>Save Paytm settings before creating a token.</span>
                </div>
                <div className="gw-token-empty">
                  <h4>No token yet</h4>
                  <p>Tokens unlock once your gateway is configured.</p>
                  <Link to="/gateway/settings" className="gw-btn-primary">Go to UPI Setup</Link>
                </div>
              </>
            ) : !token ? (
              <>
                {tokenMsg.err && <div className="gw-alert error"><span>{tokenMsg.err}</span></div>}
                <div className="gw-token-empty">
                  <h4>Create your API token</h4>
                  <p>Used to authenticate every API request.</p>
                  <button className="gw-btn-primary" disabled={busy} onClick={generate}>
                    {busy ? 'Creating…' : 'Create token'}
                  </button>
                </div>
              </>
            ) : (
              <div className="gw-token-card">
                {tokenMsg.ok && <div className="gw-alert ok"><span>{tokenMsg.ok}</span></div>}
                {tokenMsg.err && <div className="gw-alert error"><span>{tokenMsg.err}</span></div>}

                <div className="gw-token-display">{show ? token : masked}</div>
                <div className="gw-token-actions">
                  <button className="gw-btn-ghost sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
                  <button className="gw-btn-primary sm" onClick={copyToken}>{tokenCopied ? 'Copied ✓' : 'Copy'}</button>
                  <button className="gw-btn-danger sm" disabled={busy} onClick={() => setConfirmRegen(true)}>Rotate</button>
                </div>

                {confirmRegen && (
                  <div className="gw-alert warn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <div style={{ flex: 1 }}>
                      <strong>Rotate token?</strong>
                      <div style={{ marginTop: 4, color: 'var(--gw-text-mute)', fontWeight: 400 }}>The current token stops working immediately. Update your integrations.</div>
                      <div className="gw-actions" style={{ marginTop: 8 }}>
                        <button className="gw-btn-danger sm" disabled={busy} onClick={generate}>{busy ? 'Working…' : 'Rotate'}</button>
                        <button className="gw-btn-ghost sm" disabled={busy} onClick={() => setConfirmRegen(false)}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                {created && <p className="gw-muted" style={{ fontSize: 11.5, margin: 0 }}>Created {new Date(created).toLocaleString()}</p>}

                <details className="gw-acc">
                  <summary>Other ways to send the token</summary>
                  <div className="gw-acc-body">
                    <p className="gw-muted" style={{ margin: 0 }}>
                      Recommended: <code>Authorization: Bearer YOUR_TOKEN</code>.<br/>
                      Also accepted: header <code>X-Api-Token</code>, query <code>?api_token=</code>, JSON body <code>api_token</code>.
                    </p>
                  </div>
                </details>
              </div>
            )}

            <div className="gw-base-row">
              <b>Base URL</b>
              <code>{baseUrl}</code>
              <Copy text={baseUrl} />
            </div>
          </div>

          {token && settingsActive && <TestConsole apiToken={token} baseUrl={baseUrl} />}
        </>
      )}

      {tab === 'endpoints' && (
        <>
          <div className="gw-card">
            <div className="gw-card-h">
              <h3>Create order</h3>
              <span className="gw-method">POST</span>
            </div>
            <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>

            <div className="gw-h4">Body</div>
            <div className="gw-params-wrap">
              <table className="gw-params">
                <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>amount</td><td>number</td><td>yes</td><td>INR amount, e.g. 199.00</td></tr>
                  <tr><td>currency</td><td>string</td><td>no</td><td>Default INR</td></tr>
                  <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your unique order id</td></tr>
                  <tr><td>customer_reference</td><td>string</td><td>no</td><td>Internal customer ref</td></tr>
                  <tr><td>callback_url</td><td>string</td><td>no</td><td>HTTPS webhook URL</td></tr>
                  <tr><td>note</td><td>string</td><td>no</td><td>Shown in UPI app</td></tr>
                </tbody>
              </table>
            </div>

            <details className="gw-acc" style={{ marginTop: 12 }} open>
              <summary>cURL</summary>
              <div className="gw-acc-body"><Code>{createCurl}</Code></div>
            </details>
            <details className="gw-acc">
              <summary>JavaScript</summary>
              <div className="gw-acc-body"><Code>{jsCode}</Code></div>
            </details>
            <details className="gw-acc">
              <summary>Python</summary>
              <div className="gw-acc-body"><Code>{pyCode}</Code></div>
            </details>
            <details className="gw-acc">
              <summary>PHP</summary>
              <div className="gw-acc-body"><Code>{phpCode}</Code></div>
            </details>

            <div className="gw-h4">Response</div>
            <Code>{createResp}</Code>

            <details className="gw-acc">
              <summary>Errors</summary>
              <div className="gw-acc-body"><Code>{errResp}</Code></div>
            </details>
          </div>

          <div className="gw-card">
            <div className="gw-card-h">
              <h3>Check order</h3>
              <span className="gw-method">POST / GET</span>
            </div>
            <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>

            <div className="gw-h4">Body — any one</div>
            <div className="gw-params-wrap">
              <table className="gw-params">
                <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>order_id</td><td>integer</td><td>Returned by Create order</td></tr>
                  <tr><td>txn_ref</td><td>string</td><td>Returned by Create order</td></tr>
                  <tr><td>client_order_id</td><td>string</td><td>Your client order id</td></tr>
                </tbody>
              </table>
            </div>

            <details className="gw-acc" style={{ marginTop: 12 }} open>
              <summary>Example</summary>
              <div className="gw-acc-body"><Code>{checkCurl}</Code></div>
            </details>

            <div className="gw-h4">Response</div>
            <Code>{checkResp}</Code>
          </div>
        </>
      )}

      {tab === 'hosted' && (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Hosted payment page
            </h3>
          </div>

          <p className="gw-muted">
            Every <code>create-order</code> response includes a <code>payment_page_url</code>. Share it with the customer — we render the QR, handle status polling, and confirm the payment.
          </p>

          <div className="gw-h4">Response fields</div>
          <div className="gw-params-wrap">
            <table className="gw-params">
              <thead><tr><th>Field</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>public_token</td><td>~22-char public id, safe to share</td></tr>
                <tr><td>payment_page_url</td><td>Hosted checkout URL</td></tr>
                <tr><td>qr_image_url</td><td>PNG QR endpoint for self-rendering</td></tr>
              </tbody>
            </table>
          </div>

          <details className="gw-acc" style={{ marginTop: 12 }}>
            <summary>Public endpoints</summary>
            <div className="gw-acc-body">
              <ul className="gw-list">
                <li><code>GET /pay/&lt;public_token&gt;</code> — hosted page</li>
                <li><code>GET /api/pay/&lt;public_token&gt;</code> — JSON snapshot</li>
                <li><code>POST /api/pay/&lt;public_token&gt;/refresh</code> — re-verify with Paytm</li>
                <li><code>GET /api/pay/&lt;public_token&gt;/qr.png</code> — QR PNG</li>
              </ul>
            </div>
          </details>

          <details className="gw-acc">
            <summary>Status updates</summary>
            <div className="gw-acc-body">
              <ol className="gw-steps">
                <li>Page loads order from <code>GET /api/pay/&lt;token&gt;</code>.</li>
                <li>While pending, it polls the refresh endpoint with adaptive backoff. Paused on hidden tabs.</li>
                <li>Refresh re-verifies with Paytm, fires your webhook, returns the latest snapshot.</li>
                <li>Polling stops on <code>paid</code>, <code>failed</code>, or <code>expired</code>.</li>
              </ol>
            </div>
          </details>

          <details className="gw-acc">
            <summary>Security</summary>
            <div className="gw-acc-body">
              <ul className="gw-list">
                <li>~128-bit token per order — no enumeration.</li>
                <li>Only public-safe fields are exposed (amount, status, ref, payee, RRN).</li>
                <li>Webhooks fire with HMAC signature, even when status flips via the hosted page.</li>
              </ul>
            </div>
          </details>
        </div>
      )}

      {tab === 'webhooks' && (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Webhook payload
            </h3>
          </div>
          <p className="gw-muted">
            On payment verification, we POST this JSON to your <code>callback_url</code>. Reply 2xx to ack. Failures retry on each subsequent <code>check-order</code>.
          </p>
          <Code>{callbackPayload}</Code>

          <div className="gw-h4">Signature</div>
          <p className="gw-muted">
            Header <code>X-Gateway-Signature</code> is HMAC-SHA256 hex of the raw body, keyed with <b>your API token</b>. Verify before trusting the payload.
          </p>
          <Code>{`const crypto = require('crypto');
const expected = crypto
  .createHmac('sha256', YOUR_API_TOKEN)
  .update(rawBody)
  .digest('hex');
if (expected !== req.headers['x-gateway-signature']) {
  throw new Error('bad signature');
}`}</Code>
        </div>
      )}
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
  const [note, setNote] = useState('Sandbox order');

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
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          Sandbox
        </h3>
        <span className="gw-badge ok">Live</span>
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>
        Real calls. Created orders appear in Transactions.
      </p>

      <details className="gw-acc" open>
        <summary>Create test order</summary>
        <div className="gw-acc-body">
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
              <span>client_order_id</span>
              <div className="gw-field-pwd">
                <input value={clientOrderId} onChange={(e) => setClientOrderId(e.target.value)} placeholder="ORD-1001" autoCapitalize="off" />
                <button type="button" onClick={() => setClientOrderId(randomOrderId())} aria-label="Generate id">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              </div>
            </label>
            <label className="gw-field">
              <span>customer_reference <small>optional</small></span>
              <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder="user_42" />
            </label>
            <label className="gw-field">
              <span>callback_url <small>optional</small></span>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://your-site.com/callback" inputMode="url" autoCapitalize="off" />
            </label>
            <label className="gw-field">
              <span>note <small>optional</small></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sandbox order" />
            </label>
            <div className="gw-actions">
              <button className="gw-btn-primary" onClick={runCreate} disabled={createBusy || !amount}>
                {createBusy ? 'Sending…' : 'Send'}
              </button>
              <button className="gw-btn-ghost" type="button" onClick={() => { setCreateOut(null); setClientOrderId(randomOrderId()); }}>Reset</button>
            </div>
          </div>

          {createOut && (
            <div style={{ marginTop: 12 }}>
              <div className="gw-base-row" style={{ marginBottom: 6 }}>
                <b>Response</b>
                <span className={`gw-badge ${createOut.ok ? 'ok' : 'bad'}`}>HTTP {createOut.status || 'ERR'}</span>
                {createOut.ok && createOut.body?.data?.order_id && (
                  <Link to="/gateway/transactions" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
                    View →
                  </Link>
                )}
              </div>
              {createOut.ok && createOut.body?.data?.payment_page_url && (
                <div className="gw-actions" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  <a className="gw-btn-primary sm" href={createOut.body.data.payment_page_url} target="_blank" rel="noreferrer noopener">
                    Open hosted page ↗
                  </a>
                  <button
                    type="button"
                    className="gw-btn-ghost sm"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(createOut.body.data.payment_page_url); } catch {}
                    }}
                  >
                    Copy link
                  </button>
                  {createOut.body.data.qr_image_url && (
                    <a className="gw-btn-ghost sm" href={createOut.body.data.qr_image_url} target="_blank" rel="noreferrer noopener">
                      QR PNG ↗
                    </a>
                  )}
                </div>
              )}
              <Code>{pretty(createOut.body)}</Code>
            </div>
          )}
        </div>
      </details>

      <details className="gw-acc">
        <summary>Check order status</summary>
        <div className="gw-acc-body">
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
                {checkBusy ? 'Checking…' : 'Check'}
              </button>
              <button className="gw-btn-ghost" type="button" onClick={() => setCheckOut(null)}>Clear</button>
            </div>
          </div>

          {checkOut && (
            <div style={{ marginTop: 12 }}>
              <div className="gw-base-row" style={{ marginBottom: 6 }}>
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
      </details>
    </div>
  );
}
