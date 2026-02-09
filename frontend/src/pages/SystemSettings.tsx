import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function SystemConfig() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [tracks, setTracks] = useState([{ name: 'Main Track', lane_count: 4, length_feet: 40, timer_type: 'FAKE' }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const config = await apiClient.get(`/config/initial?t=${Date.now()}`);
      if (config.initialized) {
        setIsEditing(true);
        setGroupName(config.group_name || '');
        if (config.tracks && config.tracks.length > 0) {
          setTracks(config.tracks);
        }
      }
    } catch (e) {
      console.error("Failed to load config", e);
    } finally {
      setLoading(false);
    }
  };

  const handleTrackChange = (index: number, field: string, value: any) => {
    const newTracks = [...tracks];
    newTracks[index] = { ...newTracks[index], [field]: value };
    setTracks(newTracks);
  };

  const addTrack = () => {
    setTracks([...tracks, { name: `Track ${tracks.length + 1}`, lane_count: 4, length_feet: 40, timer_type: 'FAKE' }]);
  };

  const removeTrack = (index: number) => {
    if (tracks.length > 1) {
      setTracks(tracks.filter((_, i) => i !== index));
    } else {
      setError('At least one track is required.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    if (tracks.length === 0) {
        setError('At least one track is required.');
        setSubmitting(false);
        return;
    }

    try {
      const payload = {
        group_name: groupName,
        tracks: tracks
      };

      if (isEditing) {
        await apiClient.put('/config/initial', payload);
      } else {
        await apiClient.post('/config/initial', payload);
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to apply settings');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div>Loading Settings...</div>;

  return (
    <div className="container">
      <h1>{isEditing ? 'System Settings' : 'Initial Setup'}</h1>
      <p>{isEditing ? 'Update your racing environment settings.' : "Welcome to Trusty Track! Let's set up your racing environment."}</p>
      
      {error && <div style={{ color: 'var(--error)', marginBottom: '1rem', padding: '0.5rem', border: '1px solid var(--error)', borderRadius: '4px' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ maxWidth: '600px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <label htmlFor="group_name" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Organization Name</label>
          <input
            type="text"
            id="group_name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
            placeholder="e.g. Pack 123"
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <h2 style={{ marginBottom: '1rem' }}>Tracks</h2>
        {tracks.map((track, index) => (
          <div key={index} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px', background: '#f9f9f9', position: 'relative' }}>
            {tracks.length > 1 && (
              <button 
                type="button" 
                onClick={() => removeTrack(index)}
                style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '1.2rem' }}
                title="Remove Track"
              >
                &times;
              </button>
            )}
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Track Name</label>
              <input
                type="text"
                value={track.name}
                onChange={(e) => handleTrackChange(index, 'name', e.target.value)}
                required
                placeholder="e.g. Main Track"
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Lanes</label>
                <input
                  type="number"
                  value={track.lane_count}
                  onChange={(e) => handleTrackChange(index, 'lane_count', parseInt(e.target.value) || 0)}
                  min="1"
                  max="8"
                  required
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Length (Feet)</label>
                <input
                  type="number"
                  value={track.length_feet}
                  onChange={(e) => handleTrackChange(index, 'length_feet', parseInt(e.target.value) || 0)}
                  min="10"
                  required
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Timer Type</label>
              <select
                value={track.timer_type}
                onChange={(e) => handleTrackChange(index, 'timer_type', e.target.value)}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="FAKE">Fake Timer (Manual Control)</option>
                <option value="AUTO_DETECT_BACKEND">Auto-Detect (Backend Connected)</option>
                <option value="AUTO_DETECT_PROXY">Use Remote Proxy</option>
              </select>
            </div>
          </div>
        ))}

        <button 
          type="button" 
          onClick={addTrack}
          className="secondary-btn"
          style={{ marginBottom: '2rem', display: 'block', width: '100%' }}
        >
          + Add Another Track
        </button>

        <button type="submit" className="primary-btn" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
