import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

export default function GwRegister() {
  const { register } = useGwAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', email: '', password: '', confirm_password: '' });
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
          <h1>Create account</h1>
          <p>Get your own payment gateway in minutes</p>
        </div>
        {err && <div className="gw-alert error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          {err}
        </div>}
        <label className="gw-field"><span>Username</span><input value={f.username} onChange={set('username')} required minLength={3} maxLength={32} autoComplete="username" placeholder="johndoe" /></label>
        <label className="gw-field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" placeholder="john@example.com" /></label>
        <label className="gw-field"><span>Password</span><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" placeholder="••••••••" /></label>
        <label className="gw-field"><span>Confirm password</span><input type="password" value={f.confirm_password} onChange={set('confirm_password')} required minLength={8} autoComplete="new-password" placeholder="••••••••" /></label>
        <button className="gw-btn-primary" disabled={busy} style={{marginTop: '8px'}}>{busy ? 'Creating account…' : 'Create account'}</button>
        <div className="gw-auth-foot">Already have one? <Link to="/gateway/login">Sign in</Link></div>
      </form>
    </div>
  );
}
