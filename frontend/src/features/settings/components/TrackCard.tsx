/**
 * One track's card in **Settings → Tracks**.
 *
 * Lifted out of `SystemSettings.tsx`, where it was 200 lines of JSX inside a
 * `.map()` and made the shape of the page impossible to see. It is also where
 * the page's crowding was worst: name, geometry, lanes in service, transport,
 * model, serial port, remote start and historical records were one flat run of
 * controls with nothing saying which of them were about the *track* and which
 * about the *timer at the end of it*.
 *
 * The card's first line is its own title — the track's own name, live from
 * the Track Name input below, falling back to **Track {n}** (1-based) while
 * that box is blank (#1251). It used to open with a heading that just said
 * "The track", which repeated a word the page and the section above it had
 * already said, and did nothing to tell two cards apart before you had
 * scrolled past the heading to read the name box underneath it — with the
 * title doing that job instead, everything from Track Name down to lanes in
 * service is self-evidently about *this* track and needs no heading of its
 * own. One divider is left, **Timer**, ahead of the transport, model, serial
 * port, remote start and historical records — it was "The timer", written as
 * the counterpart to "The track"; without that sibling the article read as
 * orphaned, so a bare noun is what a section divider inside a titled card
 * wants.
 *
 * Everything here saves with **Save Settings** except the two panels that say
 * otherwise: lanes in service and track records each save on click, because
 * both are race-day facts rather than configuration you would batch with
 * renaming a track. Lane colours (#611) are the opposite case and say so —
 * which physical lane is painted which colour is a fact about the track
 * itself, set once when it is configured (or never), not something that
 * changes mid-event the way a connector coming loose does — so they save
 * with the rest of this card, beside the scale ratio and reverse-lanes
 * checkbox.
 *
 * The order below the title is Track Name, then Lanes (how many), then
 * `<TrackLanes>` — Lanes in service, which of them work — directly under
 * it, then Length (Feet), Lane colours and scale speed (the track's
 * physical configuration), then Track records, then the Timer divider
 * (#1252; see TrackLanes' own docstring for how it drifted away from
 * directly-under-the-lane-count and how this restored it). Lanes in
 * service and Lane colours are both a chip per lane and can look like the
 * same control at a glance, but they stay two controls with two save
 * models — one urgent and click-through, one batched with the rest of the
 * card — rather than merging into one that would have to juggle both. To
 * keep that legible before either has any state to show, the two rows are
 * drawn differently too: Lanes in service is squared, checkbox-first chips
 * (`.lane-service-chip`); Lane colours is a bare swatch per lane
 * (`.lane-colour-swatch`), no pill around the pair.
 */

import { Link } from 'react-router-dom';
import TrackLanes from './TrackLanes';
import TrackRecords, { type HistoricalRecord } from './TrackRecords';
import { useTerminology } from '../../../context/TerminologyContext';
import { lanesOf } from '../laneOutages';
import { colorForLane, presetColors, presetForLaneCount, presetNameForColor, setLaneColor } from '../laneColors';
import { TIMER_TYPE_LABELS } from '../timerTypeText';
import DocsLink from '../../../components/ui/DocsLink';

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
  reverseLanes: boolean;
  // The vehicle-to-real-life ratio scale speed is computed against, and
  // whether this track offers scale speed at all (#610). Controlled by the
  // checkbox and number input beside Length (feet), below.
  scaleRatio: number;
  showScaleSpeed: boolean;
  laneOutages?: number[];
  historicalRecords?: HistoricalRecord[];
  // The colour painted on each physical lane, if any (#611). One hex
  // string per lane, index 0 meaning lane 1 — see `../laneColors`.
  laneColors?: string[];
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
  // True on the public cloud demo (`initialConfig.demoMode`). The proxy
  // timer needs a browser to hold the serial port open for the whole race,
  // and the backend already refuses that WebSocket on a demo — this only
  // stops the settings page offering a control that cannot work.
  demoMode?: boolean;
  // #892: passed straight through to `TrackLanes`/`TrackRecords`, the two
  // panels on this card that save on click rather than on **Save
  // Settings** and so need their own role check rather than riding on the
  // form's single submit button. The rest of the card's own fields (name,
  // lane count, timer, lane colours…) do not need it here — they save
  // through the parent form's Save Settings button, which does the
  // gating. Defaults `true` so every existing caller (and any install
  // with no PIN set) renders exactly as before.
  isOperator?: boolean;
  onChange: (field: string, value: string | number | boolean) => void;
  onRemove: () => void;
  onLaneOutages: (outages: number[]) => void;
  onRecords: (records: HistoricalRecord[]) => void;
  // Unlike `onLaneOutages` and `onRecords`, this does not talk to a
  // mutation of its own — lane colours save with the rest of the card, on
  // **Save Settings** (see the module docstring for why), so this is
  // ordinary form state exactly like `onChange` above, just for a field
  // `onChange`'s string/number/boolean signature cannot carry.
  onLaneColors: (colors: string[]) => void;
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
  demoMode,
  isOperator = true,
  onChange,
  onRemove,
  onLaneOutages,
  onRecords,
  onLaneColors,
}: Props) {
  const { vehicleLower } = useTerminology();
  const chosen = timerModels.find((m) => m.key === track.timerProfile);
  // Hidden on the demo, following `displayView.viewOptionsFor`'s rule for
  // the awards view: an option that can only disappoint is worse than one
  // that is absent. But kept when it is *already* this track's own value —
  // a seed archive can carry a track saved with it, and a `<select>` whose
  // current value is missing from its own options renders with nothing
  // chosen, telling the operator nothing about what is actually set.
  //
  // Backend auto-detect gets the identical treatment, for the identical
  // reason (#691): `initialize_timer_managers` coerces *every* non-fake
  // track type to `FAKE` in demo mode, not just the proxy one, so a
  // "Plugged into this machine" track would probe USB serial ports on a
  // container that has none.
  const proxyUnavailable = !!demoMode && track.timerType === 'AUTO_DETECT_PROXY';
  const showProxyOption = !demoMode || track.timerType === 'AUTO_DETECT_PROXY';
  const backendUnavailable = !!demoMode && track.timerType === 'AUTO_DETECT_BACKEND';
  const showBackendOption = !demoMode || track.timerType === 'AUTO_DETECT_BACKEND';
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

      {/* The card's own title (#1251) — the track's name, live from the
          Track Name input just below, or Track {n} (1-based) while that box
          is blank. `paddingRight` keeps a long name clear of the Remove
          Track control, which is absolutely positioned over this corner. */}
      <h3
        data-testid={`track-card-title-${index}`}
        style={{
          margin: '0 0 1rem 0',
          fontSize: '1.1rem',
          paddingRight: canRemove ? '2rem' : 0,
        }}
      >
        {track.name.trim() || `Track ${index + 1}`}
      </h3>

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

      <div style={{ marginBottom: '1rem' }}>
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

      {/* Directly under the lane count, because "how many lanes" and "which
          of them work" are the same question asked twice — see TrackLanes'
          own docstring for how this drifted away from here and #1252's fix
          putting it back. Only once the track exists: a track added but not
          yet saved cannot have a broken lane. */}
      {track.id !== undefined && (
        <TrackLanes
          trackId={track.id}
          laneCount={track.laneCount}
          outages={track.laneOutages ?? []}
          onChange={onLaneOutages}
          isOperator={isOperator}
        />
      )}

      <div style={{ marginBottom: '1rem' }}>
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

      {/* Matching a lane's colour on screen to the paint on the physical
          track (#611) — "put car #12 in the blue lane." Every physical
          lane gets a control, not just the ones currently in service:
          colours are indexed by the track's own lane number and do not
          shift when a lane goes out of service or the count is lowered
          (see `../laneColors`'s docstring). Optional throughout — with
          nothing set here every lane renders exactly as it always has.
          Drawn as a swatch, not a pill (#1252): a filled circle with the
          lane number beside it, and no bordered pair around the two, so
          this row reads as "colours" and not as the checkbox-shaped chips
          in Lanes in service above. */}
      <div style={{ marginBottom: '1rem' }}>
        <span style={fieldLabel}>Lane colours (optional)</span>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {lanesOf(track.laneCount).map((lane) => {
            const hex = colorForLane(track.laneColors ?? [], lane);
            const name = hex ? presetNameForColor(hex) : null;
            return (
              <span
                key={lane}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <input
                  type="color"
                  className="lane-colour-swatch"
                  id={`track-lane-color-${index}-${lane}`}
                  value={hex ?? '#ffffff'}
                  title={name ? `Lane ${lane}: ${name}` : `Lane ${lane} colour`}
                  aria-label={`Lane ${lane} colour`}
                  onChange={(e) =>
                    onLaneColors(setLaneColor(track.laneColors ?? [], lane, e.target.value))
                  }
                />
                <span style={{ fontSize: '0.9rem' }}>{lane}</span>
                {hex && (
                  <button
                    type="button"
                    aria-label={`Clear lane ${lane} colour`}
                    onClick={() => onLaneColors(setLaneColor(track.laneColors ?? [], lane, ''))}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted-color)',
                      fontSize: '0.9rem',
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    &times;
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
          {presetForLaneCount(track.laneCount) && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => onLaneColors(presetColors(track.laneCount))}
            >
              Use standard colours
            </button>
          )}
          {(track.laneColors ?? []).some(Boolean) && (
            <button type="button" className="secondary-btn" onClick={() => onLaneColors([])}>
              Clear all
            </button>
          )}
        </div>
        <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.25rem' }}>
          Matches a lane number to the colour painted on the physical track — for
          example &quot;put {vehicleLower} #12 in the blue lane.&quot; &quot;Use
          standard colours&quot; is a starting point, not a lock-in: pick any
          lane&apos;s own colour afterwards to match your track exactly.
        </small>
      </div>

      {/* After Lane colours, not beside Length (feet) — #1252 moved Length
          further up the card and this block has sat after Lane colours for
          a while anyway, so "beside" stopped being true on two counts. It
          doesn't need to sit next to Length on screen: scale speed is
          nothing without a length to compute from (#610), but it reads
          `track.lengthFeet` directly rather than relying on layout
          proximity, and the flag below is ANDed with a positive length
          wherever a speed is actually rendered — so a track with no length
          shows none regardless of this setting, wherever this block sits. */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
          <input
            type="checkbox"
            id={`track-show-scale-speed-${index}`}
            checked={!!track.showScaleSpeed}
            onChange={(e) => onChange('showScaleSpeed', e.target.checked)}
          />
          Show scale speed
        </label>
        <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.25rem' }}>
          Converts a heat&apos;s time into a real-world speed, shown beside the recorded
          time. A track with no length recorded shows no speed, whatever this says.
        </small>
        {track.showScaleSpeed && (
          <div style={{ marginTop: '0.75rem' }}>
            <label htmlFor={`track-scale-ratio-${index}`} style={fieldLabel}>
              Scale (1:25 is standard for a pinewood derby {vehicleLower})
            </label>
            <input
              type="number"
              id={`track-scale-ratio-${index}`}
              value={track.scaleRatio}
              onChange={(e) => onChange('scaleRatio', parseFloat(e.target.value) || 0)}
              min="0.01"
              step="0.01"
              required
              style={textInput}
            />
            <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.25rem' }}>
              How many times smaller than life-size the {vehicleLower} is. 25 is the usual
              1:25 pinewood derby scale; a Space Derby or Raingutter Regatta {vehicleLower} may
              use a different number, or turn scale speed off above.
            </small>
          </div>
        )}
      </div>

      {/* Like the lanes control: only once the track exists, because a track
          added but not yet saved has no id to hang a record on. */}
      {track.id !== undefined && (
        <TrackRecords
          trackId={track.id}
          records={track.historicalRecords ?? []}
          onChange={onRecords}
          isOperator={isOperator}
        />
      )}

      <div data-testid="track-timer">
      <h4 style={{ ...subheading, marginTop: '1.5rem' }}>Timer</h4>

      <div>
        <label htmlFor={`track-timer-type-${index}`} style={fieldLabel}>Timer Type</label>
        <select
          id={`track-timer-type-${index}`}
          value={track.timerType}
          onChange={(e) => onChange('timerType', e.target.value)}
          style={{ ...textInput, marginBottom: track.timerType === 'FAKE' || track.timerType === 'NONE' ? '0' : '1rem' }}
        >
          <option value="FAKE">{TIMER_TYPE_LABELS.FAKE}</option>
          {showBackendOption && (
            <option value="AUTO_DETECT_BACKEND">{TIMER_TYPE_LABELS.AUTO_DETECT_BACKEND}</option>
          )}
          {showProxyOption && (
            <option value="AUTO_DETECT_PROXY">{TIMER_TYPE_LABELS.AUTO_DETECT_PROXY}</option>
          )}
          <option value="NONE">{TIMER_TYPE_LABELS.NONE}</option>
        </select>
      </div>

      {track.timerType === 'NONE' && (
        <p style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          Race Execution won't try to arm a timer. Enter Results becomes the main way
          to record a heat's result — times for a Timed race, finishing order for Points.
        </p>
      )}

      {backendUnavailable && (
        <p style={{ color: 'var(--warning-color)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          Not available in the cloud demo — the shared instance has no USB serial ports
          to detect. Choose another timer type.
        </p>
      )}

      {proxyUnavailable && (
        <p style={{ color: 'var(--warning-color)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          Not available in the cloud demo — a browser tab cannot hold a timer's serial
          port open for a shared instance. Choose another timer type.
        </p>
      )}

      {/* With both auto-detect options hidden above, Fake Timer and No Timer
          are what remain — a real choice about how to see the app work,
          not a picker quietly missing two-thirds of itself. Said explicitly
          only when neither of the "kept because it's already set" notes
          above is already saying something about why an option is absent. */}
      {!!demoMode && !backendUnavailable && !proxyUnavailable && (
        <p style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          The shared cloud demo has no hardware timer to connect to. Pick Fake Timer to
          watch heats run on their own, or No timer to try entering results by hand.
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
            <DocsLink docsKey="timer-check" label="Hardware Timer guide" />
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

      {/*
        Same gating as remote start, just above, and for the same reason:
        there is no cable to run backwards on a fake or no-timer track, so a
        control that could not change anything is worse than no control.
      */}
      {track.timerType !== 'FAKE' && track.timerType !== 'NONE' && (
        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={!!track.reverseLanes}
              onChange={(e) => onChange('reverseLanes', e.target.checked)}
            />
            The timer's cable is wired backwards
          </label>
          <small style={{ color: 'var(--text-muted-color)' }}>
            The timer's lane 1 is the track's highest lane. Tick this instead of rewiring
            the timer or renumbering the track.
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
