import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import BackupPanel from '../components/BackupPanel';
import PinFieldRow from '../components/PinFieldRow';
import SettingsNav from '../components/SettingsNav';
import TrackCard, { type TimerModel, type TrackFields } from '../components/TrackCard';
import { blankPin, pinInput, pinToSend, type PinField } from '../pinFields';
import { firstProblem, isFormSection, sectionsFor, SECTIONS, type SectionId } from '../sections';
import { clearPin, writePin } from '../../../api/pin';
import { errorText } from '../../../utils/errors';
import type { HistoricalRecord } from '../components/TrackRecords';

const GET_INITIAL_CONFIG = `
  query GetInitialConfig {
    initialConfig {
      initialized
      version
      groupName
      debugMode
      pinRequired
      checkinPinSet
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
        historicalRecords { id timeSeconds racerName carNumber raceName raceDate }
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
      checkinPinSet
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
      checkinPinSet
    }
  }
`;

// The length a track gets when nothing says otherwise. `lengthFeet` is
// nullable on the server and the submit handler already falls back to this,
// so the form has to show it rather than an empty required field — see where
// saved tracks are seeded below.
const DEFAULT_LENGTH_FEET = 40;

const blankTrack = (name: string): TrackFields => ({
  name,
  laneCount: 3,
  lengthFeet: DEFAULT_LENGTH_FEET,
  timerType: 'FAKE',
  serialPort: '',
  timerProfile: '',
  remoteStartInstalled: false,
});

/**
 * A section's own heading, shown only when the sections are separated.
 *
 * On the wizard the headings would be labelling a form somebody is reading top
 * to bottom anyway, and the blurb under each would be three more sentences
 * telling a first-time operator what they are already looking at.
 */
function SectionHeading({ id, sectioned }: { id: SectionId; sectioned: boolean }) {
  const meta = SECTIONS.find((s) => s.id === id);
  if (!sectioned || !meta) return null;
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>{meta.label}</h2>
      <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0, marginBottom: '1.5rem' }}>
        {meta.blurb}
      </p>
    </>
  );
}

export default function SystemConfig() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  // Left empty on load and never seeded from the server — a PIN is stored
  // hashed and cannot be read back. Empty therefore means "leave whatever is
  // set alone", which is exactly what the server does with an absent value;
  // `pinRequired` is what tells the operator whether one exists.
  // A field is a value *and* whether removal was asked for, because blank
  // already means "keep the current one" — see `pinFields.ts` for why that
  // left no way at all to clear a PIN (#192).
  const [operatorPin, setOperatorPin] = useState<PinField>(blankPin);
  const [checkinPin, setCheckinPin] = useState<PinField>(blankPin);
  const [pinRequired, setPinRequired] = useState(false);
  const [checkinPinSet, setCheckinPinSet] = useState(false);

  const [tracks, setTracks] = useState<TrackFields[]>([blankTrack('Main Track')]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Which section is on screen. Only consulted once the install is
  // configured — the first run is a wizard and shows the lot. See
  // `sections.ts`.
  const [section, setSection] = useState<SectionId>('general');

  const [configResult] = useQuery({ query: GET_INITIAL_CONFIG, requestPolicy: 'network-only' });
  const [modelsResult] = useQuery({ query: GET_TIMER_MODELS });
  const timerModels: TimerModel[] = modelsResult.data?.timerModels || [];
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
      setCheckinPinSet(!!data.initialConfig.checkinPinSet);
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
            historicalRecords?: HistoricalRecord[];
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
            laneOutages: t.laneOutages ?? [],
            historicalRecords: t.historicalRecords ?? []
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
    setTracks([...tracks, blankTrack(`Track ${tracks.length + 1}`)]);
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

    // The browser's own validation only covers the fields that are on screen,
    // and with one section showing at a time most of them are not. So the
    // whole form is checked here, and a failure takes the operator to the
    // section holding it rather than reporting a problem they cannot see.
    const problem = firstProblem(groupName, tracks);
    if (problem) {
      setError(problem.message);
      if (isEditing) setSection(problem.section);
      setSubmitting(false);
      return;
    }

    try {
      const variables = {
        config: {
          groupName: groupName,
          debugMode: debugMode,
          // Absent, a value, or an explicit empty string to clear — the rule
          // is in `pinFields.ts`, because getting it wrong in either direction
          // is serious: an unconditional send unlocks the install whenever
          // anyone renames a track, and no way to send `''` locks an operator
          // out of their own event with no recovery.
          ...pinInput(operatorPin, checkinPin),
          tracks: tracks.map(({ id, name, laneCount, lengthFeet, timerType, serialPort, timerProfile, remoteStartInstalled }) => ({
            // Absent for a track just added on this screen, which has no row
            // yet; present for a saved one, so the server matches it to its
            // database row by id rather than by its position in this list
            // (#318) — matching by position renamed and reconfigured
            // whichever track happened to follow one removed from the middle.
            id: id ?? null,
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
      // To be absolutely safe against race conditions, we'll wait a brief moment.
      await new Promise(resolve => setTimeout(resolve, 100));

      // The device that set the operator PIN keeps it. Otherwise setting one
      // demotes the operator on their own laptop the instant they save, which
      // is the same lockout #192 was about approached from the other side.
      // Removing it drops the stored copy for the same reason.
      const operatorPinSent = pinToSend(operatorPin);
      if (operatorPinSent) {
        writePin(operatorPinSent);
      } else if (operatorPinSent === '') {
        clearPin();
      }

      if (operatorPinSent !== undefined) {
        // A full load rather than a client-side navigation: the subscription
        // socket carries the PIN in its URL, so a changed PIN needs a new
        // socket. Same reasoning as entering one through the padlock.
        window.location.href = '/';
        return;
      }

      navigate('/');
    } catch (err: unknown) {
      setError(errorText(err, 'The settings could not be saved.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (fetching && !data) return <div>Loading Settings...</div>;
  if (queryError) {
    return <div>{errorText(queryError, 'The settings could not be loaded.')}</div>;
  }

  const navSections = sectionsFor(isEditing);
  const sectioned = navSections.length > 0;
  /** On the wizard every section is on screen; otherwise only the chosen one. */
  const shows = (id: SectionId) => !sectioned || section === id;

  return (
    <div className="container">
      <h1>{isEditing ? 'System Settings' : 'Initial Setup'}</h1>
      <p>{isEditing ? 'Update your racing environment settings.' : "Welcome to Trusty Track! Let's set up your racing environment."}</p>

      {error && <div style={{ color: 'var(--error)', marginBottom: '1rem', padding: '0.5rem', border: '1px solid var(--error)', borderRadius: '4px' }}>{error}</div>}

      <div className={sectioned ? 'settings-layout' : undefined}>
        {sectioned && (
          <SettingsNav sections={navSections} current={section} onSelect={setSection} />
        )}

        <div className="settings-section">
          {/* Only the form sections live inside the form. Backup does not: a
              Restore button under a submit button that says "Save Settings"
              invites exactly one kind of mistake. */}
          {(!sectioned || isFormSection(section)) && (
            <form onSubmit={handleSubmit}>
              {shows('general') && (
                <section aria-labelledby="settings-general" data-testid="general-panel">
                  <SectionHeading id="general" sectioned={sectioned} />
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
                </section>
              )}

              {shows('access') && (
                <section data-testid="access-panel">
                  {sectioned ? <SectionHeading id="access" sectioned={sectioned} /> : <h2 style={{ marginBottom: '0.5rem' }}>Access</h2>}
                  <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0, marginBottom: '1rem' }}>
                    {pinRequired
                      ? 'A PIN is set. Screens without one can watch the race but cannot change anything.'
                      : 'No PIN is set, so anyone on this network can change anything — including deleting the race. Set one to stop that.'}
                  </p>

                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                    <PinFieldRow
                      id="operator_pin"
                      label="Operator PIN"
                      isSet={pinRequired}
                      placeholder={pinRequired ? 'Set — type to change' : 'e.g. 1234'}
                      what="Runs the race."
                      field={operatorPin}
                      onChange={setOperatorPin}
                    />
                    <PinFieldRow
                      id="checkin_pin"
                      label="Check-in PIN"
                      optional
                      isSet={checkinPinSet}
                      placeholder={checkinPinSet ? 'Set — type to change' : 'e.g. 5678'}
                      what="Registration desk: racers and check-in only."
                      field={checkinPin}
                      onChange={setCheckinPin}
                    />
                  </div>

                  {/* The hint the check-in PIN was missing (#210). The role has existed
                      since #15 and is documented, but nothing on the screen said what it
                      is *for* — so an operator setting PINs had no cue that running the
                      desk on a second device is a supported way to work. One sentence,
                      not a wizard. */}
                  <p data-testid="checkin-pin-hint" style={{ color: '#666', fontSize: '0.85rem', marginTop: '-1.25rem', marginBottom: '2rem' }}>
                    Running check-in on a separate tablet? Set a check-in PIN and enter it
                    on that device. It can add racers and check them in, and nothing else —
                    so a tablet left on the registration table cannot delete a round.
                  </p>
                </section>
              )}

              {shows('tracks') && (
                <section data-testid="tracks-panel">
                  {sectioned ? <SectionHeading id="tracks" sectioned={sectioned} /> : <h2 style={{ marginBottom: '1rem' }}>Tracks</h2>}
                  {tracks.map((track, index) => (
                    <TrackCard
                      key={index}
                      index={index}
                      track={track}
                      timerModels={timerModels}
                      canRemove={tracks.length > 1}
                      onChange={(field, value) => handleTrackChange(index, field, value)}
                      onRemove={() => removeTrack(index)}
                      onLaneOutages={(laneOutages) =>
                        setTracks((current) =>
                          current.map((t, i) => (i === index ? { ...t, laneOutages } : t)),
                        )
                      }
                      onRecords={(historicalRecords) =>
                        setTracks((current) =>
                          current.map((t, i) => (i === index ? { ...t, historicalRecords } : t)),
                        )
                      }
                    />
                  ))}

                  <button
                    type="button"
                    onClick={addTrack}
                    className="secondary-btn"
                    style={{ marginBottom: '2rem', display: 'block', width: '100%' }}
                  >
                    + Add Another Track
                  </button>
                </section>
              )}

              <button type="submit" className="primary-btn" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          )}

          {/*
            Only once there is something to back up. On the first run this screen is
            the setup wizard, and offering to restore before the install exists
            would be offering to replace nothing.
          */}
          {isEditing && shows('backup') && (
            <section>
              <SectionHeading id="backup" sectioned={sectioned} />
              <BackupPanel />
            </section>
          )}

          {/*
            The wizard has no nav to hang these off, so they stay where they
            were — outside the form, because checking the timer is something
            you do before an event and must not look like a step of saving
            settings. Once the install is configured they are in the nav.
          */}
          {!sectioned && (
            <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>
              <Link to="/timer-check">Check the timer connection &rarr;</Link>
              {' · '}
              <Link to="/activity">See what has happened &rarr;</Link>
            </p>
          )}
        </div>
      </div>

      <div style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid #eee', textAlign: 'center', fontSize: '0.85rem', color: '#666' }}>
        <p>
          {/* Built from the git hash, so it changes on every commit. The
              documentation screenshots hide it by this test id, the same one
              the navigation bar's stamp carries. */}
          <span data-testid="app-version">Trusty Track v{data?.initialConfig?.version || '0.0.0'}</span> &bull;
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
