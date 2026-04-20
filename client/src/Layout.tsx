import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

const NAV = [
  { to: '/gateway', label: 'Dashboard', end: true },
  { to: '/gateway/settings', label: 'UPI Settings' },
  { to: '/gateway/transactions', label: 'Transactions' },
  { to: '/gateway/docs', label: 'API Docs' },
];

export default function GwLayout() {
  const { user, logout } = useGwAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="gw-shell">
      <aside className={`gw-side${open ? ' open' : ''}`}>
        <div className="gw-brand">
          <div className="gw-brand-mark">PG</div>
          <div>
            <div className="gw-brand-name">PayGateway</div>
            <div className="gw-brand-tag">Developer console</div>
          </div>
        </div>
        <nav className="gw-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `gw-nav-item${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="gw-side-foot">
          <div className="gw-user">
            <div className="gw-user-avatar">{(user?.username || '?').slice(0, 1).toUpperCase()}</div>
            <div className="gw-user-text">
              <div className="gw-user-name">{user?.username}</div>
              <div className="gw-user-mail">{user?.email}</div>
            </div>
          </div>
          <button className="gw-btn-ghost" onClick={logout}>Logout</button>
        </div>
      </aside>
      <div className="gw-main">
        <header className="gw-top">
          <button className="gw-burger" aria-label="Menu" onClick={() => setOpen(!open)}>
            <span/><span/><span/>
          </button>
          <div className="gw-top-title">{NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label || 'Gateway'}</div>
        </header>
        <main className="gw-content"><Outlet /></main>
      </div>
      {open && <div className="gw-backdrop" onClick={() => setOpen(false)} />}
    </div>
  );
}
