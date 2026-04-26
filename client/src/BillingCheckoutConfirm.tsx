import React, { useState } from 'react';
import { useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import { apiPost, ApiError } from './api';
import { CheckoutSteps, CheckoutSummaryMini, type CheckoutFormState } from './BillingCheckoutDetails';

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
    // Pass `edit: true` so the details step knows the user is intentionally
    // editing and shouldn't auto-skip back here even if the saved profile
    // is technically complete.
    nav(`/gateway/billing/checkout/${plan.id}`, { state: { form, fee, plan, edit: true } });
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
        state: form.state,
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

      <CheckoutSummaryMini plan={plan} planPrice={planPrice} fee={fee} total={total} />

      <div className="gw-card gw-checkout-form-card">
        <div className="gw-card-h">
          <div>
            <h2 style={{ margin: 0 }}>Confirm purchase</h2>
            <p className="gw-muted" style={{ margin: '4px 0 0' }}>Review your details and the plan amount before paying.</p>
          </div>
        </div>

        {err && <div className="gw-alert error"><span>{err}</span></div>}

        <div className="gw-confirm-block">
          <div className="gw-confirm-block-h gw-confirm-block-h-row">
            <span>Billing to</span>
            <button
              type="button"
              className="gw-confirm-edit-btn"
              onClick={goBack}
              disabled={saving}
              aria-label="Edit billing details"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
              Edit details
            </button>
          </div>
          <div className="gw-confirm-rows">
            <div><span>Name</span><b>{form.full_name}</b></div>
            <div><span>Email</span><b>{form.email}</b></div>
            <div><span>Mobile</span><b>{form.phone}</b></div>
            <div><span>Country</span><b>India</b></div>
            <div><span>City</span><b>{form.city}</b></div>
            <div><span>State</span><b>{form.state}</b></div>
            <div><span>Postal / ZIP</span><b>{form.postal_code}</b></div>
          </div>
        </div>

        <div className="gw-checkout-actions">
          <button type="button" className="gw-btn-ghost" onClick={goBack} disabled={saving}>Back</button>
          <button type="button" className="gw-btn-primary" onClick={confirm} disabled={saving}>
            {saving ? 'Starting…' : `Confirm & pay ₹${total.toFixed(2)}`}
          </button>
        </div>
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
