import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

const NAV: { to: string; label: string; end?: boolean; icon: React.ReactNode }[] = [
  {
    to: '/gateway', label: 'Dashboard', end: true,
    icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  },
  {
    to: '/gateway/settings', label: 'UPI Settings',
    icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  },
  {
    to: '/gateway/transactions', label: 'Transactions',
    icon: <><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>,
  },
  {
    to: '/gateway/docs', label: 'API Docs',
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></>,
  },
];

export default function GwLayout() {
  const { user, logout } = useGwAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  // Lock body scroll when drawer is open on mobile.
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close drawer on route change.
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const current = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));

  return (
    <div className="gw-shell">
      <aside className={`gw-side${open ? ' open' : ''}`} aria-hidden={!open && undefined}>
        <div className="gw-side-header">
          <div className="gw-brand-mark">PG</div>
          <div className="gw-brand-text">
            <div className="gw-brand-name">PayGateway</div>
            <div className="gw-brand-tag">Developer Console</div>
          </div>
        </div>
        <nav className="gw-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `gw-nav-item${isActive ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {n.icon}
              </svg>
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
          <button className="gw-btn-ghost gw-btn-block" onClick={logout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>
      </aside>

      <div className="gw-main">
        <header className="gw-top">
          <button className="gw-burger" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className="gw-top-mark">PG</div>
          <div className="gw-top-title">{current?.label || 'Gateway'}</div>
        </header>
        <main className="gw-content"><Outlet /></main>
      </div>

      <div className={`gw-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
    </div>
  );
}
