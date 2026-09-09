/**
 * Which of one track's lanes are working (#171).
 *
 * Inside the track's own card in **Tracks**, directly under the lane count,
 * because that is what it is a property of. It was briefly its own section at
 * the foot of the page, which meant repeating the track's name to say which
 * track it meant — a good sign it was in the wrong place.
 *
 * Unlike the rest of the card it saves on click rather than on **Save
 * Settings**, and says so. A lane going out of service is a race-day event —
 * a connector comes loose between rounds — not configuration you would batch
 * with renaming a track.
 */

import { useState } from 'react';
import { gql, useMutation } from 'urql';
import { useRunMutation } from '../../../context/runMutation';
import { lanesOf, outageSummary, toggleLane } from '../laneOutages';
import { NEEDS_OPERATOR_PIN_MESSAGE } from '../../core/roleMessage';

const SET_LANE_OUTAGES_MUTATION = gql`
  mutation SetLaneOutages($trackId: Int!, $lanes: [Int!]!) {
    setLaneOutages(trackId: $trackId, lanes: $lanes)
  }
`;

interface Props {
  trackId: number;
  laneCount: number;
  outages: number[];
  onChange: (outages: number[]) => void;
  /**
   * #892: `setLaneOutages` is operator-only (backend/api/auth.py's
   * OPERATOR_ONLY_MUTATIONS) — a lane going out of service changes every
   * schedule generated from now on. Defaults `true` so every existing
   * caller (and any install with no PIN set, where every caller resolves
   * as OPERATOR) renders exactly as before.
   */
  isOperator?: boolean;
}

export default function TrackLanes({ trackId, laneCount, outages, onChange, isOperator = true }: Props) {
  const [, setLaneOutages] = useMutation(SET_LANE_OUTAGES_MUTATION);
  const runMutation = useRunMutation();
  const [busy, setBusy] = useState(false);

  const toggle = async (lane: number) => {
    const next = toggleLane(outages, lane);
    setBusy(true);
    const response = await runMutation(
      setLaneOutages,
      { trackId, lanes: next },
      'The lane change could not be saved.',
    );
    setBusy(false);
    if (!response) return;
    // The server drops lanes the track does not have, so take its answer
    // rather than assuming ours was accepted whole.
    onChange(response.data?.setLaneOutages ?? next);
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <span style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
        Lanes in service
      </span>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {lanesOf(laneCount).map((lane) => {
          const out = outages.includes(lane);
          return (
            <label
              key={lane}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.25rem 0.55rem',
                borderRadius: '20px',
                border: '1px solid var(--input-border-color)',
                background: out ? 'var(--danger-soft-bg-color)' : 'var(--surface-color)',
                fontSize: '0.9rem',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={!out}
                disabled={busy || !isOperator}
                title={!isOperator ? NEEDS_OPERATOR_PIN_MESSAGE : undefined}
                onChange={() => toggle(lane)}
                aria-label={`Lane ${lane} works`}
              />
              {lane}
            </label>
          );
        })}
      </div>
      <small style={{ color: 'var(--text-muted-color)' }}>
        {outageSummary(laneCount, outages)}. Turning a lane off applies straight
        away, and affects rounds generated from now on.
      </small>
    </div>
  );
}
