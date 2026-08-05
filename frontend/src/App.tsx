import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navigation from './features/core/components/Navigation';
import SystemSettings from './features/settings/pages/SystemSettings';
import Home from './features/management/pages/Home';
import { useQuery } from 'urql';
import { AlertProvider } from './context/AlertContext';
import { SerialProxyProvider } from './context/SerialProxyContext';

import RaceDetails from './features/management/pages/RaceDetails';
import RaceControl from './features/racing/pages/RaceControl';
import Observation from './features/observation/pages/Observation';
import Standings from './features/stats/pages/Standings';
import RaceStats from './features/stats/pages/RaceStats';
import Printables from './features/printables/pages/Printables';
import TimerDiagnostics from './features/settings/pages/TimerDiagnostics';

import { INITIAL_CONFIG_QUERY } from './features/core/graphql/queries';

// No React hooks needed anymore in this file



function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const [result] = useQuery({
    query: INITIAL_CONFIG_QUERY,
    requestPolicy: 'network-only' // Fresh check on navigation
  });

  const { data, fetching, error } = result;

  if (fetching) return <div>Loading...</div>;

  if (error) {
    console.error("Failed to check init status", error);
  }

  const initialized = data?.initialConfig?.initialized ?? false;

  if (!initialized && location.pathname !== '/system-settings') {
    return <Navigate to="/system-settings" replace />;
  }

  return children;
}

function App() {
  return (
    <AlertProvider>
      <SerialProxyProvider>
        <Router>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navigation />
            <main style={{ flex: 1 }}>
              <Routes>
                <Route path="/system-settings" element={<ProtectedRoute><SystemSettings /></ProtectedRoute>} />
                <Route path="/system-config" element={<Navigate to="/system-settings" replace />} />
                <Route path="/timer-check" element={<ProtectedRoute><TimerDiagnostics /></ProtectedRoute>} />
                <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
                <Route path="/race/:raceId" element={<ProtectedRoute><RaceDetails /></ProtectedRoute>} />
                <Route path="/race/:raceId/standings" element={<ProtectedRoute><Standings /></ProtectedRoute>} />
                <Route path="/race/:raceId/stats" element={<ProtectedRoute><RaceStats /></ProtectedRoute>} />
                <Route path="/race/:raceId/print" element={<ProtectedRoute><Printables /></ProtectedRoute>} />
                <Route path="/race/:raceId/checkin" element={<Navigate to="../" relative="path" replace />} />
                <Route path="/race/:raceId/control/:tab?" element={<ProtectedRoute><RaceControl /></ProtectedRoute>} />
                <Route path="/race/:raceId/observation" element={<ProtectedRoute><Observation /></ProtectedRoute>} />

                {/* Legacy Redirects or Handle 404 */}
                <Route path="/checkin" element={<Navigate to="/" replace />} />
                <Route path="/control" element={<Navigate to="/" replace />} />
                <Route path="/observation" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </Router>
      </SerialProxyProvider>
    </AlertProvider>
  );
}

export default App;
