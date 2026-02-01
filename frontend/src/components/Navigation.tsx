import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  const links = [
    { to: '/', label: 'Home' },
    { to: '/system-config', label: 'System Config' },
    { to: '/checkin', label: 'Check-In' },
    { to: '/control', label: 'Race Control' },
    { to: '/observation', label: 'Observation' },
  ];

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
                <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Trusty Track</span>
            </div>
          </div>
          
          {/* Desktop Links (optional, maybe hide on small screens if we want full hamburger) */}
          <div className="desktop-links" style={{ display: 'none' }}> 
             {/* Intentionally hiding for now to force hamburger usage as requested, or we can make it responsive later */}
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
        // Let's use white for cleaner look against the blue header usually, but if we want it to feel like part of the app...
        // Let's use White background with Blue text.
        backgroundColor: '#fff',
        boxShadow: '2px 0 5px rgba(0,0,0,0.2)',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease-in-out',
        zIndex: 1001,
        paddingTop: '60px', // Space for close button or just header
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
         
         <div style={{ padding: '20px' }}>
             <h2 style={{ color: 'var(--scouting-blue)', marginTop: 0 }}>Menu</h2>
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
         </div>
      </div>
    </>
  );
}
