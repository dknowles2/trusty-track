import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

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
            <Route path="/" element={<Home />} />
            <Route path="/setup" element={<RaceSetup />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/control" element={<RaceControl />} />
            <Route path="/observation" element={<Observation />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
