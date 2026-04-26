import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gwApiRaw, gwGet, gwPost, apiGet } from './api';
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
   Lock icon
   ============================================================ */

function LockSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

/* ============================================================
   LockedPreview — blur + overlay when locked
   ============================================================ */

interface LockedPreviewProps {
  locked: boolean;
  reason: string;
  subtitle?: string;
  ctaLabel: string;
  onCta: () => void;
  children: React.ReactNode;
}

function LockedPreview({ locked, reason, subtitle, ctaLabel, onCta, children }: LockedPreviewProps) {
  if (!locked) return <>{children}</>;
  return (
    <div className="docs-locked-preview">
      <div className="docs-locked-content" aria-hidden="true">
        {children}
      </div>
      <div className="docs-lock-overlay" role="region" aria-label="Locked content">
        <div className="docs-lock-card">
          <div className="docs-lock-icon"><LockSvg /></div>
          <p className="docs-lock-title">{reason}</p>
          {subtitle && <p className="docs-lock-sub">{subtitle}</p>}
          <button className="gw-btn-primary" onClick={onCta} style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Plan badge
   ============================================================ */

function PlanBadge({ user, isExpired }: { user: any; isExpired: boolean }) {
  if (!user) return null;
  if (user.is_owner) return <span className="gw-badge mute">Owner</span>;
  const sub = user.active_subscription;
  if (!sub) {
    if (isExpired) return <span className="gw-badge expired-plan">Expired</span>;
    return <span className="gw-badge warn-plan">No active plan</span>;
  }
  const label = sub.method_access === 'server' ? 'Server API'
              : sub.method_access === 'hosted' ? 'Hosted Page'
              : 'Master';
  const days = sub.days_left !== null ? ` · ${sub.days_left}d` : '';
  return <span className="gw-badge ok" style={{ fontSize: 12, fontWeight: 600 }}>{label}{days}</span>;
}

/* ============================================================
   Page
   ============================================================ */

type TabKey = 'test' | 'server' | 'hosted' | 'setup';

const ALL_TABS: { key: TabKey; label: string }[] = [
  { key: 'test',   label: 'Test' },
  { key: 'server', label: 'Server' },
  { key: 'hosted', label: 'Hosted Page' },
  { key: 'setup',  label: 'Setup' },
];

export default function GwDocs() {
  const { refresh, user } = useGwAuth();
  const navigate = useNavigate();

  const sub = user?.active_subscription;
  const isOwner = !!user?.is_owner;
  const canServer = isOwner || !!(sub && (sub.method_access === 'server' || sub.method_access === 'master'));
  const canHosted = isOwner || !!(sub && (sub.method_access === 'hosted' || sub.method_access === 'master'));
  const isMasterOrOwner = isOwner || !!(sub && sub.method_access === 'master');
  const hasPlan = isOwner || !!sub;

  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!hasPlan && !isOwner) {
      apiGet('/api/billing/me').then((m: any) => {
        const history: any[] = m.history || [];
        setIsExpired(history.length > 0);
      }).catch(() => {});
    }
  }, [hasPlan, isOwner]);

  const goToBilling = useCallback(() => navigate('/gateway/billing'), [navigate]);

  const serverCtaLabel = isExpired ? 'Renew Plan' : !hasPlan ? 'View Plans' : 'Upgrade Plan';
  const hostedCtaLabel = isExpired ? 'Renew Plan' : !hasPlan ? 'View Plans' : 'Upgrade Plan';
  const testCtaLabel   = isExpired ? 'Renew Plan' : 'View Plans';

  const [tab, setTab] = useState<TabKey>('test');

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
      setToken((t as any)?.api_token || '');
      setCreated((t as any)?.api_token_created_at || null);
      setSettingsActive(!!(s as any)?.is_active);
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
          <p>Token, endpoints and integration guide.</p>
        </div>
        <PlanBadge user={user} isExpired={isExpired} />
      </div>

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
        hasPlan={hasPlan}
        isOwner={isOwner}
        onToggleShow={() => setShow(!show)}
        onCopy={copyToken}
        onGenerate={generate}
        onAskRotate={() => setConfirmRegen(true)}
        onCancelRotate={() => setConfirmRegen(false)}
        onGoToBilling={goToBilling}
      />

      <div className="gw-card" style={{ padding: 10 }}>
        <BaseUrlRow baseUrl={baseUrl} />
      </div>

      <div className="gw-tabs" role="tablist">
        {ALL_TABS.map((t) => (
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

      {tab === 'test' && (
        <TestTab
          token={token}
          baseUrl={baseUrl}
          settingsActive={settingsActive}
          canServer={canServer}
          canHosted={canHosted}
          isMasterOrOwner={isMasterOrOwner}
          hasPlan={hasPlan}
          isExpired={isExpired}
          ctaLabel={testCtaLabel}
          onGoToBilling={goToBilling}
        />
      )}
      {tab === 'server' && (
        <ServerTab
          baseUrl={baseUrl}
          token={token}
          canServer={canServer}
          ctaLabel={serverCtaLabel}
          onGoToBilling={goToBilling}
        />
      )}
      {tab === 'hosted' && (
        <HostedPageTab
          canHosted={canHosted}
          ctaLabel={hostedCtaLabel}
          onGoToBilling={goToBilling}
        />
      )}
      {tab === 'setup' && (
        <SetupTab
          baseUrl={baseUrl}
          canServer={canServer}
          canHosted={canHosted}
          isMasterOrOwner={isMasterOrOwner}
          hasPlan={hasPlan}
          serverCtaLabel={serverCtaLabel}
          hostedCtaLabel={hostedCtaLabel}
          onGoToBilling={goToBilling}
        />
      )}
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
  hasPlan: boolean;
  isOwner: boolean;
  onToggleShow: () => void;
  onCopy: () => void;
  onGenerate: () => void;
  onAskRotate: () => void;
  onCancelRotate: () => void;
  onGoToBilling: () => void;
}) {
  const {
    token, created, show, busy, confirmRegen,
    settingsActive, settingsLoaded, tokenMsg, tokenCopied,
    hasPlan, isOwner,
    onToggleShow, onCopy, onGenerate, onAskRotate, onCancelRotate, onGoToBilling,
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
      ) : !isOwner && !hasPlan ? (
        /* ── No active plan ── */
        <div className="gw-token-empty">
          <div style={{ marginBottom: 10, color: 'var(--gw-text-mute)' }}>
            <LockSvg />
          </div>
          <h4>API Token locked</h4>
          <p>Choose a plan to create API tokens and start accepting payments.</p>
          <button className="gw-btn-primary" onClick={onGoToBilling}>View Plans</button>
        </div>
      ) : !settingsActive && !token ? (
        /* ── Has plan but UPI not set up ── */
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
        /* ── Has plan, UPI ready, no token yet ── */
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
        /* ── Token exists ── */
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
   Shared overview helpers — used across tabs
   ============================================================ */

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  );
}

interface MethodFeature { title: string; sub: string; }

function MethodOverviewCard({ icon, title, methodLabel, description, features, bestFor }: {
  icon: React.ReactNode; title: string; methodLabel: string;
  description: string; features: MethodFeature[]; bestFor: string;
}) {
  return (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>{icon}{title}</h3>
        <span className="gw-badge mute">{methodLabel}</span>
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>{description}</p>
      <div className="gw-feat-grid">
        {features.map((f, i) => (
          <div key={i} className="gw-feat">
            <span className="gw-feat-icon"><CheckIcon /></span>
            <div className="gw-feat-text">
              <strong>{f.title}</strong>
              <span>{f.sub}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="gw-best-for">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Best for: {bestFor}
      </div>
    </div>
  );
}

function StatusLegendCard() {
  return (
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
  );
}

/* ============================================================
   TEST TAB
   ============================================================ */

function TestTab({ token, baseUrl, settingsActive, canServer, canHosted, isMasterOrOwner, hasPlan, isExpired, ctaLabel, onGoToBilling }: {
  token: string; baseUrl: string; settingsActive: boolean;
  canServer: boolean; canHosted: boolean; isMasterOrOwner: boolean;
  hasPlan: boolean; isExpired: boolean; ctaLabel: string; onGoToBilling: () => void;
}) {
  const expiredText = isExpired ? 'Plan expired' : 'Plan required';
  const expiredSub  = isExpired ? 'Renew your plan to continue testing.' : 'Choose a plan to test live payment orders.';

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
          <li>Create a test order below.</li>
          {canServer && !canHosted && <li>Use <code>payment_link</code> or <code>upi_payload</code> in your own UI.</li>}
          {canHosted && <li>Open the hosted payment page link.</li>}
          {canServer && !canHosted && <li>Scan the UPI link or redirect to a UPI app.</li>}
          <li>Check final status.</li>
        </ol>
      </div>

      {/* Sandbox — locked if no plan */}
      {!hasPlan ? (
        <LockedPreview
          locked={true}
          reason={expiredText}
          subtitle={expiredSub}
          ctaLabel={ctaLabel}
          onCta={onGoToBilling}
        >
          <LockedSandboxPreview />
        </LockedPreview>
      ) : token && settingsActive ? (
        <TestConsole apiToken={token} baseUrl={baseUrl} canServer={canServer} canHosted={canHosted} isMasterOrOwner={isMasterOrOwner} />
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

      <StatusLegendCard />
    </>
  );
}

/* Static preview card shown blurred in the locked sandbox */
function LockedSandboxPreview() {
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
      <div className="gw-form" style={{ gap: 10, marginTop: 8 }}>
        <label className="gw-field"><span>Mode</span><div style={{ height: 36, background: 'var(--gw-bg-2)', borderRadius: 8 }} /></label>
        <label className="gw-field"><span>Amount (INR)</span><div style={{ height: 36, background: 'var(--gw-bg-2)', borderRadius: 8 }} /></label>
        <label className="gw-field"><span>client_order_id</span><div style={{ height: 36, background: 'var(--gw-bg-2)', borderRadius: 8 }} /></label>
        <label className="gw-field"><span>callback_url</span><div style={{ height: 36, background: 'var(--gw-bg-2)', borderRadius: 8 }} /></label>
      </div>
      <div className="gw-actions" style={{ marginTop: 8 }}>
        <div style={{ height: 36, width: 80, background: 'var(--gw-primary)', opacity: 0.4, borderRadius: 8 }} />
      </div>
    </div>
  );
}

/* ============================================================
   SERVER TAB
   ============================================================ */

function ServerTab({ baseUrl, token, canServer, ctaLabel, onGoToBilling }: {
  baseUrl: string; token: string; canServer: boolean; ctaLabel: string; onGoToBilling: () => void;
}) {
  const createResp = `{
  "success": true,
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260425101501123ABCD1234",
    "amount": 199,
    "currency": "INR",
    "status": "pending",
    "mode": "server",
    "payment_link": "upi://pay?pa=merchant@paytm&am=199.00&...",
    "upi_payload": "upi://pay?pa=merchant@paytm&am=199.00&...",
    "expires_at": "2026-04-25T10:45:01.000Z"
  }
}`;

  const checkResp = `{
  "success": true,
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260425101501123ABCD1234",
    "status": "paid",
    "amount": 199,
    "currency": "INR",
    "mode": "server",
    "bank_rrn": "412345678901",
    "verified_at": "2026-04-25T10:18:23.000Z",
    "payment_received": true
  }
}`;

  const overview = (
    <MethodOverviewCard
      icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>}
      title="Server API"
      methodLabel="Method 1"
      description="Your backend creates orders, receives the UPI payload, shows QR or UPI links inside your own UI, and confirms payment status. The API token stays private on your server."
      features={[
        { title: 'Full UI control',     sub: 'Render QR / UPI links in your own checkout' },
        { title: 'Token stays private', sub: 'API token lives only on your backend' },
        { title: 'Webhook + polling',   sub: 'Confirm via callback_url or check-order' },
        { title: 'Custom branding',     sub: 'No external page, no redirect needed' },
      ]}
      bestFor="SaaS dashboards, custom checkouts, mobile apps"
    />
  );

  const endpoints = (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Create order</h3>
          <span className="gw-method">POST</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/create-order</code><Copy text={`${baseUrl}/create-order`} /></div>

        <div className="gw-h4">Headers</div>
        <Code>{`Authorization: Bearer YOUR_API_TOKEN\nContent-Type: application/json`}</Code>

        <div className="gw-h4">Request body</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>mode</td><td>string</td><td>yes</td><td>Use <code>"server"</code></td></tr>
              <tr><td>amount</td><td>number</td><td>yes</td><td>INR amount, e.g. <code>199.00</code></td></tr>
              <tr><td>currency</td><td>string</td><td>no</td><td>Default <code>INR</code></td></tr>
              <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your unique order id</td></tr>
              <tr><td>customer_reference</td><td>string</td><td>no</td><td>Your customer or user reference</td></tr>
              <tr><td>callback_url</td><td>string</td><td>no</td><td>Server webhook URL (POST, signed)</td></tr>
              <tr><td>note</td><td>string</td><td>no</td><td>Shown in UPI app</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Response</div>
        <Code>{createResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Check order</h3>
          <span className="gw-method">POST / GET</span>
        </div>
        <div className="gw-base-row"><code>{baseUrl}/check-order</code><Copy text={`${baseUrl}/check-order`} /></div>

        <div className="gw-h4">Body or query — provide any one</div>
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

        <div className="gw-h4">Response</div>
        <Code>{checkResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Webhook (callback_url)
          </h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          When a payment is confirmed, the gateway sends a signed <code>POST</code> to your <code>callback_url</code>. Verify the <code>X-Gateway-Signature</code> header (HMAC-SHA256 of the raw body, keyed with your API token) before trusting the data. Always confirm payment status via <code>check-order</code> or the webhook before delivering the product or service.
        </p>
      </div>
    </>
  );

  return (
    <>
      {overview}
      <LockedPreview
        locked={!canServer}
        reason="Server API locked"
        subtitle="Activate the Server API or Master plan to unlock the Method 1 endpoints."
        ctaLabel={ctaLabel}
        onCta={onGoToBilling}
      >
        {endpoints}
      </LockedPreview>
      <StatusLegendCard />
    </>
  );
}

/* ============================================================
   HOSTED PAGE TAB
   ============================================================ */

function HostedPageTab({ canHosted, ctaLabel, onGoToBilling }: {
  canHosted: boolean; ctaLabel: string; onGoToBilling: () => void;
}) {
  const createResp = `{
  "success": true,
  "data": {
    "order_id": 123,
    "txn_ref": "GW20260425101501123ABCD1234",
    "amount": 199,
    "currency": "INR",
    "status": "pending",
    "mode": "hosted",
    "public_token": "9k3mZpQ2vR8sT1xY4nL6Aw",
    "payment_page_url": "https://your-domain.com/pay/9k3mZpQ2vR8sT1xY4nL6Aw",
    "qr_image_url": "/api/pay/9k3mZpQ2vR8sT1xY4nL6Aw/qr.png?size=2048",
    "redirect_url": "https://your-site.com/payment/success",
    "cancel_url": "https://your-site.com/payment/cancelled",
    "expires_at": "2026-04-25T10:45:01.000Z"
  }
}`;

  const overview = (
    <MethodOverviewCard
      icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>}
      title="Hosted payment page"
      methodLabel="Method 2"
      description="Your backend creates the order and receives a payment_page_url. Send that URL to the customer — the hosted page handles QR display, UPI app links, status polling, and the final redirect."
      features={[
        { title: 'Drop-in checkout',  sub: 'Zero UI work — just send a URL' },
        { title: 'Auto QR + intents', sub: 'GPay, PhonePe, Paytm deep-links built in' },
        { title: 'Auto status poll',  sub: 'Customer sees live status without refresh' },
        { title: 'Smart redirect',    sub: 'Lands on your redirect_url after paid' },
      ]}
      bestFor="Online stores, link-in-bio, fast launches, no-code flows"
    />
  );

  const endpoints = (
    <>
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Create order</h3>
          <span className="gw-method">POST</span>
        </div>
        <div className="gw-base-row"><code>/api/gateway/create-order</code><Copy text="/api/gateway/create-order" /></div>

        <div className="gw-h4">Request body</div>
        <div className="gw-params-wrap">
          <table className="gw-params">
            <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>mode</td><td>string</td><td>yes</td><td>Use <code>"hosted"</code></td></tr>
              <tr><td>amount</td><td>number</td><td>yes</td><td>INR amount, e.g. <code>199.00</code></td></tr>
              <tr><td>currency</td><td>string</td><td>no</td><td>Default <code>INR</code></td></tr>
              <tr><td>client_order_id</td><td>string</td><td>no</td><td>Your unique order id</td></tr>
              <tr><td>customer_reference</td><td>string</td><td>no</td><td>Your customer or user reference</td></tr>
              <tr><td>callback_url</td><td>string</td><td>no</td><td>Server webhook URL (POST, signed)</td></tr>
              <tr><td>redirect_url</td><td>string</td><td>no</td><td>Browser redirect after <code>paid</code></td></tr>
              <tr><td>cancel_url</td><td>string</td><td>no</td><td>Browser redirect after <code>failed</code>, <code>expired</code>, or <code>cancelled</code></td></tr>
              <tr><td>note</td><td>string</td><td>no</td><td>Shown in UPI app</td></tr>
            </tbody>
          </table>
        </div>

        <div className="gw-h4">Response</div>
        <Code>{createResp}</Code>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            How it flows
          </h3>
        </div>
        <ol className="gw-steps">
          <li>Your server calls <code>create-order</code> with <code>mode: "hosted"</code>.</li>
          <li>Send <code>payment_page_url</code> to the customer (redirect or link).</li>
          <li>Customer opens the hosted page.</li>
          <li>Customer scans QR or opens a UPI app.</li>
          <li>Page polls for payment status automatically.</li>
          <li>On <code>paid</code>, page shows success and redirects to <code>redirect_url</code> after 5 seconds.</li>
          <li>On failure or expiry, page redirects to <code>cancel_url</code>.</li>
          <li>Your server confirms via webhook or <code>check-order</code> before delivering the product.</li>
        </ol>
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
              <tr><td>public_token</td><td>Public order token (safe to share)</td></tr>
              <tr><td>payment_page_url</td><td>Hosted checkout URL — send this to the customer</td></tr>
              <tr><td>qr_image_url</td><td>QR PNG URL (sizes: 512, 1024, 1080, 2048, 4096; default 2048)</td></tr>
              <tr><td>redirect_url</td><td>Success redirect target (echoed from request)</td></tr>
              <tr><td>cancel_url</td><td>Failed/cancel redirect target (echoed from request)</td></tr>
              <tr><td>expires_at</td><td>Order expiry timestamp</td></tr>
            </tbody>
          </table>
        </div>

        <details className="gw-acc" style={{ marginTop: 12 }}>
          <summary>Public endpoints</summary>
          <div className="gw-acc-body">
            <ul className="gw-list">
              <li><code>GET /api/pay/:public_token</code> — JSON order snapshot</li>
              <li><code>POST /api/pay/:public_token/refresh</code> — re-verify with Paytm</li>
              <li><code>GET /api/pay/:public_token/qr.png</code> — QR PNG download</li>
            </ul>
          </div>
        </details>

        <details className="gw-acc">
          <summary>Security notes</summary>
          <div className="gw-acc-body">
            <ul className="gw-list">
              <li><code>public_token</code> is safe to share with customers.</li>
              <li>Your API token is never exposed on the hosted page.</li>
              <li><code>callback_url</code> is never sent to the browser.</li>
              <li>Payment is only final after backend verification.</li>
            </ul>
          </div>
        </details>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Webhook (callback_url)</h3>
        </div>
        <p className="gw-muted" style={{ marginTop: -2 }}>
          When payment is confirmed, the gateway sends a signed <code>POST</code> to your <code>callback_url</code>. Verify the <code>X-Gateway-Signature</code> header (HMAC-SHA256 of the raw body, keyed with your API token) before trusting the data. Always confirm via webhook or <code>check-order</code> before delivering the product or service.
        </p>
      </div>
    </>
  );

  return (
    <>
      {overview}
      <LockedPreview
        locked={!canHosted}
        reason="Hosted Pay Page locked"
        subtitle="Activate the Hosted Pay Page or Master plan to unlock the Method 2 endpoints."
        ctaLabel={ctaLabel}
        onCta={onGoToBilling}
      >
        {endpoints}
      </LockedPreview>
      <StatusLegendCard />
    </>
  );
}

/* ============================================================
   SETUP TAB
   ============================================================ */

function SetupTab({ baseUrl, canServer, canHosted, isMasterOrOwner, hasPlan, serverCtaLabel, hostedCtaLabel, onGoToBilling }: {
  baseUrl: string; canServer: boolean; canHosted: boolean; isMasterOrOwner: boolean;
  hasPlan: boolean; serverCtaLabel: string; hostedCtaLabel: string; onGoToBilling: () => void;
}) {
  const serverSetup = (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Method 1 — Server API setup
        </h3>
        {canServer && <span className="gw-badge mute">Your plan</span>}
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>
        Your backend creates the order, shows the UPI link or QR in your own UI, and confirms payment status. You control the full checkout experience.
      </p>
      <ol className="gw-steps">
        <li>Save UPI settings in the dashboard.</li>
        <li>Create an API token on this page.</li>
        <li>Store the token in a backend environment variable (never in the frontend).</li>
        <li>Backend calls <code>POST /api/gateway/create-order</code> with <code>mode: "server"</code>.</li>
        <li>Use <code>payment_link</code> or <code>upi_payload</code> to display QR or UPI deep-link in your UI.</li>
        <li>Backend polls <code>POST /api/gateway/check-order</code> or listens to the <code>callback_url</code> webhook.</li>
        <li>Mark the user's order paid only after gateway status is <code>"paid"</code>.</li>
      </ol>
    </div>
  );

  const hostedSetup = (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Method 2 — Hosted payment page setup
        </h3>
        {canHosted && !canServer && <span className="gw-badge mute">Your plan</span>}
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>
        Your backend creates the order and redirects the customer to the hosted checkout. We handle the QR display, UPI links, and status polling.
      </p>
      <ol className="gw-steps">
        <li>Backend calls <code>POST /api/gateway/create-order</code> with <code>mode: "hosted"</code>.</li>
        <li>Include <code>redirect_url</code> and <code>cancel_url</code> to control the post-payment redirect.</li>
        <li>Redirect the customer to <code>payment_page_url</code>.</li>
        <li>Customer pays on the hosted page; we redirect them after a final status.</li>
        <li>Your server verifies via webhook or <code>check-order</code> before delivering the product.</li>
      </ol>
    </div>
  );

  const quickStart = (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Quick start
        </h3>
        <span className="gw-badge mute">3 steps</span>
      </div>
      <p className="gw-muted" style={{ marginTop: -2 }}>
        The same path for every plan — pick the method below that matches what you bought, then follow the detailed steps.
      </p>
      <ol className="gw-steps">
        <li>Choose a plan that matches your method (Server API, Hosted Page, or Master).</li>
        <li>Save your UPI settings in the dashboard.</li>
        <li>Generate an API token and start creating orders.</li>
      </ol>
    </div>
  );

  return (
    <>
      {quickStart}

      <LockedPreview
        locked={!canServer}
        reason={!hasPlan ? 'Method 1 setup locked' : 'Server API setup locked.'}
        subtitle={!hasPlan ? 'Choose a plan to unlock the Server API guide.' : 'Upgrade to Master to unlock both methods.'}
        ctaLabel={serverCtaLabel}
        onCta={onGoToBilling}
      >
        {serverSetup}
      </LockedPreview>

      <LockedPreview
        locked={!canHosted}
        reason={!hasPlan ? 'Method 2 setup locked' : 'Hosted Pay Page setup locked.'}
        subtitle={!hasPlan ? 'Choose a plan to unlock the Hosted Page guide.' : 'Upgrade to Master to unlock both methods.'}
        ctaLabel={hostedCtaLabel}
        onCta={onGoToBilling}
      >
        {hostedSetup}
      </LockedPreview>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z"/></svg>
            Important rules
          </h3>
        </div>
        <ul className="gw-list">
          <li>Never expose the API token in the frontend.</li>
          <li>Use <code>callback_url</code> for backend confirmation (server webhook).</li>
          {canHosted && <li>Use <code>redirect_url</code> only for the customer landing page after payment.</li>}
          <li>Always verify payment status before giving the product or service.</li>
          <li>Use <code>client_order_id</code> to match your own order records.</li>
        </ul>
      </div>
    </>
  );
}

/* ============================================================
   TestConsole — plan-aware
   ============================================================ */

function TestConsole({ apiToken, baseUrl, canServer, canHosted, isMasterOrOwner }: {
  apiToken: string; baseUrl: string; canServer: boolean; canHosted: boolean; isMasterOrOwner: boolean;
}) {
  const modeFixed = !isMasterOrOwner;
  const defaultMode: 'hosted' | 'server' = canHosted ? 'hosted' : 'server';

  const [mode, setMode] = useState<'hosted' | 'server'>(defaultMode);
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

  const showHostedFields = mode === 'hosted';

  const runCreate = async () => {
    setCreateBusy(true); setCreateOut(null);
    const body: any = {
      mode,
      amount: parseFloat(amount),
      currency: currency.trim().toUpperCase() || 'INR',
    };
    if (clientOrderId.trim()) body.client_order_id = clientOrderId.trim();
    if (customerRef.trim()) body.customer_reference = customerRef.trim();
    if (callbackUrl.trim()) body.callback_url = callbackUrl.trim();
    if (showHostedFields && redirectUrl.trim()) body.redirect_url = redirectUrl.trim();
    if (showHostedFields && cancelUrl.trim()) body.cancel_url = cancelUrl.trim();
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
              <span>Mode <span className="gw-required">*</span></span>
              {modeFixed ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ background: 'var(--gw-bg-2)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>{mode}</code>
                  <span className="gw-muted" style={{ fontSize: 12 }}>Fixed by your plan</span>
                </div>
              ) : (
                <div className="gw-select-wrap">
                  <select value={mode} onChange={(e) => { setMode(e.target.value as any); setCreateOut(null); }}>
                    {canServer && <option value="server">server — return payment_link / upi_payload</option>}
                    {canHosted && <option value="hosted">hosted — return payment_page_url</option>}
                  </select>
                </div>
              )}
            </label>

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

            {showHostedFields && (
              <>
                <label className="gw-field">
                  <span>redirect_url <small>optional · browser success redirect</small></span>
                  <input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://your-site.com/payment/success" inputMode="url" autoCapitalize="off" />
                </label>
                <label className="gw-field">
                  <span>cancel_url <small>optional · browser cancel/failure redirect</small></span>
                  <input value={cancelUrl} onChange={(e) => setCancelUrl(e.target.value)} placeholder="https://your-site.com/payment/cancelled" inputMode="url" autoCapitalize="off" />
                </label>
              </>
            )}

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
                    View in Transactions →
                  </Link>
                )}
              </div>

              {createOut.ok && mode === 'hosted' && createOut.body?.data?.payment_page_url && (
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
            </div>
          </div>

          {checkOut && (
            <div style={{ marginTop: 12 }}>
              <div className="gw-base-row" style={{ marginBottom: 6 }}>
                <b>Response</b>
                <span className={`gw-badge ${checkOut.ok ? 'ok' : 'bad'}`}>HTTP {checkOut.status || 'ERR'}</span>
              </div>
              <Code>{pretty(checkOut.body)}</Code>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export { };
