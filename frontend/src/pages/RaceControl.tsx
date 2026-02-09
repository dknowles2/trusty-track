import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAlert } from '../context/AlertContext';
import { ScheduleManagement } from '../components/race-control/ScheduleManagement';
import { RaceExecution } from '../components/race-control/RaceExecution';
import Icon from '@mdi/react';
import { mdiCalendarRange, mdiFlagCheckered } from '@mdi/js';

interface Heat {
  id: number;
  round_number: number;
  round_id: number;
  heat_number: number;
  round_name: string | null;
  advancement_num_racers: number | null;
  advancement_source: string | null;
  lane_results: string; // JSON
  total_participants: number;
}

// Add Racer interface
interface Racer {
  id: number;
  first_name: string;
  last_name: string;
  car_number: number;
  racer_image_url?: string;
  car_image_url?: string;
}

interface AdvancementRacer {
    racer_id: number;
    first_name: string;
    last_name: string;
    car_number: number | null;
    den_name: string;
    score: number;
    rank: number;
    is_advancing: boolean;
}

interface AdvancementStatus {
    is_ready: boolean;
    requires_advancement: boolean;
    already_advanced: boolean;
    advancing_racers: AdvancementRacer[];
    source: string | null;
    num_racers: number | null;
}

export default function RaceControl() {
  const { showAlert, showToast } = useAlert();
  const { raceId, tab } = useParams<{ raceId: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [heats, setHeats] = useState<Heat[]>([]);
  const [racers, setRacers] = useState<Record<number, Racer>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);
  const [dens, setDens] = useState<{ id: number, name: string }[]>([]);
  const [timerType, setTimerType] = useState<string | null>(null);
  const [laneCount, setLaneCount] = useState<number>(4);
  const [championshipTrophies, setChampionshipTrophies] = useState<number>(3);
  const [roundSummary, setRoundSummary] = useState<AdvancementStatus | null>(null);

  useEffect(() => {
    if (raceId) {
      setActiveRaceId(parseInt(raceId));
      fetchData(parseInt(raceId));
    }
  }, [raceId]);

  // Initialize selectedHeatId to first uncompleted heat when heats load
  useEffect(() => {
      if (heats.length > 0 && selectedHeatId === null) {
          const sorted = [...heats].sort((a, b) => {
            if (a.round_number !== b.round_number) return a.round_number - b.round_number;
            return a.heat_number - b.heat_number;
          });
          
          const firstUncompleted = sorted.find(h => {
              const results = h.lane_results ? JSON.parse(h.lane_results) : [];
              return !(results.length > 0 && results[0].time !== null);
          });
          
          if (firstUncompleted) {
              setSelectedHeatId(firstUncompleted.id);
          } else if (sorted.length > 0) {
              // All completed, default to last
              setSelectedHeatId(sorted[sorted.length - 1].id);
          }
      }
  }, [heats, selectedHeatId]);

  const fetchData = async (id: number) => {
      setLoading(true);
      try {
          const [heatsData, racersData, configData, densData, raceData] = await Promise.all([
              apiClient.get(`/races/${id}/heats`),
              apiClient.get(`/racers/?race_id=${id}`),
              apiClient.get('/config/initial'),
              apiClient.get(`/races/${id}/dens/`),
              apiClient.get(`/races/${id}`)
          ]);
          setHeats(heatsData);
          setTimerType(configData.timer_type);
          setLaneCount(configData.lane_count || 4);
          setDens(densData);
          setChampionshipTrophies(raceData.championship_trophies || 3);
          
          const racerMap: Record<number, Racer> = {};
          racersData.forEach((r: Racer) => {
              racerMap[r.id] = r;
          });
          setRacers(racerMap);
          
      } catch (e) {
          console.error("Failed to fetch race data", e);
      } finally {
          setLoading(false);
      }
  };

  const handleAddRound = async (config: any) => {
    if (!activeRaceId) return;
    setGenerating(true);
    try {
      // Create new round(s) - backend now handles heat generation too
      await apiClient.post(`/races/${activeRaceId}/rounds`, {
        race_id: activeRaceId,
        scheduling_strategy: config.schedulingStrategy || 'PPC',
        name: config.name,
        advancement_source: config.advancementSource,
        advancement_num_racers: config.advancementNumRacers,
        runs_per_lane: config.runsPerLane || 1,
        general_type: config.generalType || 'PACK'
      });
      
      // Fetch updated heats
      const updatedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
      setHeats(updatedHeats);
      setSelectedHeatId(null); // Reset selection to trigger re-init
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
      await apiClient.post(`/rounds/${roundId}/regenerate`, {});
      const fetchedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
      setHeats(fetchedHeats);
      if (!silent) {
        showToast("Schedule regenerated successfully.", "success");
      }
    } catch (e: any) {
      console.error("Failed to regenerate round", e);
      const detail = e.response?.data?.detail || "Failed to regenerate the schedule.";
      showAlert(detail, "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteRound = async (roundId: number) => {
    try {
      setGenerating(true);
      await apiClient.delete(`/rounds/${roundId}`);
      const fetchedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
      setHeats(fetchedHeats);
      showToast("Round deleted successfully.", "success");
    } catch (e: any) {
      console.error("Failed to delete round", e);
      const detail = e.response?.data?.detail || "Failed to delete the round.";
      showAlert(detail, "Error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunHeat = async (heat: Heat, shouldStart: boolean = true) => {
    // Check if heat already has results
    const hasResults = heat.lane_results && JSON.parse(heat.lane_results).some((r: any) => r.time !== null);
    
    if (hasResults) {
        // Clear results locally first (Optimistic UI Update)
        const emptyResults = JSON.parse(heat.lane_results).map((r: any) => ({ ...r, time: null, place: null }));
        const updatedHeat = { ...heat, lane_results: JSON.stringify(emptyResults) };

        // Update state immediately to reflect change in UI
        setHeats(prevHeats => prevHeats.map(h => h.id === heat.id ? updatedHeat : h));
        setRoundSummary(null); // Clear any summary
        
        try {
            await apiClient.put(`/heats/${heat.id}`, updatedHeat);
            
            // Refetch to confirm sync with server
            if (activeRaceId) {
                const fetchedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
                 setHeats(fetchedHeats);
            }
        } catch (error) {
            console.error("Failed to clear results for re-run", error);
            // Revert state by refetching
            if (activeRaceId) {
                const fetchedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
                setHeats(fetchedHeats);
            }
            showToast("Failed to reset heat on server", "error");
            return; // Don't proceed if clearing failed
        }
    }

    if (shouldStart) {
        // Just switch to execution view and select the heat
        // Don't set activeHeatId - timer will be started by FakeTimerMole "Start Timer" button
        setSelectedHeatId(heat.id);
        navigate(`/race/${activeRaceId}/control/race`);
    } else {
        // If we are just clearing results, ensure we are NOT active
        if (activeHeatId === heat.id) {
            setActiveHeatId(null);
        }
        // Don't switch views when just clearing results
    }
    
    // If we are using the fake timer system-wide (i.e. simulating separate hardware),
    // we do NOT run the local random simulation. We wait for the Mole or separate event.
    // In fact, with SKIP removed, all timer types are either FAKE (manual/external) or Hardware.
    // So we just set active and wait.
    return;
  };

  const handleUpdateResult = async (heatId: number, results: any[]) => {
      try {
          const heat = heats.find(h => h.id === heatId);
          if (!heat) return;

          // Re-sort to assign places based on new times
          // Clone results to avoid mutating the passed array just in case
          const sortedResults = [...results];
          // Filter out results with empty time to avoid parsing errors, or handle elegantly
          // Assuming valid input for now or partial input
          
          sortedResults.sort((a: any, b: any) => {
              const tA = parseFloat(a.time || '9999');
              const tB = parseFloat(b.time || '9999');
              return tA - tB;
          });
          
          sortedResults.forEach((r: any, idx: number) => r.place = idx + 1);

          await apiClient.put(`/heats/${heatId}`, {
              ...heat,
              lane_results: JSON.stringify(sortedResults)
          });

          // Update local state
          if (activeRaceId) {
              const updatedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
              setHeats(updatedHeats);
              
              // Check for Round Completion
              await checkRoundCompletion(heat, updatedHeats);
          }
           
          // Clear active heat ID to stop the timer and reset state
          if (activeHeatId === heatId) {
              setActiveHeatId(null);
          }
      } catch (e) {
          console.error("Failed to update results", e);
          showAlert("Failed to update results.", "Error");
      }
  };

  const checkRoundCompletion = async (currentHeat: Heat, currentHeats: Heat[]) => {
      if (!activeRaceId) return;

      // Find all heats for this round
      const roundHeats = currentHeats.filter(h => h.round_id === currentHeat.round_id);
      
      // Check if this was the last heat of the round (based on heat number)
      const maxHeatNumber = Math.max(...roundHeats.map(h => h.heat_number));
      if (currentHeat.heat_number !== maxHeatNumber) {
          // Not the last heat
          setRoundSummary(null);
          return;
      }
      
      // Verify all heats in round are actually complete
      const allComplete = roundHeats.every(h => {
          if (!h.lane_results) return false;
          try {
              const res = JSON.parse(h.lane_results);
              return res.some((r: any) => r.time !== null);
          } catch { return false; }
      });
      
      if (allComplete) {
          // Fetch advancement status
          try {
             const status = await apiClient.get<AdvancementStatus>(`/races/${activeRaceId}/rounds/${currentHeat.round_id}/advancement_status`);
             setRoundSummary(status);
          } catch (error) {
              console.error("Failed to fetch advancement status", error);
          }
      }
  };


  const getRacerName = (id: number) => {
      if (id < 0) {
          return `Top ${Math.abs(id)}`;
      }
      const r = racers[id];
      if (!r) return `Racer #${id}`;
      return `${r.first_name} ${r.last_name} (#${r.car_number})`;
  };

  // ... existing state ...
  const viewMode = (tab?.toUpperCase() === 'RACE') ? 'EXECUTION' : 'SCHEDULE';

  // ... (keep existing useEffects and handlers) ...

  // Derived state for Execution Mode
  const sortedHeatsEx = [...heats].sort((a, b) => {
      if (a.round_number !== b.round_number) return a.round_number - b.round_number;
      return a.heat_number - b.heat_number;
  });
  
  // Use selectedHeatId for active execution heat
  const activeExecutionHeat = selectedHeatId 
      ? sortedHeatsEx.find(h => h.id === selectedHeatId)
      : (sortedHeatsEx.length > 0 ? sortedHeatsEx[0] : null); // Fallback until effect runs
      
  const currentIndex = activeExecutionHeat 
      ? sortedHeatsEx.findIndex(h => h.id === activeExecutionHeat.id) 
      : -1;
      
  const nextExecutionHeat = currentIndex !== -1 && currentIndex + 1 < sortedHeatsEx.length 
      ? sortedHeatsEx[currentIndex + 1] 
      : null;

  // Derive upcoming heats (next 4)
  const upcomingHeats = currentIndex !== -1 
      ? sortedHeatsEx.slice(currentIndex + 1, currentIndex + 5)
      : [];

  const handleNextHeat = () => {
      setRoundSummary(null);
      if (nextExecutionHeat) {
          setSelectedHeatId(nextExecutionHeat.id);
      }
  };

  const refetchHeats = async () => {
    if (!activeRaceId) return;
    try {
      const updatedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
      setHeats(updatedHeats);
    } catch (e) {
      console.error("Failed to refetch heats", e);
    }
  };

  const handleStartTimer = (heatId: number) => {
    setActiveHeatId(heatId);
  };

  // Auto-switch to execution mode if we have heats? Optional. 
  // Let's default to SCHEDULE for overview, but user can switch.

  if (loading) return <div>Loading Race Control...</div>;

  if (!activeRaceId) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  return (
    <div className="container" style={{ padding: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Race Control</h1>
        
        {/* Mode Switcher and Actions - Centered */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifySelf: 'center' }}>
            <div style={{ display: 'flex', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button 
                    onClick={() => navigate(`/race/${activeRaceId}/control/schedule`)}
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
                    onClick={() => navigate(`/race/${activeRaceId}/control/race`)}
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
            </div>
        </div>

        {/* Action Button - Right Aligned (Empty - functionality moved to Schedule view) */}
        <div style={{ justifySelf: 'end' }}>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>Loading race data...</p>
        </div>
      ) : !activeRaceId ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>No race selected</p>
        </div>
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
            timerType={timerType}
            racers={racers}
            roundSummary={roundSummary}
          />
        )
      ) : (
        <ScheduleManagement
          raceId={activeRaceId}
          heats={heats}
          generating={generating}
          activeHeatId={activeHeatId}
          onAddRound={handleAddRound}
          onRegenerateRound={handleRegenerateRound}
          onDeleteRound={handleDeleteRound}
          onRefetchHeats={refetchHeats}
          onRunHeat={handleRunHeat}
          getRacerName={getRacerName}
          laneCount={laneCount} 
          racerCount={Object.keys(racers).length}
          denCount={dens.length}
          championshipTrophies={championshipTrophies}
        />
      )}
    </div>
  );
}
