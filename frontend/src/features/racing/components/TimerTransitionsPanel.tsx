import React, { useState } from 'react';
import { Icon } from '@mdi/react';
import { mdiStateMachine, mdiChevronUp, mdiChevronDown, mdiArrowRight } from '@mdi/js';
import { useSubscription } from 'urql';
import { TIMER_STATUS_SUBSCRIPTION } from '../graphql/queries';

interface TimerTransition {
    at: string;
    fromState: string;
    toState: string;
}

interface TimerTransitionsPanelProps {
    trackId: number;
    docked?: boolean;
}

/**
 * The timer's own state-machine history (#1079) — the debug view every
 * timer type can show, unlike `HardwareTimerMole`'s serial log, which only a
 * real device's wire produces. A stuck `WAITING` is the most common
 * real-venue fault, and this is half of diagnosing it.
 *
 * Deliberately no controls (no reconnect, no release-gate button) — those
 * belong to the hardware mole, which still owns the actual device
 * interactions. This panel only reads `TimerStatus.transitions`.
 */
export const TimerTransitionsPanel: React.FC<TimerTransitionsPanelProps> = ({ trackId, docked = false }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const [subResult] = useSubscription({
        query: TIMER_STATUS_SUBSCRIPTION,
        variables: { trackId },
        pause: !trackId,
    });

    const transitions: TimerTransition[] = subResult.data?.timerStatus?.status?.transitions ?? [];
    const timerState: string = subResult.data?.timerStatus?.status?.state ?? 'DISCONNECTED';

    return (
        <div
            data-testid="timer-transitions-panel"
            style={{
                position: docked ? undefined : 'fixed',
                bottom: docked ? undefined : '30px',
                left: docked ? undefined : '30px',
                marginTop: docked ? '20px' : undefined,
                width: docked ? '100%' : undefined,
                boxSizing: 'border-box',
                background: 'var(--surface-color)',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: docked ? '0 2px 8px rgba(0,0,0,0.1)' : '0 5px 20px rgba(0,0,0,0.2)',
                zIndex: docked ? undefined : 1000,
                minWidth: '260px',
                maxWidth: docked ? '100%' : '420px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                border: '2px solid var(--info-accent-color)',
            }}
        >
            <h3
                onClick={() => setIsExpanded((prev) => !prev)}
                style={{ margin: '0 0 5px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
            >
                <Icon path={mdiStateMachine} size={0.9} color="var(--info-accent-color)" />
                Timer State Machine
                <span style={{ flex: 1 }} />
                <span style={{
                    fontSize: '0.72rem',
                    color: 'var(--info-accent-color)',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                }}>
                    {timerState}
                </span>
                <Icon path={isExpanded ? mdiChevronDown : mdiChevronUp} size={0.7} color="var(--text-muted-color)" />
            </h3>

            {isExpanded && (
                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {transitions.length === 0 ? (
                        <div style={{ color: 'var(--text-faint-color)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            No transitions yet.
                        </div>
                    ) : (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                            {transitions.map((t, i) => (
                                <div
                                    key={i}
                                    style={{
                                        padding: '2px 4px 2px 8px',
                                        display: 'flex',
                                        gap: '8px',
                                        alignItems: 'baseline',
                                        borderLeft: '3px solid var(--info-accent-color)',
                                        marginBottom: '1px',
                                    }}
                                >
                                    <span style={{ color: 'var(--text-faintest-color)', minWidth: '70px' }}>
                                        {new Date(t.at).toLocaleTimeString()}
                                    </span>
                                    <span style={{ color: 'var(--text-color)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        {t.fromState}
                                        <Icon path={mdiArrowRight} size={0.5} color="var(--text-faint-color)" />
                                        {t.toState}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
