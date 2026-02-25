import React, { useState, useEffect, useRef } from 'react';
import { useSubscription, useMutation } from 'urql';
import Modal from '../Modal';
import { FakeTimerMole } from './FakeTimerMole';
import { TimerStatusBadge } from './TimerStatusBadge';
import { SerialProxyConnector } from './SerialProxyConnector';
import { TIMER_STATUS_SUBSCRIPTION, PREPARE_HEAT, ABORT_HEAT, FORCE_RESULTS } from '../../graphql/raceDetails';
import RacerAvatar from '../RacerAvatar';
import Icon from '@mdi/react';
import { mdiTrophy, mdiPencil, mdiRefresh, mdiArrowRight, mdiChevronRight, mdiCloseOctagon, mdiAlertCircleOutline } from '@mdi/js';

export interface Heat {
    id: number;
    roundNumber: number;
    roundId: number;
    heatNumber: number;
    roundName: string | null;
    laneResults: string; // JSON
}

export interface Racer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber: number;
    racerImageUrl?: string;
    carImageUrl?: string;
}

export interface AdvancementRacer {
    racerId: number;
    firstName: string;
    lastName: string;
    carNumber: number | null;
    denName: string;
    score: number;
    rank: number;
    isAdvancing: boolean;
}

export interface AdvancementStatus {
    isReady: boolean;
    requiresAdvancement: boolean;
    alreadyAdvanced: boolean;
    advancingRacers: AdvancementRacer[];
    source: string | null;
    numRacers: number | null;
}


interface RaceExecutionProps {
    activeExecutionHeat: Heat | null;
    nextExecutionHeat: Heat | null;
    upcomingHeats: Heat[];
    activeHeatId: number | null;
    onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
    onNextHeat: () => void;
    getRacerName: (id: number) => string;
    onUpdateResult: (heatId: number, results: any[]) => Promise<void>;
    timerType?: string | null;
    trackId?: number | null;
    racers: Record<number, Racer>;
    roundSummary: AdvancementStatus | null;
    autoAdvanceHeat: boolean;
    onToggleAutoAdvance?: (value: boolean) => void;
}

export const RaceExecution: React.FC<RaceExecutionProps> = ({
    activeExecutionHeat,
    nextExecutionHeat,
    upcomingHeats,
    onRunHeat,
    onNextHeat,
    getRacerName,
    onUpdateResult,
    timerType,
    trackId,
    racers,
    roundSummary,
    autoAdvanceHeat,
    onToggleAutoAdvance,
}) => {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingResults, setEditingResults] = useState<any[]>([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0.0);
    const [isRoundSummaryOpen, setIsRoundSummaryOpen] = useState(!!roundSummary);
    const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null);
    const [showAutoAdvanceTooltip, setShowAutoAdvanceTooltip] = useState(false);
    const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [subResult] = useSubscription({
        query: TIMER_STATUS_SUBSCRIPTION,
        variables: { trackId: trackId ?? 0 },
        pause: !trackId,
    });
    const timerState: string = subResult.data?.timerStatus?.status?.state ?? 'IDLE';
    const pendingResults = subResult.data?.timerStatus?.status?.pendingResults ?? [];

    const [, prepareHeat] = useMutation(PREPARE_HEAT);
    const [, abortHeat] = useMutation(ABORT_HEAT);
    const [, forceResults] = useMutation(FORCE_RESULTS);

    const results = activeExecutionHeat?.laneResults ? JSON.parse(activeExecutionHeat.laneResults) : [];
    const isCompleted = results.length > 0 && results[0].time !== null;
    const isRunning = timerState === 'RUNNING';

    const laneResultMap: Record<number, any> = {};
    if (isCompleted) {
        results.forEach((r: any) => { laneResultMap[r.lane] = r; });
    } else {
        // Show pending results if official results aren't in yet
        pendingResults.forEach((r: any) => {
            laneResultMap[r.lane] = {
                lane: r.lane,
                racer_id: (results.find((cr: any) => cr.lane === r.lane))?.racer_id || null,
                time: r.time,
                place: r.place,
            };
        });
    }

    // Auto-prepare heat when a new heatId is provided
    useEffect(() => {
        if (timerState === 'IDLE' && !isCompleted && activeExecutionHeat?.id) {
            prepareHeat({ heatId: activeExecutionHeat.id });
        }
        // Only run when heatId changes or on mount.
        // Do NOT depend on timerState or isCompleted to avoid re-prepare loops.
    }, [activeExecutionHeat?.id]);

    useEffect(() => {
        setIsRoundSummaryOpen(!!roundSummary);
    }, [roundSummary]);

    useEffect(() => {
        if (!autoAdvanceHeat || !isCompleted || !nextExecutionHeat || (roundSummary && isRoundSummaryOpen)) {
            setAutoAdvanceCountdown(null);
            if (autoAdvanceTimeoutRef.current) {
                clearTimeout(autoAdvanceTimeoutRef.current);
                autoAdvanceTimeoutRef.current = null;
            }
            return;
        }
        setAutoAdvanceCountdown(10);
        const interval = setInterval(() => {
            setAutoAdvanceCountdown(prev => {
                if (prev === null || prev <= 1) {
                    clearInterval(interval);
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
            onNextHeat();
        }, 10000);
        return () => {
            clearInterval(interval);
            if (autoAdvanceTimeoutRef.current) {
                clearTimeout(autoAdvanceTimeoutRef.current);
                autoAdvanceTimeoutRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCompleted, autoAdvanceHeat, nextExecutionHeat?.id, roundSummary, isRoundSummaryOpen]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRunning) {
            const startTime = Date.now();
            setElapsedSeconds(0);
            interval = setInterval(() => {
                const now = Date.now();
                setElapsedSeconds((now - startTime) / 1000);
            }, 100);
        } else {
            setElapsedSeconds(0);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isRunning]);

    if (!activeExecutionHeat) {
        return (
            <div style={{ textAlign: 'center', padding: '50px' }}>
                <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" style={{ marginBottom: '20px' }} />
                <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Race Execution</h2>
                <p style={{ fontSize: '1.2rem', color: '#666' }}>
                    {upcomingHeats.length > 0 ? "Select a heat to begin." : "All heats have been run."}
                </p>
            </div>
        );
    }

    const handleEditOpen = () => {
        setEditingResults(JSON.parse(JSON.stringify(results))); // Deep copy
        setIsEditModalOpen(true);
    };

    const handleResultChange = (index: number, field: 'time' | 'place', value: string) => {
        const newResults = [...editingResults];
        newResults[index][field] = value;
        setEditingResults(newResults);
    };

    const handleSaveResults = async () => {
        await onUpdateResult(activeExecutionHeat.id, editingResults);
        setIsEditModalOpen(false);
    };

    const handleSkipHeat = async () => {
        if (window.confirm("Are you sure you want to skip this heat? No results will be recorded.")) {
            const skippedResults = results.map((r: any) => ({
                ...r,
                time: null,
                place: null
            }));
            await onUpdateResult(activeExecutionHeat.id, skippedResults);
            if (trackId) await abortHeat({ trackId });
            onNextHeat();
        }
    };

    const showFakeControls = timerType === 'FAKE';
    const showProxyControls = timerType === 'AUTO_DETECT_PROXY';

    return (
        <>
            <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>

                {/* LEFT COLUMN: Active Heat */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Active Heat Card */}
                    <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--cub-scouting-gold)' }}>
                        {showProxyControls && trackId != null && (
                            <SerialProxyConnector trackId={trackId} />
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.heatNumber}</h2>
                                    {trackId != null && <TimerStatusBadge trackId={trackId} />}
                                </div>
                                <div style={{ color: '#666', fontSize: '1.1rem' }}>
                                    {activeExecutionHeat.roundName || `Round ${activeExecutionHeat.roundNumber}`}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                {isCompleted && nextExecutionHeat && (!roundSummary || !isRoundSummaryOpen) ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <button
                                            className="primary-btn"
                                            onClick={() => {
                                                if (autoAdvanceTimeoutRef.current) {
                                                    clearTimeout(autoAdvanceTimeoutRef.current);
                                                    autoAdvanceTimeoutRef.current = null;
                                                }
                                                setAutoAdvanceCountdown(null);
                                                onNextHeat();
                                            }}
                                            style={{
                                                padding: '6px 16px',
                                                fontSize: '0.95rem',
                                                background: '#2e7d32',
                                                color: 'white',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                borderRadius: '6px',
                                                height: '36px'
                                            }}
                                        >
                                            Next Heat{autoAdvanceCountdown !== null ? ` (${autoAdvanceCountdown}s)` : ''} <Icon path={mdiArrowRight} size={0.8} />
                                        </button>
                                        {autoAdvanceCountdown !== null && (
                                            <button
                                                onClick={() => {
                                                    if (autoAdvanceTimeoutRef.current) {
                                                        clearTimeout(autoAdvanceTimeoutRef.current);
                                                        autoAdvanceTimeoutRef.current = null;
                                                    }
                                                    setAutoAdvanceCountdown(null);
                                                }}
                                                style={{
                                                    padding: '6px 14px',
                                                    fontSize: '0.9rem',
                                                    background: 'transparent',
                                                    color: '#c62828',
                                                    border: '1px solid #c62828',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontWeight: 'bold',
                                                    height: '36px'
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                ) : isRunning ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                                        <div style={{
                                            padding: '8px 20px',
                                            fontSize: '1.15rem',
                                            background: 'orange',
                                            color: 'white',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}>
                                            <span className="pulse-dot" style={{ width: '12px', height: '12px', background: 'white', borderRadius: '50%' }} />
                                            Racing... {elapsedSeconds.toFixed(1)}s
                                        </div>
                                        <style>{`
                                        .pulse-dot { animation: pulse 1s infinite; }
                                        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
                                    `}</style>
                                    </div>
                                ) : timerState === 'RESULTS_OVERDUE' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                                        <div style={{
                                            padding: '8px 20px',
                                            fontSize: '1.1rem',
                                            background: '#d32f2f',
                                            color: 'white',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <Icon path={mdiAlertCircleOutline} size={0.8} color="white" /> Results Overdue
                                        </div>
                                    </div>
                                ) : timerState === 'IDLE' && trackId != null && !isCompleted ? (
                                    <div style={{ padding: '8px 20px', color: '#666', fontStyle: 'italic', background: '#f5f5f5', borderRadius: '4px', border: '1px solid #ddd' }}>
                                        Waiting for Timer...
                                    </div>
                                ) : !isCompleted ? (
                                    <div style={{
                                        padding: '8px 20px',
                                        fontSize: '1.15rem',
                                        background: '#f5f5f5',
                                        color: '#666',
                                        borderRadius: '4px',
                                        fontWeight: 'bold',
                                        border: '1px solid #ddd'
                                    }}>
                                        Waiting for Timer...
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gap: '15px' }}>
                            {results.map((r: any) => {
                                const racer = racers[r.racer_id];
                                // Use mapped results for real-time updates
                                const m = laneResultMap[r.lane] || r;
                                return (
                                    <div key={r.lane} style={{ display: 'flex', alignItems: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '8px', borderLeft: '5px solid #ddd' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {r.lane}</div>

                                        <div style={{
                                            flex: 1,
                                            padding: '10px 15px',
                                            background: m.place === 1 ? 'rgba(252, 209, 22, 0.1)' : 'transparent',
                                            border: m.place === 1 ? '1px solid var(--cub-scouting-gold)' : '1px solid transparent',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}>
                                            <div style={{ width: '60px', height: '60px', borderRadius: '50%', overflow: 'hidden', marginRight: '15px', background: 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                                <RacerAvatar
                                                    racer={{
                                                        id: racer?.id || r.racer_id,
                                                        first_name: racer?.firstName || '',
                                                        last_name: racer?.lastName || '',
                                                        racer_image_url: racer?.racerImageUrl
                                                    }}
                                                    size="60px"
                                                />
                                            </div>

                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{getRacerName(r.racer_id)}</div>
                                                {racer && <div style={{ fontSize: '0.9rem', color: '#666' }}>{racer.carNumber ? `#${racer.carNumber}` : ''}</div>}
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                                <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                                    {m.time ? `${Number(m.time).toFixed(4)}s` : '--'}
                                                </div>
                                                {m.place !== null && (
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        width: '60px',
                                                        padding: '5px',
                                                        borderRadius: '8px',
                                                        background: m.place === 1 ? 'var(--cub-scouting-gold)' :
                                                            m.place === 2 ? '#e0e0e0' :
                                                                m.place === 3 ? '#d7a48d' : 'transparent',
                                                        color: m.place === 1 ? 'var(--scouting-blue)' : 'inherit',
                                                        boxShadow: m.place <= 3 ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                                                    }}>
                                                        {m.place <= 3 ? (
                                                            <Icon
                                                                path={mdiTrophy}
                                                                size={1}
                                                                color={m.place === 1 ? 'var(--scouting-blue)' :
                                                                    m.place === 2 ? '#757575' : '#8d6e63'}
                                                            />
                                                        ) : (
                                                            <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{m.place}th</span>
                                                        )}
                                                        {m.place <= 3 && <span style={{ fontSize: '0.7rem', fontWeight: 'bold', lineHeight: 1 }}>
                                                            {m.place === 1 ? '1st' : m.place === 2 ? '2nd' : '3rd'}
                                                        </span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #eee' }}>
                            {/* BOTTOM LEFT: Controls */}
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                {isCompleted ? (
                                    <>
                                        <button
                                            onClick={handleEditOpen}
                                            style={{
                                                padding: '6px 14px',
                                                fontSize: '0.9rem',
                                                background: '#f0f0f0',
                                                color: 'black',
                                                border: '1px solid #ccc',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontWeight: 'bold',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                height: '36px'
                                            }}
                                        >
                                            <Icon path={mdiPencil} size={0.7} /> Edit
                                        </button>
                                        <button
                                            onClick={() => onRunHeat(activeExecutionHeat, false)}
                                            style={{
                                                padding: '6px 14px',
                                                fontSize: '0.9rem',
                                                background: 'var(--cub-scouting-gold)',
                                                color: 'black',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontWeight: 'bold',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                height: '36px'
                                            }}
                                        >
                                            <Icon path={mdiRefresh} size={0.7} /> Re-Run
                                        </button>
                                    </>
                                ) : isRunning ? (
                                    <>
                                        <button
                                            onClick={handleEditOpen}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiAlertCircleOutline} size={0.7} /> Force Results
                                        </button>
                                        <button
                                            onClick={handleSkipHeat}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiCloseOctagon} size={0.7} /> Skip Heat
                                        </button>
                                    </>
                                ) : timerState === 'RESULTS_OVERDUE' ? (
                                    <>
                                        {timerType !== 'FAKE' && trackId != null && (
                                            <button
                                                onClick={() => forceResults({ trackId })}
                                                className="secondary-btn"
                                                style={{ padding: '6px 14px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                            >
                                                <Icon path={mdiAlertCircleOutline} size={0.7} /> Force Results
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSkipHeat}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiCloseOctagon} size={0.7} /> Skip Heat
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={handleEditOpen}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiPencil} size={0.7} /> Override
                                        </button>
                                        <button
                                            onClick={handleSkipHeat}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiCloseOctagon} size={0.7} /> Skip Heat
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* BOTTOM RIGHT: Auto-advance */}
                            {onToggleAutoAdvance && (
                                <div
                                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px' }}
                                    onMouseEnter={() => setShowAutoAdvanceTooltip(true)}
                                    onMouseLeave={() => setShowAutoAdvanceTooltip(false)}
                                >
                                    {showAutoAdvanceTooltip && (
                                        <div style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            right: 0,
                                            marginBottom: '8px',
                                            background: '#333',
                                            color: 'white',
                                            fontSize: '0.8rem',
                                            padding: '6px 10px',
                                            borderRadius: '6px',
                                            whiteSpace: 'nowrap',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                                            pointerEvents: 'none',
                                            zIndex: 10,
                                        }}>
                                            Automatically advances to the next heat 10 seconds after results are recorded.
                                        </div>
                                    )}
                                    <span style={{ fontSize: '0.9rem', color: '#555', userSelect: 'none' }}>Auto-advance</span>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={autoAdvanceHeat}
                                            onChange={(e) => onToggleAutoAdvance(e.target.checked)}
                                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                                        />
                                        <div style={{
                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                            background: autoAdvanceHeat ? 'var(--scouting-blue)' : '#ccc',
                                            borderRadius: '24px',
                                            transition: 'background 0.2s',
                                        }} />
                                        <div style={{
                                            position: 'absolute',
                                            height: '18px', width: '18px',
                                            left: autoAdvanceHeat ? '23px' : '3px',
                                            bottom: '3px',
                                            background: 'white',
                                            borderRadius: '50%',
                                            transition: 'left 0.2s',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                        }} />
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Upcoming Heats */}
                <div>
                    <h3 style={{ marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Icon path={mdiChevronRight} size={1} /> Upcoming
                    </h3>
                    <div style={{ background: 'white', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                        {upcomingHeats.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                                No more upcoming heats.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {upcomingHeats.map(h => (
                                    <div key={h.id} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #eee', background: '#fafafa' }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Heat {h.heatNumber}</span>
                                            <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'normal' }}>Round {h.roundNumber}</span>
                                        </div>
                                        <div style={{ fontSize: '0.85rem' }}>
                                            {(h.laneResults ? JSON.parse(h.laneResults) : []).map((r: any) => (
                                                <div key={r.lane} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                                    <span style={{ color: '#666' }}>L{r.lane}:</span>
                                                    <span style={{ fontWeight: '500' }}>{getRacerName(r.racer_id)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Round Summary Modal */}
            <Modal
                isOpen={!!roundSummary && isRoundSummaryOpen}
                onClose={() => setIsRoundSummaryOpen(false)}
                title="Round Complete!"
            >
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" />
                    <p style={{ fontSize: '1.2rem', color: '#666', marginTop: '10px' }}>
                        {roundSummary?.requiresAdvancement
                            ? `Top ${roundSummary.numRacers} racers advance to the next round.`
                            : "This round is complete."
                        }
                    </p>
                    {roundSummary?.source && (
                        <div style={{ fontSize: '0.9rem', color: '#888', fontStyle: 'italic' }}>
                            Advancement Source: {roundSummary.source}
                        </div>
                    )}
                </div>

                {roundSummary && (
                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px', marginBottom: '20px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                                <tr>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Rank</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Racer</th>
                                    <th style={{ padding: '10px', textAlign: 'right' }}>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roundSummary.advancingRacers.map((ar, idx) => (
                                    <tr key={ar.racerId} style={{ borderBottom: '1px solid #eee', background: ar.isAdvancing ? '#fff8e1' : 'white' }}>
                                        <td style={{ padding: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                {idx < 3 && <Icon path={mdiTrophy} size={0.7} color={idx === 0 ? 'gold' : idx === 1 ? 'silver' : '#cd7f32'} />}
                                                {idx + 1}
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                            <div style={{ fontWeight: 'bold' }}>{ar.firstName} {ar.lastName}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#666' }}>{ar.denName} #{ar.carNumber}</div>
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
                                            {ar.score.toFixed(3)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
                    <button
                        className="primary-btn"
                        onClick={onNextHeat}
                        style={{
                            padding: '10px 24px',
                            fontSize: '1.1rem',
                            background: '#2e7d32',
                            color: 'white',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
                        }}
                    >
                        Start Next Round <Icon path={mdiArrowRight} size={1} />
                    </button>
                </div>
            </Modal>

            {/* Edit Results Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Edit Results - Heat ${activeExecutionHeat.heatNumber}`}
            >
                <div className="form-group">
                    <p className="form-help">Manually update times for this heat.</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '8px' }}>Lane</th>
                                <th style={{ textAlign: 'left', padding: '8px' }}>Racer</th>
                                <th style={{ textAlign: 'left', padding: '8px' }}>Time (s)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editingResults.map((r: any, idx: number) => (
                                <tr key={r.lane} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '8px' }}>{r.lane}</td>
                                    <td style={{ padding: '8px' }}>{getRacerName(r.racer_id)}</td>
                                    <td style={{ padding: '8px' }}>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            value={r.time || ''}
                                            onChange={(e) => handleResultChange(idx, 'time', e.target.value)}
                                            className="form-control"
                                            style={{ width: '100px' }}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="form-actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button className="secondary-btn" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
                        <button className="primary-btn" onClick={handleSaveResults}>Save Results</button>
                    </div>
                </div>
            </Modal>

            {/* Fake Timer Mole */}
            <FakeTimerMole
                isOpen={showFakeControls}
                heatId={activeExecutionHeat.id}
                trackId={trackId ?? 0}
            />
        </>
    );
};
