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
import { runOffAnnouncement, tooManyForRunOff } from '../runOff';
import { formatLaneTime } from '../lanes';
import type { GetRunOffHeatsQuery } from '../../../gql/operations';
import { RACE_LOCKED_MESSAGE } from '../../core/raceLockMessage';

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
  /** Lanes the race's track can actually use right now (#171's lane-outage
   * bound, see `usableLaneCount` in `runOff.ts`) — or `null`/absent when
   * that is not known (no track, or a caller that has not looked it up).
   * `crud.create_run_off_heat` refuses more racers than this; the button
   * disables itself and says so rather than letting that refusal be the
   * first the operator hears of it (#766). */
  usableLaneCount?: number | null;
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
  usableLaneCount = null,
}: RunOffControlProps) {
  const { showAlert } = useAlert();
  const [manualTimes, setManualTimes] = useState<Record<number, string>>({});
  // Correcting a mistyped run-off time (#1017). Neither `deleteRunOffHeat`
  // nor the generic `deleteHeat` will remove a heat that already has
  // results (`crud.delete_run_off_heat`/`delete_heat`, both "this module's
  // write path is one door" — the same refusal an ordinary heat's result
  // gets), so a correction is a *re-record*, not a delete-and-recreate:
  // `updateHeatResult` has no such restriction and simply overwrites the
  // lanes, the same door the first recording went through.
  const [isReRunning, setIsReRunning] = useState(false);

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
  const raceLocked = existingResult.data?.race?.isLocked ?? false;
  const lockedTitle = RACE_LOCKED_MESSAGE;

  // #766: why "Start run-off" would be refused before the operator ever
  // clicks it. The lock wins when both apply — it means nothing here can be
  // created at all right now, where the lane count is specifically about
  // this cluster.
  const laneShortage = tooManyForRunOff(racers.length, usableLaneCount);
  const startDisabled = raceLocked || !!laneShortage;
  const startTitle = raceLocked ? lockedTitle : laneShortage ?? undefined;

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
    // Un-paused during a re-run (#1017) too — arming the timer for a
    // correction is exactly as live as arming it the first time.
    pause: !trackId || !existing || (existing.recorded && !isReRunning),
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
    setIsReRunning(false);
    refetchExisting({ requestPolicy: 'network-only' });
  };

  // Prefill with what is already recorded, so correcting one mistyped
  // number does not mean retyping everyone else's too.
  const handleStartReRun = () => {
    const prefill: Record<number, string> = {};
    for (const lane of existing?.lanes ?? []) {
      if (lane.racerId != null && lane.time != null) {
        prefill[lane.racerId] = String(lane.time);
      }
    }
    setManualTimes(prefill);
    setIsReRunning(true);
  };

  const names = racers.map((r) => r.name).join(' vs. ');

  if (!existing) {
    return (
      <div>
        <button
          type="button"
          className="secondary-btn"
          data-testid="start-run-off-btn"
          onClick={handleCreate}
          disabled={startDisabled}
          title={startTitle}
          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
        >
          Start run-off
        </button>
        {/* A disabled button's own `title` is not a reliable way to learn
            why (some browsers never fire a tooltip on a disabled control) —
            unlike the race lock, which also has a page-level banner
            (`RaceControl.tsx`'s `race-locked-banner`), nothing else on
            screen says this, so it's spelled out rather than left to a
            hover (#766). */}
        {laneShortage && !raceLocked && (
          <p
            data-testid="run-off-lane-shortage"
            style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--warning-strong-color)' }}
          >
            {laneShortage}
          </p>
        )}
      </div>
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

      {existing.recorded && !isReRunning ? (
        <div>
          {/* The only record of what the run-off actually decided (#1017) —
              gone from the standings' own note the moment the tie splits
              apart, so it has to live here instead. Ordered by place, the
              same "winner first" order the standings themselves use. */}
          <div data-testid="run-off-recorded-times">
            Run-off decided:{' '}
            {existing.lanes
              .filter((lane: RunOffHeatRow['lanes'][number]) => lane.racerId != null)
              .slice()
              .sort(
                (a: RunOffHeatRow['lanes'][number], b: RunOffHeatRow['lanes'][number]) =>
                  (a.place ?? Infinity) - (b.place ?? Infinity),
              )
              .map((lane: RunOffHeatRow['lanes'][number], i: number) => {
                const racer = racers.find((r) => r.racerId === lane.racerId);
                const label = racer?.name ?? `Lane ${lane.lane}`;
                return (
                  <span key={lane.lane}>
                    {i > 0 && ' · '}
                    {label} {formatLaneTime(lane.time) ?? '—'}
                  </span>
                );
              })}
          </div>
          <button
            type="button"
            className="secondary-btn"
            data-testid="rerun-run-off-btn"
            onClick={handleStartReRun}
            disabled={raceLocked}
            title={raceLocked ? lockedTitle : undefined}
            style={{ padding: '4px 10px', fontSize: '0.8rem', marginTop: '6px' }}
          >
            Re-run
          </button>
        </div>
      ) : (
        <>
          {isReRunning && (
            <p style={{ margin: '0 0 6px', color: 'var(--warning-strong-color)' }}>
              Correcting the recorded run-off — recording a new result
              replaces it.
            </p>
          )}
          {trackId && (
            <button
              type="button"
              className="secondary-btn"
              onClick={handlePrepare}
              disabled={raceLocked}
              title={raceLocked ? lockedTitle : undefined}
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
              disabled={raceLocked}
              title={raceLocked ? lockedTitle : undefined}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Record result
            </button>
          </div>
          {/* Deleting a heat with results is refused by both
              `deleteRunOffHeat` and the generic `deleteHeat` (this module's
              write path is one door, same as an ordinary heat's result) —
              so cancelling only ever applies before the first recording,
              never while correcting one. */}
          {!existing.recorded && (
            <button
              type="button"
              className="secondary-btn"
              onClick={handleDelete}
              disabled={raceLocked}
              title={raceLocked ? lockedTitle : undefined}
              style={{ padding: '4px 10px', fontSize: '0.8rem', marginTop: '8px' }}
            >
              Cancel run-off
            </button>
          )}
          {isReRunning && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setIsReRunning(false)}
              style={{ padding: '4px 10px', fontSize: '0.8rem', marginTop: '8px', marginLeft: '8px' }}
            >
              Cancel correction
            </button>
          )}
        </>
      )}
    </div>
  );
}
