import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GwAuthProvider, useGwAuth } from './AuthCtx';
import GwLayout from './Layout';
import GwLogin from './Login';
import GwRegister from './Register';
import GwDashboard from './Dashboard';
import GwSettings from './Settings';
import GwTransactions from './Transactions';
import GwDocs from './Docs';
import PayPage from './PayPage';
import Billing from './Billing';
import BillingSuccess from './BillingSuccess';
import BillingPayPage from './BillingPayPage';
import OwnerPanel, {
  OwnerOverview, OwnerPlans, OwnerUsers, OwnerPlanOrders, OwnerPlatformSettings,
} from './OwnerPanel';

function FullBoot() {
  return <div className="gw-fullboot" aria-label="Loading" />;
}

function PrivateRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useGwAuth();
  if (loading) return <FullBoot />;
  if (!user) return <Navigate to="/gateway/login" replace />;
  return children;
}

function OwnerRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useGwAuth();
  if (loading) return <FullBoot />;
  if (!user) return <Navigate to="/gateway/login" replace />;
  if (!user.is_owner) return <Navigate to="/gateway" replace />;
  return children;
}

function PublicOnly({ children }: { children: React.ReactElement }) {
  const { user, loading } = useGwAuth();
  if (loading) return <FullBoot />;
  if (user) return <Navigate to="/gateway" replace />;
  return children;
}

export default function App() {
  return (
    <GwAuthProvider>
      <Routes>
        <Route path="/pay/:token" element={<PayPage />} />
        <Route path="/billing/pay/:token" element={<BillingPayPage />} />
        <Route path="/gateway/login" element={<PublicOnly><GwLogin /></PublicOnly>} />
        <Route path="/gateway/register" element={<PublicOnly><GwRegister /></PublicOnly>} />

        <Route
          path="/gateway"
          element={
            <PrivateRoute>
              <GwLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<GwDashboard />} />
          <Route path="settings" element={<GwSettings />} />
          <Route path="transactions" element={<GwTransactions />} />
          <Route path="docs" element={<GwDocs />} />
          <Route path="billing" element={<Billing />} />
          <Route path="billing/success" element={<BillingSuccess />} />

          <Route path="owner" element={<OwnerRoute><OwnerPanel /></OwnerRoute>}>
            <Route index element={<OwnerOverview />} />
            <Route path="plans" element={<OwnerPlans />} />
            <Route path="users" element={<OwnerUsers />} />
            <Route path="plan-orders" element={<OwnerPlanOrders />} />
            <Route path="platform-settings" element={<OwnerPlatformSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/gateway" replace />} />
      </Routes>
    </GwAuthProvider>
  );
}
