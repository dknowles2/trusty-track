import React, { useState, useEffect } from 'react';
import { useAlert } from '../../context/AlertContext';
import { useMutation } from 'urql';
import { CREATE_ROUND_WIZARD } from '../../graphql/raceDetails';

interface RoundWizardProps {
  isOpen: boolean;
  onClose: () => void;
  raceId: number;
  racerCount: number;
  denCount: number;
  laneCount: number;
  championshipTrophies: number;
  onCreated: () => void;
}

interface GeneralConfig {
  type: 'PACK' | 'DEN';
  runsPerLane: number;
}

interface ChampionshipConfig {
  id: string;
  name: string;
  source: 'PACK' | 'DEN';
  numTopRacers: number;
  runsPerLane: number;
}

// Helper to estimate duration (in minutes)
const ESTIMATED_HEAT_DURATION_MIN = 1.5;

export const RoundWizard: React.FC<RoundWizardProps> = ({
  isOpen,
  onClose,
  raceId,
  racerCount,
  denCount,
  laneCount,
  championshipTrophies,
  onCreated,
}) => {
  const [step, setStep] = useState(1);
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    type: 'PACK',
    runsPerLane: 1,
  });
  const [championshipRounds, setChampionshipRounds] = useState<ChampionshipConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlert();
  
  // GraphQL Mutation
  const [, createRoundWizardMutation] = useMutation(CREATE_ROUND_WIZARD);

  // Initialize defaults when opening
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setGeneralConfig({ type: 'PACK', runsPerLane: 1 });
      setChampionshipRounds([{
        id: 'champ-1',
        name: 'Grand Finals',
        source: 'PACK',
        numTopRacers: Math.max(championshipTrophies, laneCount), // Default to filling a heat
        runsPerLane: 1
      }]);
    }
  }, [isOpen, laneCount]);

  const calculateTotalHeats = () => {
    let heats = 0;
    
    // General Round
    // If Runs Per Lane = N, then we have roughly N * RacerCount / LaneCount heats
    heats += (racerCount * generalConfig.runsPerLane) / laneCount;

    // Championship Rounds
    for (const round of championshipRounds) {
      let participatingRacers = 0;
      if (round.source === 'PACK') {
        participatingRacers = round.numTopRacers;
      } else {
        participatingRacers = round.numTopRacers * denCount;
      }
       heats += (participatingRacers * round.runsPerLane) / laneCount;
    }

    return Math.ceil(heats);
  };

  const estimatedDuration = Math.ceil(calculateTotalHeats() * ESTIMATED_HEAT_DURATION_MIN);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const handleAddChampionshipRound = () => {
    setChampionshipRounds(prev => [
      ...prev,
      {
        id: `champ-${Date.now()}`,
        name: 'New Championship Round',
        source: 'PACK',
        numTopRacers: laneCount,
        runsPerLane: 1
      }
    ]);
  };

  const handleRemoveChampionshipRound = (id: string) => {
    setChampionshipRounds(prev => prev.filter(r => r.id !== id));
  };

  const updateChampionshipRound = (id: string, updates: Partial<ChampionshipConfig>) => {
    const nextRounds = championshipRounds.map(r => {
        if (r.id === id) return { ...r, ...updates };
        return r;
    });
    setChampionshipRounds(nextRounds);
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const config = {
        generalRound: {
          type: generalConfig.type,
          runsPerLane: generalConfig.runsPerLane,
        },
        championshipRounds: championshipRounds.map((r) => ({
          name: r.name,
          source: r.source,
          numTopRacers: r.numTopRacers,
          runsPerLane: r.runsPerLane,
        })),
      };
      
      const result = await createRoundWizardMutation({ raceId, config });
      
      if (result.error) {
          throw result.error;
      }
      
      onCreated();
      onClose();
    } catch (error: any) {
      console.error('Failed to create rounds via wizard:', error);
      const message = error.message || 'Unknown error';
      showAlert(`Failed to create rounds: ${message}`, "Error");
    } finally {
      setLoading(false);
    }
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold">Race Schedule Wizard</h2>
          <p className="text-gray-600 text-sm mt-1">
             Quickly generate a complete race schedule based on your settings.
          </p>
          <div className="flex items-center mt-4 text-sm">
             <div className={`flex items-center ${step >= 1 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center border mr-2 ${step >= 1 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>1</span>
                General Rounds
             </div>
             <div className="w-8 h-px bg-gray-300 mx-2"></div>
             <div className={`flex items-center ${step >= 2 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center border mr-2 ${step >= 2 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>2</span>
                Championships
             </div>
             <div className="w-8 h-px bg-gray-300 mx-2"></div>
             <div className={`flex items-center ${step >= 3 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center border mr-2 ${step >= 3 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>3</span>
                Review
             </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
            {step === 1 && (
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Qualifying / General Round Type</label>
                        <div className="grid grid-cols-2 gap-4">
                            <div 
                                className={`border rounded-lg p-4 cursor-pointer transition-colors ${generalConfig.type === 'PACK' ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                                onClick={() => setGeneralConfig({ ...generalConfig, type: 'PACK' })}
                            >
                                <div className="font-medium">All Pack</div>
                                <div className="text-sm text-gray-500 mt-1">Every racer races against everyone else in the pack.</div>
                            </div>
                            <div 
                                className={`border rounded-lg p-4 cursor-pointer transition-colors ${generalConfig.type === 'DEN' ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                                onClick={() => setGeneralConfig({ ...generalConfig, type: 'DEN' })}
                            >
                                <div className="font-medium">By Den</div>
                                <div className="text-sm text-gray-500 mt-1">Racers only race against others in their own Den initially.</div>
                            </div>
                        </div>
                    </div>

                    <div>
                         <label className="block text-sm font-medium text-gray-700 mb-2">Runs Per Lane</label>
                         <input 
                            type="number" 
                            min="1" 
                            max="4"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            value={generalConfig.runsPerLane}
                            onChange={(e) => setGeneralConfig({ ...generalConfig, runsPerLane: parseInt(e.target.value) || 1 })}
                         />
                         <p className="text-xs text-gray-500 mt-1">How many times does each racer run in each lane? (Standard is 1)</p>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-6">
                     <div className="flex justify-between items-center">
                        <h3 className="font-medium text-gray-900">Championship Rounds</h3>
                        <button onClick={handleAddChampionshipRound} className="text-blue-600 text-sm hover:underline">+ Add Round</button>
                     </div>

                     {championshipRounds.length === 0 && (
                         <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg dashed border border-gray-200">
                             No championship rounds configured.
                         </div>
                     )}

                     {championshipRounds.map((round) => (
                         <div key={round.id} className="border rounded-lg p-4 bg-gray-50 relative">
                             <button 
                                onClick={() => handleRemoveChampionshipRound(round.id)}
                                className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                                title="Remove Round"
                                aria-label="Remove Round"
                                data-testid="remove-round-btn"
                             >
                                 &times;
                             </button>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <div>
                                     <label className="block text-xs font-medium text-gray-700 mb-1">Round Name</label>
                                     <input 
                                        type="text" 
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                        value={round.name}
                                        onChange={(e) => updateChampionshipRound(round.id, { name: e.target.value })}
                                     />
                                 </div>
                                 <div>
                                     <label className="block text-xs font-medium text-gray-700 mb-1">Advancement Source</label>
                                     <select 
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                        value={round.source}
                                        onChange={(e) => updateChampionshipRound(round.id, { source: e.target.value as 'PACK' | 'DEN' })}
                                     >
                                         <option value="PACK">Top Overall (Pack)</option>
                                         <option value="DEN">Top per Den</option>
                                     </select>
                                 </div>
                                 <div>
                                     <label className="block text-xs font-medium text-gray-700 mb-1">
                                         {round.source === 'PACK' ? 'Number of Finalists' : 'Advancing per Den'}
                                     </label>
                                     <input 
                                        type="number" 
                                        min="1"
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                        value={round.numTopRacers}
                                        onChange={(e) => updateChampionshipRound(round.id, { numTopRacers: parseInt(e.target.value) || 1 })}
                                     />
                                 </div>
                                 <div>
                                     <label className="block text-xs font-medium text-gray-700 mb-1">Runs Per Lane</label>
                                     <input 
                                        type="number" 
                                        min="1"
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                        value={round.runsPerLane}
                                        onChange={(e) => updateChampionshipRound(round.id, { runsPerLane: parseInt(e.target.value) || 1 })}
                                     />
                                 </div>
                             </div>
                         </div>
                     ))}
                </div>
            )}

            {step === 3 && (
                <div className="space-y-6">
                    <div className="bg-blue-50 p-4 rounded-lg flex items-start">
                        <span className="text-2xl mr-3">⏱️</span>
                        <div>
                            <div className="font-bold text-blue-900">Estimated Duration: ~{estimatedDuration} mins</div>
                            <div className="text-blue-700 text-sm">Total Heats: {calculateTotalHeats()}</div>
                        </div>
                    </div>

                    <div className="border rounded-lg divide-y">
                        <div className="p-4">
                            <h4 className="font-bold text-gray-900">1. {generalConfig.type === 'PACK' ? 'All Pack' : 'Den'} Round</h4>
                             <p className="text-sm text-gray-600">
                                 {generalConfig.type === 'PACK' ? 'All racers compete against each other.' : 'Racers compete within their dens.'}
                                 {' '}{generalConfig.runsPerLane > 1 && `(${generalConfig.runsPerLane} runs per lane)`}
                             </p>
                        </div>
                        {championshipRounds.map((round, idx) => (
                             <div key={round.id} className="p-4">
                                <h4 className="font-bold text-gray-900">{idx + 2}. {round.name}</h4>
                                <p className="text-sm text-gray-600">
                                    Advances top {round.numTopRacers} racers
                                    {round.source === 'DEN' ? ' from each Den' : ' overall'}.
                                    {' '}{round.runsPerLane > 1 && `(${round.runsPerLane} runs per lane)`}
                                </p>
                             </div>
                        ))}
                    </div>

                    <div className="text-sm text-gray-500">
                        * Creating this schedule will generate all necessary rounds and heats. You can still modify the schedule later, but the wizard assumes a clean slate.
                    </div>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex justify-between">
            {step > 1 ? (
                 <button onClick={handleBack} className="secondary-btn" disabled={loading}>
                    Back
                 </button>
            ) : (
                 <button onClick={onClose} className="secondary-btn" disabled={loading}>
                    Cancel
                 </button>
            )}

            {step < 3 ? (
                <button onClick={handleNext} className="primary-btn">
                    Next
                </button>
            ) : (
                <button onClick={handleCreate} className="primary-btn" disabled={loading}>
                     {loading ? 'Generating Schedule...' : 'Generate Schedule'}
                </button>
            )}
        </div>
      </div>
    </div>
  );
};
