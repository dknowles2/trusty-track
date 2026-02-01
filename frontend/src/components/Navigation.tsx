import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [races, setRaces] = useState<any[]>([]);
  const location = useLocation();

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  useEffect(() => {
    // Fetch races for the switcher
    apiClient.get('/races/').then(setRaces).catch(console.error);
  }, []);

  // Parse raceId from location
  const match = location.pathname.match(/\/race\/(\d+)/);
  const raceId = match ? match[1] : null;

  // Find active race name
  const activeRace = raceId ? races.find(r => r.id === parseInt(raceId)) : null;

  const links: { to: string; label: string }[] = [];

  if (raceId) {
      links.push(
        { to: `/race/${raceId}`, label: 'Race Details' },
        { to: `/race/${raceId}/control`, label: 'Race Control' },
        { to: `/race/${raceId}/observation`, label: 'Live Standings' }
      );
  }

  return (
    <>
      <nav style={{ backgroundColor: 'var(--scouting-blue)', padding: '1rem', color: 'white', position: 'relative', zIndex: 1000 }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              onClick={toggleMenu}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '1.5rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '5px'
              }}
              aria-label="Toggle Menu"
            >
              ☰
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <img src="/src/assets/logo.png" alt="Trusty Track Logo" style={{ height: '40px', width: 'auto' }} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', lineHeight: 1 }}>Trusty Track</span>
                  {activeRace && (
                    <span style={{ fontSize: '0.8rem', opacity: 0.9, lineHeight: 1 }}>{activeRace.name}</span>
                  )}
                </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Drawer Overlay */}
      {isOpen && (
        <div 
          onClick={closeMenu}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 999
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '250px',
        backgroundColor: '#fff',
        boxShadow: '2px 0 5px rgba(0,0,0,0.2)',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease-in-out',
        zIndex: 1001,
        paddingTop: '60px', 
        display: 'flex',
        flexDirection: 'column'
      }}>
         <button 
            onClick={closeMenu}
            style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'transparent',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#333'
            }}
         >
             ✕
         </button>
         
         <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
             
             {/* Home Link at Top */}
             <div style={{ marginBottom: '1.5rem' }}>
                <Link 
                    to="/" 
                    onClick={closeMenu}
                    style={{
                        textDecoration: 'none',
                        color: location.pathname === '/' ? 'var(--scouting-blue)' : '#333',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '1.1rem'
                    }}
                >
                    🏠 Home
                </Link>
             </div>

             {/* Race Switcher */}
             {races.length > 0 && (
               <div style={{ marginBottom: '1.5rem' }}>
                 <label style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Switch Race</label>
                 <select 
                    value={raceId || ''} 
                    onChange={(e) => {
                      if (e.target.value) {
                         window.location.href = `/race/${e.target.value}`; // Force cleanup/reload or use navigate
                         // Using href for simplicity to ensure clean state for now, or use <Link> logic?
                         // React Router navigate is better but we are in a pure nav component.
                         // Let's use window.location for hard switch to be safe with state resets
                      }
                    }}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="" disabled>Select Race...</option>
                    {races.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                 </select>
               </div>
             )}

             {links.length > 0 && (
                 <>
                    <h2 style={{ color: 'var(--scouting-blue)', marginTop: 0, fontSize: '1.2rem' }}>Menu</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {links.map(link => (
                            <Link 
                                key={link.to} 
                                to={link.to} 
                                onClick={closeMenu}
                                style={{
                                    textDecoration: 'none',
                                    color: location.pathname === link.to ? 'var(--scouting-blue)' : '#333',
                                    fontWeight: location.pathname === link.to ? 'bold' : 'normal',
                                    padding: '10px',
                                    borderRadius: '4px',
                                    backgroundColor: location.pathname === link.to ? 'var(--scout-gold)' : 'transparent'
                                }}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                 </>
             )}
             
             {/* Pinned System Settings */}
             <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
               <Link 
                  to="/system-config" 
                  onClick={closeMenu}
                  style={{
                      textDecoration: 'none',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '10px'
                  }}
               >
                 <span>⚙️</span> System Settings
               </Link>
             </div>
         </div>
      </div>
    </>
  );
}
