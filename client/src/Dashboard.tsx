import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet, gwPost } from './api';
import { useGwAuth } from './AuthCtx';

type DayPoint = { day: string; revenue: number; paid: number; total: number };
type Window30 = { total: number; paid: number; pending: number; failed: number; revenue: number; aov: number; success_rate: number };
type Prev30 = { total: number; paid: number; revenue: number; aov: number };
type PendingOrder = {
  id: number;
  txn_ref: string;
  client_order_id: string | null;
  amount: string | number;
  currency: string;
  created_at: string;
  expires_at: string | null;
  order_mode: string;
};

interface Dash {
  stats: { total: number; paid: number; pending: number; failed: number; revenue: number };
  last_30: Window30;
  prev_30: Prev30;
  series_30: DayPoint[];
  pending_orders: PendingOrder[];
  recent: any[];
  setup_complete: boolean;
  has_token: boolean;
}

function fmtINR(n: number): string {
  return '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: number): string {
  if (!n) return '₹0';
  if (n >= 10_000_000) return '₹' + (n / 10_000_000).toFixed(2) + ' Cr';
  if (n >= 100_000) return '₹' + (n / 100_000).toFixed(2) + ' L';
  if (n >= 1_000) return '₹' + (n / 1_000).toFixed(1) + 'K';
  return '₹' + n.toFixed(0);
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

export default function GwDashboard() {
  const { user } = useGwAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState('');
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const load = () => gwGet('/dashboard').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="gw-page"><div className="gw-alert error"><span>{err}</span></div></div>;
  if (!data) return <div className="gw-loading">Loading…</div>;

  const setupComplete = !!data.setup_complete;
  const hasToken = !!data.has_token;
  const sub = user?.active_subscription;
  const planLocked = !user?.is_owner && !sub;

  const refreshPending = async (id: number) => {
    setRefreshingId(id);
    try { await gwPost(`/orders/${id}/refresh`, {}); await load(); }
    catch { /* swallow — the panel still shows the row */ }
    finally { setRefreshingId(null); }
  };

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Overview</h2>
          <p>Revenue, orders and pending action — at a glance.</p>
        </div>
        <div className="gw-status-pills">
          {!user?.is_owner && sub && <span className="gw-pill ok">Plan: {sub.plan_name}</span>}
          {setupComplete && <span className="gw-pill ok">Setup complete</span>}
          {hasToken && <span className="gw-pill ok">Token ready</span>}
        </div>
      </div>

      {planLocked && <PlanLockCard />}

      {!planLocked && (!setupComplete || !hasToken) && (
        <SetupChecklist setupComplete={setupComplete} hasToken={hasToken} />
      )}

      <RevenueHero last30={data.last_30} prev30={data.prev_30} series={data.series_30} />

      <KpiGrid stats={data.stats} last30={data.last_30} prev30={data.prev_30} />

      <div className="gw-overview-row">
        <BreakdownCard last30={data.last_30} />
        <PendingPanel
          orders={data.pending_orders}
          refreshingId={refreshingId}
          onRefresh={refreshPending}
        />
      </div>

      <div className="gw-shortcuts">
        <Link to="/gateway/settings" className="gw-shortcut">
          <strong>UPI Setup</strong>
          <span>Paytm credentials and environment.</span>
        </Link>
        <Link to="/gateway/transactions" className="gw-shortcut">
          <strong>Transactions</strong>
          <span>Search and inspect orders.</span>
        </Link>
        <Link to="/gateway/docs" className="gw-shortcut">
          <strong>API Reference</strong>
          <span>Token, endpoints and examples.</span>
        </Link>
        <Link to="/gateway/billing" className="gw-shortcut">
          <strong>Billing</strong>
          <span>Plans, current subscription and invoices.</span>
        </Link>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Recent orders
          </h3>
          <Link to="/gateway/transactions">View all</Link>
        </div>
        {data.recent.length === 0 ? (
          <div className="gw-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <h3>No orders yet</h3>
            <p>New orders will appear here.</p>
          </div>
        ) : (
          <div className="gw-table">
            <div className="gw-tr head">
              <span>Txn Ref</span><span>Order ID</span><span>Mode</span><span>Amount</span><span>Status</span><span>Created</span>
            </div>
            {data.recent.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span data-label="Txn Ref" className="mono small">{o.txn_ref}</span>
                <span data-label="Order ID">{o.client_order_id || `#${o.id}`}</span>
                <span data-label="Mode"><ModeBadge mode={o.order_mode || 'hosted'} /></span>
                <span data-label="Amount" style={{ fontWeight: 700 }}>₹{parseFloat(o.amount).toFixed(2)}</span>
                <span data-label="Status"><StatusBadge status={o.status} /></span>
                <span data-label="Created" className="gw-muted" style={{ fontSize: 12, margin: 0 }}>{new Date(o.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function PlanLockCard() {
  return (
    <div className="gw-card feature gw-lock-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Choose a plan to start
        </h3>
      </div>
      <p>UPI setup, API tokens, and order creation unlock once you have an active plan.</p>
      <div className="gw-actions">
        <Link to="/gateway/billing" className="gw-btn-primary">View plans →</Link>
      </div>
    </div>
  );
}

function SetupChecklist({ setupComplete, hasToken }: { setupComplete: boolean; hasToken: boolean }) {
  return (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Get started
        </h3>
      </div>
      <div className="gw-setup">
        <div className={`gw-setup-row${setupComplete ? ' done' : ''}`}>
          <div className="gw-setup-dot">{setupComplete ? '✓' : '1'}</div>
          <div className="gw-setup-text">
            <strong>Connect Paytm UPI</strong>
            <span>Add your UPI ID, Merchant ID and Key.</span>
          </div>
          <Link to="/gateway/settings">{setupComplete ? 'Edit' : 'Set up →'}</Link>
        </div>
        <div className={`gw-setup-row${hasToken ? ' done' : ''}`}>
          <div className="gw-setup-dot">{hasToken ? '✓' : '2'}</div>
          <div className="gw-setup-text">
            <strong>Create your API token</strong>
            <span>Required to call the gateway API.</span>
          </div>
          <Link to="/gateway/docs">{hasToken ? 'View' : 'Create →'}</Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Hero band: 30-day revenue headline with a delta vs the prior 30 days
 * and an inline SVG sparkline. No chart library — keeps the bundle tiny
 * and renders identically on every browser.
 */
function RevenueHero({ last30, prev30, series }: { last30: Window30; prev30: Prev30; series: DayPoint[] }) {
  const delta = pctDelta(last30.revenue, prev30.revenue);
  const peak = useMemo(() => series.reduce((m, p) => Math.max(m, p.revenue), 0), [series]);

  return (
    <div className="gw-hero-card">
      <div className="gw-hero-l">
        <div className="gw-hero-eyebrow">Revenue · last 30 days</div>
        <div className="gw-hero-value">{fmtINR(last30.revenue)}</div>
        <div className="gw-hero-meta">
          <DeltaPill delta={delta} />
          <span className="gw-muted">vs prior 30 days · {fmtCompact(prev30.revenue)}</span>
        </div>
        <div className="gw-hero-mini">
          <MiniStat label="Paid orders" value={last30.paid.toLocaleString('en-IN')} />
          <MiniStat label="AOV" value={fmtCompact(last30.aov)} />
          <MiniStat label="Success rate" value={(last30.success_rate || 0).toFixed(1) + '%'} />
        </div>
      </div>
      <div className="gw-hero-r">
        <Sparkline series={series} peak={peak} />
        <div className="gw-spark-foot">
          <span>30 days ago</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="gw-mini-stat">
      <div className="gw-mini-l">{label}</div>
      <div className="gw-mini-v">{value}</div>
    </div>
  );
}

function DeltaPill({ delta }: { delta: { kind: 'up' | 'down' | 'flat' | 'new'; value: number } }) {
  if (delta.kind === 'new') {
    return <span className="gw-delta new" title="No revenue in the previous period">New</span>;
  }
  if (delta.kind === 'flat') {
    return <span className="gw-delta flat">— 0%</span>;
  }
  const arrow = delta.kind === 'up' ? '▲' : '▼';
  return <span className={`gw-delta ${delta.kind}`}>{arrow} {Math.abs(delta.value).toFixed(1)}%</span>;
}

function pctDelta(curr: number, prev: number): { kind: 'up' | 'down' | 'flat' | 'new'; value: number } {
  if (!prev) return { kind: curr > 0 ? 'new' : 'flat', value: 0 };
  if (curr === prev) return { kind: 'flat', value: 0 };
  const v = ((curr - prev) / prev) * 100;
  return { kind: v > 0 ? 'up' : 'down', value: v };
}

/**
 * Sparkline drawn as a single SVG path — area fill plus the line on top.
 * Empty days render as zeros so the curve is always 30 points wide.
 */
function Sparkline({ series, peak }: { series: DayPoint[]; peak: number }) {
  const W = 480, H = 120, padX = 4, padY = 8;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const n = Math.max(series.length, 1);
  const ymax = peak > 0 ? peak : 1;
  const x = (i: number) => padX + (i * innerW) / Math.max(n - 1, 1);
  const y = (v: number) => padY + innerH - (v / ymax) * innerH;

  const pts = series.map((p, i) => `${x(i).toFixed(2)},${y(p.revenue).toFixed(2)}`);
  const linePath = pts.length ? 'M ' + pts.join(' L ') : '';
  const areaPath = pts.length
    ? `${linePath} L ${x(n - 1).toFixed(2)},${(padY + innerH).toFixed(2)} L ${x(0).toFixed(2)},${(padY + innerH).toFixed(2)} Z`
    : '';

  return (
    <svg className="gw-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="30-day revenue">
      <defs>
        <linearGradient id="gw-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gw-primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--gw-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {peak === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="currentColor" opacity="0.5" fontSize="12">
          No paid orders in the last 30 days
        </text>
      )}
      {peak > 0 && <path d={areaPath} fill="url(#gw-spark-grad)" />}
      {peak > 0 && <path d={linePath} fill="none" stroke="var(--gw-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Compact KPI grid: all-time totals on the left, last-30-day deltas on
 * the right so the operator can compare current performance to lifetime.
 */
function KpiGrid({ stats, last30, prev30 }: { stats: Dash['stats']; last30: Window30; prev30: Prev30 }) {
  return (
    <div className="gw-kpi-grid">
      <KpiCard
        title="Orders (30d)"
        value={last30.total.toLocaleString('en-IN')}
        delta={pctDelta(last30.total, prev30.total)}
        sub={`${stats.total.toLocaleString('en-IN')} all-time`}
      />
      <KpiCard
        title="Paid (30d)"
        value={last30.paid.toLocaleString('en-IN')}
        delta={pctDelta(last30.paid, prev30.paid)}
        sub={`${stats.paid.toLocaleString('en-IN')} all-time`}
        accent="ok"
      />
      <KpiCard
        title="Avg order value"
        value={fmtCompact(last30.aov)}
        delta={pctDelta(last30.aov, prev30.aov)}
        sub={fmtINR(last30.aov)}
      />
      <KpiCard
        title="Success rate"
        value={(last30.success_rate || 0).toFixed(1) + '%'}
        sub={`${last30.paid} paid · ${last30.failed} failed`}
        accent={last30.success_rate >= 90 ? 'ok' : last30.success_rate >= 70 ? 'warn' : 'bad'}
      />
    </div>
  );
}

function KpiCard({
  title, value, sub, delta, accent,
}: {
  title: string;
  value: string;
  sub?: string;
  delta?: { kind: 'up' | 'down' | 'flat' | 'new'; value: number };
  accent?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className={`gw-kpi-card${accent ? ' ' + accent : ''}`}>
      <div className="gw-kpi-title">{title}</div>
      <div className="gw-kpi-value">{value}</div>
      <div className="gw-kpi-foot">
        {delta && <DeltaPill delta={delta} />}
        {sub && <span className="gw-muted">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * Status breakdown bar: one stacked horizontal segment that sums to 100%
 * across paid/pending/failed for the last 30 days. More glanceable than a
 * pie chart and reads cleanly on mobile.
 */
function BreakdownCard({ last30 }: { last30: Window30 }) {
  const total = Math.max(last30.paid + last30.pending + last30.failed, 0);
  const pct = (n: number) => total > 0 ? (n / total) * 100 : 0;
  return (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
          Status breakdown · 30 days
        </h3>
      </div>

      {total === 0 ? (
        <p className="gw-muted" style={{ margin: '4px 0 0' }}>No orders in the last 30 days.</p>
      ) : (
        <>
          <div className="gw-stack-bar" role="img" aria-label="Order status breakdown">
            <div className="gw-stack-seg ok"   style={{ width: pct(last30.paid) + '%' }} title={`Paid · ${last30.paid}`} />
            <div className="gw-stack-seg warn" style={{ width: pct(last30.pending) + '%' }} title={`Pending · ${last30.pending}`} />
            <div className="gw-stack-seg bad"  style={{ width: pct(last30.failed) + '%' }} title={`Failed · ${last30.failed}`} />
          </div>
          <div className="gw-stack-legend">
            <LegendItem dotClass="ok"   label="Paid"    value={last30.paid}    pct={pct(last30.paid)} />
            <LegendItem dotClass="warn" label="Pending" value={last30.pending} pct={pct(last30.pending)} />
            <LegendItem dotClass="bad"  label="Failed"  value={last30.failed}  pct={pct(last30.failed)} />
          </div>
        </>
      )}
    </div>
  );
}

function LegendItem({ dotClass, label, value, pct }: { dotClass: string; label: string; value: number; pct: number }) {
  return (
    <div className="gw-legend-item">
      <span className={`gw-legend-dot ${dotClass}`} />
      <span className="gw-legend-label">{label}</span>
      <span className="gw-legend-val">{value.toLocaleString('en-IN')}</span>
      <span className="gw-legend-pct">{pct.toFixed(0)}%</span>
    </div>
  );
}

function PendingPanel({
  orders, refreshingId, onRefresh,
}: {
  orders: PendingOrder[];
  refreshingId: number | null;
  onRefresh: (id: number) => void;
}) {
  return (
    <div className="gw-card">
      <div className="gw-card-h">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Pending orders
        </h3>
        <Link to="/gateway/transactions?status=pending">View all</Link>
      </div>
      {orders.length === 0 ? (
        <p className="gw-muted" style={{ margin: '4px 0 0' }}>Nothing waiting — every recent order has settled.</p>
      ) : (
        <ul className="gw-pending-list">
          {orders.map((o) => (
            <li key={o.id} className="gw-pending-row">
              <div className="gw-pending-l">
                <span className="gw-pending-amount">{fmtINR(parseFloat(String(o.amount)))}</span>
                <span className="gw-pending-ref mono small">{o.client_order_id || o.txn_ref}</span>
              </div>
              <div className="gw-pending-r">
                <span className="gw-muted gw-pending-age">{relativeAge(o.created_at)}</span>
                <button
                  type="button"
                  className="gw-btn-ghost xs"
                  onClick={() => onRefresh(o.id)}
                  disabled={refreshingId === o.id}
                >
                  {refreshingId === o.id ? 'Checking…' : 'Verify'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = ({ paid: 'ok', pending: 'warn', failed: 'bad', cancelled: 'bad', expired: 'mute' } as any)[status] || 'mute';
  return <span className={`gw-badge ${cls}`}>{status}</span>;
}

export function ModeBadge({ mode }: { mode: string }) {
  const cls = mode === 'server' ? 'mode-server' : 'mode-hosted';
  return <span className={`gw-badge ${cls}`} title={mode === 'server' ? 'Server-to-Server — JSON only' : 'Hosted Payment Page'}>{mode}</span>;
}
