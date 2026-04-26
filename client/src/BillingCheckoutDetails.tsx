import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiGet, ApiError } from './api';
import { useGwAuth } from './AuthCtx';
import {
  INDIAN_STATES,
  CITIES_BY_STATE,
  canonicalizeState,
  canonicalizeCity,
} from './indiaGeo';

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
  state: string;
  city: string;
  postal_code: string;
}

/**
 * A snapshot of the last successful PIN-code lookup. The form accepts a
 * non-canonical city as long as it matches the district India Post returned
 * for the user's PIN — this lets users in smaller districts that aren't in
 * our curated list still complete checkout, without giving up the "must be
 * a real place" guarantee.
 */
export interface PinVerified {
  state: string;
  city: string;
}

/**
 * Returns true when every field in the form passes the same validation
 * the user would face on submit. Used to decide whether a returning user
 * with a saved billing profile can skip the details step entirely.
 *
 * State and city are required to be REAL — they must match a canonical
 * Indian state + city, OR match a district that India Post confirmed for
 * the user's PIN. This prevents users from carrying fake address data
 * through to billing.
 */
function isFormComplete(f: CheckoutFormState, pinVerified: PinVerified | null): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return false;
  if (extractPhoneDigits(f.phone).length !== 10) return false;
  if (f.full_name.trim().length < 2) return false;
  const canonState = canonicalizeState(f.state);
  if (!canonState) return false;
  const cityTrim = f.city.trim();
  const canonCity = canonicalizeCity(cityTrim, canonState);
  const pinOk = !!(pinVerified && pinVerified.state === canonState && pinVerified.city === cityTrim);
  if (!canonCity && !pinOk) return false;
  if (!/^[1-9][0-9]{5}$/.test(f.postal_code.trim())) return false;
  return true;
}

/**
 * Extracts the 10-digit Indian mobile number out of any string the user
 * (or an older saved profile) may have given us — strips +91 / 91 country
 * codes, spaces, dashes, and parens. Returns at most 10 digits.
 */
function extractPhoneDigits(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  // If the user typed the country code, drop it so we never end up storing
  // it twice when we re-add the +91 prefix on submit.
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  return digits.slice(0, 10);
}

/** Formats the stored phone value with the fixed +91 prefix. */
function formatINPhone(digits: string): string {
  return digits ? `+91 ${digits}` : '';
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
    state: incoming?.form?.state || '',
    city: incoming?.form?.city || '',
    postal_code: incoming?.form?.postal_code || '',
  });
  const [err, setErr] = useState('');
  const [errField, setErrField] = useState('');

  // Last successful India Post lookup. Lets the form accept a non-canonical
  // district (e.g. "Hailakandi") if it matches the PIN the user typed.
  const [pinVerified, setPinVerified] = useState<PinVerified | null>(null);
  // Visible status of the most recent PIN lookup, drives the inline pill
  // shown under the postal code input.
  type PinStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; state: string; districts: string[]; chosen: string }
    | { kind: 'notfound' }
    | { kind: 'error' };
  const [pinStatus, setPinStatus] = useState<PinStatus>({ kind: 'idle' });

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
        // Snap saved state to canonical spelling. For city, prefer the
        // canonical version; if the saved city isn't in our list (e.g. a
        // small district that was previously accepted via PIN lookup), keep
        // it as-is and seed pinVerified so it still passes validation.
        const canonState = canonicalizeState(profile?.state || '');
        const rawCity = String(profile?.city || '').trim();
        const canonCity = canonicalizeCity(rawCity, canonState);
        let useCity = canonCity;
        let seededPin: PinVerified | null = null;
        if (!useCity && rawCity && canonState) {
          useCity = rawCity;
          seededPin = { state: canonState, city: rawCity };
        }
        const prefilled: CheckoutFormState = {
          email: profile?.email || user?.email || '',
          phone: profile?.phone || '',
          full_name: profile?.full_name || '',
          state: canonState,
          city: useCity,
          postal_code: profile?.postal_code || '',
        };
        setForm(prefilled);
        if (seededPin) setPinVerified(seededPin);

        // Auto-fill: if the saved profile is fully valid, skip the
        // re-entry step and send the user straight to the confirm page
        // with everything pre-loaded. They can still tap "Edit details"
        // on the confirm page to come back here.
        if (isFormComplete(prefilled, seededPin)) {
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

  // Real-time India Post PIN-code → state/city auto-fill. Whenever the user
  // types (or pastes) a complete 6-digit PIN, we wait briefly to debounce
  // their typing and then ask the server proxy to resolve it. On success we
  // overwrite state + city with the resolved values, and snapshot them so
  // they pass validation even when the district isn't in our curated list.
  useEffect(() => {
    const pin = form.postal_code.trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      // Clear any stale "loading"/"ok" pill — but keep pinVerified, since the
      // user may temporarily be editing the PIN before retyping it.
      setPinStatus((p) => (p.kind === 'idle' ? p : { kind: 'idle' }));
      return;
    }
    let aborted = false;
    setPinStatus({ kind: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const r = await apiGet(`/api/billing/pincode/${pin}`);
        if (aborted) return;
        if (!r || !r.ok) {
          setPinStatus({ kind: 'notfound' });
          return;
        }
        const apiState: string = String(r.state || '');
        const districts: string[] = Array.isArray(r.districts) ? r.districts.map((d: any) => String(d)) : [];
        const canonState = canonicalizeState(apiState);
        if (!canonState || districts.length === 0) {
          setPinStatus({ kind: 'notfound' });
          return;
        }
        // Prefer a district that exists in our curated city list (gives a
        // more familiar, cased name); fall back to the first district India
        // Post returned for this PIN.
        let chosen = '';
        for (const d of districts) {
          const c = canonicalizeCity(d, canonState);
          if (c) { chosen = c; break; }
        }
        if (!chosen) chosen = districts[0];
        setForm((f) => ({ ...f, state: canonState, city: chosen }));
        setPinVerified({ state: canonState, city: chosen });
        setPinStatus({ kind: 'ok', state: canonState, districts, chosen });
        // Clear any inline form error tied to state/city the moment the PIN
        // resolves them for us.
        setErrField((ef) => (ef === 'state' || ef === 'city' ? '' : ef));
      } catch {
        if (!aborted) setPinStatus({ kind: 'error' });
      }
    }, 350);
    return () => { aborted = true; clearTimeout(timer); };
  }, [form.postal_code]);

  // When the user picks a different district from the multi-result list, swap
  // the city in-place and update the verified snapshot too.
  const choosePinDistrict = (district: string) => {
    if (pinStatus.kind !== 'ok') return;
    const c = canonicalizeCity(district, pinStatus.state) || district;
    setForm((f) => ({ ...f, city: c }));
    setPinVerified({ state: pinStatus.state, city: c });
    setPinStatus({ ...pinStatus, chosen: c });
  };

  const planPrice = plan ? (plan.discount_price ?? plan.price) : 0;
  const total = useMemo(() => Math.round((planPrice + (fee || 0)) * 100) / 100, [planPrice, fee]);

  const set = (k: keyof CheckoutFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): { ok: boolean; field?: string; message?: string } => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return { ok: false, field: 'email', message: 'Enter a valid email address.' };
    const phoneDigits = extractPhoneDigits(form.phone);
    if (phoneDigits.length !== 10) return { ok: false, field: 'phone', message: 'Enter a 10-digit mobile number.' };
    if (form.full_name.trim().length < 2) return { ok: false, field: 'full_name', message: 'Name is required.' };
    const canonState = canonicalizeState(form.state);
    if (!canonState) return { ok: false, field: 'state', message: 'Please pick your state from the list.' };
    const cityTrim = form.city.trim();
    const canonCity = canonicalizeCity(cityTrim, canonState);
    const pinOk = !!(pinVerified && pinVerified.state === canonState && pinVerified.city === cityTrim);
    if (!canonCity && !pinOk) return { ok: false, field: 'city', message: `Please pick a city in ${canonState} from the list, or enter a PIN to auto-fill it.` };
    if (!/^[1-9][0-9]{5}$/.test(form.postal_code.trim())) return { ok: false, field: 'postal_code', message: 'Indian PIN code must be 6 digits.' };
    return { ok: true };
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setErrField('');
    const v = validate();
    if (!v.ok) { setErr(v.message || 'Please check the form.'); setErrField(v.field || ''); return; }
    if (!plan) return;

    const canonState = canonicalizeState(form.state);
    const canonCity = canonicalizeCity(form.city, canonState);
    // If the city isn't in our curated list it must have come through PIN
    // verification — keep the trimmed user value, which equals the India
    // Post district name.
    const finalCity = canonCity || form.city.trim();
    const cleaned: CheckoutFormState = {
      email: form.email.trim().toLowerCase(),
      phone: formatINPhone(extractPhoneDigits(form.phone)),
      full_name: form.full_name.trim(),
      state: canonState,
      city: finalCity,
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

      <CheckoutSummaryMini plan={plan} planPrice={planPrice} fee={fee} total={total} hideTrustFooter />

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
                placeholder="you@gmail.com"
                maxLength={255}
                readOnly
                aria-readonly="true"
                title="This email is linked to your account and can't be changed here."
                className="gw-input-locked"
                required
              />
            </label>
            <label className={errField === 'phone' ? 'err' : ''}>
              <span>Mobile number *</span>
              <div className="gw-phone-input">
                <span className="gw-phone-prefix" aria-hidden="true">+91</span>
                <input
                  value={extractPhoneDigits(form.phone)}
                  onChange={(e) => {
                    const digits = extractPhoneDigits(e.target.value);
                    set('phone', formatINPhone(digits));
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData('text');
                    const digits = extractPhoneDigits(text);
                    set('phone', formatINPhone(digits));
                  }}
                  placeholder="98xxxxxxxx"
                  maxLength={10}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  aria-label="Mobile number, 10 digits, India"
                  required
                />
              </div>
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
            <div className="gw-address-block">
              <div className="gw-address-head">
                <span className="gw-address-title">Address</span>
                <span className="gw-address-sub">Type your PIN — we'll fill state &amp; city for you.</span>
              </div>

              <label className={`gw-address-pin${errField === 'postal_code' ? ' err' : ''}`}>
                <span>PIN code *</span>
                <div className={`gw-pin-input${pinStatus.kind === 'ok' ? ' ok' : ''}${pinStatus.kind === 'loading' ? ' loading' : ''}${pinStatus.kind === 'notfound' || pinStatus.kind === 'error' ? ' warn' : ''}`}>
                  <input
                    value={form.postal_code}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D+/g, '').slice(0, 6);
                      set('postal_code', next);
                    }}
                    placeholder="6-digit PIN code"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[1-9][0-9]{5}"
                    autoComplete="postal-code"
                    aria-describedby="gw-pin-help"
                    required
                  />
                  <span className="gw-pin-input-end" aria-hidden="true">
                    {pinStatus.kind === 'loading' && <span className="gw-pin-spin" />}
                    {pinStatus.kind === 'ok' && (
                      <svg className="gw-pin-input-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    {(pinStatus.kind === 'notfound' || pinStatus.kind === 'error') && (
                      <svg className="gw-pin-input-warn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 8v4" />
                        <path d="M12 16h.01" />
                      </svg>
                    )}
                  </span>
                </div>
                <span id="gw-pin-help" className="gw-pin-help">
                  {pinStatus.kind === 'notfound' && 'No postal records for this PIN — pick state and city manually.'}
                  {pinStatus.kind === 'error' && 'PIN lookup unavailable — pick state and city manually.'}
                  {pinStatus.kind !== 'notfound' && pinStatus.kind !== 'error' && 'Enter a valid 6-digit Indian PIN code.'}
                </span>
              </label>

              <div className="gw-form-row">
                <label className={errField === 'state' ? 'err' : ''}>
                  <span>State *</span>
                  <StateInput
                    value={form.state}
                    onChange={(v) => {
                      setForm((f) => ({
                        ...f,
                        state: v,
                        city: canonicalizeCity(f.city, canonicalizeState(v)),
                      }));
                    }}
                  />
                </label>
                <label className={errField === 'city' ? 'err' : ''}>
                  <span>City *</span>
                  <CityInput
                    value={form.city}
                    onChange={(v) => set('city', v)}
                    state={canonicalizeState(form.state)}
                  />
                </label>
              </div>

              {pinStatus.kind === 'ok' && pinStatus.districts.length > 1 && (
                <div className="gw-pin-alts-row" role="group" aria-label="Other districts for this PIN">
                  <span className="gw-pin-alts-lbl">Other districts for this PIN:</span>
                  {pinStatus.districts
                    .filter((d) => d.toLowerCase() !== pinStatus.chosen.toLowerCase())
                    .slice(0, 3)
                    .map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="gw-pin-chip"
                        onClick={() => choosePinDistrict(d)}
                      >
                        {d}
                      </button>
                    ))}
                </div>
              )}
            </div>

          <div className="gw-checkout-actions">
            <Link to="/gateway/billing" className="gw-btn-ghost">Cancel</Link>
            <button type="submit" className="gw-btn-primary">Continue</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Premium order-summary card shown at the top of both checkout steps.
 * Renders the plan identity, included features (when available), an
 * itemised price breakdown, and a prominent total — all wrapped in a
 * single polished card so the user always sees what they're paying for.
 *
 * The Confirm page passes a slimmer plan object (no description/features),
 * so those fields are optional and degrade gracefully.
 */
export function CheckoutSummaryMini({
  plan, planPrice, fee, total, hideTrustFooter = false,
}: {
  plan: {
    name: string;
    method_access: string;
    duration_days: number;
    price?: number;
    discount_price?: number | null;
    is_featured?: boolean;
    description?: string | null;
    features?: string[];
  };
  planPrice: number;
  fee: number;
  total: number;
  hideTrustFooter?: boolean;
}) {
  const duration = plan.duration_days >= 200 ? '1 year' : `${plan.duration_days} days`;
  const list = (plan.features || []).filter(Boolean).slice(0, 4);
  const hasDiscount =
    typeof plan.price === 'number' &&
    typeof plan.discount_price === 'number' &&
    plan.discount_price !== null &&
    plan.discount_price < plan.price;
  const savings = hasDiscount ? Math.max(0, (plan.price as number) - (plan.discount_price as number)) : 0;
  const savingsPct = hasDiscount && (plan.price as number) > 0
    ? Math.round((savings / (plan.price as number)) * 100)
    : 0;

  return (
    <section className="gw-card gw-checkout-mini" role="region" aria-label="Order summary">
      <header className="gw-co-mini-head">
        <div className="gw-co-mini-eyebrow">
          <span className="gw-co-mini-eyebrow-dot" aria-hidden="true" />
          Order summary
        </div>
        {plan.is_featured && (
          <span className="gw-co-mini-badge" title="Featured plan">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.6 6.3 6.8.55-5.18 4.43 1.6 6.62L12 16.9l-5.82 3.5 1.6-6.62L2.6 9.35l6.8-.55L12 2.5z" />
            </svg>
            Featured
          </span>
        )}
      </header>

      <div className="gw-co-mini-plan">
        <div className="gw-co-mini-plan-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div className="gw-co-mini-plan-text">
          <h3 className="gw-co-mini-name">{plan.name}</h3>
          {plan.description && (
            <p className="gw-co-mini-desc">{plan.description}</p>
          )}
          <div className="gw-co-mini-tags">
            <span className="gw-co-mini-tag">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 10h18" />
              </svg>
              {labelMethod(plan.method_access)}
            </span>
            <span className="gw-co-mini-tag">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {duration} access
            </span>
          </div>
        </div>
      </div>

      {list.length > 0 && (
        <ul className="gw-co-mini-feats" aria-label="What's included">
          {list.map((f) => (
            <li key={f}>
              <svg className="gw-co-mini-feats-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="gw-co-mini-rule" aria-hidden="true" />

      <dl className="gw-co-mini-rows">
        <div className="gw-co-mini-row">
          <dt>Plan price</dt>
          <dd>
            {hasDiscount && (
              <s className="gw-co-mini-strike">₹{(plan.price as number).toFixed(2)}</s>
            )}
            <span>₹{planPrice.toFixed(2)}</span>
          </dd>
        </div>
        {hasDiscount && (
          <div className="gw-co-mini-row gw-co-mini-row-save">
            <dt>
              You save
              {savingsPct > 0 && <span className="gw-co-mini-save-pct">{savingsPct}% off</span>}
            </dt>
            <dd>−₹{savings.toFixed(2)}</dd>
          </div>
        )}
        <div className="gw-co-mini-row">
          <dt>Platform fee</dt>
          <dd>{fee > 0 ? `₹${fee.toFixed(2)}` : <span className="gw-co-mini-free">Included</span>}</dd>
        </div>
      </dl>

      <div className="gw-co-mini-total">
        <div className="gw-co-mini-total-l">
          <span className="gw-co-mini-total-lbl">Total due today</span>
          <span className="gw-co-mini-total-sub">One-time payment · INR</span>
        </div>
        <div className="gw-co-mini-total-r">
          <span className="gw-co-mini-total-cur">₹</span>
          <span className="gw-co-mini-total-amt">{total.toFixed(2)}</span>
        </div>
      </div>

      {!hideTrustFooter && (
        <footer className="gw-co-mini-foot">
          <span className="gw-co-mini-trust">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
            Secure SSL checkout
          </span>
          <span className="gw-co-mini-trust-sep" aria-hidden="true">·</span>
          <span className="gw-co-mini-trust">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
            </svg>
            Encrypted payment
          </span>
          <span className="gw-co-mini-trust-sep" aria-hidden="true">·</span>
          <span className="gw-co-mini-trust">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 8v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8" />
              <path d="M3 8l9 6 9-6" />
              <path d="M3 8a2 2 0 012-2h14a2 2 0 012 2" />
            </svg>
            Receipt emailed
          </span>
        </footer>
      )}
    </section>
  );
}

function labelMethod(m: string) {
  if (m === 'server') return 'Server API only';
  if (m === 'hosted') return 'Hosted Pay Page only';
  if (m === 'master') return 'Server + Hosted (all features)';
  return m;
}

/**
 * Shared geography autocomplete used by both the State and City pickers.
 * Filters a fixed source list by prefix-first then substring, highlights
 * the matched portion, supports full keyboard navigation, and — critically
 * — when the input is empty + focused it shows the full list so the user
 * can browse and pick. Free-typed values are not validated here; the form's
 * `validate()` rejects anything not on the canonical list before submit.
 */
function GeoAutocomplete({
  value,
  onChange,
  source,
  disabled,
  placeholder,
  emptyLabel,
  ariaLabel,
  autoComplete,
  iconKind,
}: {
  value: string;
  onChange: (v: string) => void;
  source: readonly string[];
  disabled?: boolean;
  placeholder: string;
  emptyLabel: string;
  ariaLabel: string;
  autoComplete: string;
  iconKind: 'pin' | 'flag';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const q = value.trim().toLowerCase();

  const matches = useMemo(() => {
    // Empty input + open dropdown → show the first slice of the full list
    // so the user can simply browse without having to guess a starting letter.
    if (!q) return source.slice(0, 8);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const c of source) {
      const lc = c.toLowerCase();
      if (lc.startsWith(q)) starts.push(c);
      else if (lc.includes(q)) contains.push(c);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [q, source]);

  const showList = open && !disabled && matches.length > 0;

  // Close the dropdown when the user clicks anywhere outside the wrapper.
  useEffect(() => {
    function onDocPointer(e: MouseEvent | TouchEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, []);

  // Keep the active item in view as the user arrows through the list.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLLIElement>(`li[data-idx="${active}"]`);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const select = (item: string) => {
    onChange(item);
    setOpen(false);
    setActive(-1);
    // Move focus back to the input so the user can keep tabbing through the form.
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      if (!showList && matches.length) { setOpen(true); setActive(0); e.preventDefault(); return; }
      if (showList) { setActive((a) => Math.min(matches.length - 1, a + 1)); e.preventDefault(); }
    } else if (e.key === 'ArrowUp') {
      if (showList) { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && active < matches.length) {
        e.preventDefault();
        select(matches[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) { setOpen(false); setActive(-1); e.stopPropagation(); }
    } else if (e.key === 'Tab') {
      setOpen(false); setActive(-1);
    }
  };

  // Highlights the matched substring inside a suggestion label.
  const renderMatch = (c: string) => {
    if (!q) return c;
    const lc = c.toLowerCase();
    const i = lc.indexOf(q);
    if (i < 0) return c;
    return (
      <>
        {c.slice(0, i)}
        <mark className="gw-city-mark">{c.slice(i, i + q.length)}</mark>
        {c.slice(i + q.length)}
      </>
    );
  };

  const PinIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
  const FlagIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V4" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </svg>
  );
  const HeaderIcon = iconKind === 'flag' ? FlagIcon : PinIcon;

  return (
    <div className={`gw-city-wrap${showList ? ' open' : ''}${disabled ? ' is-disabled' : ''}`} ref={wrapRef}>
      <div className="gw-city-field">
        <span className="gw-city-icon" aria-hidden="true">{HeaderIcon}</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { if (disabled) return; onChange(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onKeyDown={onKey}
          placeholder={placeholder}
          maxLength={120}
          autoComplete={autoComplete}
          spellCheck={false}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="gw-city-listbox"
          aria-activedescendant={showList && active >= 0 ? `gw-city-opt-${active}` : undefined}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          required
        />
      </div>
      {showList && (
        <ul
          id="gw-city-listbox"
          className="gw-city-list"
          ref={listRef}
          role="listbox"
        >
          {matches.map((c, i) => (
            <li
              key={c}
              id={`gw-city-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              className={`gw-city-opt${i === active ? ' on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="gw-city-opt-pin">{iconKind === 'flag' ? FlagIcon : PinIcon}</span>
              <span className="gw-city-opt-name">{renderMatch(c)}</span>
              <span className="gw-city-opt-tag">India</span>
            </li>
          ))}
        </ul>
      )}
      {disabled && (
        <p className="gw-city-hint">{emptyLabel}</p>
      )}
    </div>
  );
}

/**
 * State picker — autocomplete bound to the canonical INDIAN_STATES list.
 * Required to be picked from the list; free-typed values won't pass the
 * form's `validate()` step.
 */
function StateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <GeoAutocomplete
      value={value}
      onChange={onChange}
      source={INDIAN_STATES}
      placeholder="Start typing your state"
      emptyLabel=""
      ariaLabel="State"
      autoComplete="address-level1"
      iconKind="flag"
    />
  );
}

/**
 * City picker — autocomplete bound to the cities of the currently-selected
 * state. Disabled until a state is chosen, since the city list is meaningless
 * without one. Required to be picked from the list.
 */
function CityInput({
  value,
  onChange,
  state,
}: {
  value: string;
  onChange: (v: string) => void;
  state: string;
}) {
  const source = state ? (CITIES_BY_STATE[state] || []) : [];
  return (
    <GeoAutocomplete
      value={value}
      onChange={onChange}
      source={source}
      disabled={!state}
      placeholder={state ? `Start typing a city in ${state}` : 'Select a state first'}
      emptyLabel="Pick your state above to see matching cities."
      ariaLabel="City"
      autoComplete="address-level2"
      iconKind="pin"
    />
  );
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
