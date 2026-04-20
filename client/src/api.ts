const BASE = '/api/gateway';
const TOKEN_KEY = 'gw_session_token';

export function getGwToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setGwToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearGwToken(): void { localStorage.removeItem(TOKEN_KEY); }

export async function gwApi(path: string, options: RequestInit = {}): Promise<any> {
  const token = getGwToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as any) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearGwToken();
    if (!path.startsWith('/auth/')) window.location.href = '/gateway/login';
    throw new Error('Session expired');
  }
  let data: any = null;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

export const gwGet = (p: string) => gwApi(p);
export const gwPost = (p: string, b?: any) => gwApi(p, { method: 'POST', body: JSON.stringify(b || {}) });
export const gwPut = (p: string, b?: any) => gwApi(p, { method: 'PUT', body: JSON.stringify(b || {}) });
