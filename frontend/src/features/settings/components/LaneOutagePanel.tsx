/**
 * Taking a lane out of service (#171).
 *
 * Outside the settings form, and saving on click rather than on **Save
 * Settings**. This is a race-day action — a sensor stops working and the next
 * round has to be scheduled around it — not configuration you would batch with
 * renaming a track. The Backup panel sits outside the form for the same reason.
 */

import { useState } from 'react';
import { gql, useMutation, useQuery } from 'urql';
import { useAlert } from '../../../context/AlertContext';
import { lanesOf, outageSummary, toggleLane } from '../laneOutages';

const TRACK_LANES_QUERY = gql`
  query TrackLanes {
    tracks {
      id
      name
      laneCount
      laneOutages
    }
  }
`;

const SET_LANE_OUTAGES_MUTATION = gql`
  mutation SetLaneOutages($trackId: Int!, $lanes: [Int!]!) {
    setLaneOutages(trackId: $trackId, lanes: $lanes)
  }
`;

interface TrackLanes {
  id: number;
  name: string;
  laneCount: number;
  laneOutages: number[];
}

export default function LaneOutagePanel() {
  const { showToast } = useAlert();
  const [result, refetch] = useQuery({ query: TRACK_LANES_QUERY });
  const [, setLaneOutages] = useMutation(SET_LANE_OUTAGES_MUTATION);
  const [busy, setBusy] = useState<number | null>(null);

  const tracks: TrackLanes[] = result.data?.tracks ?? [];
  if (tracks.length === 0) return null;

  const toggle = async (track: TrackLanes, lane: number) => {
    setBusy(track.id);
    const response = await setLaneOutages({
      trackId: track.id,
      lanes: toggleLane(track.laneOutages ?? [], lane),
    });
    setBusy(null);
    if (response.error) {
      showToast(response.error.message, 'error');
      return;
    }
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div
      style={{
        marginTop: '2rem',
        padding: '1rem',
        border: '1px solid #ddd',
        borderRadius: '12px',
        background: '#f9f9f9',
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>
        Lanes out of service
      </h2>
      <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0 }}>
        If a lane stops working, turn it off here and the next round will be
        scheduled around it. Heats that already exist are left alone.
      </p>

      {tracks.map((track) => (
        <div key={track.id} style={{ marginTop: '1rem' }}>
          <strong>{track.name}</strong>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              margin: '0.5rem 0 0.35rem',
            }}
          >
            {lanesOf(track.laneCount).map((lane) => {
              const out = (track.laneOutages ?? []).includes(lane);
              return (
                <label
                  key={lane}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.3rem 0.6rem',
                    borderRadius: '20px',
                    border: '1px solid #ccc',
                    background: out ? '#ffe6e6' : 'white',
                    cursor: busy === track.id ? 'wait' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!out}
                    disabled={busy === track.id}
                    onChange={() => toggle(track, lane)}
                    aria-label={`${track.name} lane ${lane} works`}
                  />
                  Lane {lane}
                </label>
              );
            })}
          </div>
          <small style={{ color: '#666' }}>
            {outageSummary(track.laneCount, track.laneOutages ?? [])}
          </small>
        </div>
      ))}
    </div>
  );
}
