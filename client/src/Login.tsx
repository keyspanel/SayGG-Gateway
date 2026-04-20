import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

export default function GwLogin() {
  const { login } = useGwAuth();
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(u, p); nav('/gateway'); }
    catch (e: any) { setErr(e.message || 'Login failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="gw-auth-page">
      <form onSubmit={submit} className="gw-auth-card">
        <div className="gw-auth-brand">
          <div className="gw-brand-mark big">PG</div>
          <h1>Welcome back</h1>
          <p>Sign in to your payment gateway dashboard</p>
        </div>
        {err && <div className="gw-alert error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          {err}
        </div>}
        <label className="gw-field"><span>Username</span><input value={u} onChange={(e) => setU(e.target.value)} required autoFocus autoComplete="username" placeholder="Enter your username" /></label>
        <label className="gw-field"><span>Password</span><input type="password" value={p} onChange={(e) => setP(e.target.value)} required autoComplete="current-password" placeholder="••••••••" /></label>
        <button className="gw-btn-primary" disabled={busy} style={{marginTop: '8px'}}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="gw-auth-foot">No account? <Link to="/gateway/register">Create one</Link></div>
      </form>
    </div>
  );
}
