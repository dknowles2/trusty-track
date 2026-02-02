import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import RacerForm, { RacerData, Den } from '../components/RacerForm';
import DenManager from '../components/DenManager';

interface Race {
    id: number;
    name: string;
    date_time: string;
    location: string;
    group_id?: number;
    scheduling_strategy: string;
    scoring_strategy: string;
    car_numbering_strategy: string;
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
  const [showDenManager, setShowDenManager] = useState(false);
  const [editingRacer, setEditingRacer] = useState<Racer | undefined>(undefined);

  // Race Edit State
  const [isEditingRace, setIsEditingRace] = useState(false);
  const [editRaceData, setEditRaceData] = useState<Partial<Race>>({});
  
  // Roster View State
  const [isGroupedByDen, setIsGroupedByDen] = useState(false);


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
          setEditRaceData(data);
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
          const data = await apiClient.get('/dens/');
          setDens(data);
      } catch (e) {
          console.error("Failed to fetch dens", e);
      }
  };

  const handleUpdateRace = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await apiClient.put(`/races/${raceId}`, editRaceData);
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

  const handleToggleCheckIn = async (racer: Racer) => {
      try {
       const response = await fetch(`/api/racers/${racer.id}`, {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ ...racer, car_passed_inspection: !racer.car_passed_inspection })
       });
       if(response.ok) {
           fetchRacers();
       }
    } catch (error) {
        console.error("Failed to toggle", error);
    }
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
              <div><strong>Scheduling:</strong> {race?.scheduling_strategy}</div>
              <div><strong>Scoring:</strong> {race?.scoring_strategy}</div>
              <div><strong>Car Numbering:</strong> {race?.car_numbering_strategy}</div>
          </div>
      </div>

      {/* Edit Race Modal */}
      {isEditingRace && race && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '100%', maxWidth: '500px' }}>
                <h2>Edit Race Details</h2>
                <form onSubmit={handleUpdateRace} style={{ display: 'grid', gap: '1rem' }}>
                    <div>
                        <label>Event Name</label>
                        <input 
                            type="text" 
                            value={editRaceData.name || ''} 
                            onChange={e => setEditRaceData({...editRaceData, name: e.target.value})}
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>
                    <div>
                        <label>Date & Time</label>
                        <input 
                            type="datetime-local" 
                            value={editRaceData.date_time || ''} 
                            onChange={e => setEditRaceData({...editRaceData, date_time: e.target.value})}
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>
                    <div>
                        <input 
                            type="text" 
                            value={editRaceData.location || ''} 
                            onChange={e => setEditRaceData({...editRaceData, location: e.target.value})}
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Scheduling</label>
                            <select 
                                value={editRaceData.scheduling_strategy || 'LANE_ROTATION'} 
                                onChange={e => setEditRaceData({...editRaceData, scheduling_strategy: e.target.value})}
                                style={{ width: '100%', padding: '0.5rem' }}
                            >
                                <option value="LANE_ROTATION">Lane Rotation</option>
                                <option value="PERFECT_N">Perfect N</option>
                                <option value="CHAOTIC">Chaotic</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Scoring</label>
                            <select 
                                value={editRaceData.scoring_strategy || 'TIMED'} 
                                onChange={e => setEditRaceData({...editRaceData, scoring_strategy: e.target.value})}
                                style={{ width: '100%', padding: '0.5rem' }}
                            >
                                <option value="TIMED">Timed</option>
                                <option value="POINTS">Points</option>
                            </select>
                        </div>
                         <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Car Numbering</label>
                            <select 
                                value={editRaceData.car_numbering_strategy || 'MANUAL'} 
                                onChange={e => setEditRaceData({...editRaceData, car_numbering_strategy: e.target.value})}
                                style={{ width: '100%', padding: '0.5rem' }}
                            >
                                <option value="MANUAL">Manual</option>
                                <option value="PER_GROUP">Per Group</option>
                                <option value="GLOBAL">Global</option>
                            </select>
                        </div>
                    </div>
                    {/* Settings could be editable here too */}
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        <button type="submit">Save Changes</button>
                        <button type="button" onClick={() => setIsEditingRace(false)} className="secondary-btn">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* Roster Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Racer Roster</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginRight: '10px' }}>
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
            <button 
                className="secondary-btn" 
                onClick={async () => {
                   try {
                        const btn = document.getElementById('populate-btn');
                        if (btn) btn.textContent = '⏳ Populating...';
                        if (btn) (btn as HTMLButtonElement).disabled = true;

                        await apiClient.post(`/races/${raceId}/populate?count=20`, {});
                        await fetchRacers();
                        
                   } catch (e) {
                        console.error("Failed to populate", e);
                        alert("Failed to populate test data. Check console for details.");
                   } finally {
                        const btn = document.getElementById('populate-btn');
                        if (btn) btn.textContent = '⚡ Populate Test Data';
                        if (btn) (btn as HTMLButtonElement).disabled = false;
                   }
                }}
                id="populate-btn"
                style={{ backgroundColor: '#f0f0f0', color: '#666', border: '1px solid #ccc' }}
            >
                ⚡ Populate Test Data
            </button>
            <button className="secondary-btn" onClick={handleAddRacerClick}>+ Add Racer</button>
            <button className="secondary-btn" onClick={() => setShowDenManager(true)}>Manage Dens</button>
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
                    {racers.length === 0 ? (
                        <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>No racers registered yet.</td></tr>
                    ) : isGroupedByDen ? (
                        // Grouped View
                        Object.values(racers.reduce((acc, racer) => {
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
                                                <input
                                                    type="checkbox"
                                                    checked={racer.car_passed_inspection}
                                                    onChange={() => handleToggleCheckIn(racer)}
                                                    style={{ transform: 'scale(1.5)', cursor: 'pointer' }}
                                                />
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
                         racers.map(racer => (
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
                                    <input
                                        type="checkbox"
                                        checked={racer.car_passed_inspection}
                                        onChange={() => handleToggleCheckIn(racer)}
                                        style={{ transform: 'scale(1.5)', cursor: 'pointer' }}
                                    />
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

      {showRacerForm && (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ width: '100%', maxWidth: '500px' }}>
                <RacerForm
                    initialData={editingRacer}
                    onSubmit={handleRacerFormSubmit}
                    onCancel={() => setShowRacerForm(false)}
                />
            </div>
        </div>
      )}

      {showDenManager && (
          <DenManager 
            onClose={() => setShowDenManager(false)}
            onUpdate={() => {
                fetchDens();
                fetchRacers();
            }}
          />
      )}
    </div>
  );
}
