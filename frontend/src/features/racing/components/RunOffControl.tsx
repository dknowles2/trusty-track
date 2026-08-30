import { useMemo, useState } from 'react';
import { useMutation, useQuery, useSubscription } from 'urql';
import {
  CREATE_RUN_OFF_HEAT_MUTATION,
  DELETE_RUN_OFF_HEAT_MUTATION,
  GET_RUN_OFF_HEATS,
  HEAT_SESSION_SUBSCRIPTION,
  PREPARE_HEAT,
  UPDATE_HEAT_RESULT_MUTATION,
} from '../graphql/queries';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { runOffAnnouncement } from '../runOff';
import type { GetRunOffHeatsQuery } from '../../../gql/operations';

type RunOffHeatRow = NonNullable<GetRunOffHeatsQuery['race']>['runOffHeats'][number];

interface TiedRacer {
  racerId: number;
  name: string;
}

interface RunOffControlProps {
  raceId: number;
  /** Null when the race has no track configured — a run-off still exists
   * as a record, but nothing can arm or time it, so the control offers
   * only manual entry. */
  trackId: number | null;
  /** The round this cluster's shared rank belongs to, or `null` for the
   * race's own overall (prelim-scoped) standings — must match whichever
   * `Race.leaderboard(roundId: ...)` view the caller read the tie from. */
  settlesRoundId: number | null;
  /** Exactly the racers sharing the rank this control is attached to. */
  racers: TiedRacer[];
}

/**
 * Settling a tie by racing the tied cars (#550).
 *
 * Appears against a shared rank on the standings page and beside a
 * contested cut on the schedule — both places a tie is already in front of
 * the operator. One control either way: create the heat, arm it like any
 * other, and record a result through the ordinary door
 * (`updateHeatResult`) — no special casing here for the timer, because
 * `prepareHeat`/`updateHeatResult` need none either.
 */
export default function RunOffControl({
  raceId,
  trackId,
  settlesRoundId,
  racers,
}: RunOffControlProps) {
  const { showAlert } = useAlert();
  const [manualTimes, setManualTimes] = useState<Record<number, string>>({});

  const [existingResult, refetchExisting] = useQuery<GetRunOffHeatsQuery>({
    query: GET_RUN_OFF_HEATS,
    variables: { raceId },
    requestPolicy: 'cache-and-network',
  });

  const racerIds = useMemo(
    () => new Set(racers.map((r) => r.racerId)),
    [racers],
  );

  // The run-off already created for exactly this tied set, if any — a
  // race can hold several run-offs (different cuts, or a corrected re-run
  // after one was deleted), so this is a client-side match on racer ids
  // rather than "the most recent one".
  const runOffHeats: RunOffHeatRow[] = existingResult.data?.race?.runOffHeats ?? [];
  const existing = runOffHeats.find((heat: RunOffHeatRow) => {
    if (heat.settlesRoundId !== settlesRoundId) return false;
    const heatRacerIds = new Set(
      heat.lanes
        .map((l: RunOffHeatRow['lanes'][number]) => l.racerId)
        .filter((id: number | null): id is number => id != null),
    );
    return (
      heatRacerIds.size === racerIds.size &&
      [...heatRacerIds].every((id) => racerIds.has(id))
    );
  });

  const [, createRunOffHeat] = useMutation(CREATE_RUN_OFF_HEAT_MUTATION);
  const [, deleteRunOffHeat] = useMutation(DELETE_RUN_OFF_HEAT_MUTATION);
  const [, prepareHeat] = useMutation(PREPARE_HEAT);
  const [, updateHeatResult] = useMutation(UPDATE_HEAT_RESULT_MUTATION);

  const [sessionResult] = useSubscription({
    query: HEAT_SESSION_SUBSCRIPTION,
    variables: { trackId: trackId ?? 0, heatId: existing?.id ?? null },
    pause: !trackId || !existing || existing.recorded,
  });
  const phase: string | undefined = sessionResult.data?.heatSession?.phase;

  const handleCreate = async () => {
    const result = await createRunOffHeat({
      raceId,
      racerIds: racers.map((r) => r.racerId),
      settlesRoundId,
    });
    if (result.error) {
      showAlert(errorText(result.error, 'The run-off could not be created.'), 'Error');
      return;
    }
    refetchExisting({ requestPolicy: 'network-only' });
  };

  const handleDelete = async () => {
    if (!existing) return;
    const result = await deleteRunOffHeat({ heatId: existing.id });
    if (result.error) {
      showAlert(errorText(result.error, 'The run-off could not be removed.'), 'Error');
      return;
    }
    refetchExisting({ requestPolicy: 'network-only' });
  };

  const handlePrepare = async () => {
    if (!existing || !trackId) return;
    const result = await prepareHeat({ heatId: existing.id });
    if (result.error || result.data?.prepareHeat === false) {
      showAlert(
        errorText(result.error, 'The timer could not be armed for the run-off.'),
        'Error',
      );
    }
  };

  const handleRecordManually = async () => {
    if (!existing) return;
    const lanes = existing.lanes
      .filter((lane: RunOffHeatRow['lanes'][number]) => lane.racerId != null)
      .map((lane: RunOffHeatRow['lanes'][number]) => {
        const raw = manualTimes[lane.racerId as number];
        const time = raw ? parseFloat(raw) : null;
        return {
          lane: lane.lane,
          racerId: lane.racerId,
          time: time != null && !Number.isNaN(time) ? time : null,
          place: null,
          skipped: false,
        };
      });
    if (lanes.some((l) => l.time == null)) {
      showAlert('Enter a time for every racer before recording.', 'Missing times');
      return;
    }
    const result = await updateHeatResult({ heatId: existing.id, lanes });
    if (result.error) {
      showAlert(errorText(result.error, 'The result could not be recorded.'), 'Error');
      return;
    }
    refetchExisting({ requestPolicy: 'network-only' });
  };

  const names = racers.map((r) => r.name).join(' vs. ');

  if (!existing) {
    return (
      <button
        type="button"
        className="secondary-btn"
        data-testid="start-run-off-btn"
        onClick={handleCreate}
        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
      >
        Start run-off
      </button>
    );
  }

  const announcement = runOffAnnouncement(existing.placement);

  return (
    <div
      data-testid="run-off-panel"
      style={{
        border: '1px solid var(--input-border-color)',
        borderRadius: '12px',
        padding: '10px 14px',
        marginTop: '6px',
        background: 'var(--surface-tint-color)',
        fontSize: '0.85rem',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
        Run-off: {names}
      </div>
      {announcement && <div style={{ marginBottom: '6px' }}>{announcement}</div>}

      {existing.recorded ? (
        <div>Run-off decided.</div>
      ) : (
        <>
          {trackId && (
            <button
              type="button"
              className="secondary-btn"
              onClick={handlePrepare}
              style={{ padding: '4px 10px', fontSize: '0.8rem', marginRight: '8px' }}
            >
              {phase === 'RUNNING' ? 'Racing…' : 'Arm timer'}
            </button>
          )}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
            {existing.lanes
              .filter((lane: RunOffHeatRow['lanes'][number]) => lane.racerId != null)
              .map((lane: RunOffHeatRow['lanes'][number]) => {
                const racer = racers.find((r) => r.racerId === lane.racerId);
                return (
                  <label key={lane.lane} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {racer?.name ?? `Lane ${lane.lane}`}
                    <input
                      type="number"
                      step="0.001"
                      style={{ width: '70px' }}
                      value={manualTimes[lane.racerId as number] ?? ''}
                      onChange={(e) =>
                        setManualTimes((prev) => ({
                          ...prev,
                          [lane.racerId as number]: e.target.value,
                        }))
                      }
                    />
                  </label>
                );
              })}
            <button
              type="button"
              className="primary-btn"
              onClick={handleRecordManually}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Record result
            </button>
          </div>
          <button
            type="button"
            className="secondary-btn"
            onClick={handleDelete}
            style={{ padding: '4px 10px', fontSize: '0.8rem', marginTop: '8px' }}
          >
            Cancel run-off
          </button>
        </>
      )}
    </div>
  );
}
