import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

export default function GwRegister() {
  const { register } = useGwAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', email: '', password: '', confirm_password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await register(f); nav('/gateway/settings'); }
    catch (e: any) { setErr(e.message || 'Registration failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="gw-auth-page">
      <form onSubmit={submit} className="gw-auth-card">
        <div className="gw-auth-brand">
          <div className="gw-brand-mark big">PG</div>
          <div>
            <h1>Create account</h1>
            <p>Start accepting UPI payments.</p>
          </div>
        </div>

        {err && (
          <div className="gw-alert error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>{err}</span>
          </div>
        )}

        <label className="gw-field">
          <span>Username <small>3–32 · letters, digits, _</small></span>
          <input value={f.username} onChange={set('username')} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username" placeholder="merchant_co" autoCapitalize="off" />
        </label>

        <label className="gw-field">
          <span>Email</span>
          <input type="email" value={f.email} onChange={set('email')} required autoComplete="email" placeholder="you@example.com" inputMode="email" autoCapitalize="off" />
        </label>

        <label className="gw-field">
          <span>Password <small>min 8 chars</small></span>
          <div className="gw-field-pwd">
            <input
              type={showPwd ? 'text' : 'password'}
              value={f.password}
              onChange={set('password')}
              required minLength={8}
              autoComplete="new-password"
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

        <label className="gw-field">
          <span>Confirm password</span>
          <input
            type={showPwd ? 'text' : 'password'}
            value={f.confirm_password}
            onChange={set('confirm_password')}
            required minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </label>

        <button className="gw-btn-primary gw-btn-block" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <div className="gw-auth-foot">
          Already have one? <Link to="/gateway/login">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
