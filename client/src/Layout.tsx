import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

const NAV = [
  { to: '/gateway', label: 'Dashboard', end: true, icon: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path> },
  { to: '/gateway/settings', label: 'UPI Settings', icon: <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path> },
  { to: '/gateway/transactions', label: 'Transactions', icon: <path d="M17 3v18 M3 15h18 M3 9h18"></path> },
  { to: '/gateway/docs', label: 'API Docs', icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8"></path> },
];

export default function GwLayout() {
  const { user, logout } = useGwAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="gw-shell">
      <aside className={`gw-side${open ? ' open' : ''}`}>
        <div className="gw-side-header">
          <div className="gw-brand-mark">PG</div>
          <div className="gw-brand-text">
            <div className="gw-brand-name">PayGateway</div>
            <div className="gw-brand-tag">Developer Console</div>
          </div>
        </div>
        <nav className="gw-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `gw-nav-item${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {n.icon}
                {n.to === '/gateway/transactions' && <path d="M12 3v18" strokeWidth="2"/>}
                {n.to === '/gateway/transactions' && <path d="M3 15h18" strokeWidth="2"/>}
                {n.to === '/gateway/transactions' && <path d="M3 9h18" strokeWidth="2"/>}
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
          <button className="gw-btn-ghost" style={{width: '100%'}} onClick={logout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Logout
          </button>
        </div>
      </aside>
      <div className="gw-main">
        <header className="gw-top">
          <button className="gw-burger" aria-label="Menu" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div className="gw-top-title">{NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label || 'Gateway'}</div>
        </header>
        <main className="gw-content"><Outlet /></main>
      </div>
      <div className={`gw-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
    </div>
  );
}
