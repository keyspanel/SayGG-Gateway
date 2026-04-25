import React, { createContext, useContext, useEffect, useState } from 'react';
import { clearGwToken, gwGet, gwPost, setGwToken } from './api';

export interface ActiveSubscription {
  id: number;
  plan_id: number;
  plan_key: string;
  plan_name: string;
  method_access: 'server' | 'hosted' | 'master';
  status: string;
  starts_at: string;
  expires_at: string | null;
  days_left: number | null;
}

export interface GwUser {
  id: number;
  username: string;
  email: string;
  has_token: boolean;
  role: 'owner' | 'user';
  is_owner: boolean;
  access: { server: boolean; hosted: boolean; master: boolean };
  active_subscription: ActiveSubscription | null;
}

interface Ctx {
  user: GwUser | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; confirm_password: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const C = createContext<Ctx | null>(null);

const EMPTY_ACCESS = { server: false, hosted: false, master: false };

function normalize(raw: any): GwUser | null {
  if (!raw) return null;
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
    has_token: !!raw.has_token,
    role: raw.role === 'owner' ? 'owner' : 'user',
    is_owner: !!raw.is_owner,
    access: raw.access || EMPTY_ACCESS,
    active_subscription: raw.active_subscription || null,
  };
}

export function GwAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GwUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { const u = await gwGet('/auth/me'); setUser(normalize(u)); }
    catch { setUser(null); }
  };

  useEffect(() => {
    const t = localStorage.getItem('gw_session_token');
    if (!t) { setLoading(false); return; }
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const data = await gwPost('/auth/login', { username, password });
    setGwToken(data.token);
    await refresh();
  };
  const register = async (d: any) => {
    const data = await gwPost('/auth/register', d);
    setGwToken(data.token);
    await refresh();
  };
  const logout = () => { clearGwToken(); setUser(null); window.location.href = '/gateway/login'; };

  return <C.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</C.Provider>;
}
export const useGwAuth = () => useContext(C)!;
