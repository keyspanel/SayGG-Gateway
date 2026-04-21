import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet, gwPut } from './api';

export default function GwSettings() {
  const [f, setF] = useState({ paytm_upi_id: '', paytm_merchant_id: '', paytm_merchant_key: '', paytm_env: 'production', payee_name: '' });
  const [loaded, setLoaded] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [active, setActive] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await gwGet('/settings/');
    setF((s) => ({
      ...s,
      paytm_upi_id: d.paytm_upi_id || '',
      paytm_merchant_id: d.paytm_merchant_id || '',
      paytm_env: d.paytm_env || 'production',
      payee_name: d.payee_name || '',
    }));
    setHasKey(!!d.has_key);
    setMaskedKey(d.paytm_merchant_key_masked || '');
    setActive(!!d.is_active);
    setLoaded(true);
  };
  useEffect(() => { load().catch((e) => setMsg({ err: e.message })); }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg({}); setBusy(true);
    try {
      const r = await gwPut('/settings/', f);
      setMsg({ ok: r.is_active ? 'Settings saved. Your gateway is now active — generate your API token next.' : 'Settings saved.' });
      setF((s) => ({ ...s, paytm_merchant_key: '' }));
      await load();
    } catch (e: any) { setMsg({ err: e.message }); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div className="gw-loading">Loading settings…</div>;

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>UPI Settings</h2>
          <p>Connect your Paytm merchant account to start accepting UPI payments.</p>
        </div>
        {active ? <span className="gw-badge ok">Active</span> : <span className="gw-badge warn">Setup required</span>}
      </div>

      {msg.err && (
        <div className="gw-alert error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>{msg.err}</span>
        </div>
      )}
      {msg.ok && (
        <div className="gw-alert ok">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>{msg.ok}</span>
        </div>
      )}

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            Paytm credentials
          </h3>
        </div>

        <form onSubmit={submit} className="gw-form">
          <label className="gw-field">
            <span>Paytm UPI ID <span className="gw-required">*</span></span>
            <input value={f.paytm_upi_id} onChange={set('paytm_upi_id')} placeholder="merchant@paytm" required autoCapitalize="off" autoComplete="off" />
            <div className="gw-field-hint">Funds settle directly to this UPI handle.</div>
          </label>

          <label className="gw-field">
            <span>Paytm Merchant ID (MID) <span className="gw-required">*</span></span>
            <input value={f.paytm_merchant_id} onChange={set('paytm_merchant_id')} required placeholder="MID" autoCapitalize="off" autoComplete="off" />
          </label>

          <label className="gw-field">
            <span>
              Paytm Merchant Key
              {hasKey ? <small>saved · {maskedKey}</small> : <span className="gw-required">*</span>}
            </span>
            <div className="gw-field-pwd">
              <input
                value={f.paytm_merchant_key}
                onChange={set('paytm_merchant_key')}
                placeholder={hasKey ? 'Leave blank to keep saved key' : 'Enter merchant key'}
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="off"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                {showKey ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            <div className="gw-field-hint">Used to verify payments with Paytm. Stored encrypted at rest.</div>
          </label>

          <label className="gw-field">
            <span>Payee display name <small>optional</small></span>
            <input value={f.payee_name} onChange={set('payee_name')} placeholder="Your business name" />
            <div className="gw-field-hint">Shown to customers in their UPI app.</div>
          </label>

          <label className="gw-field">
            <span>Environment</span>
            <div className="gw-select-wrap">
              <select value={f.paytm_env} onChange={set('paytm_env')}>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
              </select>
            </div>
          </label>

          <div className="gw-actions">
            <button className="gw-btn-primary" disabled={busy}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            {active && (
              <Link to="/gateway/docs" className="gw-btn-ghost">
                Generate API token →
              </Link>
            )}
          </div>
        </form>
      </div>

      {!active && (
        <div className="gw-alert info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Once you save valid credentials, you can generate your API token from the API Docs page.</span>
        </div>
      )}
    </div>
  );
}
