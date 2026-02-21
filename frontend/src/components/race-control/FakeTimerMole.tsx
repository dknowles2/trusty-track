import React from 'react';
import Icon from '@mdi/react';
import { mdiTimerOutline, mdiPlay, mdiFlagCheckered } from '@mdi/js';
import { useMutation, useSubscription } from 'urql';
import { FAKE_TIMER_START, FAKE_TIMER_FINISH, TIMER_STATUS_SUBSCRIPTION } from '../../graphql/raceDetails';
import { useAlert } from '../../context/AlertContext';


interface FakeTimerMoleProps {
    isOpen: boolean;       // show/hide the mole panel
    heatId: number;        // passed to both mutations
    trackId: number;       // scopes the timerStatus subscription
}

export const FakeTimerMole: React.FC<FakeTimerMoleProps> = ({ isOpen, heatId, trackId }) => {
    const { showAlert } = useAlert();

    const [, fakeTimerStart] = useMutation(FAKE_TIMER_START);
    const [, fakeTimerFinish] = useMutation(FAKE_TIMER_FINISH);

    const [subResult] = useSubscription({
        query: TIMER_STATUS_SUBSCRIPTION,
        variables: { trackId },
        pause: !isOpen || !trackId,
    });

    const timerState: string = subResult.data?.timerStatus?.status?.state ?? 'IDLE';

    // Auto-finish after 3-5 seconds when timer transitions to RUNNING
    React.useEffect(() => {
        let timeout: NodeJS.Timeout;
        if (isOpen && timerState === 'RUNNING') {
            const delay = 3000 + Math.random() * 2000;
            timeout = setTimeout(async () => {
                const result = await fakeTimerFinish({ heatId });
                if (result.error) {
                    showAlert(result.error.message || 'Failed to finish heat.', 'Error');
                }
            }, delay);
        }
        return () => {
            if (timeout) clearTimeout(timeout);
        };
    }, [isOpen, timerState, heatId]);

    if (!isOpen) return null;

    const handleStartTimer = async () => {
        const result = await fakeTimerStart({ heatId });
        if (result.error) {
            showAlert(result.error.message || 'Failed to start timer.', 'Error');
        }
    };

    const handleFinishHeat = async () => {
        const result = await fakeTimerFinish({ heatId });
        if (result.error) {
            showAlert(result.error.message || 'Failed to finish heat.', 'Error');
        }
    };

    const isArmed = timerState === 'ARMED';
    const isRunning = timerState === 'RUNNING';

    const startDisabled = !isArmed;
    const finishDisabled = !isRunning;

    const statusText = () => {
        switch (timerState) {
            case 'ARMED':
                return <span style={{ color: '#2196f3', fontWeight: 'bold' }}>Ready to start</span>;
            case 'RUNNING':
                return <span style={{ color: '#ff9800', fontWeight: 'bold' }}>Racing...</span>;
            case 'IDLE':
                return <span style={{ color: '#4caf50', fontWeight: 'bold' }}>Heat Completed</span>;
            default:
                return <span style={{ color: '#666', fontWeight: 'bold' }}>{timerState}</span>;
        }
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
                disabled={startDisabled}
                style={{ width: '100%', cursor: startDisabled ? 'not-allowed' : 'pointer', padding: '10px', background: startDisabled ? '#f0f0f0' : '#e0e0e0', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: startDisabled ? '#999' : '#000' }}
            >
                <Icon path={mdiPlay} size={0.7} color={startDisabled ? '#ccc' : '#4caf50'} /> Start Timer
            </button>

            <button
                className="primary-btn"
                onClick={handleFinishHeat}
                disabled={finishDisabled}
                style={{ width: '100%', cursor: finishDisabled ? 'not-allowed' : 'pointer', padding: '10px', background: finishDisabled ? '#f0f0f0' : '#d32f2f', color: finishDisabled ? '#999' : 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
                <Icon path={mdiFlagCheckered} size={0.7} color={finishDisabled ? '#ccc' : 'white'} /> Finish Heat
            </button>

            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: '#666' }}>
                {statusText()}
            </div>

            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: '#888' }}>
                Simulates hardware timer events.
            </div>
        </div>
    );
};
