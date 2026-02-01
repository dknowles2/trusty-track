import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import InitialSetup from './pages/InitialSetup';
import { apiClient } from './api/client';

// Placeholder components
const Home = () => (
  <div className="container">
    <h1>Welcome to Trusty Track</h1>
    <p>Select an option below to get started.</p>
    <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <Link to="/setup" className="secondary-btn" style={{textAlign: 'center', textDecoration: 'none'}}>Race Setup</Link>
        <Link to="/checkin" className="secondary-btn" style={{textAlign: 'center', textDecoration: 'none'}}>Check-In</Link>
        <Link to="/control" className="secondary-btn" style={{textAlign: 'center', textDecoration: 'none'}}>Race Control</Link>
        <Link to="/observation" className="secondary-btn" style={{textAlign: 'center', textDecoration: 'none'}}>Observation</Link>
    </div>
  </div>
);

const RaceSetup = () => <div className="container"><h1>Race Setup</h1><p>Configuration options go here.</p></div>;
const CheckIn = () => <div className="container"><h1>Check-In</h1><p>Racer check-in interface.</p></div>;
const RaceControl = () => <div className="container"><h1>Race Control</h1><p>Manage heats and start races.</p></div>;
const Observation = () => <div className="container"><h1>Observation</h1><p>Public display view.</p></div>;

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

    if (!initialized && location.pathname !== '/initial-setup') {
        return <Navigate to="/initial-setup" replace />;
    }
    
    if (initialized && location.pathname === '/initial-setup') {
         return <Navigate to="/" replace />;
    }

    return children;
}

function App() {
  return (
    <Router>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <nav style={{ backgroundColor: 'var(--scouting-blue)', padding: '1rem', color: 'white' }}>
            <div className="container" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Trusty Track</span>
                <div>
                     <Link to="/" style={{ color: 'white', marginRight: '1rem', textDecoration: 'none' }}>Home</Link>
                     <Link to="/setup" style={{ color: 'white', marginRight: '1rem', textDecoration: 'none' }}>Setup</Link>
                </div>
            </div>
        </nav>
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/initial-setup" element={<ProtectedRoute><InitialSetup /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/setup" element={<ProtectedRoute><RaceSetup /></ProtectedRoute>} />
            <Route path="/checkin" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />
            <Route path="/control" element={<ProtectedRoute><RaceControl /></ProtectedRoute>} />
            <Route path="/observation" element={<ProtectedRoute><Observation /></ProtectedRoute>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
