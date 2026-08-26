import React, { useState } from 'react';
import { errorText } from '../../../utils/errors';
import { useMutation } from 'urql';
import { FreeRaceLaneSetup, LaneAssignment, Mode } from './FreeRaceLaneSetup';
import { FreeRaceExecution } from './FreeRaceExecution';

interface RacerSummary {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
  racerImageUrl?: string | null;
}

interface FreeRaceTabProps {
  raceId: number;
  laneCount: number;
  timerType: string | null;
  trackId?: number | null;
  racers: Record<number, RacerSummary>;
  debugMode?: boolean;
}

type FreeRacePhase =
  | { kind: 'setup' }
  | { kind: 'running'; heatId: number; assignments: LaneAssignment[] };

const START_FREE_RACE_HEAT = `
  mutation StartFreeRaceHeat($raceId: Int!, $laneAssignments: [FreeRaceLaneAssignmentInput!]!) {
    startFreeRaceHeat(raceId: $raceId, laneAssignments: $laneAssignments) {
      id
    }
  }
`;

export const FreeRaceTab: React.FC<FreeRaceTabProps> = ({
  raceId,
  laneCount,
  timerType,
  trackId,
  racers,
  debugMode,
}) => {
  const [phase, setPhase] = useState<FreeRacePhase>({ kind: 'setup' });
  const [mode, setMode] = useState<Mode>('random');
  const [error, setError] = useState<string | null>(null);

  const [, startMutation] = useMutation(START_FREE_RACE_HEAT);

  const handleStart = async (assignments: LaneAssignment[]) => {
    setError(null);
    const gqlAssignments = assignments.map((a) => ({
      lane: a.lane,
      racerId: a.racerId,
    }));

    const result = await startMutation({ raceId, laneAssignments: gqlAssignments });

    if (result.error) {
      setError(errorText(result.error, 'The heat could not be started.'));
      return;
    }

    const heatId = result.data?.startFreeRaceHeat?.id;
    if (!heatId) {
      setError('The heat could not be started.');
      return;
    }

    setPhase({ kind: 'running', heatId, assignments });
  };

  const handleRunAnother = () => {
    setPhase({ kind: 'setup' });
    setError(null);
  };

  return (
    <div>
      {error && (
        <div style={{
          background: '#ffebee',
          border: '1px solid #ef9a9a',
          borderRadius: '6px',
          padding: '12px 16px',
          marginBottom: '16px',
          color: '#c62828',
        }}>
          {error}
        </div>
      )}

      {phase.kind === 'setup' ? (
        <FreeRaceLaneSetup
          raceId={raceId}
          laneCount={laneCount}
          onStart={handleStart}
          racers={racers}
          timerType={timerType}
          trackId={trackId}
          mode={mode}
          onModeChange={setMode}
        />
      ) : (
        <FreeRaceExecution
          heatId={phase.heatId}
          laneAssignments={phase.assignments}
          racers={racers}
          timerType={timerType}
          trackId={trackId ?? null}
          onRunAnother={handleRunAnother}
          debugMode={debugMode}
        />
      )}
    </div>
  );
};
