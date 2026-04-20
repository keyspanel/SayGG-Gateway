import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet, gwPut } from './api';

export default function GwSettings() {
  const [f, setF] = useState({ paytm_upi_id: '', paytm_merchant_id: '', paytm_merchant_key: '', paytm_env: 'production', payee_name: '' });
  const [loaded, setLoaded] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [active, setActive] = useState(false);
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
      setMsg({ ok: r.is_active ? 'Settings saved successfully. Gateway is now active.' : 'Settings saved successfully.' });
      setF((s) => ({ ...s, paytm_merchant_key: '' }));
      await load();
    } catch (e: any) { setMsg({ err: e.message }); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div className="gw-loading">Loading settings…</div>;
  return (
    <div className="gw-page">
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Paytm UPI Settings
          </h3>
          {active ? <span className="gw-badge ok">Active</span> : <span className="gw-badge warn">Setup Required</span>}
        </div>
        <p className="gw-muted" style={{marginBottom: '24px'}}>Save your Paytm merchant credentials to process orders. Payments go directly to your account.</p>
        
        {msg.err && <div className="gw-alert error"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>{msg.err}</div>}
        {msg.ok && <div className="gw-alert ok"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>{msg.ok}</div>}
        
        <form onSubmit={submit} className="gw-form">
          <label className="gw-field">
            <span>Paytm UPI ID <span style={{color: 'var(--gw-warn)'}}>*</span></span>
            <input value={f.paytm_upi_id} onChange={set('paytm_upi_id')} placeholder="merchant@paytm" required />
          </label>
          <label className="gw-field">
            <span>Paytm Merchant ID <span style={{color: 'var(--gw-warn)'}}>*</span></span>
            <input value={f.paytm_merchant_id} onChange={set('paytm_merchant_id')} required placeholder="MID" />
          </label>
          <label className="gw-field">
            <span>Paytm Merchant Key {hasKey ? <span className="gw-muted">(saved: {maskedKey})</span> : <span style={{color: 'var(--gw-warn)'}}>*</span>}</span>
            <input value={f.paytm_merchant_key} onChange={set('paytm_merchant_key')} placeholder={hasKey ? 'Leave blank to keep saved key' : 'Enter merchant key'} type="password" autoComplete="off" />
          </label>
          <label className="gw-field">
            <span>Payee display name (Optional)</span>
            <input value={f.payee_name} onChange={set('payee_name')} placeholder="Your business name" />
          </label>
          <label className="gw-field">
            <span>Environment</span>
            <select value={f.paytm_env} onChange={set('paytm_env')}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
            </select>
          </label>
          
          <div className="gw-actions" style={{marginTop: '16px'}}>
            <button className="gw-btn-primary" disabled={busy}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            <Link to="/gateway/docs" className="gw-btn-ghost">View API Docs</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
