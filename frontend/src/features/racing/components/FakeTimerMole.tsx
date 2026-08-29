import React from 'react';
import { Icon } from '@mdi/react';
import { mdiTimerOutline, mdiPlay, mdiFlagCheckered, mdiChevronUp, mdiChevronDown } from '@mdi/js';
import { useMutation, useSubscription } from 'urql';
import { FAKE_TIMER_START, FAKE_TIMER_FINISH, TIMER_STATUS_SUBSCRIPTION } from '../graphql/queries';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';


/**
 * Whether the panel is collapsed, remembered across mounts.
 *
 * Remembering matters more than it looks: the panel remounts on every
 * navigation and the operator would otherwise re-collapse it all evening, which
 * is no better than not being able to collapse it at all.
 *
 * Storage is wrapped because it throws rather than returns null in a few
 * browser configurations, and a floating debug panel must never be the reason a
 * race screen fails to render.
 */
const COLLAPSED_KEY = 'trustytrack.fakeTimerMole.collapsed';

function readCollapsed(): boolean {
    try {
        return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function writeCollapsed(collapsed: boolean): void {
    try {
        window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
        // Not worth surfacing: the panel still works, it just forgets.
    }
}

interface FakeTimerMoleProps {
    isOpen: boolean;       // show/hide the mole panel
    heatId: number;        // passed to both mutations
    trackId: number;       // scopes the timerStatus subscription
    isFreeRace?: boolean;
}

export const FakeTimerMole: React.FC<FakeTimerMoleProps> = ({ isOpen, heatId, trackId, isFreeRace = false }) => {
    const { showAlert } = useAlert();

    // Expanded by default. Unlike the hardware panel's serial log — which is a
    // readout and starts collapsed — these buttons are the only way to run a
    // heat on a fake timer, so hiding them by default would break the very
    // configuration the panel exists for.
    const [collapsed, setCollapsed] = React.useState(readCollapsed);

    const toggleCollapsed = () => {
        setCollapsed(prev => {
            writeCollapsed(!prev);
            return !prev;
        });
    };

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
                const result = await fakeTimerFinish({ heatId, isFreeRace });
                if (result.error) {
                    showAlert(errorText(result.error, 'The heat could not be finished.'), 'Error');
                }
            }, delay);
        }
        return () => {
            if (timeout) clearTimeout(timeout);
        };
    }, [isOpen, timerState, heatId, isFreeRace, fakeTimerFinish, showAlert]);

    if (!isOpen) return null;

    const handleStartTimer = async () => {
        const result = await fakeTimerStart({ heatId, isFreeRace });
        if (result.error) {
            showAlert(errorText(result.error, 'The timer could not be started.'), 'Error');
        }
    };

    const handleFinishHeat = async () => {
        const result = await fakeTimerFinish({ heatId, isFreeRace });
        if (result.error) {
            showAlert(errorText(result.error, 'The heat could not be finished.'), 'Error');
        }
    };

    const isArmed = timerState === 'ARMED';
    const isRunning = timerState === 'RUNNING';

    const startDisabled = !isArmed;
    const finishDisabled = !isRunning;

    const statusText = () => {
        switch (timerState) {
            case 'ARMED':
                return <span style={{ color: 'var(--info-accent-color)', fontWeight: 'bold' }}>Ready to start</span>;
            case 'RUNNING':
                return <span style={{ color: 'var(--active-accent-color)', fontWeight: 'bold' }}>Racing...</span>;
            case 'IDLE':
                return <span style={{ color: 'var(--success-accent-color)', fontWeight: 'bold' }}>Heat Completed</span>;
            default:
                return <span style={{ color: 'var(--text-muted-color)', fontWeight: 'bold' }}>{timerState}</span>;
        }
    };

    return (
        <div
            className="fake-timer-mole"
            style={{
                position: 'fixed',
                bottom: '30px',
                right: '30px',
                background: 'var(--surface-color)',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
                zIndex: 1000,
                minWidth: '260px',
                display: 'flex',
                flexDirection: 'column',
                gap: collapsed ? 0 : 10,
                border: '2px solid var(--active-accent-color)'
            }}
        >
            <h3
                onClick={toggleCollapsed}
                title={collapsed ? 'Show the fake timer controls' : 'Collapse out of the way'}
                style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
            >
                <Icon path={mdiTimerOutline} size={0.9} color="var(--active-accent-color)" />
                Fake Timer Controls
                <span style={{ flex: 1 }} />
                {/* Collapsed, this is the only thing left saying whether the
                    heat can be started — so it belongs in the header, not in
                    the body with the buttons. */}
                <span style={{ fontSize: '0.72rem', color: 'var(--active-accent-color)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {timerState}
                </span>
                <Icon path={collapsed ? mdiChevronUp : mdiChevronDown} size={0.7} color="var(--text-muted-color)" />
            </h3>

            {!collapsed && (
              <>
            <button
                className="secondary-btn"
                onClick={handleStartTimer}
                disabled={startDisabled}
                style={{ width: '100%', cursor: startDisabled ? 'not-allowed' : 'pointer', padding: '10px', background: startDisabled ? 'var(--surface-soft-color)' : 'var(--surface-strong-color)', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: startDisabled ? 'var(--text-faint-color)' : 'var(--text-emphasis-color)' }}
            >
                <Icon path={mdiPlay} size={0.7} color={startDisabled ? 'var(--input-border-color)' : 'var(--success-accent-color)'} /> Start Timer
            </button>

            <button
                className="primary-btn"
                onClick={handleFinishHeat}
                disabled={finishDisabled}
                style={{ width: '100%', cursor: finishDisabled ? 'not-allowed' : 'pointer', padding: '10px', background: finishDisabled ? 'var(--surface-soft-color)' : 'var(--error)', color: finishDisabled ? 'var(--text-faint-color)' : 'var(--on-primary-color)', border: 'none', borderRadius: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
                <Icon path={mdiFlagCheckered} size={0.7} color={finishDisabled ? 'var(--input-border-color)' : 'var(--on-primary-color)'} /> Finish Heat
            </button>

            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                {statusText()}
            </div>

            <div style={{ marginTop: '5px', fontSize: '0.8rem', color: 'var(--text-subtle-color)' }}>
                Simulates hardware timer events.
            </div>
              </>
            )}
        </div>
    );
};
