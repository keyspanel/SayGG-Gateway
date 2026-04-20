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
      setMsg({ ok: r.is_active ? 'Settings saved. Gateway is active.' : 'Saved.' });
      setF((s) => ({ ...s, paytm_merchant_key: '' }));
      await load();
    } catch (e: any) { setMsg({ err: e.message }); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div className="gw-loading">Loading…</div>;
  return (
    <div className="gw-page">
      <div className="gw-card">
        <div className="gw-card-h"><h3>Paytm UPI Settings</h3>{active && <span className="gw-badge ok">Active</span>}</div>
        <p className="gw-muted">Save your own Paytm merchant credentials. Each order is processed using your account.</p>
        {msg.err && <div className="gw-alert error">{msg.err}</div>}
        {msg.ok && <div className="gw-alert ok">{msg.ok}</div>}
        <form onSubmit={submit} className="gw-form">
          <label className="gw-field"><span>Paytm UPI ID *</span><input value={f.paytm_upi_id} onChange={set('paytm_upi_id')} placeholder="merchant@paytm" required /></label>
          <label className="gw-field"><span>Paytm Merchant ID *</span><input value={f.paytm_merchant_id} onChange={set('paytm_merchant_id')} required /></label>
          <label className="gw-field">
            <span>Paytm Merchant Key {hasKey ? `(saved: ${maskedKey})` : '*'}</span>
            <input value={f.paytm_merchant_key} onChange={set('paytm_merchant_key')} placeholder={hasKey ? 'Leave blank to keep saved key' : 'Enter merchant key'} type="password" />
          </label>
          <label className="gw-field"><span>Payee display name</span><input value={f.payee_name} onChange={set('payee_name')} placeholder="Your business name" /></label>
          <label className="gw-field">
            <span>Environment</span>
            <select value={f.paytm_env} onChange={set('paytm_env')}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
            </select>
          </label>
          <div className="gw-actions">
            <button className="gw-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
            <Link to="/gateway/docs" className="gw-btn-ghost">Go to API Docs</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
