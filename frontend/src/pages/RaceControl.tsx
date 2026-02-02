import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { ScheduleManagement } from '../components/race-control/ScheduleManagement';
import { RaceExecution } from '../components/race-control/RaceExecution';

interface Heat {
  id: number;
  round_number: number;
  heat_number: number;
  lane_results: string; // JSON
}

// Add Racer interface
interface Racer {
  id: number;
  first_name: string;
  last_name: string;
  car_number: number;
}

export default function RaceControl() {
  const { raceId } = useParams<{ raceId: string }>();
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [heats, setHeats] = useState<Heat[]>([]);
  const [racers, setRacers] = useState<Record<number, Racer>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);

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
          const [heatsData, racersData] = await Promise.all([
              apiClient.get(`/races/${id}/heats`),
              apiClient.get(`/racers/?race_id=${id}`)
          ]);
          setHeats(heatsData);
          
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

  const handleGenerateSchedule = async () => {
    if (!activeRaceId) return;
    setGenerating(true);
    try {
      const data = await apiClient.post(`/races/${activeRaceId}/generate_heats`, {});
      setHeats(data);
      setSelectedHeatId(null); // Reset selection to trigger re-init
    } catch (e) {
      console.error("Failed to generate", e);
      alert("Failed to generate schedule. Ensure you have at least 2 racers.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunHeat = async (heat: Heat) => {
    setActiveHeatId(heat.id);
    // Simulate race duration
    setTimeout(async () => {
      // Generate random results for lanes
      // Parse existing lane_results to keep assignments
      const assignments = JSON.parse(heat.lane_results || '[]');
      const results = assignments.map((a: any) => ({
        ...a,
        time: (3.0 + Math.random()).toFixed(4),
        place: 0 // logic to sort places later
      }));
      
      // Sort to assign places
      results.sort((a: any, b: any) => parseFloat(a.time) - parseFloat(b.time));
      results.forEach((r: any, idx: number) => r.place = idx + 1);

      try {
        await apiClient.put(`/heats/${heat.id}`, { 
          ...heat, 
          lane_results: JSON.stringify(results) 
        });
        
        // Update local state without full refetch if possible, but refetch is safer for sync
        if (activeRaceId) {
            const updatedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
            setHeats(updatedHeats);
            // NOTE: We do NOT update selectedHeatId here, satisfying "no auto-advance"
        }
      } catch (e) {
        console.error("Failed to save results", e);
        alert("Failed to save race results. Please try again.");
      } finally {
        setActiveHeatId(null);
      }
    }, 2000); // 2 second race simulation
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
          }
      } catch (e) {
          console.error("Failed to update results", e);
          alert("Failed to update results.");
      }
  };

  const getRacerName = (id: number) => {
      const r = racers[id];
      if (!r) return `Racer #${id}`;
      return `${r.first_name} ${r.last_name} (#${r.car_number})`;
  };

  // ... existing state ...
  const [viewMode, setViewMode] = useState<'SCHEDULE' | 'EXECUTION'>('SCHEDULE');

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

  const handleNextHeat = () => {
      if (nextExecutionHeat) {
          setSelectedHeatId(nextExecutionHeat.id);
      }
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
    <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Race Control</h1>
        
        {/* Mode Switcher and Actions - Centered */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifySelf: 'center' }}>
            <div style={{ display: 'flex', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button 
                    onClick={() => setViewMode('SCHEDULE')}
                    style={{ 
                        padding: '8px 20px', 
                        borderRadius: '20px', 
                        border: 'none', 
                        background: viewMode === 'SCHEDULE' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'SCHEDULE' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'SCHEDULE' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    📅 Schedule
                </button>
                <button 
                    onClick={() => setViewMode('EXECUTION')}
                    style={{ 
                        padding: '8px 20px', 
                        borderRadius: '20px', 
                        border: 'none', 
                        background: viewMode === 'EXECUTION' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'EXECUTION' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'EXECUTION' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    🏁 Race
                </button>
            </div>
        </div>

        {/* Action Button - Right Aligned (Empty - functionality moved to Schedule view) */}
        <div style={{ justifySelf: 'end' }}>
        </div>
      </div>

      {heats.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '8px' }}>
          <p>No heats scheduled.</p>
          <button className="primary-btn" onClick={handleGenerateSchedule}>Generate Schedule</button>
        </div>
      ) : viewMode === 'EXECUTION' ? (
        <RaceExecution
          activeExecutionHeat={activeExecutionHeat || null}
          nextExecutionHeat={nextExecutionHeat}
          activeHeatId={activeHeatId}
          onRunHeat={handleRunHeat}
          onNextHeat={handleNextHeat}
          getRacerName={getRacerName}
          onUpdateResult={handleUpdateResult}
        />
      ) : (
        <ScheduleManagement
          heats={heats}
          generating={generating}
          activeHeatId={activeHeatId}
          onGenerate={handleGenerateSchedule}
          onRunHeat={handleRunHeat}
          getRacerName={getRacerName}
        />
      )}
    </div>
  );
}
