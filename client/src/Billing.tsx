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

type BillingPeriod = 'monthly' | 'yearly';

export default function Billing() {
  const { user } = useGwAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<any>(null);
  const [platformFee, setPlatformFee] = useState<number>(0);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  // Two-step checkout sheet
  const [sheetPlan, setSheetPlan] = useState<Plan | null>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [p, m] = await Promise.all([apiGet('/api/billing/plans'), apiGet('/api/billing/me')]);
      setPlans(p.items || []);
      setPlatformFee(typeof p.platform_fee === 'number' ? p.platform_fee : (typeof m.platform_fee === 'number' ? m.platform_fee : 0));
      setMe(m);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visiblePlans = useMemo(() => {
    return plans.filter((p) => period === 'yearly' ? p.duration_days >= 200 : p.duration_days < 200);
  }, [plans, period]);

  const monthlyByMethod = useMemo(() => {
    const map: Record<string, Plan> = {};
    plans.filter((p) => p.duration_days < 200).forEach((p) => { map[p.method_access] = p; });
    return map;
  }, [plans]);

  if (loading) return <div className="gw-loading">Loading…</div>;

  const sub = me?.active_subscription;
  const hasYearly = plans.some((p) => p.duration_days >= 200);
  const initialProfile = me?.billing_profile || null;

  const onChoose = (plan: Plan) => {
    setErr('');
    setSheetPlan(plan);
  };

  const onSheetCompleted = async (planId: number) => {
    setBusy(planId);
    try {
      const order = await apiPost('/api/billing/purchase', { plan_id: planId });
      window.location.href = `/billing/pay/${order.public_token}`;
    } catch (e: any) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'PLATFORM_PAYMENT_NOT_CONFIGURED') {
        setErr('Plan checkout is temporarily unavailable. Please try again shortly.');
      } else if (code === 'BILLING_PROFILE_REQUIRED') {
        setErr('Please complete the billing form before continuing.');
      } else {
        setErr(e.message);
      }
      setSheetPlan(null);
      setBusy(null);
    }
  };

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Billing</h2>
          <p>Choose a plan to unlock the gateway.</p>
        </div>
      </div>

      {err && <div className="gw-alert error"><span>{err}</span></div>}

      {user?.is_owner && (
        <div className="gw-alert info">
          <span>You are an <strong>owner</strong>. Plans don't apply to your account — you have full access automatically.</span>
        </div>
      )}

      {sub && (
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
                  onClick={() => onChoose(p)}
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

      {sheetPlan && (
        <CheckoutSheet
          plan={sheetPlan}
          fee={platformFee}
          initialProfile={initialProfile}
          defaultEmail={user?.email || ''}
          onClose={() => setSheetPlan(null)}
          onConfirmed={() => onSheetCompleted(sheetPlan.id)}
        />
      )}
    </div>
  );
}

/* ----------------------------- Two-step sheet ----------------------------- */

interface SheetProps {
  plan: Plan;
  fee: number;
  initialProfile: any;
  defaultEmail: string;
  onClose: () => void;
  onConfirmed: () => void;
}

interface FormState {
  email: string;
  phone: string;
  full_name: string;
  city: string;
  postal_code: string;
}

function CheckoutSheet({ plan, fee, initialProfile, defaultEmail, onClose, onConfirmed }: SheetProps) {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [form, setForm] = useState<FormState>({
    email: initialProfile?.email || defaultEmail || '',
    phone: initialProfile?.phone || '',
    full_name: initialProfile?.full_name || '',
    city: initialProfile?.city || '',
    postal_code: initialProfile?.postal_code || '',
  });
  const [err, setErr] = useState('');
  const [errField, setErrField] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const planPrice = plan.discount_price ?? plan.price;
  const total = Math.round((planPrice + (fee || 0)) * 100) / 100;

  const validateLocal = (): { ok: boolean; field?: string; message?: string } => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return { ok: false, field: 'email', message: 'Enter a valid email address.' };
    if (!/^[\+]?[0-9\-\s\(\)]{6,40}$/.test(form.phone.trim())) return { ok: false, field: 'phone', message: 'Mobile number looks invalid.' };
    if (form.full_name.trim().length < 2) return { ok: false, field: 'full_name', message: 'Name is required.' };
    if (form.city.trim().length < 2) return { ok: false, field: 'city', message: 'City is required.' };
    if (!/^[1-9][0-9]{5}$/.test(form.postal_code.trim())) return { ok: false, field: 'postal_code', message: 'Indian PIN code must be 6 digits.' };
    return { ok: true };
  };

  const goToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setErrField('');
    const v = validateLocal();
    if (!v.ok) { setErr(v.message || 'Please check the form.'); setErrField(v.field || ''); return; }
    setStep('confirm');
  };

  const confirm = async () => {
    setSaving(true); setErr(''); setErrField('');
    try {
      await apiPost('/api/billing/profile', {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        country: 'IN',
        city: form.city.trim(),
        postal_code: form.postal_code.trim(),
      });
      onConfirmed();
    } catch (e: any) {
      setErr(e.message);
      if (e instanceof ApiError && e.details && (e.details as any).field) {
        setErrField((e.details as any).field);
      }
      setStep('form');
      setSaving(false);
    }
  };

  return (
    <div className="gw-modal-overlay" onClick={() => !saving && onClose()}>
      <div className="gw-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="cs-h">
        <div className="gw-sheet-handle" aria-hidden="true" />
        <div className="gw-sheet-h">
          <div>
            <h3 id="cs-h">{step === 'form' ? 'Your details' : 'Confirm purchase'}</h3>
            <p className="gw-muted">
              {step === 'form'
                ? 'Required for invoicing. Stored against your account.'
                : 'Review your details and the plan amount before paying.'}
            </p>
          </div>
          <button className="gw-btn-ghost xs" onClick={onClose} aria-label="Close" disabled={saving}>✕</button>
        </div>

        {err && <div className="gw-alert error"><span>{err}</span></div>}

        {step === 'form' ? (
          <form className="gw-billing-form" onSubmit={goToConfirm} noValidate>
            <label className={errField === 'email' ? 'err' : ''}>
              <span>Gmail / Email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="you@gmail.com"
                maxLength={255}
                autoFocus
                required
              />
            </label>
            <label className={errField === 'phone' ? 'err' : ''}>
              <span>Mobile number *</span>
              <input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+91 98xxxxxxxx"
                maxLength={40}
                inputMode="tel"
                required
              />
            </label>
            <label className={errField === 'full_name' ? 'err' : ''}>
              <span>Name *</span>
              <input
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                placeholder="Your name"
                maxLength={120}
                required
              />
            </label>
            <label>
              <span>Country</span>
              <input value="India" disabled readOnly />
            </label>
            <div className="gw-form-row">
              <label className={errField === 'city' ? 'err' : ''}>
                <span>City *</span>
                <input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} required />
              </label>
              <label className={errField === 'postal_code' ? 'err' : ''}>
                <span>Postal / ZIP *</span>
                <input
                  value={form.postal_code}
                  onChange={(e) => set('postal_code', e.target.value)}
                  placeholder="6-digit PIN"
                  maxLength={6}
                  inputMode="numeric"
                  required
                />
              </label>
            </div>
            <div className="gw-modal-actions">
              <button type="button" className="gw-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="gw-btn-primary">Continue</button>
            </div>
          </form>
        ) : (
          <div className="gw-confirm">
            <div className="gw-confirm-block">
              <div className="gw-confirm-block-h">Billing to</div>
              <div className="gw-confirm-rows">
                <div><span>Name</span><b>{form.full_name}</b></div>
                <div><span>Email</span><b>{form.email}</b></div>
                <div><span>Mobile</span><b>{form.phone}</b></div>
                <div><span>Country</span><b>India</b></div>
                <div><span>City</span><b>{form.city}</b></div>
                <div><span>Postal / ZIP</span><b>{form.postal_code}</b></div>
              </div>
              <button type="button" className="gw-btn-ghost xs gw-confirm-edit" onClick={() => setStep('form')} disabled={saving}>
                Edit details
              </button>
            </div>

            <div className="gw-confirm-block">
              <div className="gw-confirm-block-h">Selected plan</div>
              <div className="gw-confirm-plan">
                <div>
                  <b>{plan.name}</b>
                  <div className="gw-muted" style={{ fontSize: 12 }}>{labelMethod(plan.method_access)} · {plan.duration_days >= 200 ? '1 year' : `${plan.duration_days} days`}</div>
                </div>
                <div className="gw-confirm-amt">₹{planPrice.toFixed(2)}</div>
              </div>
            </div>

            <div className="gw-confirm-block totals">
              <div className="gw-confirm-line">
                <span>Plan</span><span>₹{planPrice.toFixed(2)}</span>
              </div>
              <div className="gw-confirm-line">
                <span>Fee</span><span>{fee > 0 ? `₹${fee.toFixed(2)}` : '₹0.00'}</span>
              </div>
              <div className="gw-confirm-line total">
                <span>Total payable</span><span>₹{total.toFixed(2)}</span>
              </div>
            </div>

            <div className="gw-modal-actions">
              <button type="button" className="gw-btn-ghost" onClick={() => setStep('form')} disabled={saving}>Back</button>
              <button type="button" className="gw-btn-primary" onClick={confirm} disabled={saving}>
                {saving ? 'Starting…' : `Confirm & pay ₹${total.toFixed(2)}`}
              </button>
            </div>
          </div>
        )}
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
