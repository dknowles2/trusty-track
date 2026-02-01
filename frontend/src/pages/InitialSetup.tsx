import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function InitialSetup() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    group_name: '',
    lane_count: 4,
    length_feet: 40,
    timer_type: 'SKIP'
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      await apiClient.post('/config/initial', formData);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to apply configuration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <h1>Initial Setup</h1>
      <p>Welcome to Trusty Track! Let's set up your racing environment.</p>
      
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
             <option value="SKIP">Skip (Configure Later)</option>
             <option value="FAKE">Fake Timer (Testing)</option>
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
