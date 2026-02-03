import { BrowserRouter as Router, Routes, Route,  Navigate, useLocation } from 'react-router-dom';
import Navigation from './components/Navigation';
import SystemConfig from './pages/SystemConfig';
import Home from './pages/Home';
import { apiClient } from './api/client';

import RaceDetails from './pages/RaceDetails';
import RaceControl from './pages/RaceControl';
import Observation from './pages/Observation';

import { useState, useEffect } from 'react';



function ProtectedRoute({ children }: { children: JSX.Element }) {
    const [loading, setLoading] = useState(true);
    const [initialized, setInitialized] = useState(false);
    const location = useLocation();

    useEffect(() => {
        const checkStatus = async () => {
             try {
                const status = await apiClient.get('/config/initial');
                setInitialized(status.initialized);
             } catch (e) {
                 console.error("Failed to check init status", e);
             } finally {
                 setLoading(false);
             }
        };
        checkStatus();
    }, []);

    if (loading) return <div>Loading...</div>;

    if (!initialized && location.pathname !== '/system-config') {
        return <Navigate to="/system-config" replace />;
    }
    
    // Allow initialized users to visit system-config (Edit Mode)
    // Removed the redirect away from config page logic.

    return children;
}

function App() {
  return (
    <Router>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navigation />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/system-config" element={<ProtectedRoute><SystemConfig /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/race/:raceId" element={<ProtectedRoute><RaceDetails /></ProtectedRoute>} />
            <Route path="/race/:raceId/checkin" element={<Navigate to="../" relative="path" replace />} />
            <Route path="/race/:raceId/control" element={<ProtectedRoute><RaceControl /></ProtectedRoute>} />
            <Route path="/race/:raceId/observation" element={<ProtectedRoute><Observation /></ProtectedRoute>} />

            {/* Legacy Redirects or Handle 404 */}
            <Route path="/checkin" element={<Navigate to="/" replace />} />
            <Route path="/control" element={<Navigate to="/" replace />} />
            <Route path="/observation" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
