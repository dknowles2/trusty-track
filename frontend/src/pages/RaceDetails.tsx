import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import RacerForm, { RacerData, Den } from '../components/RacerForm';
import DenManager from '../components/DenManager';
import Modal from '../components/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import ImportRacersModal from '../components/ImportRacersModal';
import CheckInModal from '../components/CheckInModal';

interface Race extends RaceFormData {
    id: number;
}

interface Racer extends RacerData {
  id: number;
}

export default function RaceDetails() {
  const { raceId } = useParams<{ raceId: string }>();
  const [race, setRace] = useState<Race | null>(null);
  const [racers, setRacers] = useState<Racer[]>([]);
  const [dens, setDens] = useState<Den[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Racer Form State
  const [showRacerForm, setShowRacerForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDenManager, setShowDenManager] = useState(false);
  const [editingRacer, setEditingRacer] = useState<Racer | undefined>(undefined);
  
  // Check In Modal
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [checkingInRacer, setCheckingInRacer] = useState<Racer | null>(null);

  // Race Edit State
  const [isEditingRace, setIsEditingRace] = useState(false);
  
  // Roster View State
  const [isGroupedByDen, setIsGroupedByDen] = useState(false);
  const [isAddRacerDropdownOpen, setIsAddRacerDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');


  useEffect(() => {
    if (raceId) {
        fetchRaceDetails();
        fetchRacers();
        fetchDens();
    }
  }, [raceId]);

  const fetchRaceDetails = async () => {
      try {
          const data = await apiClient.get(`/races/${raceId}`);
          setRace(data);
      } catch (e) {
          console.error("Failed to fetch race details", e);
      }
  };

  const fetchRacers = async () => {
    try {
      const data = await apiClient.get(`/racers/?race_id=${raceId}`);
      setRacers(data);
    } catch (error) {
      console.error('Failed to fetch racers:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDens = async () => {
      try {
          if (!raceId) return;
          const data = await apiClient.get(`/races/${raceId}/dens/`);
          setDens(data);
      } catch (e) {
          console.error("Failed to fetch dens", e);
      }
  };

  const handleUpdateRace = async (data: RaceFormData) => {
      try {
          await apiClient.put(`/races/${raceId}`, data);
          setIsEditingRace(false);
          fetchRaceDetails();
      } catch (e) {
          console.error("Failed to update race", e);
          alert("Failed to update race details");
      }
  };

  // Racer Actions
  const handleAddRacerClick = () => {
    setEditingRacer(undefined);
    setShowRacerForm(true);
  };

  const handleEditRacerClick = (racer: Racer) => {
    setEditingRacer(racer);
    setShowRacerForm(true);
  };

  const handleCheckInClick = (racer: Racer) => {
      setCheckingInRacer(racer);
      setShowCheckInModal(true);
  };
  
  const handleRacerFormSubmit = async (data: RacerData) => {
      try {
          if (editingRacer) {
              await fetch(`/api/racers/${editingRacer.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data)
              });
          } else {
              if (raceId) {
                  await apiClient.post('/racers/', { ...data, race_id: parseInt(raceId) });
              }
          }
           setShowRacerForm(false);
           fetchRacers();
      } catch (e) {
          console.error("Failed to save", e);
          alert("Failed to save racer");
      }
  };

  const filteredRacers = racers.filter(racer => {
      const searchLower = searchTerm.toLowerCase();
      const denName = dens.find(d => d.id === racer.den_id)?.name || '';
      
      return (
          (racer.first_name || '').toLowerCase().includes(searchLower) ||
          (racer.last_name || '').toLowerCase().includes(searchLower) ||
          (racer.car_number || '').toString().includes(searchLower) ||
          denName.toLowerCase().includes(searchLower)
      );
  });

  if (loading && !race) return <p>Loading...</p>;

  return (
    <div className="container" style={{ padding: '2rem' }}>
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div>
              {race ? (
                  <>
                    <h1 style={{ margin: 0, color: 'var(--scouting-blue)' }}>{race.name}</h1>
                    <div style={{ color: '#666', marginTop: '0.5rem' }}>
                        <span style={{ marginRight: '1.5rem' }}>📅 {new Date(race.date_time).toLocaleString()}</span>
                        <span>📍 {race.location || 'No Location Set'}</span>
                    </div>
                  </>
              ) : <p>Race not found</p>}
          </div>
          <button onClick={() => setIsEditingRace(true)}>Edit Details</button>
      </div>

      {/* Race Settings Summary (Read-Only for now, can be expanded) */}
      <div style={{ marginBottom: '2rem', background: '#f9f9f9', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>Race Settings</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div><strong>Scheduling:</strong> {race?.scheduling_strategy ? ({
                  'LANE_ROTATION': 'Lane Rotation',
                  'PERFECT_N': 'Perfect N',
                  'CHAOTIC': 'Chaotic'
              }[race.scheduling_strategy] || race.scheduling_strategy) : '-'}</div>
              <div><strong>Scoring:</strong> {race?.scoring_strategy ? ({
                  'TIMED': 'Timed',
                  'POINTS': 'Points'
              }[race.scoring_strategy] || race.scoring_strategy) : '-'}</div>
              <div><strong>Car Numbering:</strong> {race?.car_numbering_strategy ? ({
                  'MANUAL': 'Manual',
                  'PER_GROUP': 'Per Den',
                  'GLOBAL': 'Global'
              }[race.car_numbering_strategy] || race.car_numbering_strategy) : '-'}</div>
          </div>
      </div>

      {/* Edit Race Modal */}
      <Modal
          isOpen={isEditingRace}
          onClose={() => setIsEditingRace(false)}
          title="Edit Race Details"
      >
          {race && (
            <RaceForm
                initialData={race}
                onSubmit={handleUpdateRace}
                onCancel={() => setIsEditingRace(false)}
                submitLabel="Save Changes"
            />
          )}
      </Modal>

      {/* Roster Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Racer Roster</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginRight: '10px' }}>
                <input
                    type="text"
                    placeholder="🔍 Search racers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '20px',
                        border: '1px solid #ddd',
                        marginRight: '1rem',
                        fontSize: '0.9rem',
                        width: '200px'
                    }}
                />
                <span style={{ marginRight: '8px', fontSize: '0.9rem', color: '#555' }}>Group by Den</span>
                <label className="toggle-switch">
                    <input 
                        type="checkbox" 
                        checked={isGroupedByDen} 
                        onChange={e => setIsGroupedByDen(e.target.checked)} 
                    />
                    <span className="slider"></span>
                </label>
            </div>
            
            <button className="secondary-btn" onClick={() => setShowDenManager(true)}>Manage Dens</button>
            
            <button 
                className="secondary-btn" 
                onClick={async () => {
                     const btn = document.getElementById('auto-num-btn');
                     if (btn) btn.textContent = '⏳ ...';
                     try {
                         const res = await apiClient.post(`/races/${raceId}/auto_number`, {});
                         await fetchRacers();
                         
                         if (res.updated_count === 0) {
                             alert(res.message + ".\n\nTip: If using 'Per Den', ensure Dens have number ranges configured.");
                         } else {
                             alert(res.message);
                         }
                     } catch(e) {
                         alert("Failed to auto-number");
                     } finally {
                         if (btn) btn.textContent = '#️⃣ Auto #';
                     }
                }}
                id="auto-num-btn"
                title="Auto Number Racers"
            >
                #️⃣ Auto #
            </button>

            <div className="dropdown" style={{ position: 'relative' }}>
                <div className="split-btn-container">
                    <button className="secondary-btn split-btn-main" onClick={handleAddRacerClick} style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
                        + Add Racer
                    </button>
                    <button 
                        className="secondary-btn split-btn-arrow" 
                        style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsAddRacerDropdownOpen(!isAddRacerDropdownOpen);
                        }}
                    >
                        ▼
                    </button>
                </div>
                {isAddRacerDropdownOpen && (
                    <div 
                        className="dropdown-content" 
                        style={{ display: 'block' }}
                        ref={(node) => {
                            if (node) {
                                // Close when clicking outside
                                const handleClickOutside = (event: MouseEvent) => {
                                    if (node && !node.contains(event.target as Node) && !(event.target as Element).classList.contains('split-btn-arrow')) {
                                        setIsAddRacerDropdownOpen(false);
                                    }
                                };
                                document.addEventListener('mousedown', handleClickOutside);
                                return () => {
                                    document.removeEventListener('mousedown', handleClickOutside);
                                };
                            }
                        }}
                    >
                        <button 
                            onClick={async () => {
                               try {
                                    const btn = document.getElementById('populate-btn-drop');
                                    if (btn) btn.textContent = '⏳ Populating...';
                                    
                                    await apiClient.post(`/races/${raceId}/populate?count=20`, {});
                                    await fetchRacers();
                                    
                               } catch (e) {
                                    console.error("Failed to populate", e);
                                    alert("Failed to populate test data. Check console for details.");
                               } finally {
                                    const btn = document.getElementById('populate-btn-drop');
                                    if (btn) btn.textContent = '⚡ Populate Test Data';
                                    setIsAddRacerDropdownOpen(false);
                               }
                            }}
                            id="populate-btn-drop"
                        >
                            ⚡ Populate Test Data
                        </button>
                        <button
                            onClick={() => {
                                setShowImportModal(true);
                                setIsAddRacerDropdownOpen(false);
                            }}
                        >
                            📂 Import from CSV
                        </button>
                    </div>
                )}
            </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
                    <tr>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Car #</th>
                        <th style={{ padding: '12px', textAlign: 'center' }}>Photo</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>First Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Last Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Den</th>
                        <th style={{ padding: '12px', textAlign: 'center' }}>Checked In</th>
                        <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredRacers.length === 0 ? (
                        <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>
                            {searchTerm ? 'No racers found matching your search.' : 'No racers registered yet.'}
                        </td></tr>
                    ) : isGroupedByDen ? (
                        // Grouped View
                        Object.values(filteredRacers.reduce((acc, racer) => {
                            const denId = racer.den_id || -1;
                            if (!acc[denId]) acc[denId] = { denId, items: [] };
                            acc[denId].items.push(racer);
                            return acc;
                        }, {} as Record<number, { denId: number, items: Racer[] }>))
                        .sort((a, b) => {
                             // Sort groups logic
                             if (a.denId === -1) return 1; // Unassigned last
                             if (b.denId === -1) return -1;
                             const denA = dens.find(d => d.id === a.denId);
                             const denB = dens.find(d => d.id === b.denId);
                             return (denA?.name || '').localeCompare(denB?.name || '');
                        })
                        .map(group => {
                            const den = dens.find(d => d.id === group.denId);
                            const denName = group.denId === -1 ? "Unassigned" : (den?.name || 'Unknown Den');
                            const denColor = group.denId === -1 ? "#eee" : (den?.color || '#eee');
                            
                            return (
                                <>
                                    <tr key={`header-${group.denId}`} style={{ backgroundColor: '#f9f9f9', borderTop: '2px solid #ddd' }}>
                                        <td colSpan={7} style={{ padding: '12px', fontWeight: 'bold', fontSize: '1.1rem' }}>
                                            <span style={{ 
                                                display: 'inline-block', 
                                                width: '12px', 
                                                height: '12px', 
                                                borderRadius: '50%', 
                                                backgroundColor: denColor,
                                                marginRight: '8px'
                                            }}></span>
                                            {denName} ({group.items.length})
                                        </td>
                                    </tr>
                                    {group.items.map(racer => (
                                         <tr key={racer.id} style={{ borderBottom: '1px solid #eee' }}>
                                            <td style={{ padding: '12px' }}>{racer.car_number || '-'}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                {racer.racer_image_url ? (
                                                    <img 
                                                        src={racer.racer_image_url} 
                                                        alt={`${racer.first_name}`} 
                                                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} 
                                                    />
                                                ) : (
                                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: '#999', fontSize: '0.8rem' }}>
                                                        No
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px' }}>{racer.first_name}</td>
                                            <td style={{ padding: '12px' }}>{racer.last_name}</td>
                                            <td style={{ padding: '12px' }}>
                                                {racer.den_id ? (
                                                    <span style={{ 
                                                        padding: '4px 8px', 
                                                        borderRadius: '12px', 
                                                        backgroundColor: dens.find(d => d.id === racer.den_id)?.color || '#eee',
                                                        color: '#333',
                                                        fontSize: '0.85rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {dens.find(d => d.id === racer.den_id)?.name || 'Unknown'}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                <button 
                                                    onClick={() => handleCheckInClick(racer)}
                                                    style={{ 
                                                        background: racer.car_passed_inspection ? '#e8f5e9' : '#fafafa', 
                                                        border: `1px solid ${racer.car_passed_inspection ? '#4caf50' : '#ddd'}`, 
                                                        borderRadius: '20px',
                                                        padding: '6px 12px',
                                                        cursor: 'pointer',
                                                        color: racer.car_passed_inspection ? '#2e7d32' : '#666',
                                                        fontSize: '0.85rem',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '5px'
                                                    }}
                                                >
                                                    {racer.car_passed_inspection ? '✅ Checked In' : 'Check In'}
                                                </button>
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                                <button
                                                    onClick={() => handleEditRacerClick(racer)}
                                                    style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', textDecoration: 'underline', cursor: 'pointer' }}
                                                >
                                                    Edit
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            );
                        })
                    ) : (
                        // Standard View
                         filteredRacers.map(racer => (
                            <tr key={racer.id} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '12px' }}>{racer.car_number || '-'}</td>
                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                    {racer.racer_image_url ? (
                                        <img 
                                            src={racer.racer_image_url} 
                                            alt={`${racer.first_name}`} 
                                            style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} 
                                        />
                                    ) : (
                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: '#999', fontSize: '0.8rem' }}>
                                            No
                                        </div>
                                    )}
                                </td>
                                <td style={{ padding: '12px' }}>{racer.first_name}</td>
                                <td style={{ padding: '12px' }}>{racer.last_name}</td>
                                <td style={{ padding: '12px' }}>
                                    {racer.den_id ? (
                                        <span style={{ 
                                            padding: '4px 8px', 
                                            borderRadius: '12px', 
                                            backgroundColor: dens.find(d => d.id === racer.den_id)?.color || '#eee',
                                            color: '#333',
                                            fontSize: '0.85rem',
                                            fontWeight: 'bold'
                                        }}>
                                            {dens.find(d => d.id === racer.den_id)?.name || 'Unknown'}
                                        </span>
                                    ) : '-'}
                                </td>
                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                    <button 
                                        onClick={() => handleCheckInClick(racer)}
                                        style={{ 
                                            background: racer.car_passed_inspection ? '#e8f5e9' : '#fafafa', 
                                            border: `1px solid ${racer.car_passed_inspection ? '#4caf50' : '#ddd'}`, 
                                            borderRadius: '20px',
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            color: racer.car_passed_inspection ? '#2e7d32' : '#666',
                                            fontSize: '0.85rem',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px'
                                        }}
                                    >
                                        {racer.car_passed_inspection ? '✅ Checked In' : 'Check In'}
                                    </button>
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                    <button
                                        onClick={() => handleEditRacerClick(racer)}
                                        style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', textDecoration: 'underline', cursor: 'pointer' }}
                                    >
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
      </div>

      {/* Racer Form Modal */}
      <Modal
         isOpen={showRacerForm}
         onClose={() => setShowRacerForm(false)}
         title={editingRacer ? 'Edit Racer' : 'Add New Racer'}
      >
        <RacerForm
            initialData={editingRacer}
            raceId={race ? race.id : undefined}
            onSubmit={handleRacerFormSubmit}
            onCancel={() => setShowRacerForm(false)}
        />
      </Modal>

      {/* Den Manager Modal */}
      <Modal
        isOpen={showDenManager}
        onClose={() => setShowDenManager(false)}
        title="Manage Dens"
      >
          {race ? (
             <DenManager 
                raceId={race.id}
                onClose={() => setShowDenManager(false)}
                onUpdate={() => {
                    fetchDens();
                    fetchRacers();
                }}
              />
          ) : <p>Loading race details...</p>}
      </Modal>

      {/* Import Racers Modal */}
      {race && (
          <ImportRacersModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            raceId={race.id}
            onImportSuccess={() => {
                fetchRacers();
                // Optional: close modal automatically or let user close
                // setShowImportModal(false); 
            }}
          />
      )}

      {/* Check In Modal */}
      <Modal
        isOpen={showCheckInModal}
        onClose={() => setShowCheckInModal(false)}
        title="Racer Check In"
      >
          {checkingInRacer && (
              <CheckInModal 
                racer={checkingInRacer}
                onClose={() => setShowCheckInModal(false)}
                onSave={fetchRacers}
              />
          )}
      </Modal>
    </div>
  );
}
