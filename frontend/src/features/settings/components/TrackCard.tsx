/**
 * One track's card in **Settings → Tracks**.
 *
 * Lifted out of `SystemSettings.tsx`, where it was 200 lines of JSX inside a
 * `.map()` and made the shape of the page impossible to see. It is also where
 * the page's crowding was worst: name, geometry, lanes in service, transport,
 * model, serial port, remote start and historical records were one flat run of
 * controls with nothing saying which of them were about the *track* and which
 * about the *timer at the end of it*. Two subheadings, and the card reads.
 *
 * Everything here saves with **Save Settings** except the two panels that say
 * otherwise: lanes in service and track records each save on click, because
 * both are race-day facts rather than configuration you would batch with
 * renaming a track.
 */

import { Link } from 'react-router-dom';
import TrackLanes from './TrackLanes';
import TrackRecords, { type HistoricalRecord } from './TrackRecords';

export interface TrackFields {
  // Absent until the track has been saved, which is also when it can first
  // have a lane out of service or a record hung on it.
  id?: number;
  name: string;
  laneCount: number;
  lengthFeet: number;
  timerType: string;
  serialPort: string;
  timerProfile: string;
  remoteStartInstalled: boolean;
  laneOutages?: number[];
  historicalRecords?: HistoricalRecord[];
}

export interface TimerModel {
  key: string;
  name: string;
  provenance: string;
  detectable: boolean;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
}

interface Props {
  index: number;
  track: TrackFields;
  timerModels: readonly TimerModel[];
  canRemove: boolean;
  onChange: (field: string, value: string | number | boolean) => void;
  onRemove: () => void;
  onLaneOutages: (outages: number[]) => void;
  onRecords: (records: HistoricalRecord[]) => void;
}

const subheading: React.CSSProperties = {
  margin: '0 0 0.75rem 0',
  fontSize: '0.8rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted-color)',
};

const fieldLabel: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.25rem',
  fontSize: '0.9rem',
};

const textInput: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem',
  borderRadius: '4px',
  border: '1px solid var(--input-border-color)',
};

export default function TrackCard({
  index,
  track,
  timerModels,
  canRemove,
  onChange,
  onRemove,
  onLaneOutages,
  onRecords,
}: Props) {
  const chosen = timerModels.find((m) => m.key === track.timerProfile);
  const unusualFraming =
    chosen &&
    (chosen.baudRate !== 9600 ||
      chosen.dataBits !== 8 ||
      chosen.stopBits !== 1 ||
      chosen.parity !== 'N');

  return (
    <div
      data-testid={`track-card-${index}`}
      style={{
        marginBottom: '1.5rem',
        padding: '1rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--surface-tint-color)',
        position: 'relative',
      }}
    >
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'none',
            border: 'none',
            color: 'var(--error)',
            cursor: 'pointer',
            fontSize: '1.2rem',
          }}
          title="Remove Track"
        >
          &times;
        </button>
      )}

      <h3 style={subheading}>The track</h3>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor={`track-name-${index}`} style={fieldLabel}>Track Name</label>
        <input
          type="text"
          id={`track-name-${index}`}
          value={track.name}
          onChange={(e) => onChange('name', e.target.value)}
          required
          placeholder="e.g. Main Track"
          style={textInput}
        />
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`track-lanes-${index}`} style={fieldLabel}>Lanes</label>
          <input
            type="number"
            id={`track-lanes-${index}`}
            value={track.laneCount}
            onChange={(e) => onChange('laneCount', parseInt(e.target.value) || 0)}
            min="1"
            max="8"
            required
            style={textInput}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor={`track-length-${index}`} style={fieldLabel}>Length (Feet)</label>
          <input
            type="number"
            id={`track-length-${index}`}
            value={track.lengthFeet}
            onChange={(e) => onChange('lengthFeet', parseInt(e.target.value) || 0)}
            min="10"
            required
            style={textInput}
          />
        </div>
      </div>

      {/* Under the lane count, because "how many lanes" and "which of them
          work" are the same question asked twice. Only once the track exists:
          a track added but not yet saved cannot have a broken lane. */}
      {track.id !== undefined && (
        <TrackLanes
          trackId={track.id}
          laneCount={track.laneCount}
          outages={track.laneOutages ?? []}
          onChange={onLaneOutages}
        />
      )}

      {/* Like the lanes control: only once the track exists, because a track
          added but not yet saved has no id to hang a record on. */}
      {track.id !== undefined && (
        <TrackRecords
          trackId={track.id}
          records={track.historicalRecords ?? []}
          onChange={onRecords}
        />
      )}

      <div data-testid="track-timer">
      <h3 style={{ ...subheading, marginTop: '1.5rem' }}>The timer</h3>

      <div>
        <label htmlFor={`track-timer-type-${index}`} style={fieldLabel}>Timer Type</label>
        <select
          id={`track-timer-type-${index}`}
          value={track.timerType}
          onChange={(e) => onChange('timerType', e.target.value)}
          style={{ ...textInput, marginBottom: track.timerType === 'FAKE' || track.timerType === 'NONE' ? '0' : '1rem' }}
        >
          <option value="FAKE">Fake Timer (Manual Control)</option>
          <option value="AUTO_DETECT_BACKEND">Plugged into this machine</option>
          <option value="AUTO_DETECT_PROXY">Plugged into the laptop running the browser</option>
          <option value="NONE">No timer — I'll enter results by hand</option>
        </select>
      </div>

      {track.timerType === 'NONE' && (
        <p style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          Race Execution won't try to arm a timer. Enter Results becomes the main way
          to record a heat's result — times for a Timed race, finishing order for Points.
        </p>
      )}

      {track.timerType !== 'FAKE' && track.timerType !== 'NONE' && (
        <div>
          <label htmlFor={`track-model-${index}`} style={fieldLabel}>
            Timer Model <span style={{ fontWeight: 'normal', color: 'var(--text-muted-color)' }}>(optional)</span>
          </label>
          <select
            id={`track-model-${index}`}
            value={track.timerProfile}
            onChange={(e) => onChange('timerProfile', e.target.value)}
            style={textInput}
          >
            <option value="">Detect automatically</option>
            {timerModels.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}{model.detectable ? '' : ' — must be chosen'}
              </option>
            ))}
          </select>
          <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.25rem' }}>
            {chosen
              ? chosen.provenance
              : 'Leave this alone and the app asks each timer it knows about who it is. Pick a model if yours is not found, or to stop it asking.'}{' '}
            <a
              href="https://trusty-track.com/docs/hardware-timer/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hardware Timer guide
            </a>
          </small>
          {chosen && !chosen.detectable && (
            <small style={{ color: 'var(--warning-color)', display: 'block', marginTop: '0.25rem' }}>
              This model cannot answer an identifying question, so choosing it here is the only way to use it.
            </small>
          )}
          {unusualFraming && (
            <small style={{ color: 'var(--warning-color)', display: 'block', marginTop: '0.25rem' }}>
              Uses {chosen.baudRate} baud, {chosen.dataBits} data bits, {chosen.stopBits} stop bit
              {chosen.stopBits === 1 ? '' : 's'}, parity {chosen.parity} — not the usual 9600 8-N-1.
            </small>
          )}
        </div>
      )}

      {track.timerType === 'AUTO_DETECT_BACKEND' && (
        <div style={{ marginTop: '1rem' }}>
          <label htmlFor={`track-serial-${index}`} style={fieldLabel}>
            Serial Port <span style={{ fontWeight: 'normal', color: 'var(--text-muted-color)' }}>(optional)</span>
          </label>
          {/*
            Deliberately not `required`. Leaving it blank is now the normal
            case: the server finds the timer by probing the USB serial ports. A
            device path is the escape hatch for a timer on a built-in serial
            port, which is never probed.
          */}
          <input
            type="text"
            id={`track-serial-${index}`}
            value={track.serialPort || ''}
            onChange={(e) => onChange('serialPort', e.target.value)}
            placeholder="Leave blank to detect automatically"
            style={textInput}
          />
          <small style={{ color: 'var(--text-muted-color)' }}>
            Leave this blank and Trusty Track finds the timer by itself. Fill it in only if
            your timer is on a built-in serial port, or you need to point at one particular
            device — for example <code>/dev/ttyUSB0</code> or <code>COM3</code>.
          </small>
        </div>
      )}

      {/*
        Not shown for the fake timer, which has no gate, or for no timer at
        all, which has neither a gate nor anything to release it. Otherwise
        always shown, because whether the accessory is fitted is something
        only the operator knows — no timer protocol reports it, and the
        MicroWizard silently ignores the command without it.
      */}
      {track.timerType !== 'FAKE' && track.timerType !== 'NONE' && (
        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={!!track.remoteStartInstalled}
              onChange={(e) => onChange('remoteStartInstalled', e.target.checked)}
            />
            This track has a remote start gate
          </label>
          <small style={{ color: 'var(--text-muted-color)' }}>
            Tick this only if a solenoid is fitted to the start gate and wired to the timer.
            With it on, an armed heat can be launched from the race screen instead of by hand.
          </small>
        </div>
      )}

      {/* "Is my timer working" is a question about *this* timer, so the way in
          is on the timer's own card. The link carries the track and the
          diagnostics page scrolls to it — a venue with three tracks would
          otherwise land on a page of three live panels and have to find the
          right one. The general door stays in the settings nav, because a
          track that has not been saved yet has no id to point at. */}
      {track.id !== undefined && (
        <p style={{ marginTop: '1rem', marginBottom: 0, fontSize: '0.9rem' }}>
          <Link to={`/timer-check#timer-${track.id}`}>Check this timer &rarr;</Link>
        </p>
      )}
      </div>
    </div>
  );
}
