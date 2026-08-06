import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, gql } from 'urql';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import { arrayMove } from '@dnd-kit/sortable';
import { useAlert } from '../../../context/AlertContext';
import { ScheduleManagement } from '../components/ScheduleManagement';
import { RaceExecution } from '../components/RaceExecution';
import { FreeRaceTab } from '../components/FreeRaceTab';
import { Icon } from '@mdi/react';
import { mdiCalendarRange, mdiFlagCheckered, mdiRacingHelmet, mdiPlay, mdiRefresh } from '@mdi/js';
import type { Heat, Racer, Round, AdvancementStatus, LaneInput, Lane } from '../types';
import { hasRun, hasTimes, byPlace, cleared } from '../lanes';
import { observeAdvanced, type SeenRounds } from '../roundCompletion';

const GET_RACE_CONTROL_DATA = gql`
  query GetRaceControlData($id: Int!) {
    initialConfig {
      debugMode
    }
    race(raceId: $id) {
      id
      name
      championshipTrophies
      scoringStrategy
      autoAdvanceHeat
      track {
        id
        laneCount
        timerType
      }
      dens {
        id
        name
      }
      racers {
        id
        firstName
        lastName
        carNumber
        racerImageUrl
        carImageUrl
      }
      heats {
        id
        heatNumber
        roundNumber
        roundId
        roundName
        lanes {
          lane
          racerId
          placeholderSlot
          time
          place
          skipped
        }
      }
      rounds {
        id
        roundNumber
        name
        advancementSource
        advancementStatus {
          isReady
          requiresAdvancement
          alreadyAdvanced
          source
          numRacers
          advancingRacers {
            racerId
            firstName
            lastName
            carNumber
            denName
            score
            rank
            isAdvancing
          }
        }
      }
    }
  }
`;

const CREATE_ROUND_MUTATION = gql`
  mutation CreateRound($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) {
      id
    }
  }
`;

const REGENERATE_ROUND_MUTATION = gql`
  mutation RegenerateRound($roundId: Int!) {
    regenerateRound(roundId: $roundId) {
      id
    }
  }
`;

const DELETE_ROUND_MUTATION = gql`
  mutation DeleteRound($roundId: Int!) {
    deleteRound(roundId: $roundId)
  }
`;

const DELETE_HEAT_MUTATION = gql`
  mutation DeleteHeat($heatId: Int!) {
    deleteHeat(heatId: $heatId)
  }
`;

const REORDER_HEATS_MUTATION = gql`
  mutation ReorderHeats($heatUpdates: [HeatReorderItemInput!]!) {
    reorderHeats(heatUpdates: $heatUpdates) {
      updatedCount
    }
  }
`;

const UPDATE_HEAT_RESULT_MUTATION = gql`
  mutation UpdateHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
    updateHeatResult(heatId: $heatId, lanes: $lanes) {
      id
    }
  }
`;

const UPDATE_RACE_MUTATION = gql`
  mutation UpdateRaceAutoAdvance($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
      id
      autoAdvanceHeat
    }
  }
`;

export default function RaceControl() {
  const { showAlert, showConfirm, showToast } = useAlert();
  const { raceId } = useParams<{ raceId: string }>();
  const navigate = useNavigate();
  const id = parseInt(raceId || '0');

  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [roundSummary, setRoundSummary] = useState<AdvancementStatus | null>(null);

  // Which rounds we had already seen decided (#13). A ref rather than state:
  // it is bookkeeping for the detector and nothing renders from it. Keeping it
  // in state is what forced the old effect to depend on its own output and
  // defer half its work to the next pass.
  const seenAdvancedRounds = useRef<SeenRounds>(null);

  // Nothing resets this screen when the race changes, because the route keys
  // it on the race id and a different race is a different component. That is
  // stronger than the effect it replaces, which had to name every piece of
  // state to clear — including `seenAdvancedRounds`, so that an already-decided
  // round in the new race read as history rather than as news. A remount gets
  // that right for state nobody has thought about yet.

  const [result, reExecute] = useQuery({
    query: GET_RACE_CONTROL_DATA,
    variables: { id },
    pause: !id || isNaN(id),
  });

  const [, createRoundMutation] = useMutation(CREATE_ROUND_MUTATION);
  const [, regenerateRoundMutation] = useMutation(REGENERATE_ROUND_MUTATION);
  const [, deleteRoundMutation] = useMutation(DELETE_ROUND_MUTATION);
  const [, deleteHeatMutation] = useMutation(DELETE_HEAT_MUTATION);
  const [, reorderHeatsMutation] = useMutation(REORDER_HEATS_MUTATION);
  const [, updateHeatResultMutation] = useMutation(UPDATE_HEAT_RESULT_MUTATION);
  const [, updateRaceMutation] = useMutation(UPDATE_RACE_MUTATION);

  // Keep every open tab in sync. Heat results and check-ins arrive with the
  // updated entity and merge into the normalized cache; only structural
  // changes cost a refetch. See useRaceStateChanged.
  useRaceStateChanged(id, () => reExecute({ requestPolicy: 'network-only' }));

  const { data, fetching } = result;
  const race = data?.race;
  const heats = useMemo(() => race?.heats || [], [race?.heats]);
  const racers = useMemo(() => {
    const map: Record<number, Racer> = {};
    (race?.racers || []).forEach((r: Racer) => {
      map[r.id] = r;
    });
    return map;
  }, [race?.racers]);


  useEffect(() => {
    if (fetching || !race?.rounds) return;

    // A round is decided once its placeholders have been resolved into the
    // racers who advanced.
    const advancedIds = race.rounds
      .filter((r: Round) =>
          r.advancementStatus.requiresAdvancement &&
          r.advancementStatus.isReady &&
          r.advancementStatus.alreadyAdvanced
      )
      .map((r: Round) => r.id);

    const { seen, completedRoundId } = observeAdvanced(seenAdvancedRounds.current, advancedIds);
    seenAdvancedRounds.current = seen;
    if (completedRoundId === null) return;

    const round = race.rounds.find((r: Round) => r.id === completedRoundId);
    if (round) {
      setRoundSummary({ ...round.advancementStatus, roundId: round.id });
    }
  }, [race?.rounds, fetching]);

  const handleAddRound = async (config: {
    schedulingStrategy?: string;
    name: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    runsPerLane?: number;
    generalType?: string;
  }) => {
    if (!id) return;
    setGenerating(true);
    try {
      const result = await createRoundMutation({
        raceId: id,
        roundData: {
          schedulingStrategy: config.schedulingStrategy || 'PPC',
          name: config.name,
          advancementSource: config.advancementSource,
          advancementNumRacers: config.advancementNumRacers,
          runsPerLane: config.runsPerLane || 1,
          generalType: config.generalType || 'PACK'
        }
      });

      if (result.error) throw result.error;

      reExecute({ requestPolicy: 'network-only' });
      setSelectedHeatId(null);
    } catch (e: unknown) {
      console.error("Failed to add round", e);
      const err = e as { message?: string };
      showAlert(err.message || "Failed to add round.", "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateRound = async (roundId: number, silent: boolean = false) => {
    try {
      setGenerating(true);
      const result = await regenerateRoundMutation({ roundId });
      if (result.error) throw result.error;

      reExecute({ requestPolicy: 'network-only' });
      setSelectedHeatId(null);
      if (!silent) {
        showToast("Schedule regenerated successfully.", "success");
      }
    } catch (e: unknown) {
      console.error("Failed to regenerate round", e);
      const err = e as { message?: string };
      showAlert(err.message || "Failed to regenerate the schedule.", "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteRound = async (roundId: number) => {
    try {
      setGenerating(true);
      const result = await deleteRoundMutation({ roundId });
      if (result.error) throw result.error;

      reExecute({ requestPolicy: 'network-only' });
      setSelectedHeatId(null);
      showToast("Round deleted successfully.", "success");
    } catch (e: unknown) {
      console.error("Failed to delete round", e);
      const err = e as { message?: string };
      showAlert(err.message || "Failed to delete the round.", "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteHeat = async (heatId: number) => {
    const confirmed = await showConfirm(
      "Are you sure you want to delete this heat?",
      "Delete Heat",
      "Delete",
      "danger"
    );
    if (!confirmed) return;

    try {
      setGenerating(true);
      const result = await deleteHeatMutation({ heatId });
      if (result.error) throw result.error;

      reExecute({ requestPolicy: 'network-only' });
      if (selectedHeatId === heatId) {
        setSelectedHeatId(null);
      }
      showToast("Heat deleted successfully.", "success");
    } catch (e: unknown) {
      console.error("Failed to delete heat", e);
      const err = e as { message?: string };
      showAlert(err.message || "Failed to delete the heat.", "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateResult = useCallback(async (heatId: number, results: LaneInput[]) => {
      try {
          const heat = heats.find((h: Heat) => h.id === heatId);
          if (!heat) return;

          const sortedResults = results.map(r => ({ ...r }));

          // Only assign places if at least one racer has a time
          const hasAnyTime = sortedResults.some(r => r.time !== null);

          if (hasAnyTime) {
              sortedResults.sort((a, b) => (a.time ?? 9999) - (b.time ?? 9999));

              sortedResults.forEach((r, idx) => {
                  r.skipped = false; // Always clear skipped flag if we have times
                  r.place = r.time !== null ? idx + 1 : null;
              });
          } else {
              // If no times (e.g. Skip Heat), clear all places
              sortedResults.forEach(r => {
                  r.place = null;
              });
          }

          const result = await updateHeatResultMutation({
              heatId,
              lanes: sortedResults,
          });
          if (result.error) throw result.error;

          reExecute({ requestPolicy: 'network-only' });

          // Round completion check logic can be simplified or moved to sub-component
          // For now we'll just re-fetch and let the user decide

          if (activeHeatId === heatId) {
              setActiveHeatId(null);
          }
      } catch (e) {
          console.error("Failed to update results", e);
          showAlert("Failed to update results.", "Error");
      }
  }, [heats, updateHeatResultMutation, reExecute, activeHeatId, showAlert]);

  const handleReorderHeats = useCallback(async (updates: { heat_id: number, new_heat_number: number }[]) => {
    try {
      const formattedUpdates = updates.map(u => ({
        heatId: u.heat_id,
        newHeatNumber: u.new_heat_number
      }));
      const result = await reorderHeatsMutation({ heatUpdates: formattedUpdates });
      if (result.error) throw result.error;
      reExecute({ requestPolicy: 'network-only' });
    } catch (e) {
      console.error("Failed to reorder heats", e);
      showAlert("Failed to reorder heats.", "Error");
    }
  }, [reorderHeatsMutation, reExecute, showAlert]);

  const handleRunHeat = useCallback(async (heat: Heat, shouldStart: boolean = true) => {
    if (hasRun(heat.lanes)) {
        // Clear results locally first (Optimistic UI Update would be complex with urql, so we just clear on server)
        try {
            const result = await updateHeatResultMutation({
                heatId: heat.id,
                lanes: cleared(heat.lanes),
            });
            if (result.error) throw result.error;

            reExecute({ requestPolicy: 'network-only' });
            setRoundSummary(null); // Clear any summary
        } catch (error) {
            console.error("Failed to clear results for re-run", error);
            showToast("Failed to reset heat on server", "error");
            return;
        }
    }

    if (shouldStart) {
        // If this is a future heat, move it to be the next one in its round
        const roundHeats = heats
          .filter((h: Heat) => h.roundId === heat.roundId)
          .sort((a: Heat, b: Heat) => a.heatNumber - b.heatNumber);

        // Deliberately not `hasRun`: a skipped heat still counts as somewhere to
        // jump back to.
        const firstUncompletedIndex = roundHeats.findIndex((h: Heat) => !hasTimes(h.lanes));

        const targetIndex = roundHeats.findIndex((h: Heat) => h.id === heat.id);

        // Only reorder if we're jumping ahead of at least one uncompleted heat
        if (firstUncompletedIndex !== -1 && targetIndex > firstUncompletedIndex) {
            const reordered = arrayMove(roundHeats, targetIndex, firstUncompletedIndex) as Heat[];
            const updates = reordered.map((h: Heat, idx) => ({
                heat_id: h.id,
                new_heat_number: idx + 1
            }));

            try {
                await handleReorderHeats(updates);
            } catch (e) {
                console.error("Failed to reorder heats for Run button", e);
            }
        }

        setSelectedHeatId(heat.id);
        navigate(`/race/${id}/control/race`);
    } else {
        if (activeHeatId === heat.id) {
            setActiveHeatId(null);
        }
    }
  }, [heats, updateHeatResultMutation, reExecute, handleReorderHeats, activeHeatId, navigate, id, showToast]);


  const getRacerName = (id: number) => {
      if (id < 0) {
          return `Top ${Math.abs(id)}`;
      }
      const r = racers[id];
      if (!r) return `Racer #${id}`;
      return `${r.firstName} ${r.lastName} (#${r.carNumber})`;
  };

  // The same question asked of a structured lane, where an undecided
  // championship slot is a field rather than a negative id.
  const laneRacerName = (lane: Lane) => {
      if (lane.placeholderSlot !== null) return `Top ${lane.placeholderSlot}`;
      if (lane.racerId === null) return '—';
      return getRacerName(lane.racerId);
  };

  const location = useLocation();
  const viewMode = location.pathname.includes('/control/race')
    ? 'EXECUTION'
    : location.pathname.includes('/control/free-race')
    ? 'FREE_RACE'
    : 'SCHEDULE';

  // Re-fetch on view change to ensure fresh data (e.g., after reordering in Schedule)
  useEffect(() => {
    reExecute({ requestPolicy: 'network-only' });
  }, [viewMode, reExecute]);

  const sortedHeatsEx = useMemo(() => {
    return [...heats].sort((a, b) => {
      if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
      return a.heatNumber - b.heatNumber;
    }).map((h: Heat, idx) => ({ ...h, globalHeatNumber: idx + 1 }));
  }, [heats]);

  /** The heat on screen: what the operator picked, else where the race is up to.
   *
   * Derived rather than written into state by an effect. The effect had to run
   * after every change to the heats *and* to the selection, and it left a
   * render in between showing the wrong heat. It also could not cope with a
   * selection that had ceased to exist — a heat deleted or a round
   * regenerated — where this simply falls back.
   */
  const activeExecutionHeat = useMemo(() => {
      const chosen = selectedHeatId !== null
          ? sortedHeatsEx.find((h: Heat) => h.id === selectedHeatId)
          : undefined;
      if (chosen) return chosen;
      // The first heat still to be run, or the last one if the race is over.
      return sortedHeatsEx.find((h: Heat) => !hasRun(h.lanes))
          ?? sortedHeatsEx[sortedHeatsEx.length - 1]
          ?? null;
  }, [sortedHeatsEx, selectedHeatId]);

  const currentIndex = activeExecutionHeat
      ? sortedHeatsEx.findIndex((h: Heat) => h.id === activeExecutionHeat.id)
      : -1;

  const nextExecutionHeat = currentIndex !== -1 && currentIndex + 1 < sortedHeatsEx.length
      ? sortedHeatsEx[currentIndex + 1]
      : null;

  const completedPreviousHeats = useMemo(() => {
    return [...sortedHeatsEx]
      .filter((h: Heat) => h.id !== activeExecutionHeat?.id && hasRun(h.lanes))
      .sort((a: Heat, b: Heat) => {
        if (b.roundNumber !== a.roundNumber) return b.roundNumber - a.roundNumber;
        return b.heatNumber - a.heatNumber;
      });
  }, [sortedHeatsEx, activeExecutionHeat]);

  const handleNextHeat = useCallback(() => {
      setRoundSummary(null);
      if (nextExecutionHeat) {
          setSelectedHeatId(nextExecutionHeat.id);
      }
  }, [nextExecutionHeat]);

  const currentRoundHeats = useMemo(() => {
    if (!activeExecutionHeat) return [];
    return heats.filter((h: Heat) => h.roundId === activeExecutionHeat.roundId);
  }, [heats, activeExecutionHeat]);

  const totalHeatsInRound = currentRoundHeats.length;
  const remainingHeatsInRound = useMemo(() => {
    return currentRoundHeats.filter((h: Heat) => !hasRun(h.lanes)).length;
  }, [currentRoundHeats]);

  const upcomingRounds = useMemo(() => {
    if (!activeExecutionHeat) return [];
    const rounds: Record<number, { roundNumber: number, roundName: string | null, totalHeats: number, roundId: number }> = {};
    heats.forEach((h: Heat) => {
      if (h.roundNumber > activeExecutionHeat.roundNumber) {
        if (!rounds[h.roundId]) {
          rounds[h.roundId] = {
            roundNumber: h.roundNumber,
            roundName: h.roundName,
            totalHeats: 0,
            roundId: h.roundId
          };
        }
        rounds[h.roundId].totalHeats++;
      }
    });
    return Object.values(rounds).sort((a, b) => a.roundNumber - b.roundNumber);
  }, [heats, activeExecutionHeat]);

  if (fetching && !data) return <div>Loading Race Control...</div>;

  if (!race && !fetching) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  return (
    <div className="container" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Race Control</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1, minWidth: '300px', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button
                    onClick={() => navigate(`/race/${id}/control/schedule`)}
                     style={{
                        padding: '6px 16px',
                        fontSize: '0.95rem',
                        whiteSpace: 'nowrap',
                        borderRadius: '20px',
                        border: 'none',
                        background: viewMode === 'SCHEDULE' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'SCHEDULE' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'SCHEDULE' ? 'bold' : 'normal',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Icon path={mdiCalendarRange} size={0.8} /> Schedule
                </button>
                <button
                    onClick={() => navigate(`/race/${id}/control/race`)}
                    style={{
                        padding: '6px 16px',
                        fontSize: '0.95rem',
                        whiteSpace: 'nowrap',
                        borderRadius: '20px',
                        border: 'none',
                        background: viewMode === 'EXECUTION' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'EXECUTION' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'EXECUTION' ? 'bold' : 'normal',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Icon path={mdiFlagCheckered} size={0.8} /> Race
                </button>
                <button
                    onClick={() => navigate(`/race/${id}/control/free-race`)}
                    style={{
                        padding: '6px 16px',
                        fontSize: '0.95rem',
                        whiteSpace: 'nowrap',
                        borderRadius: '20px',
                        border: 'none',
                        background: viewMode === 'FREE_RACE' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'FREE_RACE' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'FREE_RACE' ? 'bold' : 'normal',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Icon path={mdiRacingHelmet} size={0.8} /> Free Race
                </button>
            </div>
        </div>

        <div style={{ minWidth: '160px' }} />
      </div>

      {viewMode === 'FREE_RACE' ? (
        <FreeRaceTab
          raceId={id}
          laneCount={race?.track?.laneCount ?? 4}
          timerType={race?.track?.timerType ?? null}
          trackId={race?.track?.id ?? null}
          racers={racers}
          debugMode={data?.initialConfig?.debugMode ?? false}
        />
      ) : viewMode === 'EXECUTION' ? (
        heats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '8px' }}>
            <p>No heats available. Please add a round in the Schedule view first.</p>
          </div>
        ) : (
          <>
            <RaceExecution
              activeExecutionHeat={activeExecutionHeat || null}
              nextExecutionHeat={nextExecutionHeat}
              activeHeatId={activeHeatId}
              onRunHeat={handleRunHeat}
              onNextHeat={handleNextHeat}
              getRacerName={getRacerName}
              onUpdateResult={handleUpdateResult}
              timerType={race?.track?.timerType}
              trackId={race?.track?.id ?? null}
              racers={racers}
              roundSummary={roundSummary}
              autoAdvanceHeat={race?.autoAdvanceHeat ?? false}
              remainingHeatsInRound={remainingHeatsInRound}
              totalHeatsInRound={totalHeatsInRound}
              upcomingRounds={upcomingRounds}
              debugMode={data?.initialConfig?.debugMode ?? false}
              onToggleAutoAdvance={async (value) => {
                await updateRaceMutation({ id, race: { autoAdvanceHeat: value } });
                reExecute({ requestPolicy: 'network-only' });
              }}
            />
            {completedPreviousHeats.length > 0 && (
              <div style={{ maxWidth: '1000px', margin: '24px auto 0' }}>
                <h3 style={{ marginBottom: '12px', color: '#555', fontWeight: 600 }}>Previous Heats</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {completedPreviousHeats.map((heat: Heat) => {
                    const isSkipped = heat.lanes.some((l) => l.skipped);
                    const timed = hasTimes(heat.lanes);
                    const sorted = byPlace(heat.lanes);
                    return (
                      <div key={heat.id} style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '14px 20px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        borderLeft: isSkipped && !timed ? '4px solid #f44336' : '4px solid #4caf50'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>Heat {heat.globalHeatNumber ?? heat.heatNumber}</span>
                            {isSkipped && !timed && (
                                <span style={{ background: '#ffebee', color: '#c62828', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Skipped</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ color: '#888', fontSize: '0.85rem' }}>{heat.roundName || `Round ${heat.roundNumber}`}</span>
                            <button
                                onClick={() => handleRunHeat(heat)}
                                style={{
                                    padding: '4px 10px',
                                    fontSize: '0.8rem',
                                    background: isSkipped && !timed ? 'var(--cub-scouting-gold)' : '#f5f5f5',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontWeight: 'bold'
                                }}
                            >
                                <Icon path={isSkipped && !timed ? mdiPlay : mdiRefresh} size={0.6} />
                                {isSkipped && !timed ? 'Run' : 'Re-Run'}
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: '2px' }}>
                          {sorted.map((r) => (
                            <div key={r.lane} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', padding: '5px 0', borderBottom: '1px solid #f5f5f5' }}>
                              <span style={{
                                minWidth: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: r.place === 1 ? 'var(--cub-scouting-gold)' : r.place === 2 ? '#e0e0e0' : r.place === 3 ? '#d7a48d' : '#f0f0f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.75rem',
                                flexShrink: 0
                              }}>{r.place ?? '–'}</span>
                              <span style={{ color: '#888', minWidth: '52px', fontSize: '0.85rem' }}>Lane {r.lane}</span>
                              <span style={{ flex: 1, fontWeight: r.place === 1 ? 600 : 'normal' }}>{laneRacerName(r)}</span>
                              <span style={{ fontFamily: 'monospace', color: '#444', flexShrink: 0 }}>{r.time != null ? `${Number(r.time).toFixed(4)}s` : '–'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )
      ) : (
        <ScheduleManagement
          raceId={id}
          heats={heats}
          generating={generating}
          activeHeatId={activeHeatId}
          onAddRound={handleAddRound}
          onRegenerateRound={handleRegenerateRound}
          onDeleteRound={handleDeleteRound}
          onDeleteHeat={handleDeleteHeat}
          onRefetchHeats={async () => { reExecute({ requestPolicy: 'network-only' }); }}
          onRunHeat={handleRunHeat}
          onReorderHeats={handleReorderHeats}
          getRacerName={getRacerName}
          laneCount={race?.track?.laneCount || 4}
          racerCount={race?.racers?.length || 0}
          denCount={race?.dens?.length || 0}
          championshipTrophies={race?.championshipTrophies || 3}
        />
      )}
    </div>
  );
}
