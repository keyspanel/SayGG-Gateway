import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from './api';
import { useGwAuth } from './AuthCtx';

interface Plan {
  id: number;
  plan_key: string;
  name: string;
  method_access: 'server' | 'hosted' | 'master';
  duration_days: number;
  price: number;
  discount_price: number | null;
  effective_price: number;
  currency: string;
  is_featured: boolean;
  description: string | null;
  features: string[];
}

interface BillingProfile {
  full_name: string;
  email: string;
  phone: string | null;
  country: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  tax_id: string | null;
}

type BillingPeriod = 'monthly' | 'yearly';

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SG', name: 'Singapore' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'JP', name: 'Japan' },
  { code: 'OT', name: 'Other' },
];

export default function Billing() {
  const { user } = useGwAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<any>(null);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  // billing-details modal state
  const [showProfile, setShowProfile] = useState(false);
  const [pendingPlanId, setPendingPlanId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [p, m] = await Promise.all([apiGet('/api/billing/plans'), apiGet('/api/billing/me')]);
      setPlans(p.items || []);
      setMe(m);
      setProfile(m.billing_profile || null);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const buy = async (planId: number) => {
    setBusy(planId); setErr('');
    try {
      const order = await apiPost('/api/billing/purchase', { plan_id: planId });
      window.location.href = `/billing/pay/${order.public_token}`;
    } catch (e: any) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'BILLING_PROFILE_REQUIRED') {
        setPendingPlanId(planId);
        setShowProfile(true);
      } else if (code === 'PLATFORM_PAYMENT_NOT_CONFIGURED') {
        setErr('Plan checkout is temporarily unavailable. Please try again shortly.');
      } else {
        setErr(e.message);
      }
      setBusy(null);
    }
  };

  const onChoose = (planId: number) => {
    if (!profile) {
      setPendingPlanId(planId);
      setShowProfile(true);
      return;
    }
    buy(planId);
  };

  const onProfileSaved = (p: BillingProfile) => {
    setProfile(p);
    setShowProfile(false);
    if (pendingPlanId != null) {
      const id = pendingPlanId;
      setPendingPlanId(null);
      buy(id);
    }
  };

  const visiblePlans = useMemo(() => {
    return plans.filter((p) => period === 'yearly' ? p.duration_days >= 200 : p.duration_days < 200);
  }, [plans, period]);

  // Pair monthly ↔ annual by method_access for showing savings on annual cards.
  const monthlyByMethod = useMemo(() => {
    const map: Record<string, Plan> = {};
    plans.filter((p) => p.duration_days < 200).forEach((p) => { map[p.method_access] = p; });
    return map;
  }, [plans]);

  if (loading) return <div className="gw-loading">Loading…</div>;

  const sub = me?.active_subscription;
  const hasYearly = plans.some((p) => p.duration_days >= 200);

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Billing</h2>
          <p>Choose a plan to unlock the gateway.</p>
        </div>
        {!user?.is_owner && (
          <button className="gw-btn-ghost sm" onClick={() => setShowProfile(true)}>
            {profile ? 'Edit billing details' : 'Add billing details'}
          </button>
        )}
      </div>

      {err && <div className="gw-alert error"><span>{err}</span></div>}

      {user?.is_owner && (
        <div className="gw-alert info">
          <span>You are an <strong>owner</strong>. Plans don't apply to your account — you have full access automatically.</span>
        </div>
      )}

      {sub ? (
        <div className="gw-card feature">
          <div className="gw-card-h">
            <h3>Current plan</h3>
            <span className="gw-badge ok">Active</span>
          </div>
          <div className="gw-billing-current">
            <div>
              <div className="gw-current-name">{sub.plan_name}</div>
              <div className="gw-muted">{labelMethod(sub.method_access)}</div>
            </div>
            <div className="gw-current-meta">
              {sub.expires_at && (
                <div><b>Renews / expires</b><span>{new Date(sub.expires_at).toLocaleString()}</span></div>
              )}
              {sub.days_left != null && (
                <div><b>Days left</b><span>{sub.days_left}</span></div>
              )}
            </div>
          </div>
        </div>
      ) : !user?.is_owner ? (
        <div className="gw-alert warn">
          <span>You don't have an active plan yet. Pick one below to start using the gateway.</span>
        </div>
      ) : null}

      {!user?.is_owner && (
        <div className="gw-billing-meta">
          {profile ? (
            <div className="gw-billing-meta-row">
              <span className="gw-muted">Billing to</span>
              <span><b>{profile.full_name}</b> · {profile.email} · {profile.city}, {profile.country}</span>
            </div>
          ) : (
            <div className="gw-billing-meta-row warn">
              <span>Billing email and address are required before checkout.</span>
              <button className="gw-btn-ghost xs" onClick={() => setShowProfile(true)}>Add now</button>
            </div>
          )}
        </div>
      )}

      {hasYearly && (
        <div className="gw-billing-toggle-wrap">
          <div className="gw-billing-toggle" role="tablist" aria-label="Billing period">
            <button
              role="tab"
              aria-selected={period === 'monthly'}
              className={period === 'monthly' ? 'on' : ''}
              onClick={() => setPeriod('monthly')}
            >
              Monthly
            </button>
            <button
              role="tab"
              aria-selected={period === 'yearly'}
              className={period === 'yearly' ? 'on' : ''}
              onClick={() => setPeriod('yearly')}
            >
              Yearly <span className="gw-toggle-pill">Save 17%</span>
            </button>
          </div>
          <p className="gw-toggle-hint">
            {period === 'yearly'
              ? 'Pay 12 months upfront and get 2 months free.'
              : 'Switch to yearly to save 2 months.'}
          </p>
        </div>
      )}

      <div className="gw-plan-grid">
        {visiblePlans.map((p) => {
          const featured = !!p.is_featured;
          const isCurrent = sub && sub.plan_id === p.id;
          const periodLabel = p.duration_days >= 200 ? 'year' : `${p.duration_days} days`;
          const monthEquivalent = period === 'yearly'
            ? Math.round((p.discount_price ?? p.price) / 12)
            : null;
          const monthlyTwin = period === 'yearly' ? monthlyByMethod[p.method_access] : null;
          const annualSavings = monthlyTwin
            ? Math.max(0, Math.round((monthlyTwin.discount_price ?? monthlyTwin.price) * 12 - (p.discount_price ?? p.price)))
            : 0;
          return (
            <div key={p.id} className={`gw-plan${featured ? ' featured' : ''}${isCurrent ? ' current' : ''}`}>
              {featured && <div className="gw-plan-flag">Most popular</div>}
              <div className="gw-plan-name">{p.name}</div>
              <div className="gw-plan-price">
                {p.discount_price != null && p.discount_price < p.price ? (
                  <>
                    <span className="now">₹{p.discount_price.toFixed(0)}</span>
                    <span className="was">₹{p.price.toFixed(0)}</span>
                  </>
                ) : (
                  <span className="now">₹{p.price.toFixed(0)}</span>
                )}
                <span className="per">/ {periodLabel}</span>
              </div>
              {monthEquivalent != null && (
                <div className="gw-plan-sub">
                  ≈ ₹{monthEquivalent}/mo billed yearly
                  {annualSavings > 0 && <span className="gw-save-pill">Save ₹{annualSavings.toLocaleString('en-IN')}</span>}
                </div>
              )}
              <div className="gw-plan-meta">{labelMethod(p.method_access)}</div>
              {p.description && <p className="gw-plan-desc">{p.description}</p>}
              <ul className="gw-plan-features">
                {p.features.map((f, i) => <li key={i}>✓ {f}</li>)}
              </ul>
              {user?.is_owner ? (
                <button className="gw-btn-ghost gw-btn-block" disabled>Owner — full access</button>
              ) : isCurrent ? (
                <button className="gw-btn-ghost gw-btn-block" disabled>Current plan</button>
              ) : (
                <button
                  className={featured ? 'gw-btn-primary gw-btn-block' : 'gw-btn-ghost gw-btn-block'}
                  disabled={busy === p.id}
                  onClick={() => onChoose(p.id)}
                >
                  {busy === p.id ? 'Starting…' : sub ? 'Switch / renew' : 'Choose plan'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {me?.recent_orders?.length > 0 && (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>Recent purchases</h3>
            <button className="gw-btn-ghost sm" onClick={load}>Refresh</button>
          </div>
          <div className="gw-table">
            <div className="gw-tr head">
              <span>Plan</span><span>Amount</span><span>Status</span><span>When</span><span></span>
            </div>
            {me.recent_orders.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span data-label="Plan">{o.plan_name}</span>
                <span data-label="Amount">₹{parseFloat(o.amount).toFixed(2)}</span>
                <span data-label="Status"><span className={`gw-badge ${badgeFor(o.status)}`}>{o.status}</span></span>
                <span data-label="When" className="gw-muted" style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleString()}</span>
                <span data-label="">
                  {o.status === 'pending' && (
                    <Link to={`/billing/pay/${o.public_token}`} className="gw-btn-ghost sm">Open</Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showProfile && (
        <BillingProfileModal
          initial={profile}
          defaultEmail={user?.email || ''}
          onClose={() => { setShowProfile(false); setPendingPlanId(null); }}
          onSaved={onProfileSaved}
        />
      )}
    </div>
  );
}

interface ModalProps {
  initial: BillingProfile | null;
  defaultEmail: string;
  onClose: () => void;
  onSaved: (p: BillingProfile) => void;
}

function BillingProfileModal({ initial, defaultEmail, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState({
    full_name: initial?.full_name || '',
    email: initial?.email || defaultEmail || '',
    phone: initial?.phone || '',
    country: initial?.country || 'IN',
    address_line1: initial?.address_line1 || '',
    address_line2: initial?.address_line2 || '',
    city: initial?.city || '',
    state: initial?.state || '',
    postal_code: initial?.postal_code || '',
    tax_id: initial?.tax_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [errField, setErrField] = useState('');

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(''); setErrField('');
    try {
      const r = await apiPost('/api/billing/profile', form);
      onSaved(r.profile);
    } catch (e: any) {
      setErr(e.message);
      if (e instanceof ApiError && e.details && (e.details as any).field) {
        setErrField((e.details as any).field);
      }
      setSaving(false);
    }
  };

  return (
    <div className="gw-modal-overlay" onClick={onClose}>
      <div className="gw-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="bp-h">
        <div className="gw-modal-h">
          <div>
            <h3 id="bp-h">Billing details</h3>
            <p className="gw-muted">Required before checkout. Used on your invoices and receipts.</p>
          </div>
          <button className="gw-btn-ghost xs" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className="gw-billing-form" onSubmit={submit} noValidate>
          {err && <div className="gw-alert error"><span>{err}</span></div>}

          <div className="gw-form-row">
            <label className={errField === 'full_name' ? 'err' : ''}>
              <span>Full name *</span>
              <input
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                placeholder="Jane Doe"
                maxLength={120}
                required
              />
            </label>
            <label className={errField === 'email' ? 'err' : ''}>
              <span>Billing email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="you@example.com"
                maxLength={255}
                required
              />
            </label>
          </div>

          <div className="gw-form-row">
            <label className={errField === 'phone' ? 'err' : ''}>
              <span>Phone</span>
              <input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+91 98xxxxxxxx"
                maxLength={40}
              />
            </label>
            <label className={errField === 'country' ? 'err' : ''}>
              <span>Country *</span>
              <select value={form.country} onChange={(e) => set('country', e.target.value)} required>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <label className={errField === 'address_line1' ? 'err' : ''}>
            <span>Address line 1 *</span>
            <input
              value={form.address_line1}
              onChange={(e) => set('address_line1', e.target.value)}
              placeholder="Street and house / building no."
              maxLength={255}
              required
            />
          </label>

          <label className={errField === 'address_line2' ? 'err' : ''}>
            <span>Address line 2</span>
            <input
              value={form.address_line2}
              onChange={(e) => set('address_line2', e.target.value)}
              placeholder="Apartment, suite, landmark (optional)"
              maxLength={255}
            />
          </label>

          <div className="gw-form-row three">
            <label className={errField === 'city' ? 'err' : ''}>
              <span>City *</span>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} required />
            </label>
            <label className={errField === 'state' ? 'err' : ''}>
              <span>State / Province *</span>
              <input value={form.state} onChange={(e) => set('state', e.target.value)} maxLength={120} required />
            </label>
            <label className={errField === 'postal_code' ? 'err' : ''}>
              <span>Postal / ZIP *</span>
              <input
                value={form.postal_code}
                onChange={(e) => set('postal_code', e.target.value)}
                placeholder={form.country === 'IN' ? '6-digit PIN' : ''}
                maxLength={20}
                required
              />
            </label>
          </div>

          <label className={errField === 'tax_id' ? 'err' : ''}>
            <span>Tax ID / GSTIN</span>
            <input
              value={form.tax_id}
              onChange={(e) => set('tax_id', e.target.value)}
              placeholder="Optional"
              maxLength={64}
            />
          </label>

          <div className="gw-modal-actions">
            <button type="button" className="gw-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="gw-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : initial ? 'Save & continue' : 'Save details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function labelMethod(m: string) {
  if (m === 'server') return 'Server API only';
  if (m === 'hosted') return 'Hosted Pay Page only';
  if (m === 'master') return 'Server + Hosted (all features)';
  return m;
}

function badgeFor(s: string) {
  if (s === 'paid') return 'ok';
  if (s === 'pending') return 'warn';
  if (s === 'failed' || s === 'cancelled') return 'bad';
  return 'mute';
}
