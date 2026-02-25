import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import { GET_RACES_NAV, CREATE_RACE } from '../graphql/raceDetails';
import Modal from './Modal';
import RaceForm, { RaceFormData } from './RaceForm';
import { useAlert } from '../context/AlertContext';
import Icon from '@mdi/react';
import { mdiFlagCheckered, mdiChevronUp, mdiChevronDown, mdiPlus, mdiCog, mdiCardSearch, mdiVideo, mdiMenu, mdiClose } from '@mdi/js';
import logoUrl from '../assets/logo_transparent.png';

export default function Navigation() {
  const { showAlert } = useAlert();
  const [{ data }] = useQuery({ query: GET_RACES_NAV });
  const races: { id: number; name: string }[] = data?.races || [];
  
  const [, createRaceMutation] = useMutation(CREATE_RACE);

  const [isRaceDropdownOpen, setIsRaceDropdownOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const match = location.pathname.match(/\/race\/(\d+)/);
  const raceId = match ? match[1] : null;
  const activeRace = raceId ? races.find((r: { id: number; name: string }) => r.id === parseInt(raceId)) : null;

  const links: { to: string; label: string; icon: string }[] = [];
  if (raceId) {
      links.push(
        { to: `/race/${raceId}`, label: 'Details', icon: mdiCardSearch },
        { to: `/race/${raceId}/control`, label: 'Control', icon: mdiFlagCheckered },
        { to: `/race/${raceId}/observation`, label: 'Live', icon: mdiVideo }
      );
  }

  const handleCreateRace = async (data: RaceFormData) => {
    try {
      const raceInput = {
        name: data.name,
        dateTime: data.date_time,
        location: data.location,
        trackId: data.track_id,
        scoringStrategy: data.scoring_strategy,
        carNumberingStrategy: data.car_numbering_strategy,
        globalStartNumber: data.global_start_number,
        championshipTrophies: data.championship_trophies,
      };
      const result = await createRaceMutation({ race: raceInput });
      if (result.error) throw result.error;
      
      const newRace = result.data.createRace;
      setShowCreateModal(false);
      navigate(`/race/${newRace.id}`);
    } catch (e) {
      console.error("Failed to create race", e);
      showAlert("Failed to create race", "Error");
    }
  };

  const isProjectorMode = new URLSearchParams(location.search).get('projector') === 'true';

  if (isProjectorMode) return null;

  return (
    <>
      <nav style={{ backgroundColor: 'var(--scouting-blue)', color: 'white', position: 'relative', zIndex: 1000, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem' }}>
          
          {/* Left: Logo & Home */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
            <img src={logoUrl} alt="Trusty Track Logo" style={{ height: '32px', width: 'auto' }} />
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>Trusty Track</span>
          </Link>

          {/* Center: Race Switcher (Hidden on Mobile) */}
          {!isMobile && (
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
              <Icon path={mdiFlagCheckered} size={0.8} color="white" />
              {activeRace ? activeRace.name : 'Select a Race'}
              <Icon path={isRaceDropdownOpen ? mdiChevronUp : mdiChevronDown} size={0.6} color="white" style={{ opacity: 0.8 }} />
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
                    {races.map((r: { id: number; name: string }) => (
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
                      <Icon path={mdiPlus} size={0.7} /> New Race...
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>
          )}

          {/* Right: System Settings (Hidden on Mobile) */}
          {!isMobile && (
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
              <Icon path={mdiCog} size={0.9} />
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Settings</span>
            </Link>
          )}

          {/* Mobile: Hamburger Menu Button */}
          {isMobile && (
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open Menu"
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                padding: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Icon path={mdiMenu} size={1.2} />
            </button>
          )}
        </div>

        {/* Mobile Menu Drawer */}
        {isMobile && (
          <>
            {/* Backdrop */}
            <div 
              onClick={() => setIsMobileMenuOpen(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 2000,
                opacity: isMobileMenuOpen ? 1 : 0,
                visibility: isMobileMenuOpen ? 'visible' : 'hidden',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(4px)'
              }}
            />
            {/* Drawer */}
            <div style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '280px',
              backgroundColor: 'white',
              zIndex: 2001,
              boxShadow: '-5px 0 25px rgba(0,0,0,0.1)',
              transform: isMobileMenuOpen ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              visibility: isMobileMenuOpen ? 'visible' : 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Drawer Header */}
              <div style={{ 
                padding: '1.5rem', 
                borderBottom: '1px solid #eee', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                backgroundColor: 'var(--scouting-blue)',
                color: 'white'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <img src={logoUrl} alt="Logo" style={{ height: '24px' }} />
                  <span style={{ fontWeight: 'bold' }}>Trusty Track</span>
                </div>
                <button 
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label="Close Menu"
                  style={{ background: 'none', border: 'none', color: 'white', padding: '4px', cursor: 'pointer' }}
                >
                  <Icon path={mdiClose} size={1} />
                </button>
              </div>

              {/* Drawer Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#999', margin: '1rem 0 0.5rem 0.5rem', letterSpacing: '1px' }}>Races</h3>
                {races.map((r: { id: number; name: string }) => (
                  <div key={r.id}>
                    <Link
                      to={`/race/${r.id}`}
                      onClick={() => setIsMobileMenuOpen(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '12px 16px',
                        textDecoration: 'none',
                        color: raceId === r.id.toString() ? 'var(--scouting-blue)' : '#444',
                        backgroundColor: raceId === r.id.toString() ? '#f0f7ff' : 'transparent',
                        fontWeight: raceId === r.id.toString() ? 'bold' : '500',
                        borderRadius: '8px',
                        marginBottom: '4px'
                      }}
                    >
                      {r.name}
                    </Link>
                    {/* If this is the active race, show its sub-links */}
                    {raceId === r.id.toString() && (
                      <div style={{ marginLeft: '1rem', borderLeft: '2px solid #f0f7ff', paddingLeft: '0.5rem' }}>
                        {links.map(link => (
                          <Link
                            key={link.to}
                            to={link.to}
                            onClick={() => setIsMobileMenuOpen(false)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 16px',
                              textDecoration: 'none',
                              color: location.pathname === link.to ? 'var(--scouting-blue)' : '#666',
                              fontSize: '0.9rem',
                              fontWeight: location.pathname === link.to ? 'bold' : '500'
                            }}
                          >
                            <Icon path={link.icon} size={0.7} />
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setShowCreateModal(true);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--scouting-blue)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '0.5rem'
                  }}
                >
                  <Icon path={mdiPlus} size={0.8} /> New Race...
                </button>
              </div>

              {/* Drawer Footer - Pinned Settings */}
              <div style={{ borderTop: '1px solid #eee', padding: '1rem' }}>
                <Link
                  to="/system-settings"
                  onClick={() => setIsMobileMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    textDecoration: 'none',
                    color: location.pathname === '/system-settings' ? 'var(--cub-scouting-gold)' : 'var(--scouting-blue)',
                    backgroundColor: location.pathname === '/system-settings' ? 'rgba(0,63,135,0.05)' : 'transparent',
                    fontWeight: 'bold',
                    borderRadius: '8px'
                  }}
                >
                  <Icon path={mdiCog} size={0.9} />
                  System Settings
                </Link>
              </div>
            </div>
          </>
        )}
      </nav>

      {/* Secondary Header: Race Navigation (Hidden on Mobile) */}
      {raceId && !isMobile && (
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
                <Icon path={link.icon} size={0.7} />
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
