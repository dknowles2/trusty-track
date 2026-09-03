import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiCoffee, mdiPause, mdiPlay, mdiPlus, mdiStop } from '@mdi/js';
import {
  END_INTERMISSION_MUTATION,
  EXTEND_INTERMISSION_MUTATION,
  GET_RACE_INTERMISSION,
  PAUSE_INTERMISSION_MUTATION,
  RESUME_INTERMISSION_MUTATION,
  START_INTERMISSION_MUTATION,
} from '../graphql/queries';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import {
  EXTEND_SECONDS,
  INTERMISSION_PRESETS,
  formatCountdown,
  isLiveActive,
  liveRemainingSeconds,
  NONE,
  type IntermissionData,
} from '../intermission';
import type { GetRaceIntermissionQuery } from '../../../gql/operations';

interface IntermissionControlProps {
  raceId: number;
}

/**
 * Starting, extending, pausing and ending a race-scoped break (#592).
 *
 * Lives on Race Control's Race tab — that is where the operator is standing
 * when a break is called or ends, the same reasoning that put the displays
 * registry on its own tab rather than in System Settings. The round-summary
 * modal offers the same presets from its own "Take a break" row (see
 * `RaceExecution.tsx`); this is the always-available control for calling one
 * mid-round or from the schedule screen, not only right after a round ends.
 */
export default function IntermissionControl({ raceId }: IntermissionControlProps) {
  const { showAlert } = useAlert();
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('15');

  const [{ data }, reExecute] = useQuery<GetRaceIntermissionQuery>({
    query: GET_RACE_INTERMISSION,
    variables: { raceId },
    pause: !raceId,
  });

  // Another tab — or another mutation on this one — can change the break;
  // this is the display's own leash reused rather than a bespoke poll (see
  // "Telling an audience display what to show" in CLAUDE.md).
  useRaceStateChanged(raceId, () => reExecute({ requestPolicy: 'network-only' }));

  const intermission: IntermissionData = data?.race?.intermission ?? NONE;

  // Ticks the display once a second while a countdown is actually running,
  // so `formatCountdown` reflects the passing second with no server round
  // trip. Not while paused — nothing is counting down, so there is nothing
  // to re-render for.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!intermission.active || intermission.paused) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [intermission.active, intermission.paused, intermission.endsAt]);

  const [, startIntermission] = useMutation(START_INTERMISSION_MUTATION);
  const [, extendIntermission] = useMutation(EXTEND_INTERMISSION_MUTATION);
  const [, pauseIntermission] = useMutation(PAUSE_INTERMISSION_MUTATION);
  const [, resumeIntermission] = useMutation(RESUME_INTERMISSION_MUTATION);
  const [, endIntermission] = useMutation(END_INTERMISSION_MUTATION);

  const run = async (
    action: () => Promise<{ error?: unknown }>,
    failureMessage: string,
  ) => {
    const result = await action();
    if (result.error) {
      showAlert(errorText(result.error, failureMessage), 'Error');
      return;
    }
    reExecute({ requestPolicy: 'network-only' });
  };

  const handleStart = (seconds: number) => {
    setCustomOpen(false);
    return run(
      () => startIntermission({ raceId, durationSeconds: seconds, label: null }),
      'The intermission could not be started.',
    );
  };

  const handleCustomStart = () => {
    const minutes = parseFloat(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      showAlert('Enter a number of minutes greater than zero.', 'Invalid duration');
      return;
    }
    return handleStart(Math.round(minutes * 60));
  };

  const handleExtend = () =>
    run(
      () => extendIntermission({ raceId, seconds: EXTEND_SECONDS }),
      'The intermission could not be extended.',
    );

  const handlePauseResume = () =>
    intermission.paused
      ? run(
          () => resumeIntermission({ raceId }),
          'The intermission could not be resumed.',
        )
      : run(() => pauseIntermission({ raceId }), 'The intermission could not be paused.');

  const handleEnd = () =>
    run(() => endIntermission({ raceId }), 'The intermission could not be ended.');

  const now = new Date();
  const active = isLiveActive(intermission, now);

  if (!active) {
    return (
      <div
        data-testid="intermission-control"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          marginBottom: '16px',
          borderRadius: '12px',
          border: '1px solid var(--input-border-color)',
          background: 'var(--surface-tint-color)',
        }}
      >
        <Icon path={mdiCoffee} size={0.9} />
        <span style={{ fontWeight: 'bold', marginRight: '4px' }}>Take a break:</span>
        {INTERMISSION_PRESETS.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            className="secondary-btn"
            data-testid={`intermission-preset-${preset.seconds}`}
            onClick={() => handleStart(preset.seconds)}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            {preset.label}
          </button>
        ))}
        {customOpen ? (
          <>
            <input
              type="number"
              min={1}
              step={1}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              style={{ width: '64px' }}
              aria-label="Custom break length, in minutes"
            />
            <span style={{ fontSize: '0.8rem' }}>min</span>
            <button
              type="button"
              className="primary-btn"
              onClick={handleCustomStart}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            >
              Start
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary-btn"
            data-testid="intermission-custom-btn"
            onClick={() => setCustomOpen(true)}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            Custom
          </button>
        )}
      </div>
    );
  }

  const remaining = liveRemainingSeconds(intermission, now);

  return (
    <div
      data-testid="intermission-control"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        marginBottom: '16px',
        borderRadius: '12px',
        border: '1px solid var(--cub-scouting-gold)',
        background: 'var(--warning-bg-color)',
      }}
    >
      <Icon path={mdiCoffee} size={1} />
      <span style={{ fontWeight: 'bold' }}>{intermission.label || 'Intermission'}</span>
      <span
        data-testid="intermission-countdown"
        style={{ fontFamily: 'monospace', fontSize: '1.3rem', fontWeight: 'bold' }}
      >
        {formatCountdown(remaining)}
      </span>
      {intermission.paused && (
        <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold' }}>
          Paused
        </span>
      )}
      <button
        type="button"
        className="secondary-btn"
        onClick={handleExtend}
        style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        <Icon path={mdiPlus} size={0.7} /> 5 min
      </button>
      <button
        type="button"
        className="secondary-btn"
        onClick={handlePauseResume}
        style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        <Icon path={intermission.paused ? mdiPlay : mdiPause} size={0.7} />
        {intermission.paused ? 'Resume' : 'Pause'}
      </button>
      <button
        type="button"
        className="secondary-btn"
        onClick={handleEnd}
        style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        <Icon path={mdiStop} size={0.7} /> End now
      </button>
    </div>
  );
}
