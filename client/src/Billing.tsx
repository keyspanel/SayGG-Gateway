import React, { useEffect, useState } from 'react';
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

export default function Billing() {
  const { user, refresh } = useGwAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

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

  const buy = async (planId: number) => {
    setBusy(planId); setErr('');
    try {
      const order = await apiPost('/api/billing/purchase', { plan_id: planId });
      window.location.href = `/billing/pay/${order.public_token}`;
    } catch (e: any) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'PLATFORM_PAYMENT_NOT_CONFIGURED') {
        setErr('Plan checkout is temporarily unavailable. Please try again shortly.');
      } else {
        setErr(e.message);
      }
      setBusy(null);
    }
  };

  if (loading) return <div className="gw-loading">Loading…</div>;

  const sub = me?.active_subscription;

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

      <div className="gw-plan-grid">
        {plans.map((p) => {
          const featured = !!p.is_featured;
          const isCurrent = sub && sub.plan_id === p.id;
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
                <span className="per">/ {p.duration_days} days</span>
              </div>
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
                  onClick={() => buy(p.id)}
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
