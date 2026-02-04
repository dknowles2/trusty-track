import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import Modal from './Modal';
import RaceForm, { RaceFormData } from './RaceForm';
import { useAlert } from '../context/AlertContext';

export default function Navigation() {
  const { showAlert } = useAlert();
  const [races, setRaces] = useState<any[]>([]);
  const [isRaceDropdownOpen, setIsRaceDropdownOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const fetchRaces = () => {
    apiClient.get('/races/').then(setRaces).catch(console.error);
  };

  useEffect(() => {
    fetchRaces();
  }, []);

  const match = location.pathname.match(/\/race\/(\d+)/);
  const raceId = match ? match[1] : null;
  const activeRace = raceId ? races.find(r => r.id === parseInt(raceId)) : null;

  const links: { to: string; label: string }[] = [];
  if (raceId) {
      links.push(
        { to: `/race/${raceId}`, label: 'Details' },
        { to: `/race/${raceId}/control`, label: 'Control' },
        { to: `/race/${raceId}/observation`, label: 'Live' }
      );
  }

  const handleCreateRace = async (data: RaceFormData) => {
    try {
      const newRace = await apiClient.post('/races/', data);
      setShowCreateModal(false);
      fetchRaces();
      navigate(`/race/${newRace.id}`);
    } catch (e) {
      console.error("Failed to create race", e);
      showAlert("Failed to create race", "Error");
    }
  };

  return (
    <>
      <nav style={{ backgroundColor: 'var(--scouting-blue)', color: 'white', position: 'relative', zIndex: 1000, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem' }}>
          
          {/* Left: Logo & Home */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
            <img src="/src/assets/logo.png" alt="Trusty Track Logo" style={{ height: '32px', width: 'auto' }} />
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>Trusty Track</span>
          </Link>

          {/* Center: Race Switcher */}
          <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
            <button 
              onClick={() => setIsRaceDropdownOpen(!isRaceDropdownOpen)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: 'white',
                padding: '5px 16px',
                borderRadius: '20px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            >
              {activeRace ? `🏁 ${activeRace.name}` : 'Select a Race'}
              <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{isRaceDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {isRaceDropdownOpen && (
              <>
                <div 
                  onClick={() => setIsRaceDropdownOpen(false)}
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001 }}
                />
                <div style={{
                  position: 'absolute',
                  top: '120%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'white',
                  borderRadius: '10px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                  minWidth: '220px',
                  zIndex: 1002,
                  overflow: 'hidden',
                  padding: '6px',
                  border: '1px solid #eee'
                }}>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {races.map(r => (
                      <Link
                        key={r.id}
                        to={`/race/${r.id}`}
                        onClick={() => setIsRaceDropdownOpen(false)}
                        style={{
                          display: 'block',
                          padding: '10px 18px',
                          textDecoration: 'none',
                          color: raceId === r.id.toString() ? 'var(--scouting-blue)' : '#444',
                          backgroundColor: raceId === r.id.toString() ? '#f0f7ff' : 'transparent',
                          fontWeight: raceId === r.id.toString() ? 'bold' : '500',
                          fontSize: '0.9rem',
                          borderRadius: '6px',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => ! (raceId === r.id.toString()) && (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                        onMouseLeave={(e) => ! (raceId === r.id.toString()) && (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {r.name}
                      </Link>
                    ))}
                    {races.length === 0 && (
                      <div style={{ padding: '15px', color: '#999', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center' }}>No races found</div>
                    )}
                  </div>
                  
                  {/* New Race Option */}
                  <div style={{ borderTop: '1px solid #eee', marginTop: '4px', paddingTop: '4px' }}>
                    <button
                      onClick={() => {
                        setIsRaceDropdownOpen(false);
                        setShowCreateModal(true);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 18px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--scouting-blue)',
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f7ff'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span>+</span> New Race...
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right: System Settings */}
          <Link 
            to="/system-settings" 
            title="System Settings"
            style={{
              textDecoration: 'none',
              color: location.pathname === '/system-settings' ? 'var(--cub-scouting-gold)' : 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '6px 12px',
              borderRadius: '8px',
              background: location.pathname === '/system-settings' ? 'rgba(255,255,255,0.15)' : 'transparent',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
            onMouseEnter={(e) => ! (location.pathname === '/system-settings') && (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={(e) => ! (location.pathname === '/system-settings') && (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: '1.2rem' }}>⚙️</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Settings</span>
          </Link>
        </div>
      </nav>

      {/* Secondary Header: Race Navigation */}
      {raceId && (
        <div style={{ 
          backgroundColor: 'white', 
          borderBottom: '1px solid #ddd', 
          padding: '0.75rem 0',
          display: 'flex',
          justifyContent: 'center',
          gap: '2.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          position: 'relative',
          zIndex: 999
        }}>
          {links.map(link => {
            const isActive = location.pathname === link.to;
            return (
              <Link 
                key={link.to} 
                to={link.to}
                style={{
                  textDecoration: 'none',
                  color: isActive ? 'var(--scouting-blue)' : '#666',
                  fontWeight: 'bold',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  padding: '4px 8px',
                  borderBottom: `2px solid ${isActive ? 'var(--cub-scouting-gold)' : 'transparent'}`,
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
                onMouseEnter={(e) => !isActive && (e.currentTarget.style.color = '#333')}
                onMouseLeave={(e) => !isActive && (e.currentTarget.style.color = '#666')}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Race Modal */}
      <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create New Race Event"
      >
          <RaceForm
              onSubmit={handleCreateRace}
              onCancel={() => setShowCreateModal(false)}
              submitLabel="Create Race"
          />
      </Modal>
    </>
  );
}
