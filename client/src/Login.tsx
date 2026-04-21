import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

export default function GwLogin() {
  const { login } = useGwAuth();
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(u.trim(), p); nav('/gateway'); }
    catch (e: any) { setErr(e.message || 'Sign in failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="gw-auth-page">
      <form onSubmit={submit} className="gw-auth-card">
        <div className="gw-auth-brand">
          <div className="gw-brand-mark big">PG</div>
          <div>
            <h1>Sign in</h1>
            <p>Access your gateway.</p>
          </div>
        </div>

        {err && (
          <div className="gw-alert error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>{err}</span>
          </div>
        )}

        <label className="gw-field">
          <span>Username or email</span>
          <input value={u} onChange={(e) => setU(e.target.value)} required autoFocus autoComplete="username" placeholder="you@example.com" inputMode="email" />
        </label>

        <label className="gw-field">
          <span>Password</span>
          <div className="gw-field-pwd">
            <input
              type={showPwd ? 'text' : 'password'}
              value={p}
              onChange={(e) => setP(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
              {showPwd ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
        </label>

        <button className="gw-btn-primary gw-btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="gw-auth-foot">
          New here? <Link to="/gateway/register">Create account</Link>
        </div>
      </form>
    </div>
  );
}
