import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet } from './api';
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
  const nav = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<any>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [p, m] = await Promise.all([apiGet('/api/billing/plans'), apiGet('/api/billing/me')]);
      setPlans(p.items || []);
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

  const onChoose = (plan: Plan) => {
    setErr('');
    nav(`/gateway/billing/checkout/${plan.id}`);
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
                  onClick={() => onChoose(p)}
                >
                  {sub ? 'Switch / renew' : 'Choose plan'}
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
