const BASE = '/api/gateway';
const TOKEN_KEY = 'gw_session_token';

export function getGwToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setGwToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearGwToken(): void { localStorage.removeItem(TOKEN_KEY); }

/**
 * Lower-level API caller. Pass a full /api/... path. On 401 the session is
 * cleared. Public endpoints (e.g. /api/billing/pay/:token) work without a
 * token. Throws an Error whose `.code` carries the server error code (so the
 * UI can branch on PLAN_REQUIRED, PLAN_FEATURE_LOCKED, etc).
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(message: string, status: number, code: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiCall(fullPath: string, options: RequestInit = {}): Promise<any> {
  const token = getGwToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as any) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(fullPath, { ...options, headers });
  let data: any = null;
  try { data = await res.json(); } catch { data = {}; }
  if (res.status === 401) {
    // Only clear + bounce when the route was attempted with a token (i.e. the
    // user thought they were logged in). Public token-based routes still work.
    if (token) {
      clearGwToken();
      if (!fullPath.includes('/auth/')) window.location.href = '/gateway/login';
    }
    throw new ApiError(data?.message || 'Session expired', 401, data?.code || 'AUTH_REQUIRED', data?.details);
  }
  if (!res.ok) {
    throw new ApiError(
      data?.message || data?.error || 'Request failed',
      res.status,
      data?.code || 'REQUEST_FAILED',
      data?.details,
    );
  }
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) return data.data;
  return data;
}

export const apiGet = (p: string) => apiCall(p);
export const apiPost = (p: string, b?: any) => apiCall(p, { method: 'POST', body: JSON.stringify(b || {}) });
export const apiPut = (p: string, b?: any) => apiCall(p, { method: 'PUT', body: JSON.stringify(b || {}) });
export const apiPatch = (p: string, b?: any) => apiCall(p, { method: 'PATCH', body: JSON.stringify(b || {}) });
export const apiDelete = (p: string) => apiCall(p, { method: 'DELETE' });

/* Backwards-compatible /api/gateway helpers used by Dashboard/Settings/Docs/Transactions */
export const gwApi = (p: string, options: RequestInit = {}) => apiCall(`${BASE}${p}`, options);
export const gwGet = (p: string) => gwApi(p);
export const gwPost = (p: string, b?: any) => gwApi(p, { method: 'POST', body: JSON.stringify(b || {}) });
export const gwPut = (p: string, b?: any) => gwApi(p, { method: 'PUT', body: JSON.stringify(b || {}) });

// Raw call to the public gateway API using a user-supplied API token.
// Returns { status, ok, body } so the test console can show the real response envelope.
export async function gwApiRaw(
  path: string,
  apiToken: string,
  init: { method?: string; body?: any } = {},
): Promise<{ status: number; ok: boolean; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = { _raw: await res.text().catch(() => '') }; }
  return { status: res.status, ok: res.ok, body };
}
