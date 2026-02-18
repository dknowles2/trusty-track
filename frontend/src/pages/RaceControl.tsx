import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import { useAlert } from '../context/AlertContext';
import { ScheduleManagement } from '../components/race-control/ScheduleManagement';
import { RaceExecution } from '../components/race-control/RaceExecution';
import { FreeRaceTab } from '../components/race-control/FreeRaceTab';
import Icon from '@mdi/react';
import { mdiCalendarRange, mdiFlagCheckered, mdiRacingHelmet } from '@mdi/js';

const GET_RACE_CONTROL_DATA = `
  query GetRaceControlData($id: Int!) {
    race(raceId: $id) {
      id
      name
      championshipTrophies
      scoringStrategy
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
        laneResults
      }
    }
  }
`;

const CREATE_ROUND_MUTATION = `
  mutation CreateRound($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) {
      id
    }
  }
`;

const REGENERATE_ROUND_MUTATION = `
  mutation RegenerateRound($roundId: Int!) {
    regenerateRound(roundId: $roundId) {
      id
    }
  }
`;

const DELETE_ROUND_MUTATION = `
  mutation DeleteRound($roundId: Int!) {
    deleteRound(roundId: $roundId)
  }
`;

const REORDER_HEATS_MUTATION = `
  mutation ReorderHeats($heatUpdates: [HeatReorderItemInput!]!) {
    reorderHeats(heatUpdates: $heatUpdates) {
      updatedCount
    }
  }
`;

const UPDATE_HEAT_RESULT_MUTATION = `
  mutation UpdateHeatResult($heatId: Int!, $results: String!) {
    updateHeatResult(heatId: $heatId, results: $results) {
      id
    }
  }
`;

interface Heat {
  id: number;
  roundNumber: number;
  roundId: number;
  heatNumber: number;
  roundName: string | null;
  laneResults: string;
}

interface Racer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number;
  racerImageUrl?: string;
  carImageUrl?: string;
}

interface AdvancementRacer {
    racerId: number;
    firstName: string;
    lastName: string;
    carNumber: number | null;
    denName: string;
    score: number;
    rank: number;
    isAdvancing: boolean;
}

interface AdvancementStatus {
    isReady: boolean;
    requiresAdvancement: boolean;
    alreadyAdvanced: boolean;
    advancingRacers: AdvancementRacer[];
    source: string | null;
    numRacers: number | null;
}

export default function RaceControl() {
  const { showAlert, showToast } = useAlert();
  const { raceId } = useParams<{ raceId: string }>();
  const navigate = useNavigate();
  const id = parseInt(raceId || '0');

  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [roundSummary, setRoundSummary] = useState<AdvancementStatus | null>(null);

  const [result, reExecute] = useQuery({
    query: GET_RACE_CONTROL_DATA,
    variables: { id },
    pause: !id || isNaN(id),
  });

  const [, createRoundMutation] = useMutation(CREATE_ROUND_MUTATION);
  const [, regenerateRoundMutation] = useMutation(REGENERATE_ROUND_MUTATION);
  const [, deleteRoundMutation] = useMutation(DELETE_ROUND_MUTATION);
  const [, reorderHeatsMutation] = useMutation(REORDER_HEATS_MUTATION);
  const [, updateHeatResultMutation] = useMutation(UPDATE_HEAT_RESULT_MUTATION);

  const { data, fetching } = result;
  const race = data?.race;
  const heats = race?.heats || [];
  const racers = useMemo(() => {
    const map: Record<number, Racer> = {};
    (race?.racers || []).forEach((r: Racer) => {
      map[r.id] = r;
    });
    return map;
  }, [race?.racers]);

  useEffect(() => {
      if (heats.length > 0 && selectedHeatId === null) {
          const sorted = [...heats].sort((a, b) => {
            if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
            return a.heatNumber - b.heatNumber;
          });
          
          const firstUncompleted = sorted.find((h: Heat) => {
              const results = h.laneResults ? JSON.parse(h.laneResults) : [];
              return !(results.length > 0 && results[0].time !== null);
          });
          
          if (firstUncompleted) {
              setSelectedHeatId(firstUncompleted.id);
          } else if (sorted.length > 0) {
              setSelectedHeatId(sorted[sorted.length - 1].id);
          }
      }
  }, [heats, selectedHeatId]);

  const handleAddRound = async (config: any) => {
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
    } catch (e: any) {
      console.error("Failed to add round", e);
      showAlert(e.message || "Failed to add round.", "Error");
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
      if (!silent) {
        showToast("Schedule regenerated successfully.", "success");
      }
    } catch (e: any) {
      console.error("Failed to regenerate round", e);
      showAlert(e.message || "Failed to regenerate the schedule.", "Error");
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
      showToast("Round deleted successfully.", "success");
    } catch (e: any) {
      console.error("Failed to delete round", e);
      showAlert(e.message || "Failed to delete the round.", "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunHeat = async (heat: Heat, shouldStart: boolean = true) => {
    // Check if heat already has results
    const hasResults = heat.laneResults && JSON.parse(heat.laneResults).some((r: {time: number | null}) => r.time !== null);
    
    if (hasResults) {
        // Clear results locally first (Optimistic UI Update would be complex with urql, so we just clear on server)
        const emptyResults = JSON.parse(heat.laneResults).map((r: {lane: number, racer_id: number, time: number | null, place: number | null}) => ({ ...r, time: null, place: null }));
        
        try {
            const result = await updateHeatResultMutation({
                heatId: heat.id,
                results: JSON.stringify(emptyResults)
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
        setSelectedHeatId(heat.id);
        navigate(`/race/${id}/control/race`);
    } else {
        if (activeHeatId === heat.id) {
            setActiveHeatId(null);
        }
    }
  };

  const handleUpdateResult = async (heatId: number, results: any[]) => {
      try {
          const heat = heats.find((h: Heat) => h.id === heatId);
          if (!heat) return;

          const sortedResults = [...results] as {lane: number, racer_id: number, time: string | null, place: number | null}[];
          sortedResults.sort((a, b) => {
              const tA = parseFloat(a.time || '9999');
              const tB = parseFloat(b.time || '9999');
              return tA - tB;
          });
          
          sortedResults.forEach((r, idx) => r.place = idx + 1);

          const result = await updateHeatResultMutation({
              heatId,
              results: JSON.stringify(sortedResults)
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
  };

  const handleReorderHeats = async (updates: { heat_id: number, new_heat_number: number }[]) => {
    try {
      const formattedUpdates = updates.map(u => ({
        heatId: u.heat_id,
        newHeatNumber: u.new_heat_number
      }));
      const result = await reorderHeatsMutation({ heatUpdates: formattedUpdates });
      if (result.error) throw result.error;
      reExecute({ requestPolicy: 'network-only' });
    } catch (e: any) {
      console.error("Failed to reorder heats", e);
      throw e;
    }
  };

  const getRacerName = (id: number) => {
      if (id < 0) {
          return `Top ${Math.abs(id)}`;
      }
      const r = racers[id];
      if (!r) return `Racer #${id}`;
      return `${r.firstName} ${r.lastName} (#${r.carNumber})`;
  };

  const location = useLocation();
  const viewMode = location.pathname.includes('/control/race')
    ? 'EXECUTION'
    : location.pathname.includes('/control/free-race')
    ? 'FREE_RACE'
    : 'SCHEDULE';

  const sortedHeatsEx = [...heats].sort((a, b) => {
      if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
      return a.heatNumber - b.heatNumber;
  });
  
  const activeExecutionHeat = selectedHeatId 
      ? sortedHeatsEx.find((h: Heat) => h.id === selectedHeatId)
      : (sortedHeatsEx.length > 0 ? sortedHeatsEx[0] : null);
      
  const currentIndex = activeExecutionHeat 
      ? sortedHeatsEx.findIndex((h: Heat) => h.id === activeExecutionHeat.id) 
      : -1;
      
  const nextExecutionHeat = currentIndex !== -1 && currentIndex + 1 < sortedHeatsEx.length 
      ? sortedHeatsEx[currentIndex + 1] 
      : null;

  const upcomingHeats = currentIndex !== -1 
      ? sortedHeatsEx.slice(currentIndex + 1, currentIndex + 5)
      : [];

  const handleNextHeat = () => {
      setRoundSummary(null);
      if (nextExecutionHeat) {
          setSelectedHeatId(nextExecutionHeat.id);
      }
  };

  const handleStartTimer = (heatId: number) => {
    setActiveHeatId(heatId);
  };

  if (fetching && !data) return <div>Loading Race Control...</div>;

  if (!race && !fetching) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  return (
    <div className="container" style={{ padding: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Race Control</h1>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifySelf: 'center' }}>
            <div style={{ display: 'flex', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button 
                    onClick={() => navigate(`/race/${id}/control/schedule`)}
                     style={{ 
                        padding: '8px 20px', 
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
                        padding: '8px 20px',
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
                        padding: '8px 20px',
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

        <div style={{ justifySelf: 'end' }}>
        </div>
      </div>

      {viewMode === 'FREE_RACE' ? (
        <FreeRaceTab
          raceId={id}
          laneCount={race?.track?.laneCount ?? 4}
          timerType={race?.track?.timerType ?? null}
          racers={racers}
        />
      ) : viewMode === 'EXECUTION' ? (
        heats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '8px' }}>
            <p>No heats available. Please add a round in the Schedule view first.</p>
          </div>
        ) : (
          <RaceExecution
            activeExecutionHeat={activeExecutionHeat || null}
            nextExecutionHeat={nextExecutionHeat}
            upcomingHeats={upcomingHeats}
            activeHeatId={activeHeatId}
            onRunHeat={handleRunHeat}
            onStartTimer={handleStartTimer}
            onNextHeat={handleNextHeat}
            getRacerName={getRacerName}
            onUpdateResult={handleUpdateResult}
            timerType={race?.track?.timerType}
            racers={racers}
            roundSummary={roundSummary}
          />
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
