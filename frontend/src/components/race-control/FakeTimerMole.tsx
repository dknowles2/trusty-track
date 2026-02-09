import React from 'react';
import Icon from '@mdi/react';
import { mdiTimerOutline, mdiPlay, mdiFlagCheckered } from '@mdi/js';


interface FakeTimerMoleProps {
    onTriggerFinish: (results: any[]) => void;
    onTriggerStart?: () => void;
    activeHeat: any;
    isOpen: boolean;
    isRunning?: boolean;
    isCompleted?: boolean;
}

export const FakeTimerMole: React.FC<FakeTimerMoleProps> = ({ onTriggerFinish, onTriggerStart, activeHeat, isOpen, isRunning, isCompleted }) => {
    React.useEffect(() => {
        let timeout: NodeJS.Timeout;
        if (isOpen && isRunning) {
            // Auto finish after 3-5 seconds
            const delay = 3000 + Math.random() * 2000;
            timeout = setTimeout(() => {
                handleFinishHeat();
            }, delay);
        }
        return () => {
            if (timeout) clearTimeout(timeout);
        };
    }, [isOpen, isRunning, activeHeat?.id]);

    if (!isOpen) return null;

    const handleStartTimer = () => {
        if (onTriggerStart) {
            onTriggerStart();
        }
    };

    const handleFinishHeat = () => {
        // Generate random results locally for the fake timer
        const currentResults = activeHeat.lane_results ? JSON.parse(activeHeat.lane_results) : [];
        
        const newResults = currentResults.map((r: any) => ({
            ...r,
            time: (3.0 + Math.random()).toFixed(4),
            place: 0 
        }));
        
        // Sort
        newResults.sort((a: any, b: any) => parseFloat(a.time) - parseFloat(b.time));
        newResults.forEach((r: any, idx: number) => r.place = idx + 1);

        onTriggerFinish(newResults);
    };

    return (
        <div 
            style={{
                position: 'fixed',
                bottom: '30px',
                right: '30px',
                background: 'white',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
                zIndex: 1000,
                minWidth: '220px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                border: '2px solid #ff9800'
            }}
        >
            <h3 style={{ margin: '0 0 5px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon path={mdiTimerOutline} size={0.9} color="#ff9800" /> Fake Timer Controls
            </h3>
            
            <button 
                className="secondary-btn"
                onClick={handleStartTimer}
                disabled={isCompleted || isRunning}
                style={{ width: '100%', cursor: (isCompleted || isRunning) ? 'not-allowed' : 'pointer', padding: '10px', background: (isCompleted || isRunning) ? '#f0f0f0' : '#e0e0e0', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: (isCompleted || isRunning) ? '#999' : '#000' }}
            >
                <Icon path={mdiPlay} size={0.7} color={(isCompleted || isRunning) ? '#ccc' : "#4caf50"} /> Start Timer
            </button>

            <button 
                className="primary-btn"
                onClick={handleFinishHeat}
                disabled={isCompleted || !isRunning}
                style={{ width: '100%', cursor: (isCompleted || !isRunning) ? 'not-allowed' : 'pointer', padding: '10px', background: (isCompleted || !isRunning) ? '#f0f0f0' : '#d32f2f', color: (isCompleted || !isRunning) ? '#999' : 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
                <Icon path={mdiFlagCheckered} size={0.7} color={(isCompleted || !isRunning) ? '#ccc' : "white"} /> Finish Heat
            </button>
            
            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: '#666' }}>
                {isCompleted ? (
                    <span style={{ color: '#4caf50', fontWeight: 'bold' }}>Heat Completed</span>
                ) : isRunning ? (
                    <span style={{ color: '#ff9800', fontWeight: 'bold' }}>Racing...</span>
                ) : (
                    "Ready to start"
                )}
            </div>
            
            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: '#888' }}>
                Simulates hardware timer events.
            </div>
        </div>
    );
};
