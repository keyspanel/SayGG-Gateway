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

function FullBoot() {
  return <div className="gw-fullboot" aria-label="Loading" />;
}

function PrivateRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useGwAuth();
  if (loading) return <FullBoot />;
  if (!user) return <Navigate to="/gateway/login" replace />;
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
        </Route>

        <Route path="*" element={<Navigate to="/gateway" replace />} />
      </Routes>
    </GwAuthProvider>
  );
}
