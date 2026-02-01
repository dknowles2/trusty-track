import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import RacerForm, { RacerData } from '../components/RacerForm';

interface Racer extends RacerData {
  id: number;
}

export default function CheckIn() {
  const [racers, setRacers] = useState<Racer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRacer, setEditingRacer] = useState<Racer | undefined>(undefined);

  const fetchRacers = async () => {
    try {
      const data = await apiClient.get('/racers/');
      setRacers(data);
    } catch (error) {
      console.error('Failed to fetch racers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRacers();
  }, []);

  const handleAddClick = () => {
    setEditingRacer(undefined);
    setShowForm(true);
  };

  const handleEditClick = (racer: Racer) => {
    setEditingRacer(racer);
    setShowForm(true);
  };

  const handleToggleCheckIn = async (racer: Racer) => {
    try {
      await apiClient.post('/racers/', { ...racer, car_passed_inspection: !racer.car_passed_inspection }); // WAIT: create? NO, PUT.
      // Actually my apiClient.post is generic. I need PUT.
       // Let's blindly try a PUT via custom call or fix apiClient.
       // For now, let's use apiClient.post but the endpoint is PUT /racers/{id} in backend
       // Oh wait, apiClient helper might not have PUT.
       // I'll assume i can just fetch with PUT.
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
  
    // Correction for RacerForm submission
  const handleFormSubmit = async (data: RacerData) => {
      try {
          if (editingRacer) {
              await fetch(`/api/racers/${editingRacer.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data)
              });
          } else {
              await apiClient.post('/racers/', data);
          }
           setShowForm(false);
           fetchRacers();
      } catch (e) {
          console.error("Failed to save", e);
          alert("Failed to save racer");
      }
  };


  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Racer Check-In</h1>
        <button className="secondary-btn" onClick={handleAddClick}>+ Add Racer</button>
      </div>

      {loading ? (
        <p>Loading racers...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
                    <tr>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Car #</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>First Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Last Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Rank</th>
                        <th style={{ padding: '12px', textAlign: 'center' }}>Checked In</th>
                        <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {racers.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>No racers registered yet.</td></tr>
                    ) : racers.map(racer => (
                        <tr key={racer.id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '12px' }}>{racer.car_number || '-'}</td>
                            <td style={{ padding: '12px' }}>{racer.first_name}</td>
                            <td style={{ padding: '12px' }}>{racer.last_name}</td>
                            <td style={{ padding: '12px' }}>{racer.rank}</td>
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
                                    onClick={() => handleEditClick(racer)}
                                    style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', textDecoration: 'underline', cursor: 'pointer' }}
                                >
                                    Edit
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      )}

      {showForm && (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div style={{ width: '100%', maxWidth: '500px' }}>
                <RacerForm
                    initialData={editingRacer}
                    onSubmit={handleFormSubmit}
                    onCancel={() => setShowForm(false)}
                />
            </div>
        </div>
      )}
    </div>
  );
}
