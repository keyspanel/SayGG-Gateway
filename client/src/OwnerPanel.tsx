import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from './api';

const SUB_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/gateway/owner', label: 'Overview', end: true },
  { to: '/gateway/owner/plans', label: 'Plans' },
  { to: '/gateway/owner/users', label: 'Users' },
  { to: '/gateway/owner/plan-orders', label: 'Plan Orders' },
  { to: '/gateway/owner/platform-settings', label: 'Platform UPI' },
];

export default function OwnerPanel() {
  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Owner Panel</h2>
          <p>Plans, users, subscriptions and platform settings.</p>
        </div>
        <span className="gw-badge ok">Owner</span>
      </div>
      <div className="gw-tabs" role="tablist">
        {SUB_NAV.map((n) => (
          <NavLink
            key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `gw-tab${isActive ? ' active' : ''}`}
          >
            {n.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

/* ---------------------------------------------------------------- Overview */

export function OwnerOverview() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { apiGet('/api/owner/overview').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="gw-alert error"><span>{err}</span></div>;
  if (!d) return <div className="gw-loading">Loading…</div>;
  return (
    <>
      <div className="gw-stats">
        <Stat label="Users" value={d.users.total} />
        <Stat label="Active subs" value={d.active_subscriptions} accent="ok" />
        <Stat label="Plans (active)" value={`${d.plans.active}/${d.plans.total}`} />
        <Stat label="Plan orders paid" value={d.plan_orders.paid} accent="ok" />
        <Stat label="Plan revenue" value={`₹${(d.plan_orders.revenue || 0).toFixed(2)}`} wide />
      </div>

      {!d.platform_payment_configured && (
        <div className="gw-alert warn">
          <span>Platform UPI is not configured yet — users cannot purchase plans. <NavLink to="/gateway/owner/platform-settings">Configure now</NavLink></span>
        </div>
      )}

      <div className="gw-grid-2">
        <div className="gw-card">
          <div className="gw-card-h"><h3>Recent users</h3><NavLink to="/gateway/owner/users">All</NavLink></div>
          <div className="gw-table">
            <div className="gw-tr head"><span>User</span><span>Email</span><span>Role</span><span>Created</span></div>
            {d.recent_users.map((u: any) => (
              <div className="gw-tr" key={u.id}>
                <span data-label="User">{u.username}</span>
                <span data-label="Email" className="gw-muted">{u.email}</span>
                <span data-label="Role"><span className={`gw-badge ${u.role === 'owner' ? 'ok' : 'mute'}`}>{u.role}</span></span>
                <span data-label="Created" className="gw-muted" style={{ fontSize: 12 }}>{new Date(u.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="gw-card">
          <div className="gw-card-h"><h3>Recent plan orders</h3><NavLink to="/gateway/owner/plan-orders">All</NavLink></div>
          <div className="gw-table">
            <div className="gw-tr head"><span>User</span><span>Plan</span><span>Amount</span><span>Status</span></div>
            {d.recent_plan_orders.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span data-label="User">{o.username}</span>
                <span data-label="Plan">{o.plan_name}</span>
                <span data-label="Amount">₹{parseFloat(o.amount).toFixed(2)}</span>
                <span data-label="Status"><span className={`gw-badge ${badgeFor(o.status)}`}>{o.status}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- Plans */

const METHOD_OPTIONS = [
  { value: 'server', label: 'Server API only' },
  { value: 'hosted', label: 'Hosted page only' },
  { value: 'master', label: 'Master (both)' },
];

export function OwnerPlans() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try { const r = await apiGet('/api/owner/plans'); setItems(r.items); } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const save = async (form: any) => {
    setErr('');
    try {
      const body = { ...form, features: parseFeatures(form.features) };
      if (form.id) await apiPut(`/api/owner/plans/${form.id}`, body);
      else await apiPost('/api/owner/plans', body);
      setEditing(null); setCreating(false);
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (id: number) => {
    if (!confirm('Deactivate this plan? Existing subscribers keep access until expiry.')) return;
    try { await apiDelete(`/api/owner/plans/${id}`); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      {err && <div className="gw-alert error"><span>{err}</span></div>}
      <div className="gw-card">
        <div className="gw-card-h">
          <h3>Plans</h3>
          <button className="gw-btn-primary sm" onClick={() => { setCreating(true); setEditing({ id: 0, plan_key: '', name: '', method_access: 'master', duration_days: 30, price: 999, discount_price: '', currency: 'INR', is_active: true, is_featured: false, sort_order: 10, description: '', features: '' }); }}>+ New plan</button>
        </div>
        <div className="gw-table">
          <div className="gw-tr head"><span>Key</span><span>Name</span><span>Access</span><span>Days</span><span>Price</span><span>Status</span><span></span></div>
          {items.map((p) => (
            <div className="gw-tr" key={p.id}>
              <span data-label="Key" className="mono small">{p.plan_key}</span>
              <span data-label="Name">{p.name}{p.is_featured ? ' ★' : ''}</span>
              <span data-label="Access">{p.method_access}</span>
              <span data-label="Days">{p.duration_days}</span>
              <span data-label="Price">₹{parseFloat(p.discount_price ?? p.price).toFixed(0)}{p.discount_price && parseFloat(p.discount_price) < parseFloat(p.price) ? ` (was ₹${parseFloat(p.price).toFixed(0)})` : ''}</span>
              <span data-label="Status"><span className={`gw-badge ${p.is_active ? 'ok' : 'mute'}`}>{p.is_active ? 'active' : 'inactive'}</span></span>
              <span data-label="">
                <button className="gw-btn-ghost sm" onClick={() => setEditing({ ...p, features: (Array.isArray(p.features) ? p.features : []).join('\n'), discount_price: p.discount_price ?? '' })}>Edit</button>
                {p.is_active && <button className="gw-btn-danger sm" onClick={() => remove(p.id)}>Deactivate</button>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {(editing || creating) && (
        <PlanEditor
          plan={editing}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSave={save}
        />
      )}
    </>
  );
}

function PlanEditor({ plan, onCancel, onSave }: { plan: any; onCancel: () => void; onSave: (p: any) => void }) {
  const [f, setF] = useState<any>(plan);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  return (
    <div className="gw-card feature">
      <div className="gw-card-h">
        <h3>{f.id ? 'Edit plan' : 'New plan'}</h3>
      </div>
      <div className="gw-form">
        <div className="gw-grid-2">
          <label className="gw-field"><span>Plan key</span><input value={f.plan_key} onChange={(e) => set('plan_key', e.target.value)} placeholder="server_30" /></label>
          <label className="gw-field"><span>Name</span><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Server API" /></label>
        </div>
        <div className="gw-grid-2">
          <label className="gw-field"><span>Method access</span>
            <div className="gw-select-wrap">
              <select value={f.method_access} onChange={(e) => set('method_access', e.target.value)}>
                {METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </label>
          <label className="gw-field"><span>Duration (days)</span><input type="number" min={1} value={f.duration_days} onChange={(e) => set('duration_days', parseInt(e.target.value, 10) || 0)} /></label>
        </div>
        <div className="gw-grid-2">
          <label className="gw-field"><span>Price (₹)</span><input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} /></label>
          <label className="gw-field"><span>Discount price (₹) <small>optional</small></span><input type="number" min={0} step="0.01" value={f.discount_price} onChange={(e) => set('discount_price', e.target.value)} /></label>
        </div>
        <div className="gw-grid-2">
          <label className="gw-field"><span>Sort order</span><input type="number" value={f.sort_order} onChange={(e) => set('sort_order', parseInt(e.target.value, 10) || 0)} /></label>
          <label className="gw-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={!!f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label>
            <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={!!f.is_featured} onChange={(e) => set('is_featured', e.target.checked)} /> Featured</label>
          </label>
        </div>
        <label className="gw-field"><span>Description</span><textarea rows={2} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="gw-field"><span>Features <small>(one per line)</small></span><textarea rows={5} value={f.features} onChange={(e) => set('features', e.target.value)} placeholder={'Server API\nWebhook\nTransactions'} /></label>
        <div className="gw-actions">
          <button className="gw-btn-primary" onClick={() => onSave(f)}>{f.id ? 'Save changes' : 'Create plan'}</button>
          <button className="gw-btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function parseFeatures(text: string): string[] {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------- Users */

export function OwnerUsers() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [grantFor, setGrantFor] = useState<any | null>(null);
  const [plans, setPlans] = useState<any[]>([]);

  const load = async (off = 0) => {
    setErr('');
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(off) });
      if (q) params.set('q', q);
      const r = await apiGet('/api/owner/users?' + params.toString());
      setItems(r.items); setTotal(r.total); setOffset(off);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(0); apiGet('/api/owner/plans').then((r) => setPlans(r.items.filter((p: any) => p.is_active))).catch(() => {}); }, []);

  const patch = async (id: number, body: any) => {
    try { await apiPatch(`/api/owner/users/${id}`, body); await load(offset); }
    catch (e: any) { setErr(e.message); }
  };

  const grant = async (userId: number, planId: number, days: number | null, notes: string) => {
    try {
      await apiPost(`/api/owner/users/${userId}/subscriptions`, { plan_id: planId, days_override: days, notes });
      setGrantFor(null);
      await load(offset);
    } catch (e: any) { setErr(e.message); }
  };

  const revoke = async (subId: number) => {
    if (!confirm('Revoke this subscription?')) return;
    try { await apiDelete(`/api/owner/subscriptions/${subId}`); await load(offset); }
    catch (e: any) { setErr(e.message); }
  };

  const extend = async (subId: number, days: number) => {
    try { await apiPost(`/api/owner/subscriptions/${subId}/extend`, { days }); await load(offset); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      {err && <div className="gw-alert error"><span>{err}</span></div>}
      <div className="gw-filters">
        <input placeholder="Search username or email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(0)} />
        <button className="gw-btn-primary" onClick={() => load(0)}>Search</button>
      </div>
      <div className="gw-card">
        <div className="gw-card-h"><h3>Users <span className="gw-muted">({total})</span></h3></div>
        <div className="gw-table">
          <div className="gw-tr head"><span>User</span><span>Plan</span><span>Role</span><span>Active</span><span>Last seen</span><span></span></div>
          {items.map((u) => (
            <div className="gw-tr" key={u.id}>
              <span data-label="User">
                <div><strong>{u.username}</strong></div>
                <div className="gw-muted" style={{ fontSize: 12 }}>{u.email}</div>
              </span>
              <span data-label="Plan">
                {u.active_subscription ? (
                  <>
                    <strong>{u.active_subscription.plan_name}</strong>
                    <div className="gw-muted" style={{ fontSize: 12 }}>
                      {u.active_subscription.expires_at ? `until ${new Date(u.active_subscription.expires_at).toLocaleDateString()}` : 'no expiry'}
                    </div>
                  </>
                ) : <span className="gw-muted">— none —</span>}
              </span>
              <span data-label="Role">
                <div className="gw-select-wrap">
                  <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                    <option value="user">user</option>
                    <option value="owner">owner</option>
                  </select>
                </div>
              </span>
              <span data-label="Active">
                <label style={{ display: 'inline-flex', gap: 6 }}>
                  <input type="checkbox" checked={!!u.is_active} onChange={(e) => patch(u.id, { is_active: e.target.checked })} />
                  {u.is_active ? 'on' : 'off'}
                </label>
              </span>
              <span data-label="Last seen" className="gw-muted" style={{ fontSize: 12 }}>{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : '—'}</span>
              <span data-label="">
                <button className="gw-btn-ghost sm" onClick={() => setGrantFor(u)}>Grant plan</button>
                {u.active_subscription && (
                  <>
                    <button className="gw-btn-ghost sm" onClick={() => extend(u.active_subscription.id ?? null, 30)} title="Extend by 30 days" disabled={!u.active_subscription.id}>+30d</button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {total > 50 && (
        <div className="gw-pager">
          <span>{offset + 1}–{Math.min(offset + items.length, total)} of {total}</span>
          <div>
            <button className="gw-btn-ghost sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 50))}>← Prev</button>
            <button className="gw-btn-ghost sm" disabled={offset + items.length >= total} onClick={() => load(offset + 50)}>Next →</button>
          </div>
        </div>
      )}

      {grantFor && (
        <GrantDialog user={grantFor} plans={plans} onClose={() => setGrantFor(null)} onSubmit={grant} />
      )}
    </>
  );
}

function GrantDialog({ user, plans, onClose, onSubmit }: { user: any; plans: any[]; onClose: () => void; onSubmit: (u: number, p: number, d: number | null, n: string) => void }) {
  const [planId, setPlanId] = useState(plans[0]?.id || 0);
  const [days, setDays] = useState<string>('');
  const [notes, setNotes] = useState('');
  return (
    <div className="gw-card feature">
      <div className="gw-card-h"><h3>Grant plan to {user.username}</h3></div>
      <div className="gw-form">
        <label className="gw-field"><span>Plan</span>
          <div className="gw-select-wrap">
            <select value={planId} onChange={(e) => setPlanId(parseInt(e.target.value, 10))}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.method_access} · {p.duration_days}d</option>)}
            </select>
          </div>
        </label>
        <label className="gw-field"><span>Override days <small>(blank = use plan default)</small></span>
          <input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" />
        </label>
        <label className="gw-field"><span>Notes <small>optional</small></span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="gw-actions">
          <button className="gw-btn-primary" disabled={!planId} onClick={() => onSubmit(user.id, planId, days ? parseInt(days, 10) : null, notes)}>Grant</button>
          <button className="gw-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Plan orders */

export function OwnerPlanOrders() {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status) params.set('status', status);
      const r = await apiGet('/api/owner/plan-orders?' + params.toString());
      setItems(r.items);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const refresh = async (id: number) => {
    try { await apiPost(`/api/owner/plan-orders/${id}/refresh`); await load(); }
    catch (e: any) { setErr(e.message); }
  };
  const cancel = async (id: number) => {
    if (!confirm('Cancel this pending plan order?')) return;
    try { await apiPost(`/api/owner/plan-orders/${id}/cancel`); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      {err && <div className="gw-alert error"><span>{err}</span></div>}
      <div className="gw-filters">
        <div className="gw-select-wrap">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button className="gw-btn-ghost" onClick={load}>Refresh</button>
      </div>
      <div className="gw-card">
        <div className="gw-table">
          <div className="gw-tr head"><span>Ref</span><span>User</span><span>Plan</span><span>Amount</span><span>Status</span><span>When</span><span></span></div>
          {items.map((o) => (
            <div className="gw-tr" key={o.id}>
              <span data-label="Ref" className="mono small">{o.txn_ref}</span>
              <span data-label="User">{o.username}<div className="gw-muted" style={{ fontSize: 12 }}>{o.email}</div></span>
              <span data-label="Plan">{o.plan_name}</span>
              <span data-label="Amount">₹{parseFloat(o.amount).toFixed(2)}</span>
              <span data-label="Status"><span className={`gw-badge ${badgeFor(o.status)}`}>{o.status}</span></span>
              <span data-label="When" className="gw-muted" style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleString()}</span>
              <span data-label="">
                {o.status === 'pending' && (
                  <>
                    <button className="gw-btn-ghost sm" onClick={() => refresh(o.id)}>Verify</button>
                    <button className="gw-btn-danger sm" onClick={() => cancel(o.id)}>Cancel</button>
                  </>
                )}
                {o.status === 'paid' && (
                  <span className="gw-muted" style={{ fontSize: 12 }}>RRN: {o.bank_rrn || o.gateway_txn_id || '—'}</span>
                )}
              </span>
            </div>
          ))}
          {items.length === 0 && <div className="gw-tr"><span className="gw-muted">No plan orders.</span></div>}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------- Platform settings */

export function OwnerPlatformSettings() {
  const [f, setF] = useState({ paytm_upi_id: '', paytm_merchant_id: '', paytm_merchant_key: '', paytm_env: 'production', payee_name: '' });
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await apiGet('/api/owner/platform-settings');
      setF((s) => ({ ...s,
        paytm_upi_id: d.paytm_upi_id || '',
        paytm_merchant_id: d.paytm_merchant_id || '',
        paytm_env: d.paytm_env || 'production',
        payee_name: d.payee_name || '',
      }));
      setHasKey(!!d.has_key); setMaskedKey(d.paytm_merchant_key_masked || '');
      setActive(!!d.is_active);
    } finally { setLoaded(true); }
  };
  useEffect(() => { load().catch((e) => setMsg({ err: e.message })); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg({});
    try {
      await apiPut('/api/owner/platform-settings', f);
      setMsg({ ok: 'Saved.' });
      setF((s) => ({ ...s, paytm_merchant_key: '' }));
      await load();
    } catch (e: any) { setMsg({ err: e.message }); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div className="gw-loading">Loading…</div>;

  return (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>Platform UPI</h3>
        {active ? <span className="gw-badge ok">Active</span> : <span className="gw-badge warn">Inactive</span>}
      </div>
      <p className="gw-muted">Plan purchases by users settle into <strong>this</strong> UPI handle. This is independent of every user's own merchant settings.</p>
      {msg.err && <div className="gw-alert error"><span>{msg.err}</span></div>}
      {msg.ok && <div className="gw-alert ok"><span>{msg.ok}</span></div>}
      <form onSubmit={submit} className="gw-form">
        <label className="gw-field"><span>UPI ID</span><input value={f.paytm_upi_id} onChange={(e) => setF((s) => ({ ...s, paytm_upi_id: e.target.value }))} placeholder="platform@paytm" required /></label>
        <label className="gw-field"><span>Merchant ID (MID)</span><input value={f.paytm_merchant_id} onChange={(e) => setF((s) => ({ ...s, paytm_merchant_id: e.target.value }))} required /></label>
        <label className="gw-field"><span>Merchant Key {hasKey && <small>saved · {maskedKey}</small>}</span>
          <input type="password" value={f.paytm_merchant_key} onChange={(e) => setF((s) => ({ ...s, paytm_merchant_key: e.target.value }))} placeholder={hasKey ? 'Leave blank to keep saved key' : 'Enter merchant key'} autoComplete="off" />
        </label>
        <label className="gw-field"><span>Display name <small>optional</small></span><input value={f.payee_name} onChange={(e) => setF((s) => ({ ...s, payee_name: e.target.value }))} placeholder="PayGateway" /></label>
        <label className="gw-field"><span>Environment</span>
          <div className="gw-select-wrap">
            <select value={f.paytm_env} onChange={(e) => setF((s) => ({ ...s, paytm_env: e.target.value }))}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
            </select>
          </div>
        </label>
        <div className="gw-actions">
          <button className="gw-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ small */

function Stat({ label, value, accent, wide }: { label: string; value: any; accent?: string; wide?: boolean }) {
  return (
    <div className={`gw-stat ${accent || ''}${wide ? ' wide' : ''}`}>
      <div className="gw-stat-l">{label}</div>
      <div className="gw-stat-v">{value}</div>
    </div>
  );
}

function badgeFor(s: string) {
  if (s === 'paid' || s === 'active') return 'ok';
  if (s === 'pending') return 'warn';
  if (s === 'failed' || s === 'cancelled') return 'bad';
  return 'mute';
}
