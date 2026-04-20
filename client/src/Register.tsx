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
        {err && <div className="gw-alert error">{err}</div>}
        <label className="gw-field"><span>Username</span><input value={f.username} onChange={set('username')} required minLength={3} maxLength={32} /></label>
        <label className="gw-field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} required /></label>
        <label className="gw-field"><span>Password</span><input type="password" value={f.password} onChange={set('password')} required minLength={8} /></label>
        <label className="gw-field"><span>Confirm password</span><input type="password" value={f.confirm_password} onChange={set('confirm_password')} required minLength={8} /></label>
        <button className="gw-btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <div className="gw-auth-foot">Already have one? <Link to="/gateway/login">Sign in</Link></div>
      </form>
    </div>
  );
}
