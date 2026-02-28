import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';

const GET_INITIAL_CONFIG = `
  query GetInitialConfig {
    initialConfig {
      initialized
      version
      groupName
      debugMode
      tracks {
        id
        name
        laneCount
        lengthFeet
        timerType
        serialPort
      }
    }
  }
`;

const CREATE_INITIAL_CONFIG = `
  mutation CreateInitialConfig($config: InitialConfigInput!) {
    createInitialConfig(config: $config) {
      initialized
      groupName
      debugMode
      tracks {
        id
        name
      }
    }
  }
`;

const UPDATE_INITIAL_CONFIG = `
  mutation UpdateInitialConfig($config: InitialConfigInput!) {
    updateInitialConfig(config: $config) {
      initialized
      groupName
      debugMode
    }
  }
`;

export default function SystemConfig() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [tracks, setTracks] = useState([{ name: 'Main Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: '' }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [configResult] = useQuery({ query: GET_INITIAL_CONFIG, requestPolicy: 'network-only' });
  const { data, fetching, error: queryError } = configResult;

  const [, createInitialConfig] = useMutation(CREATE_INITIAL_CONFIG);
  const [, updateInitialConfig] = useMutation(UPDATE_INITIAL_CONFIG);

  useEffect(() => {
    if (data?.initialConfig) {
      const { initialized, groupName: savedGroupName, debugMode: savedDebugMode, tracks: savedTracks } = data.initialConfig;
      if (initialized) {
        setIsEditing(true);
        setGroupName(savedGroupName || '');
        setDebugMode(!!savedDebugMode);
        if (savedTracks && savedTracks.length > 0) {
          setTracks(savedTracks.map((t: {
            name: string;
            laneCount: number;
            lengthFeet: number;
            timerType: string;
            serialPort?: string;
          }) => ({
            name: t.name,
            laneCount: t.laneCount,
            lengthFeet: t.lengthFeet,
            timerType: t.timerType,
            serialPort: t.serialPort || ''
          })));
        }
      }
    }
  }, [data]);

  const handleTrackChange = (index: number, field: string, value: string | number) => {
    const newTracks = [...tracks];
    newTracks[index] = { ...newTracks[index], [field]: value };
    setTracks(newTracks);
  };

  const addTrack = () => {
    setTracks([...tracks, { name: `Track ${tracks.length + 1}`, laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: '' }]);
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
      const variables = {
        config: {
          groupName: groupName,
          debugMode: debugMode,
          tracks: tracks.map(({ name, laneCount, lengthFeet, timerType, serialPort }) => ({
            name,
            laneCount,
            lengthFeet: lengthFeet || 40,
            timerType,
            serialPort: timerType === 'AUTO_DETECT_BACKEND' ? serialPort : null
          }))
        }
      };

      let result;
      if (isEditing) {
        result = await updateInitialConfig(variables);
      } else {
        result = await createInitialConfig(variables);
      }
      
      if (result.error) {
        throw result.error;
      }

      
      // We can't easily use useClient() here unless we change the component to use it,
      // but we can trust that the mutation result being successful means the backend is ready.
      // but we can trust that the mutation result being successful means the backend is ready.
      // To be absolutely safe against race conditions, we'll wait a brief moment.
      await new Promise(resolve => setTimeout(resolve, 100));
      
      navigate('/');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to apply settings');
    } finally {
      setSubmitting(false);
    }
  };

  if (fetching && !data) return <div>Loading Settings...</div>;
  if (queryError) return <div>Error loading settings: {queryError.message}</div>;

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

        <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            id="debug_mode"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
          />
          <label htmlFor="debug_mode" style={{ fontWeight: 'bold', cursor: 'pointer' }}>Debugging Mode</label>
          <small style={{ color: '#666', marginLeft: 'auto' }}>When enabled, additional timer controls and logs are shown during races.</small>
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
                  value={track.laneCount}
                  onChange={(e) => handleTrackChange(index, 'laneCount', parseInt(e.target.value) || 0)}
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
                  value={track.lengthFeet}
                  onChange={(e) => handleTrackChange(index, 'lengthFeet', parseInt(e.target.value) || 0)}
                  min="10"
                  required
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Timer Type</label>
              <select
                value={track.timerType}
                onChange={(e) => handleTrackChange(index, 'timerType', e.target.value)}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', marginBottom: track.timerType === 'AUTO_DETECT_BACKEND' ? '1rem' : '0' }}
              >
                <option value="FAKE">Fake Timer (Manual Control)</option>
                <option value="AUTO_DETECT_BACKEND">Auto-Detect (Backend Connected)</option>
                <option value="AUTO_DETECT_PROXY">Use Remote Proxy</option>
              </select>
            </div>

            {track.timerType === 'AUTO_DETECT_BACKEND' && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Serial Port</label>
                <input
                  type="text"
                  value={track.serialPort || ''}
                  onChange={(e) => handleTrackChange(index, 'serialPort', e.target.value)}
                  required
                  placeholder="e.g. /dev/ttyUSB0 or COM3"
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
                <small style={{ color: '#666' }}>The device path where the timer is connected to the server.</small>
              </div>
            )}
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

      <div style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid #eee', textAlign: 'center', fontSize: '0.85rem', color: '#666' }}>
        <p>
          Trusty Track v{data?.initialConfig?.version || '0.0.0'} &bull; 
          <a 
            href="https://github.com/dknowles2/trusty-track" 
            target="_blank" 
            rel="noopener noreferrer" 
            style={{ marginLeft: '0.5rem', color: 'var(--primary)', textDecoration: 'none' }}
          >
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
