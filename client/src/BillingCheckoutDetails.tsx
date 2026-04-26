import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiGet, ApiError } from './api';
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

export interface CheckoutFormState {
  email: string;
  phone: string;
  full_name: string;
  city: string;
  postal_code: string;
}

/**
 * Returns true when every field in the form passes the same validation
 * the user would face on submit. Used to decide whether a returning user
 * with a saved billing profile can skip the details step entirely.
 */
function isFormComplete(f: CheckoutFormState): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return false;
  if (!/^[\+]?[0-9\-\s\(\)]{6,40}$/.test(f.phone.trim())) return false;
  if (f.full_name.trim().length < 2) return false;
  if (f.city.trim().length < 2) return false;
  if (!/^[1-9][0-9]{5}$/.test(f.postal_code.trim())) return false;
  return true;
}

export default function BillingCheckoutDetails() {
  const { planId } = useParams<{ planId: string }>();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useGwAuth();

  // If the user clicked "Edit details" on the confirm step, the previous
  // form values come back to us in route state. We use that as the form's
  // initial value AND as a signal to skip the auto-redirect — otherwise
  // a complete profile would bounce them right back to the confirm page,
  // making "Edit details" feel broken.
  const incoming = loc.state as { form?: CheckoutFormState; edit?: boolean } | null;
  const isEditing = !!(incoming?.form || incoming?.edit);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [fee, setFee] = useState<number>(0);
  const [bootErr, setBootErr] = useState('');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<CheckoutFormState>({
    email: incoming?.form?.email || '',
    phone: incoming?.form?.phone || '',
    full_name: incoming?.form?.full_name || '',
    city: incoming?.form?.city || '',
    postal_code: incoming?.form?.postal_code || '',
  });
  const [err, setErr] = useState('');
  const [errField, setErrField] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setBootErr('');
      try {
        const [plansRes, meRes] = await Promise.all([
          apiGet('/api/billing/plans'),
          apiGet('/api/billing/me'),
        ]);
        if (cancelled) return;

        const id = parseInt(planId || '', 10);
        const found: Plan | undefined = (plansRes.items || []).find((p: Plan) => p.id === id);
        if (!found) {
          setBootErr('That plan is no longer available.');
          return;
        }
        setPlan(found);

        const platformFee = typeof plansRes.platform_fee === 'number'
          ? plansRes.platform_fee
          : (typeof meRes.platform_fee === 'number' ? meRes.platform_fee : 0);
        setFee(platformFee);

        // When the user is explicitly editing, never overwrite the form
        // values they were just looking at on the confirm page.
        if (isEditing) return;

        const profile = meRes.billing_profile || null;
        const prefilled: CheckoutFormState = {
          email: profile?.email || user?.email || '',
          phone: profile?.phone || '',
          full_name: profile?.full_name || '',
          city: profile?.city || '',
          postal_code: profile?.postal_code || '',
        };
        setForm(prefilled);

        // Auto-fill: if the saved profile is fully valid, skip the
        // re-entry step and send the user straight to the confirm page
        // with everything pre-loaded. They can still tap "Edit details"
        // on the confirm page to come back here.
        if (isFormComplete(prefilled)) {
          nav(`/gateway/billing/checkout/${found.id}/confirm`, {
            replace: true,
            state: { form: prefilled, fee: platformFee, plan: found, autofilled: true },
          });
          return;
        }
      } catch (e: any) {
        if (!cancelled) setBootErr(e instanceof ApiError ? e.message : 'Could not load this plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [planId, user?.email, isEditing, nav]);

  const planPrice = plan ? (plan.discount_price ?? plan.price) : 0;
  const total = useMemo(() => Math.round((planPrice + (fee || 0)) * 100) / 100, [planPrice, fee]);

  const set = (k: keyof CheckoutFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): { ok: boolean; field?: string; message?: string } => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return { ok: false, field: 'email', message: 'Enter a valid email address.' };
    if (!/^[\+]?[0-9\-\s\(\)]{6,40}$/.test(form.phone.trim())) return { ok: false, field: 'phone', message: 'Mobile number looks invalid.' };
    if (form.full_name.trim().length < 2) return { ok: false, field: 'full_name', message: 'Name is required.' };
    if (form.city.trim().length < 2) return { ok: false, field: 'city', message: 'City is required.' };
    if (!/^[1-9][0-9]{5}$/.test(form.postal_code.trim())) return { ok: false, field: 'postal_code', message: 'Indian PIN code must be 6 digits.' };
    return { ok: true };
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setErrField('');
    const v = validate();
    if (!v.ok) { setErr(v.message || 'Please check the form.'); setErrField(v.field || ''); return; }
    if (!plan) return;

    const cleaned: CheckoutFormState = {
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      full_name: form.full_name.trim(),
      city: form.city.trim(),
      postal_code: form.postal_code.trim(),
    };

    nav(`/gateway/billing/checkout/${plan.id}/confirm`, {
      state: { form: cleaned, fee, plan },
    });
  };

  if (loading) return <div className="gw-loading">Loading…</div>;

  if (bootErr || !plan) {
    return (
      <div className="gw-page">
        <div className="gw-card">
          <h2>Plan not available</h2>
          <p className="gw-muted">{bootErr || 'That plan could not be loaded.'}</p>
          <div className="gw-actions" style={{ marginTop: 12 }}>
            <Link to="/gateway/billing" className="gw-btn-primary">Back to billing</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gw-page gw-checkout">
      <CheckoutSteps current={1} />

      <div className="gw-checkout-grid">
        <div className="gw-card gw-checkout-form-card">
          <div className="gw-card-h">
            <div>
              <h2 style={{ margin: 0 }}>Billing details</h2>
              <p className="gw-muted" style={{ margin: '4px 0 0' }}>Required for invoicing. Stored against your account.</p>
            </div>
          </div>

          {err && <div className="gw-alert error"><span>{err}</span></div>}

          <form className="gw-billing-form" onSubmit={onSubmit} noValidate>
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

            <div className="gw-checkout-actions">
              <Link to="/gateway/billing" className="gw-btn-ghost">Cancel</Link>
              <button type="submit" className="gw-btn-primary">Continue</button>
            </div>
          </form>
        </div>

        <aside className="gw-card gw-checkout-summary">
          <div className="gw-checkout-sum-h">Order summary</div>
          <div className="gw-checkout-plan">
            <div>
              <b>{plan.name}</b>
              <div className="gw-muted" style={{ fontSize: 12 }}>
                {labelMethod(plan.method_access)} · {plan.duration_days >= 200 ? '1 year' : `${plan.duration_days} days`}
              </div>
            </div>
            <div className="gw-checkout-amt">₹{planPrice.toFixed(2)}</div>
          </div>

          <div className="gw-checkout-lines">
            <div><span>Plan</span><span>₹{planPrice.toFixed(2)}</span></div>
            <div><span>Fee</span><span>{fee > 0 ? `₹${fee.toFixed(2)}` : '₹0.00'}</span></div>
            <div className="gw-checkout-total"><span>Total payable</span><span>₹{total.toFixed(2)}</span></div>
          </div>

          <p className="gw-checkout-secure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Secure UPI checkout
          </p>
        </aside>
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

export function CheckoutSteps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="gw-checkout-steps" aria-label="Checkout progress">
      <li className={`gw-step${current >= 1 ? ' on' : ''}${current > 1 ? ' done' : ''}`}>
        <span className="gw-step-num">{current > 1 ? '✓' : '1'}</span>
        <span className="gw-step-lbl">Your details</span>
      </li>
      <li className="gw-step-bar" aria-hidden="true" />
      <li className={`gw-step${current >= 2 ? ' on' : ''}`}>
        <span className="gw-step-num">2</span>
        <span className="gw-step-lbl">Confirm</span>
      </li>
      <li className="gw-step-bar" aria-hidden="true" />
      <li className="gw-step">
        <span className="gw-step-num">3</span>
        <span className="gw-step-lbl">Pay</span>
      </li>
    </ol>
  );
}
