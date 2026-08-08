import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import BackupPanel from '../components/BackupPanel';
import TrackLanes from '../components/TrackLanes';

const GET_INITIAL_CONFIG = `
  query GetInitialConfig {
    initialConfig {
      initialized
      version
      groupName
      debugMode
      pinRequired
      isOperator
      tracks {
        id
        name
        laneCount
        lengthFeet
        timerType
        serialPort
        timerProfile
        remoteStartInstalled
        laneOutages
      }
    }
  }
`;

// The models a track can be set to. The frontend holds no copy of the
// profiles — the backend owns every piece of protocol state — so this is the
// list to show and the key to send back, nothing more.
const GET_TIMER_MODELS = `
  query GetTimerModels {
    timerModels {
      key
      name
      provenance
      detectable
      baudRate
      dataBits
      stopBits
      parity
    }
  }
`;

const CREATE_INITIAL_CONFIG = `
  mutation CreateInitialConfig($config: InitialConfigInput!) {
    createInitialConfig(config: $config) {
      initialized
      groupName
      debugMode
      pinRequired
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
      pinRequired
    }
  }
`;

export default function SystemConfig() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  // Left empty on load and never seeded from the server — a PIN is stored
  // hashed and cannot be read back. Empty therefore means "leave whatever is
  // set alone", which is exactly what the server does with an absent value;
  // `pinRequired` is what tells the operator whether one exists.
  const [operatorPin, setOperatorPin] = useState('');
  const [checkinPin, setCheckinPin] = useState('');
  const [pinRequired, setPinRequired] = useState(false);
  // The length a track gets when nothing says otherwise. `lengthFeet` is
  // nullable on the server and the submit handler already falls back to this,
  // so the form has to show it rather than an empty required field — see where
  // saved tracks are seeded below.
  const DEFAULT_LENGTH_FEET = 40;

  interface TrackFields {
    // Absent until the track has been saved, which is also when it can first
    // have a lane out of service.
    id?: number;
    name: string;
    laneCount: number;
    lengthFeet: number;
    timerType: string;
    serialPort: string;
    timerProfile: string;
    remoteStartInstalled: boolean;
    laneOutages?: number[];
  }

  const [tracks, setTracks] = useState<TrackFields[]>([{ name: 'Main Track', laneCount: 3, lengthFeet: DEFAULT_LENGTH_FEET, timerType: 'FAKE', serialPort: '', timerProfile: '', remoteStartInstalled: false }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [configResult] = useQuery({ query: GET_INITIAL_CONFIG, requestPolicy: 'network-only' });
  const [modelsResult] = useQuery({ query: GET_TIMER_MODELS });
  const timerModels: {
    key: string;
    name: string;
    provenance: string;
    detectable: boolean;
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string;
  }[] = modelsResult.data?.timerModels || [];
  const { data, fetching, error: queryError } = configResult;

  const [, createInitialConfig] = useMutation(CREATE_INITIAL_CONFIG);
  const [, updateInitialConfig] = useMutation(UPDATE_INITIAL_CONFIG);

  // Seeded from the saved configuration during render rather than in an
  // effect, so the form never paints empty and then fills in. `seededFrom`
  // starts at undefined rather than at the current data: a query already
  // resolved by the first render would otherwise look as though it had been
  // read, and the operator would be shown a blank setup screen for a system
  // that is configured.
  const [seededFrom, setSeededFrom] = useState<typeof data>(undefined);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    if (data.initialConfig) {
      const { initialized, groupName: savedGroupName, debugMode: savedDebugMode, tracks: savedTracks } = data.initialConfig;
      setPinRequired(!!data.initialConfig.pinRequired);
      if (initialized) {
        setIsEditing(true);
        setGroupName(savedGroupName || '');
        setDebugMode(!!savedDebugMode);
        if (savedTracks && savedTracks.length > 0) {
          setTracks(savedTracks.map((t: {
            id: number;
            name: string;
            laneCount: number;
            lengthFeet: number | null;
            timerType: string;
            serialPort?: string;
            timerProfile?: string | null;
            remoteStartInstalled?: boolean;
            laneOutages?: number[];
          }) => ({
            id: t.id,
            name: t.name,
            laneCount: t.laneCount,
            // Null is legitimate — the column is nullable and `createTrack`
            // does not require a length — but the input is `required`, so a
            // null here renders an empty box that blocks the whole form from
            // submitting, with nothing on screen naming the track at fault.
            lengthFeet: t.lengthFeet ?? DEFAULT_LENGTH_FEET,
            timerType: t.timerType,
            serialPort: t.serialPort || '',
            timerProfile: t.timerProfile || '',
            remoteStartInstalled: !!t.remoteStartInstalled,
            laneOutages: t.laneOutages ?? []
          })));
        }
      }
    }
  }

  const handleTrackChange = (index: number, field: string, value: string | number | boolean) => {
    const newTracks = [...tracks];
    newTracks[index] = { ...newTracks[index], [field]: value };
    setTracks(newTracks);
  };

  const addTrack = () => {
    setTracks([...tracks, { name: `Track ${tracks.length + 1}`, laneCount: 3, lengthFeet: DEFAULT_LENGTH_FEET, timerType: 'FAKE', serialPort: '', timerProfile: '', remoteStartInstalled: false }]);
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
          // Only sent when the operator typed something. Sending `''` would
          // *clear* the PIN, and this form re-submits everything on every save
          // — so an unconditional send would unlock the install the next time
          // anyone renamed a track.
          ...(operatorPin ? { operatorPin } : {}),
          ...(checkinPin ? { checkinPin } : {}),
          tracks: tracks.map(({ name, laneCount, lengthFeet, timerType, serialPort, timerProfile, remoteStartInstalled }) => ({
            name,
            laneCount,
            lengthFeet: lengthFeet || DEFAULT_LENGTH_FEET,
            timerType,
            serialPort: timerType === 'AUTO_DETECT_BACKEND' ? serialPort : null,
            // Empty means "work it out", which is what null is on the server.
            // A model is meaningless on the fake timer, so it does not travel
            // with one — otherwise a track switched to FAKE and back would
            // silently keep a model the operator had stopped seeing.
            timerProfile: timerType === 'FAKE' ? null : (timerProfile || null),
            remoteStartInstalled
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

        <h2 style={{ marginBottom: '0.5rem' }}>Access</h2>
        <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0, marginBottom: '1rem' }}>
          {pinRequired
            ? 'A PIN is set. Screens without one can watch the race but cannot change anything.'
            : 'No PIN is set, so anyone on this network can change anything — including deleting the race. Set one to stop that.'}
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="operator_pin" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
              Operator PIN
            </label>
            <input
              type="text"
              inputMode="numeric"
              id="operator_pin"
              value={operatorPin}
              onChange={(e) => setOperatorPin(e.target.value)}
              placeholder={pinRequired ? 'Set — type to change' : 'e.g. 1234'}
              style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <small style={{ color: '#666' }}>Runs the race. Leave blank to keep the current PIN.</small>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="checkin_pin" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
              Check-in PIN <span style={{ fontWeight: 'normal', color: '#666' }}>(optional)</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              id="checkin_pin"
              value={checkinPin}
              onChange={(e) => setCheckinPin(e.target.value)}
              placeholder="e.g. 5678"
              style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <small style={{ color: '#666' }}>Registration desk: racers and check-in only.</small>
          </div>
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
              <label htmlFor={`track-name-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Track Name</label>
              <input
                type="text"
                id={`track-name-${index}`}
                  value={track.name}
                onChange={(e) => handleTrackChange(index, 'name', e.target.value)}
                required
                placeholder="e.g. Main Track"
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor={`track-lanes-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Lanes</label>
                <input
                  type="number"
                  id={`track-lanes-${index}`}
                  value={track.laneCount}
                  onChange={(e) => handleTrackChange(index, 'laneCount', parseInt(e.target.value) || 0)}
                  min="1"
                  max="8"
                  required
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor={`track-length-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Length (Feet)</label>
                <input
                  type="number"
                  id={`track-length-${index}`}
                  value={track.lengthFeet}
                  onChange={(e) => handleTrackChange(index, 'lengthFeet', parseInt(e.target.value) || 0)}
                  min="10"
                  required
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            </div>

            {/* Under the lane count, because "how many lanes" and "which of
                them work" are the same question asked twice. Only once the
                track exists: a track added but not yet saved cannot have a
                broken lane. */}
            {track.id !== undefined && (
              <TrackLanes
                trackId={track.id}
                laneCount={track.laneCount}
                outages={track.laneOutages ?? []}
                onChange={(outages) =>
                  setTracks((current) =>
                    current.map((t, i) =>
                      i === index ? { ...t, laneOutages: outages } : t,
                    ),
                  )
                }
              />
            )}

            <div>
              <label htmlFor={`track-timer-type-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Timer Type</label>
              <select
                id={`track-timer-type-${index}`}
                  value={track.timerType}
                onChange={(e) => handleTrackChange(index, 'timerType', e.target.value)}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', marginBottom: track.timerType === 'AUTO_DETECT_BACKEND' ? '1rem' : '0' }}
              >
                <option value="FAKE">Fake Timer (Manual Control)</option>
                <option value="AUTO_DETECT_BACKEND">Auto-Detect (Backend Connected)</option>
                <option value="AUTO_DETECT_PROXY">Use Remote Proxy</option>
              </select>
            </div>

            {track.timerType !== 'FAKE' && (() => {
              const chosen = timerModels.find((m) => m.key === track.timerProfile);
              const unusualFraming =
                chosen && (chosen.baudRate !== 9600 || chosen.dataBits !== 8 || chosen.stopBits !== 1 || chosen.parity !== 'N');
              return (
                <div>
                  <label htmlFor={`track-model-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                    Timer Model <span style={{ fontWeight: 'normal', color: '#666' }}>(optional)</span>
                  </label>
                  <select
                    id={`track-model-${index}`}
                    value={track.timerProfile}
                    onChange={(e) => handleTrackChange(index, 'timerProfile', e.target.value)}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="">Detect automatically</option>
                    {timerModels.map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.name}{model.detectable ? '' : ' — must be chosen'}
                      </option>
                    ))}
                  </select>
                  <small style={{ color: '#666', display: 'block', marginTop: '0.25rem' }}>
                    {chosen
                      ? chosen.provenance
                      : 'Leave this alone and the app asks each timer it knows about who it is. Pick a model if yours is not found, or to stop it asking.'}
                  </small>
                  {chosen && !chosen.detectable && (
                    <small style={{ color: '#8a6d00', display: 'block', marginTop: '0.25rem' }}>
                      This model cannot answer an identifying question, so choosing it here is the only way to use it.
                    </small>
                  )}
                  {unusualFraming && (
                    <small style={{ color: '#8a6d00', display: 'block', marginTop: '0.25rem' }}>
                      Uses {chosen.baudRate} baud, {chosen.dataBits} data bits, {chosen.stopBits} stop bit
                      {chosen.stopBits === 1 ? '' : 's'}, parity {chosen.parity} — not the usual 9600 8-N-1.
                    </small>
                  )}
                </div>
              );
            })()}

            {track.timerType === 'AUTO_DETECT_BACKEND' && (
              <div>
                <label htmlFor={`track-serial-${index}`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Serial Port <span style={{ fontWeight: 'normal', color: '#666' }}>(optional)</span></label>
                {/*
                  Deliberately not `required`. Leaving it blank is now the
                  normal case: the server finds the timer by probing the USB
                  serial ports. A device path is the escape hatch for a timer
                  on a built-in serial port, which is never probed.
                */}
                <input
                  type="text"
                  id={`track-serial-${index}`}
                  value={track.serialPort || ''}
                  onChange={(e) => handleTrackChange(index, 'serialPort', e.target.value)}
                  placeholder="Leave blank to detect automatically"
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
                <small style={{ color: '#666' }}>
                  Leave this blank and the server will look for the timer on each USB port when it
                  starts. Fill it in only if your timer is on a built-in serial port, or you need to
                  point at one particular device — for example <code>/dev/ttyUSB0</code> or <code>COM3</code>.
                </small>
              </div>
            )}

            {/*
              Not shown for the fake timer, which has no gate. Otherwise always
              shown, because whether the accessory is fitted is something only
              the operator knows — no timer protocol reports it, and the
              MicroWizard silently ignores the command without it.
            */}
            {track.timerType !== 'FAKE' && (
              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={!!track.remoteStartInstalled}
                    onChange={(e) => handleTrackChange(index, 'remoteStartInstalled', e.target.checked)}
                  />
                  This track has a remote start gate
                </label>
                <small style={{ color: '#666' }}>
                  Tick this only if a solenoid is fitted to the start gate and wired to the timer.
                  With it on, an armed heat can be launched from the race screen instead of by hand.
                </small>
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

      {/*
        Outside the form on purpose: checking the timer is something you do
        before an event, and it must not look like a step of saving settings.
      */}
      <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>
        <Link to="/timer-check">Check the timer connection &rarr;</Link>
      </p>

      {/*
        Only once there is something to back up. On the first run this screen is
        the setup wizard, and offering to restore before the install exists
        would be offering to replace nothing.
      */}
      {isEditing && <BackupPanel />}

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
