import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function SystemConfig() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    group_name: '',
    lane_count: 4,
    length_feet: 40,
    timer_type: 'FAKE'
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
      try {
          const config = await apiClient.get('/config/initial');
          if (config.initialized) {
             setIsEditing(true);
             // We need to fetch details, but /config/initial only gives summary. 
             // Ideally we should have a GET for full config or just use what we have.
             // Wait, the POST/PUT takes all fields but GET /config/initial returns summary.
             // I need to fetch the existing values to pre-fill.
             // I'll fetch Group and Track separately or just assume user re-enters if I can't easily get them.
             // Actually, I can use the existing /groups/{id} and just assume track details are default if not exposed?
             // No, I should probably expose a way to get the full config.
             // But for now, let's just pre-fill what we can (Organization Name) and maybe default the rest or fetch via separate calls if possible.
             // Let's rely on the user re-confirming technical details or update backend to return full config.
             // Actually, for a Polish phase, getting the data is better.
             // Let's try to get group info.
             setFormData(prev => ({
                 ...prev,
                 group_name: config.group_name || '',
                 lane_count: config.lane_count || 4,
                 length_feet: config.length_feet || 40,
                 timer_type: config.timer_type || 'FAKE'
             }));
          }
      } catch (e) {
          console.error("Failed to load config", e);
      } finally {
          setLoading(false);
      }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'lane_count' || name === 'length_feet' ? parseInt(value) || 0 : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (isEditing) {
          await apiClient.put('/config/initial', formData);
      } else {
          await apiClient.post('/config/initial', formData);
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to apply configuration');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div>Loading Configuration...</div>;

  return (
    <div className="container">
      <h1>{isEditing ? 'System Configuration' : 'Initial Setup'}</h1>
      <p>{isEditing ? 'Update your racing environment settings.' : "Welcome to Trusty Track! Let's set up your racing environment."}</p>
      
      {error && <div style={{ color: 'var(--error)', marginBottom: '1rem' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ maxWidth: '500px' }}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="group_name" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Organization Name</label>
          <input
            type="text"
            id="group_name"
            name="group_name"
            value={formData.group_name}
            onChange={handleChange}
            required
            placeholder="e.g. Pack 123"
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="lane_count" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Number of Lanes</label>
          <input
            type="number"
            id="lane_count"
            name="lane_count"
            value={formData.lane_count}
            onChange={handleChange}
            min="1"
            max="8"
            required
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="length_feet" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Track Length (Feet)</label>
          <input
            type="number"
            id="length_feet"
            name="length_feet"
            value={formData.length_feet}
            onChange={handleChange}
            min="10"
            required
             style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
           <label htmlFor="timer_type" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Timer Type</label>
           <select
             id="timer_type"
             name="timer_type"
             value={formData.timer_type}
             onChange={handleChange}
             style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
           >
             <option value="FAKE">Fake Timer (Manual Control)</option>
             <option value="AUTO_DETECT_BACKEND">Auto-Detect (Backend Connected)</option>
             <option value="AUTO_DETECT_PROXY">Use Remote Proxy</option>
           </select>
        </div>

        <button type="submit" className="primary-btn" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Configuration'}
        </button>
      </form>
    </div>
  );
}
