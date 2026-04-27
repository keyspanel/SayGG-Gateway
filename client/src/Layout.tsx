import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

interface NavItem { to: string; label: string; end?: boolean; icon: React.ReactNode; ownerOnly?: boolean; }

const NAV: NavItem[] = [
  {
    to: '/gateway', label: 'Overview', end: true,
    icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  },
  {
    to: '/gateway/transactions', label: 'Transactions',
    icon: <><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>,
  },
  {
    to: '/gateway/settings', label: 'UPI Setup',
    icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  },
  {
    to: '/gateway/docs', label: 'API Reference',
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></>,
  },
  {
    to: '/gateway/billing', label: 'Billing',
    icon: <><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></>,
  },
  {
    to: '/gateway/owner', label: 'Owner Panel', ownerOnly: true,
    icon: <><path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6z"/><polyline points="9 12 11 14 15 10"/></>,
  },
];

type Theme = 'light' | 'dark';
function getInitialTheme(): Theme {
  try {
    const t = localStorage.getItem('gw_theme');
    if (t === 'dark' || t === 'light') return t;
  } catch {}
  return 'dark';
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('gw_theme', theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      className="gw-icon-btn"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      title={theme === 'light' ? 'Dark mode' : 'Light mode'}
    >
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      )}
    </button>
  );
}

function PlanPill({ user }: { user: { is_owner: boolean; active_subscription: any } }) {
  if (user.is_owner) return <span className="gw-plan-pill owner">Owner</span>;
  const sub = user.active_subscription;
  if (!sub) return <span className="gw-plan-pill warn">No active plan</span>;
  const days = sub.days_left;
  return (
    <span className={`gw-plan-pill ok${days != null && days <= 3 ? ' ending' : ''}`} title={sub.plan_name}>
      {sub.plan_name}{days != null ? ` · ${days}d` : ''}
    </span>
  );
}

export default function GwLayout() {
  const { user, logout } = useGwAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const visibleNav = NAV.filter((n) => !n.ownerOnly || user?.is_owner);
  const current = visibleNav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));

  return (
    <div className="gw-shell">
      <aside className={`gw-side${open ? ' open' : ''}`} aria-hidden={!open && undefined}>
        <div className="gw-side-header">
          <div className="gw-brand-mark">PG</div>
          <div className="gw-brand-text">
            <div className="gw-brand-name">PayGateway</div>
          </div>
        </div>
        <nav className="gw-nav">
          {visibleNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `gw-nav-item${isActive ? ' active' : ''}${n.ownerOnly ? ' owner' : ''}`}
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
              {user && <PlanPill user={user} />}
            </div>
          </div>
          <button className="gw-btn-ghost gw-btn-block sm" onClick={logout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
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
          {user && <PlanPill user={user} />}
          <ThemeToggle />
        </header>
        <main className="gw-content"><Outlet /></main>
      </div>

      <div className={`gw-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
    </div>
  );
}
