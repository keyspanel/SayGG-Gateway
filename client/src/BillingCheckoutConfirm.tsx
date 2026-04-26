import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import { apiPost, ApiError } from './api';
import { CheckoutSteps, type CheckoutFormState } from './BillingCheckoutDetails';

interface PassedState {
  form: CheckoutFormState;
  fee: number;
  plan: {
    id: number;
    name: string;
    method_access: 'server' | 'hosted' | 'master';
    duration_days: number;
    price: number;
    discount_price: number | null;
  };
}

export default function BillingCheckoutConfirm() {
  const { planId } = useParams<{ planId: string }>();
  const nav = useNavigate();
  const loc = useLocation();
  const state = loc.state as PassedState | null;

  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // If user landed here without going through step 1 (e.g. direct URL or
  // page refresh), bounce them back to the details step. We intentionally
  // do NOT silently re-fetch — they already filled in personal info, so
  // forcing them to confirm it again is the safer UX.
  if (!state || !state.form || !state.plan) {
    return <Navigate to={`/gateway/billing/checkout/${planId}`} replace />;
  }

  const { form, fee, plan } = state;
  const planPrice = plan.discount_price ?? plan.price;
  const total = Math.round((planPrice + (fee || 0)) * 100) / 100;

  const goBack = () => {
    nav(`/gateway/billing/checkout/${plan.id}`, { state: { form, fee, plan } });
  };

  const confirm = async () => {
    if (saving) return;
    setSaving(true); setErr('');
    try {
      // Save the billing profile first (server requires it before purchase).
      await apiPost('/api/billing/profile', {
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        country: 'IN',
        city: form.city,
        postal_code: form.postal_code,
      });

      // Create the subscription order — backend returns the public token
      // for the hosted pay page.
      const order = await apiPost('/api/billing/purchase', { plan_id: plan.id });
      nav(`/billing/pay/${order.public_token}`, { replace: true });
    } catch (e: any) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'PLATFORM_PAYMENT_NOT_CONFIGURED') {
        setErr('Plan checkout is temporarily unavailable. Please try again shortly.');
      } else if (code === 'BILLING_PROFILE_REQUIRED') {
        setErr('Please complete the billing form before continuing.');
      } else if (code === 'VALIDATION_ERROR' && e?.details?.field) {
        // Validation error came from the profile step — send the user back
        // so they can correct the offending field.
        setErr(e.message);
        nav(`/gateway/billing/checkout/${plan.id}`, { state: { form, fee, plan } });
        return;
      } else {
        setErr(e.message || 'Could not start the payment.');
      }
      setSaving(false);
    }
  };

  return (
    <div className="gw-page gw-checkout">
      <CheckoutSteps current={2} />

      <div className="gw-checkout-grid">
        <div className="gw-card gw-checkout-form-card">
          <div className="gw-card-h">
            <div>
              <h2 style={{ margin: 0 }}>Confirm purchase</h2>
              <p className="gw-muted" style={{ margin: '4px 0 0' }}>Review your details and the plan amount before paying.</p>
            </div>
          </div>

          {err && <div className="gw-alert error"><span>{err}</span></div>}

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
            <button type="button" className="gw-btn-ghost xs gw-confirm-edit" onClick={goBack} disabled={saving}>
              Edit details
            </button>
          </div>

          <div className="gw-confirm-block">
            <div className="gw-confirm-block-h">Selected plan</div>
            <div className="gw-confirm-plan">
              <div>
                <b>{plan.name}</b>
                <div className="gw-muted" style={{ fontSize: 12 }}>
                  {labelMethod(plan.method_access)} · {plan.duration_days >= 200 ? '1 year' : `${plan.duration_days} days`}
                </div>
              </div>
              <div className="gw-confirm-amt">₹{planPrice.toFixed(2)}</div>
            </div>
          </div>

          <div className="gw-checkout-actions">
            <button type="button" className="gw-btn-ghost" onClick={goBack} disabled={saving}>Back</button>
            <button type="button" className="gw-btn-primary" onClick={confirm} disabled={saving}>
              {saving ? 'Starting…' : `Confirm & pay ₹${total.toFixed(2)}`}
            </button>
          </div>
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

          <Link to="/gateway/billing" className="gw-checkout-back">← Back to plans</Link>
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
