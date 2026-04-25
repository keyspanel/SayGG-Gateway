import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwApiRaw, gwGet, gwPost } from './api';
import { useGwAuth } from './AuthCtx';

/* ============================================================
   Small helpers
   ============================================================ */

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

function BaseUrlRow({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="gw-base-row" style={{ margin: 0 }}>
      <b>Base URL</b>
      <code>{baseUrl}</code>
      <Copy text={baseUrl} />
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

/* ============================================================
   Tabs
   ============================================================ */

type TabKey = 'test' | 'server' | 'hosted' | 'setup';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'test',   label: 'Test' },
  { key: 'server', label: 'Server' },
  { key: 'hosted', label: 'Hosted Page' },
  { key: 'setup',  label: 'Setup' },
];

/* ============================================================
   Page
   ============================================================ */

export default function GwDocs() {
  const { refresh } = useGwAuth();
  const [tab, setTab] = useState<TabKey>('test');

  // ---- Token state (kept identical to previous behavior) ----
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

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>API Reference</h2>
          <p>Token, endpoints and examples.</p>
        </div>
      </div>

      {/* Token card and Base URL — pinned above tabs */}
      <ApiTokenCard
        token={token}
        created={created}
        show={show}
        busy={busy}
        confirmRegen={confirmRegen}
        settingsActive={settingsActive}
        settingsLoaded={settingsLoaded}
        tokenMsg={tokenMsg}
        tokenCopied={tokenCopied}
        onToggleShow={() => setShow(!show)}
        onCopy={copyToken}
        onGenerate={generate}
        onAskRotate={() => setConfirmRegen(true)}
        onCancelRotate={() => setConfirmRegen(false)}
      />

      <div className="gw-card" style={{ padding: 10 }}>
        <BaseUrlRow baseUrl={baseUrl} />
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

      {tab === 'test'   && <TestTab   token={token} baseUrl={baseUrl} settingsActive={settingsActive} />}
      {tab === 'server' && <ServerTab baseUrl={baseUrl} token={token} />}
      {tab === 'hosted' && <HostedPageTab />}
      {tab === 'setup'  && <SetupTab  baseUrl={baseUrl} />}
    </div>
  );
}

/* ============================================================
   ApiTokenCard
   ============================================================ */

function ApiTokenCard(props: {
  token: string;
  created: string | null;
  show: boolean;
  busy: boolean;
  confirmRegen: boolean;
  settingsActive: boolean;
  settingsLoaded: boolean;
  tokenMsg: { ok?: string; err?: string };
  tokenCopied: boolean;
  onToggleShow: () => void;
  onCopy: () => void;
  onGenerate: () => void;
  onAskRotate: () => void;
  onCancelRotate: () => void;
}) {
  const {
    token, created, show, busy, confirmRegen,
    settingsActive, settingsLoaded, tokenMsg, tokenCopied,
    onToggleShow, onCopy, onGenerate, onAskRotate, onCancelRotate,
  } = props;

  const masked = token ? token.slice(0, 5) + '••••••••' + token.slice(-4) : '';

  return (
    <div className="gw-card feature">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          API Token
        </h3>
        {token && <span className="gw-badge ok">Ready</span>}
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>
        Use this token to authenticate server API requests.
      </p>

      {!settingsLoaded ? (
        <div className="gw-loading">Loading…</div>
      ) : !settingsActive && !token ? (
        <>
          <div className="gw-alert warn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Save UPI settings before creating a token.</span>
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
            <button className="gw-btn-primary" disabled={busy} onClick={onGenerate}>
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
            <button className="gw-btn-ghost sm" onClick={onToggleShow}>{show ? 'Hide' : 'Show'}</button>
            <button className="gw-btn-primary sm" onClick={onCopy}>{tokenCopied ? 'Copied ✓' : 'Copy'}</button>
            <button className="gw-btn-danger sm" disabled={busy} onClick={onAskRotate}>Rotate</button>
          </div>

          {confirmRegen && (
            <div className="gw-alert warn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div style={{ flex: 1 }}>
                <strong>Rotate token?</strong>
                <div style={{ marginTop: 4, color: 'var(--gw-text-mute)', fontWeight: 400 }}>The current token stops working immediately. Update your integrations.</div>
                <div className="gw-actions" style={{ marginTop: 8 }}>
                  <button className="gw-btn-danger sm" disabled={busy} onClick={onGenerate}>{busy ? 'Working…' : 'Rotate'}</button>
                  <button className="gw-btn-ghost sm" disabled={busy} onClick={onCancelRotate}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {created && <p className="gw-muted" style={{ fontSize: 11.5, margin: 0 }}>Created {new Date(created).toLocaleString()}</p>}

          <details className="gw-acc">
            <summary>How to send the token</summary>
            <div className="gw-acc-body">
              <p className="gw-muted" style={{ margin: 0 }}>
                Recommended: <code>Authorization: Bearer YOUR_TOKEN</code>.<br/>
                Also accepted: header <code>X-Api-Token</code>, query <code>?api_token=</code>, JSON body <code>api_token</code>.
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TEST TAB
   ============================================================ */

function TestTab({ token, baseUrl, settingsActive }: { token: string; baseUrl: string; settingsActive: boolean }) {
  return (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Quick start
          </h3>
        </div>
        <ol className="gw-steps">
          <li>Save UPI settings.</li>
          <li>Create API token.</li>
          <li>Create a test order.</li>
          <li>Open hosted payment page.</li>
          <li>Scan or pay using UPI.</li>
          <li>Check final status.</li>
        </ol>
      </div>

      {token && settingsActive ? (
        <TestConsole apiToken={token} baseUrl={baseUrl} />
      ) : (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              Sandbox
            </h3>
          </div>
          <div className="gw-alert warn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>{!settingsActive ? 'Save UPI settings, then create a token to start testing.' : 'Create an API token above to start testing.'}</span>
          </div>
        </div>
      )}

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Status meaning
          </h3>
        </div>
        <ul className="gw-list">
          <li><span className="gw-badge warn" style={{ minWidth: 78, justifyContent: 'center' }}>pending</span> waiting for payment</li>
          <li><span className="gw-badge ok"   style={{ minWidth: 78, justifyContent: 'center' }}>paid</span> verified payment</li>
          <li><span className="gw-badge bad"  style={{ minWidth: 78, justifyContent: 'center' }}>failed</span> payment failed or mismatch</li>
          <li><span className="gw-badge mute" style={{ minWidth: 78, justifyContent: 'center' }}>expired</span> order time ended</li>
          <li><span className="gw-badge bad"  style={{ minWidth: 78, justifyContent: 'center' }}>cancelled</span> cancelled manually</li>
        </ul>
      </div>
    </>
  );
}

/* ============================================================
   SERVER TAB
   ============================================================ */

function ServerTab({ baseUrl, token }: { baseUrl: string; token: string }) {
  const tokenForCode = token || 'YOUR_API_TOKEN';

  const createCurl = `curl -X POST '${baseUrl}/create-order' \\
  -H 'Authorization: Bearer ${tokenForCode}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "amount": 199.00,
    "currency": "INR",
    "client_order_id": "ORD-1001",
    "callback_url": "https://your-site.com/payment/webhook",
    "redirect_url": "https://your-site.com/payment/success",
    "cancel_url": "https://your-site.com/payment/cancelled"
  }'`;

  const jsCode = `const res = await fetch('${baseUrl}/create-order', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${tokenForCode}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: 199,
    currency: 'INR',
    client_order_id: 'ORD-1001',
    callback_url: 'https://your-site.com/payment/webhook',
    redirect_url: 'https://your-site.com/payment/success',
    cancel_url: 'https://your-site.com/payment/cancelled',
  }),
});
const { data } = await res.json();
console.log(data.payment_page_url);`;

  const pyCode = `import requests

r = requests.post(
    '${baseUrl}/create-order',
    headers={'Authorization': 'Bearer ${tokenForCode}'},
    json={
        'amount': 199,
        'currency': 'INR',
        'client_order_id': 'ORD-1001',
        'callback_url': 'https://your-site.com/payment/webhook',
        'redirect_url': 'https://your-site.com/payment/success',
        'cancel_url': 'https://your-site.com/payment/cancelled',
    },
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
  'amount' => 199,
  'currency' => 'INR',
  'client_order_id' => 'ORD-1001',
  'callback_url' => 'https://your-site.com/payment/webhook',
  'redirect_url' => 'https://your-site.com/payment/success',
  'cancel_url' => 'https://your-site.com/payment/cancelled',
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
    "expires_at": "2026-04-20T10:45:01.000Z",
    "redirect_url": "https://your-site.com/payment/success",
    "cancel_url": "https://your-site.com/payment/cancelled"
  }
}`;

  const checkCurl = `curl -X POST '${baseUrl}/check-order' \\
  -H 'Authorization: Bearer ${tokenForCode}' \\
  -H 'Content-Type: application/json' \\
  -d '{ "order_id": 123 }'`;

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

  const verifyJs = `const crypto = require('crypto');

const expected = crypto
  .createHmac('sha256', YOUR_API_TOKEN)
  .update(rawBody)
  .digest('hex');

if (expected !== req.headers['x-gateway-signature']) {
  throw new Error('bad signature');
}`;

  return (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Server API
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          Use this method when your backend creates orders and checks payment status. Your server keeps the API token private.
        </p>
      </div>

      {/* Create order */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Create order</h3>
          <span className="gw-method">POST</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>

        <div className="gw-h4">Headers</div>
        <Code>{`Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json`}</Code>

        <div className="gw-h4">Body</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>amount</td><td>number</td><td>yes</td><td>INR amount, e.g. 199.00</td></tr>
              <tr><td>currency</td><td>string</td><td>no</td><td>Default INR</td></tr>
              <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your unique order id</td></tr>
              <tr><td>customer_reference</td><td>string</td><td>no</td><td>Your customer/user ref</td></tr>
              <tr><td>callback_url</td><td>string</td><td>no</td><td>Server webhook URL (POST, signed)</td></tr>
              <tr><td>redirect_url</td><td>string</td><td>no</td><td>Browser success redirect after <code>paid</code></td></tr>
              <tr><td>cancel_url</td><td>string</td><td>no</td><td>Browser cancel/failure redirect</td></tr>
              <tr><td>note</td><td>string</td><td>no</td><td>Shown in UPI app</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Examples</div>
        <details className="gw-acc" open>
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

      {/* Check order */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Check order</h3>
          <span className="gw-method">POST / GET</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>

        <div className="gw-h4">Body or query — any one</div>
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

        <div className="gw-h4">Example</div>
        <Code>{checkCurl}</Code>

        <div className="gw-h4">Response</div>
        <Code>{checkResp}</Code>
      </div>

      {/* Webhooks */}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Webhooks
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          <code>callback_url</code> receives server-to-server payment updates. Verify the <code>X-Gateway-Signature</code> header before trusting webhook data.
        </p>

        <div className="gw-h4">Payload</div>
        <Code>{callbackPayload}</Code>

        <div className="gw-h4">Verify signature</div>
        <p className="gw-muted" style={{ margin: '4px 0 8px' }}>
          HMAC-SHA256 hex of the raw body, keyed with <b>your API token</b>.
        </p>
        <Code>{verifyJs}</Code>

        <div className="gw-h4">URL types</div>
        <ul className="gw-list">
          <li><span className="gw-badge mute" style={{ minWidth: 92, justifyContent: 'center' }}>callback_url</span> server webhook only — never opened in a browser</li>
          <li><span className="gw-badge ok" style={{ minWidth: 92, justifyContent: 'center' }}>redirect_url</span> browser redirect after <code>paid</code></li>
          <li><span className="gw-badge bad" style={{ minWidth: 92, justifyContent: 'center' }}>cancel_url</span> browser redirect after <code>failed</code>, <code>expired</code>, or <code>cancelled</code></li>
        </ul>
      </div>
    </>
  );
}

/* ============================================================
   HOSTED PAGE TAB
   ============================================================ */

function HostedPageTab() {
  return (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Hosted payment page
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          Every <code>create-order</code> response returns <code>payment_page_url</code>. Share this URL with the customer. The page shows QR, UPI apps, status polling and the final result.
        </p>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            How it flows
          </h3>
        </div>
        <ol className="gw-steps">
          <li>Your server calls <code>create-order</code>.</li>
          <li>You send <code>payment_page_url</code> to the customer.</li>
          <li>Customer opens the page.</li>
          <li>Customer scans QR or opens a UPI app.</li>
          <li>Page keeps checking status.</li>
          <li>If paid, page shows success.</li>
          <li>If <code>redirect_url</code> exists, customer redirects after 5 seconds.</li>
        </ol>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18"/><polyline points="13 5 20 12 13 19"/></svg>
            Redirect behavior
          </h3>
        </div>
        <ul className="gw-list">
          <li><span className="gw-badge ok"   style={{ minWidth: 92, justifyContent: 'center' }}>redirect_url</span> success page</li>
          <li><span className="gw-badge bad"  style={{ minWidth: 92, justifyContent: 'center' }}>cancel_url</span> failed, expired or cancelled page</li>
          <li><span className="gw-badge mute" style={{ minWidth: 92, justifyContent: 'center' }}>callback_url</span> server webhook only</li>
        </ul>
        <div className="gw-h4">Rules</div>
        <ul className="gw-list">
          <li>No redirect while pending.</li>
          <li><code>redirect_url</code> only after <code>paid</code>.</li>
          <li><code>cancel_url</code> only after <code>failed</code>, <code>expired</code> or <code>cancelled</code>.</li>
          <li>Browser redirects after 5 seconds.</li>
          <li>Customer can choose <em>Redirect now</em> or <em>Stay on this page</em>.</li>
        </ul>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Response fields
          </h3>
        </div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>public_token</td><td>Public order token</td></tr>
              <tr><td>payment_page_url</td><td>Hosted checkout URL</td></tr>
              <tr><td>qr_image_url</td><td>QR PNG URL</td></tr>
              <tr><td>redirect_url</td><td>Success redirect target</td></tr>
              <tr><td>cancel_url</td><td>Failed/cancel redirect target</td></tr>
            </tbody>
          </table>
        </div>

        <details className="gw-acc" style={{ marginTop: 12 }}>
          <summary>Public endpoints</summary>
          <div className="gw-acc-body">
            <ul className="gw-list">
              <li><code>GET /pay/:public_token</code> — hosted page</li>
              <li><code>GET /api/pay/:public_token</code> — JSON snapshot</li>
              <li><code>POST /api/pay/:public_token/refresh</code> — re-verify with Paytm</li>
              <li><code>GET /api/pay/:public_token/qr.png?size=2048</code> — HD QR PNG</li>
            </ul>
            <p className="gw-muted" style={{ marginTop: 8, fontSize: 12 }}>
              QR sizes: <code>512</code>, <code>1024</code>, <code>1080</code>, <code>2048</code> (default), <code>4096</code>.
              Plain black-and-white PNG, error-correction level H, large quiet zone — sharp and scannable on print and screen.
              Invalid sizes fall back to 2048.
            </p>
          </div>
        </details>

        <details className="gw-acc">
          <summary>Security</summary>
          <div className="gw-acc-body">
            <ul className="gw-list">
              <li><code>public_token</code> is safe to share.</li>
              <li>API token is never exposed on the hosted page.</li>
              <li><code>callback_url</code> is never exposed to the browser.</li>
              <li>Only public-safe order fields are shown.</li>
              <li>Payment is only final after backend verification.</li>
            </ul>
          </div>
        </details>
      </div>
    </>
  );
}

/* ============================================================
   SETUP TAB
   ============================================================ */

function SetupTab({ baseUrl }: { baseUrl: string }) {
  const serverExample = `app.post("/create-payment", async (req, res) => {
  const r = await fetch("${baseUrl}/create-order", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.GATEWAY_API_TOKEN}\`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: req.body.amount,
      client_order_id: req.body.orderId,
      callback_url: "https://your-site.com/payment/webhook"
    })
  });

  const data = await r.json();
  res.json(data);
});`;

  const hostedExample = `const order = await createGatewayOrder({
  amount: 199,
  client_order_id: "ORD-1001",
  callback_url: "https://your-site.com/api/payment/webhook",
  redirect_url: "https://your-site.com/payment/success",
  cancel_url: "https://your-site.com/payment/failed"
});

return res.json({
  pay_url: order.data.payment_page_url
});`;

  return (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Method 1 — Server API setup
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          Your backend creates the order, shows the QR or UPI link in your own UI, and confirms payment.
        </p>
        <ol className="gw-steps">
          <li>Save UPI settings in dashboard.</li>
          <li>Create API token.</li>
          <li>Store the API token in a backend env variable.</li>
          <li>Backend calls <code>POST /create-order</code>.</li>
          <li>Show QR or UPI link in your own frontend.</li>
          <li>Backend checks <code>POST /check-order</code> or receives <code>callback_url</code> webhook.</li>
          <li>Mark the user order paid only after gateway status is <code>paid</code>.</li>
        </ol>
        <div className="gw-h4">Node / Express example</div>
        <Code>{serverExample}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Method 2 — Hosted payment page setup
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          Your backend creates the order and sends the customer to our hosted checkout. We handle the UI.
        </p>
        <ol className="gw-steps">
          <li>Backend calls <code>POST /create-order</code>.</li>
          <li>Include <code>redirect_url</code> and <code>cancel_url</code>.</li>
          <li>Send <code>payment_page_url</code> to the customer.</li>
          <li>Customer pays on the hosted page.</li>
          <li>Gateway redirects the customer after final status.</li>
          <li>Your server still verifies via webhook or <code>check-order</code> before delivering the product.</li>
        </ol>
        <div className="gw-h4">Minimal example</div>
        <Code>{hostedExample}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z"/></svg>
            Important rules
          </h3>
        </div>
        <ul className="gw-list">
          <li>Never expose the API token in the frontend.</li>
          <li>Use <code>callback_url</code> for backend confirmation.</li>
          <li>Use <code>redirect_url</code> only for the customer landing page.</li>
          <li>Always verify status before giving the product or service.</li>
          <li>Use <code>client_order_id</code> to match your own order.</li>
        </ul>
      </div>
    </>
  );
}

/* ============================================================
   TestConsole — kept identical in behavior
   ============================================================ */

function TestConsole({ apiToken, baseUrl }: { apiToken: string; baseUrl: string }) {
  const [amount, setAmount] = useState('1.00');
  const [currency, setCurrency] = useState('INR');
  const [clientOrderId, setClientOrderId] = useState(randomOrderId());
  const [customerRef, setCustomerRef] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [cancelUrl, setCancelUrl] = useState('');
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
    if (redirectUrl.trim()) body.redirect_url = redirectUrl.trim();
    if (cancelUrl.trim()) body.cancel_url = cancelUrl.trim();
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
        Real API calls. Test orders appear in Transactions. Use ₹1.00 for safe testing.
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
              <span>callback_url <small>optional · server webhook</small></span>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://your-site.com/payment/webhook" inputMode="url" autoCapitalize="off" />
            </label>
            <label className="gw-field">
              <span>redirect_url <small>optional · browser success redirect</small></span>
              <input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://your-site.com/payment/success" inputMode="url" autoCapitalize="off" />
            </label>
            <label className="gw-field">
              <span>cancel_url <small>optional · browser cancel/failure redirect</small></span>
              <input value={cancelUrl} onChange={(e) => setCancelUrl(e.target.value)} placeholder="https://your-site.com/payment/cancelled" inputMode="url" autoCapitalize="off" />
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
