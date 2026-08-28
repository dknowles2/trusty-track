import React, { useState, useEffect, useRef } from 'react';
import { useSubscription, useMutation } from 'urql';
import Modal from '../../../components/ui/Modal';
import { FakeTimerMole } from './FakeTimerMole';
import { HardwareTimerMole } from './HardwareTimerMole';
import { TimerStatusBadge } from './TimerStatusBadge';
import { SerialProxyConnector } from './SerialProxyConnector';
import { HEAT_SESSION_SUBSCRIPTION, PREPARE_HEAT, ABORT_HEAT, FORCE_RESULTS } from '../graphql/queries';
import { heatsEstimate } from '../../../utils/duration';
import RacerAvatar from '../../management/components/RacerAvatar';
import { Icon } from '@mdi/react';
import { mdiTrophy, mdiPencil, mdiRefresh, mdiArrowRight, mdiChevronDoubleRight, mdiCloseOctagon, mdiAlertCircleOutline, mdiCalendarRange, mdiPlay } from '@mdi/js';

// These types are derived from the generated GraphQL operation types in
// ../types. They are re-exported here because several components already
// import them from this module.
export type {
    Heat,
    Racer,
    AdvancementRacer,
    AdvancementStatus,
    LaneInput,
} from '../types';
import type { Heat, Racer, AdvancementStatus, LaneInput, Lane, LiveLane } from '../types';
import type { HeatPhase } from '../../../gql/operations';
import { hasRun, hasTimes, toInput } from '../lanes';
import { chimeEnabled, playChime, setChimeEnabled, shouldChime } from '../chime';
import { isTypingTarget, shortcutFor, SHORTCUT_HINTS } from '../shortcuts';
import { useRaceFlow } from '../useRaceFlow';

/**
 * A lane being edited by hand. `time` is held as text while the operator types
 * — "3." is not a number yet, and coercing on every keystroke would fight them
 * for the cursor. It becomes a number on save.
 */
type EditableLane = LaneInput & { timeText: string };

/** How a keyboard hint looks on the button it mirrors (#207). */
const KBD_STYLE: React.CSSProperties = {
    marginLeft: '2px',
    padding: '1px 5px',
    fontSize: '0.7rem',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    border: '1px solid currentColor',
    borderRadius: '4px',
    opacity: 0.65,
};

interface RaceExecutionProps {
    activeExecutionHeat: Heat | null;
    nextExecutionHeat: Heat | null;
    activeHeatId: number | null;
    onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
    onNextHeat: () => void;
    getRacerName: (id: number, fromBottom?: boolean) => string;
    /** Rounds whose field is the slowest cars — their undecided slots read
     * "Slowest N" rather than "Top N". */
    slowestRoundIds?: Set<number>;
    onUpdateResult: (heatId: number, lanes: LaneInput[]) => Promise<void>;
    timerType?: string | null;
    trackId?: number | null;
    racers: Record<number, Racer>;
    roundSummary: AdvancementStatus | null;
    autoAdvanceHeat: boolean;
    onToggleAutoAdvance?: (value: boolean) => void;
    remainingHeatsInRound?: number;
    totalHeatsInRound?: number;
    upcomingRounds?: { roundNumber: number, roundName: string | null, totalHeats: number }[];
    debugMode?: boolean;
}

export const RaceExecution: React.FC<RaceExecutionProps> = ({
    activeExecutionHeat,
    nextExecutionHeat,
    onRunHeat,
    onNextHeat,
    getRacerName,
    slowestRoundIds,
    onUpdateResult,
    timerType,
    trackId,
    racers,
    roundSummary,
    autoAdvanceHeat,
    onToggleAutoAdvance,
    remainingHeatsInRound,
    totalHeatsInRound,
    upcomingRounds,
    debugMode,
}) => {
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingResults, setEditingResults] = useState<EditableLane[]>([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0.0);
    const [showAutoAdvanceTooltip, setShowAutoAdvanceTooltip] = useState(false);

    // The live view, assembled by the server (#7). What used to be here was a
    // merge of the heat's stored lanes with `timerStatus.pendingResults`,
    // recomputed on every render.
    const [subResult] = useSubscription({
        query: HEAT_SESSION_SUBSCRIPTION,
        variables: { trackId: trackId ?? 0, heatId: activeExecutionHeat?.id ?? null },
        pause: !trackId,
    });
    const session = subResult.data?.heatSession;

    const [, prepareHeat] = useMutation(PREPARE_HEAT);
    const [, abortHeat] = useMutation(ABORT_HEAT);
    const [, forceResults] = useMutation(FORCE_RESULTS);

    // What is saved. Editing and skipping write against this, not against the
    // live view — an operator overriding a result is changing the record.
    const storedLanes = activeExecutionHeat?.lanes ?? [];

    // What to show. Identical to the stored lanes until the timer reports
    // something, which is why falling back to them costs nothing on the first
    // render before the subscription answers.
    const liveLanes: LiveLane[] = session?.lanes ?? storedLanes.map((l) => ({ ...l, pending: false }));

    const timerState: string = session?.timerState ?? 'IDLE';

    // One phase, three questions. The server's answer wins; the fallback is the
    // same rule `domain/heat_session.phase` applies, in the same order, for the
    // first render before the subscription answers. It cannot produce RUNNING,
    // which is correct — that needs the timer, and without a session there is
    // no timer to ask.
    const phase: HeatPhase = session?.phase ?? (
        !activeExecutionHeat ? 'NO_HEAT'
        : storedLanes.some((l) => l.placeholderSlot !== null) ? 'NOT_READY'
        : hasRun(storedLanes) ? 'RECORDED'
        : 'WAITING'
    );
    const isCompleted = phase === 'RECORDED';
    const hasPlaceholders = phase === 'NOT_READY';
    // From the phase, not the device. A recorded heat whose timer has not caught
    // up used to show "Racing..." over its own saved results — the phase settles
    // that (RECORDED outranks RUNNING) and the screen no longer has to.
    const isRunning = phase === 'RUNNING';

    const hasRecordedTimes = hasTimes(storedLanes);
    const isSkipped = storedLanes.some((l) => l.skipped);

    // The race-day flow (#13). What used to be six mutually-guarding effects
    // with two refs, a mirror state and an `eslint-disable` is now one machine
    // in `raceFlow.ts`, tested without rendering. This component supplies what
    // it can see and performs what comes back.
    const flow = useRaceFlow(
        {
            heatId: activeExecutionHeat?.id ?? null,
            phase,
            timerState,
            hasRecordedTimes,
            hasNextHeat: !!nextExecutionHeat,
            autoAdvanceEnabled: autoAdvanceHeat,
            hasRoundSummary: !!roundSummary,
            roundSummaryId: roundSummary?.roundId ?? null,
        },
        {
            onPrepareHeat: (heatId) => { prepareHeat({ heatId }); },
            onAdvance: onNextHeat,
        },
    );
    const autoAdvanceCountdown = flow.countdown;

    // The finish chime (#208). The edge, not the state: RECORDED persists for
    // as long as the operator leaves the heat on screen, and a payload arrives
    // for every lane time and every check-in.
    const [chimeOn, setChimeOn] = useState(() => chimeEnabled(window.localStorage));
    const previousPhase = useRef<HeatPhase | null>(null);
    useEffect(() => {
        if (chimeOn && shouldChime(previousPhase.current, phase)) playChime();
        previousPhase.current = phase;
    }, [phase, chimeOn]);


    const isRoundSummaryOpen = flow.screen.kind === 'ROUND_SUMMARY';

    const handleEditOpen = () => {
        setEditingResults(storedLanes.map((l) => ({
            ...toInput(l),
            timeText: l.time === null ? '' : String(l.time),
        })));
        setIsEditModalOpen(true);
    };

    // Keys the operator can reach without the mouse (#207). The rules are in
    // `shortcuts.ts`; this is the wiring and nothing else.
    //
    // Up here with the other hooks rather than beside the buttons it drives:
    // there are two early returns below — no heat, and a round whose field is
    // undecided — and a hook after them does not run on every render.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const action = shortcutFor(
                event.key,
                { ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey },
                {
                    phase,
                    hasNextHeat: !!nextExecutionHeat,
                    countingDown: flow.countdown !== null,
                    modalOpen: isEditModalOpen || isRoundSummaryOpen,
                    typing: isTypingTarget(event.target),
                },
            );
            if (!action) return;
            // Only once we have decided to act: Space scrolls a page and
            // Escape closes things, and taking either away from a keystroke we
            // are going to ignore would be worse than having no shortcut.
            event.preventDefault();
            if (action === 'ADVANCE') {
                flow.cancelCountdown();
                onNextHeat();
            } else if (action === 'EDIT') {
                handleEditOpen();
            } else {
                flow.cancelCountdown();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });


    useEffect(() => {
        if (!isRunning) return;
        const startTime = Date.now();
        const interval = setInterval(() => {
            setElapsedSeconds((Date.now() - startTime) / 1000);
        }, 100);
        // Resetting on the way out replaces a second effect that mirrored
        // `isRunning` into `prevIsRunning` purely to notice the same edge.
        return () => {
            clearInterval(interval);
            setElapsedSeconds(0);
        };
    }, [isRunning]);

    if (!activeExecutionHeat) {
        return (
            <div style={{ textAlign: 'center', padding: '50px' }}>
                <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" style={{ marginBottom: '20px' }} />
                <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Race Execution</h2>
                <p style={{ fontSize: '1.2rem', color: '#666' }}>
                    {nextExecutionHeat ? "Select a heat to begin." : "All heats have been run."}
                </p>
            </div>
        );
    }

    if (hasPlaceholders) {
        return (
            <div style={{ textAlign: 'center', padding: '100px 50px' }}>
                <Icon path={mdiCalendarRange} size={4} color="#ccc" style={{ marginBottom: '20px' }} />
                <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Round Not Ready</h2>
                <p style={{ fontSize: '1.2rem', color: '#666', maxWidth: '600px', margin: '0 auto' }}>
                    The racers for <strong>{activeExecutionHeat.roundName || `Round ${activeExecutionHeat.roundNumber}`}</strong> haven't been determined yet.
                </p>
                <p style={{ color: '#888', marginTop: '10px' }}>
                    Please complete the previous rounds to advance racers into this round.
                </p>
            </div>
        );
    }

    const handleResultChange = (index: number, field: 'time' | 'place', value: string) => {
        const newResults = [...editingResults];
        if (field === 'time') newResults[index].timeText = value;
        else if (field === 'place') newResults[index].place = parseInt(value) || null;
        setEditingResults(newResults);
    };


    const handleSaveResults = async () => {
        const edited = editingResults.map(({ timeText, ...rest }) => {
            const time = Number(timeText);
            return { ...rest, time: timeText.trim() === '' || isNaN(time) ? null : time };
        });
        await onUpdateResult(activeExecutionHeat.id, edited);
        setIsEditModalOpen(false);
    };

    const handleSkipHeat = async () => {
        if (window.confirm("Are you sure you want to skip this heat? No results will be recorded.")) {
            // A skip advances through the handler below rather than waiting out
            // the countdown, so call the countdown off first.
            flow.cancelCountdown();

            const currentHeatId = activeExecutionHeat.id;
            const skippedResults = storedLanes.map((l) => ({
                ...toInput(l),
                time: null,
                place: null,
                skipped: true
            }));

            // Move UI forward IMMEDIATELY to prevent "flash back" race conditions
            onNextHeat();

            await onUpdateResult(currentHeatId, skippedResults);
            if (trackId) await abortHeat({ trackId });
        }
    };

    const showFakeControls = timerType === 'FAKE';
    const showProxyControls = timerType === 'AUTO_DETECT_PROXY';
    const showHardwareMole = timerType != null && timerType !== 'FAKE' && debugMode;

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
                                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.globalHeatNumber ?? activeExecutionHeat.heatNumber}</h2>
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
                                                flow.cancelCountdown();
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
                                            <kbd style={KBD_STYLE}>{SHORTCUT_HINTS.ADVANCE}</kbd>
                                        </button>
                                        {autoAdvanceCountdown !== null && (
                                            <button
                                                onClick={flow.cancelCountdown}
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
                                                <kbd style={KBD_STYLE}>{SHORTCUT_HINTS.CANCEL_COUNTDOWN}</kbd>
                                            </button>
                                        )}
                                    </div>
                                ) : isRunning ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                                        <div style={{
                                            padding: '8px 20px',
                                            fontSize: '1.15rem',
                                            background: timerState === 'RESULTS_OVERDUE' ? '#d32f2f' : 'orange',
                                            color: 'white',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}>
                                            <span className="pulse-dot" style={{ width: '12px', height: '12px', background: 'white', borderRadius: '50%' }} />
                                            {timerState === 'RESULTS_OVERDUE' ? 'Overdue' : 'Racing'}... {elapsedSeconds.toFixed(1)}s
                                        </div>
                                        <style>{`
                                        .pulse-dot { animation: pulse 1s infinite; }
                                        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
                                    `}</style>
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
                            {liveLanes.map((r) => {
                                const racer = racers[r.racerId || 0];
                                return (
                                    <div key={r.lane} style={{ display: 'flex', alignItems: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '8px', borderLeft: '5px solid #ddd' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {r.lane}</div>

                                        <div style={{
                                            flex: 1,
                                            padding: '10px 15px',
                                            background: r.place === 1 ? 'rgba(252, 209, 22, 0.1)' : 'transparent',
                                            border: r.place === 1 ? '1px solid var(--cub-scouting-gold)' : '1px solid transparent',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}>
                                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', marginRight: '15px', background: 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                                <RacerAvatar
                                                    racer={{
                                                        id: racer?.id || r.racerId || 0,
                                                        first_name: racer?.firstName || '',
                                                        last_name: racer?.lastName || '',
                                                        racer_image_url: racer?.racerImageUrl
                                                    }}
                                                    size="80px"
                                                />
                                            </div>

                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                                                    {racer ? `${racer.firstName} ${racer.lastName}` : getRacerName(r.racerId ?? (r.placeholderSlot !== null ? -r.placeholderSlot : 0), slowestRoundIds?.has(activeExecutionHeat.roundId))}
                                                </div>
                                                {racer && <div style={{ fontSize: '1rem', color: '#666' }}>{racer.carNumber ? `#${racer.carNumber}` : ''}</div>}
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                                <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                                    {r.time ? `${Number(r.time).toFixed(4)}s` : '--'}
                                                </div>
                                                {r.place !== null && (
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        width: '60px',
                                                        padding: '5px',
                                                        borderRadius: '8px',
                                                        background: r.place === 1 ? 'var(--cub-scouting-gold)' :
                                                            r.place === 2 ? '#e0e0e0' :
                                                                r.place === 3 ? '#d7a48d' : 'transparent',
                                                        color: r.place === 1 ? 'var(--scouting-blue)' : 'inherit',
                                                        boxShadow: r.place <= 3 ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                                                    }}>
                                                        {r.place <= 3 ? (
                                                            <Icon
                                                                path={mdiTrophy}
                                                                size={1}
                                                                color={r.place === 1 ? 'var(--scouting-blue)' :
                                                                    r.place === 2 ? '#757575' : '#8d6e63'}
                                                            />
                                                        ) : (
                                                            <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{r.place}th</span>
                                                        )}
                                                        {r.place <= 3 && <span style={{ fontSize: '0.7rem', fontWeight: 'bold', lineHeight: 1 }}>
                                                            {r.place === 1 ? '1st' : r.place === 2 ? '2nd' : '3rd'}
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
                                            <kbd style={KBD_STYLE}>{SHORTCUT_HINTS.EDIT}</kbd>
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
                                            <Icon path={isSkipped && !hasRecordedTimes ? mdiPlay : mdiRefresh} size={0.7} /> {isSkipped && !hasRecordedTimes ? 'Run' : 'Re-Run'}
                                        </button>
                                    </>
                                ) : isRunning ? (
                                    <>
                                        <button
                                            onClick={() => prepareHeat({ heatId: activeExecutionHeat.id })}
                                            className="secondary-btn"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: '#f5f5f5', color: 'black', border: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiRefresh} size={0.7} /> Reset Heat
                                        </button>
                                        {trackId != null && (
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
                                            <kbd style={KBD_STYLE}>{SHORTCUT_HINTS.EDIT}</kbd>
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

                            {/* BOTTOM RIGHT: sound, then auto-advance */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                            {/* The finish chime (#208). Off until somebody asks
                                for it, and remembered per device — the
                                operator's laptop wants it, a wall display does
                                not. */}
                            <label
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: '#555', cursor: 'pointer', userSelect: 'none' }}
                                title="Play a short sound when a heat's results are recorded."
                            >
                                <input
                                    type="checkbox"
                                    data-testid="finish-chime-toggle"
                                    checked={chimeOn}
                                    onChange={(e) => {
                                        setChimeEnabled(window.localStorage, e.target.checked);
                                        setChimeOn(e.target.checked);
                                        // Played on the way on, never on the way
                                        // off: it is the only way to find out
                                        // whether the machine's sound is muted
                                        // without waiting for a heat to finish.
                                        if (e.target.checked) playChime();
                                    }}
                                />
                                Finish sound
                            </label>
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
                                            data-testid="auto-advance-toggle"
                                            aria-label="Auto-advance"
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
                </div>

                {/* RIGHT COLUMN: On Deck */}
                <div>
                    <h3 style={{ marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px', color: '#444' }}>
                        <Icon path={mdiChevronDoubleRight} size={1} /> On Deck
                    </h3>
                    <div style={{ background: 'white', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                        {!nextExecutionHeat || nextExecutionHeat.roundId !== activeExecutionHeat.roundId ? (
                            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#555' }}>
                                <Icon path={mdiTrophy} size={2} color="var(--cub-scouting-gold)" style={{ marginBottom: '10px' }} />
                                <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>End of Round</div>
                                <div style={{ fontSize: '0.9rem', color: '#888', marginTop: '5px' }}>
                                    {nextExecutionHeat
                                        ? `Next: ${nextExecutionHeat.roundName || `Round ${nextExecutionHeat.roundNumber}`}`
                                        : "Race Complete!"}
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <span style={{ fontSize: '1.1rem' }}>Heat {nextExecutionHeat.globalHeatNumber ?? nextExecutionHeat.heatNumber}</span>
                                    <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'normal' }}>{nextExecutionHeat.roundName || `Round ${nextExecutionHeat.roundNumber}`}</span>
                                </div>
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    {nextExecutionHeat.lanes.map((r: Lane) => {
                                        const racer = racers[r.racerId || 0];
                                        return (
                                                                                        <div key={r.lane} style={{ display: 'flex', alignItems: 'center', gap: '15px', paddingBottom: '12px', borderBottom: '1px solid #f5f5f5' }}>
                                                                                            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#999', width: '30px' }}>L{r.lane}</div>

                                                                                            <div style={{ width: '60px', height: '60px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                                {racer?.carImageUrl ? (
                                                                                                    <img
                                                                                                        src={racer.carImageUrl}
                                                                                                        alt={`Car #${racer.carNumber}`}
                                                                                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', border: '1px solid #eee' }}
                                                                                                    />
                                                                                                ) : (
                                                                                                    <div style={{
                                                                                                        width: '100%',
                                                                                                        height: '100%',
                                                                                                        background: 'var(--cub-scouting-gold)',
                                                                                                        color: 'var(--scouting-blue)',
                                                                                                        borderRadius: '50%',
                                                                                                        display: 'flex',
                                                                                                        flexDirection: 'column',
                                                                                                        alignItems: 'center',
                                                                                                        justifyContent: 'center',
                                                                                                        fontWeight: 'bold',
                                                                                                        border: '1px solid #d4af37',
                                                                                                        boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)'
                                                                                                    }}>
                                                                                                        <div style={{ fontSize: '0.6rem', opacity: 0.8, textTransform: 'uppercase', lineHeight: 1 }}>Car</div>
                                                                                                        <div style={{ fontSize: '1.25rem', lineHeight: 1 }}>{racer?.carNumber ?? '-'}</div>
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>

                                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                                <div style={{ fontWeight: '600', fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                                                    {racer ? `${racer.firstName} ${racer.lastName}` : getRacerName(r.racerId ?? (r.placeholderSlot !== null ? -r.placeholderSlot : 0), slowestRoundIds?.has(nextExecutionHeat?.roundId ?? -1))}
                                                                                                </div>
                                                                                                {racer?.carNumber && (
                                                                                                    <div style={{ fontSize: '0.85rem', color: '#888' }}>Car #{racer.carNumber}</div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>

                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    {totalHeatsInRound !== undefined && remainingHeatsInRound !== undefined && (
                        <div style={{ marginTop: '15px', padding: '10px 15px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.85rem', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Round Progress</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#495057' }}>
                                {totalHeatsInRound - remainingHeatsInRound} of {totalHeatsInRound} Heats Completed
                            </div>
                            <div style={{ fontSize: '0.9rem', color: '#2e7d32', fontWeight: 600 }}>
                                {remainingHeatsInRound} {remainingHeatsInRound === 1 ? 'Heat' : 'Heats'} Remaining
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                                Estimated time remaining: {heatsEstimate(remainingHeatsInRound)}
                            </div>
                        </div>
                    )}
                    {upcomingRounds && upcomingRounds.length > 0 && (
                        <div style={{ marginTop: '20px' }}>
                            <h3 style={{ fontSize: '1rem', color: '#444', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Icon path={mdiCalendarRange} size={0.8} /> Upcoming Rounds
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {upcomingRounds.map((round) => (
                                    <div key={round.roundNumber} style={{ background: 'white', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderLeft: '4px solid #ddd' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '4px' }}>
                                            {round.roundName || `Round ${round.roundNumber}`}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                            {round.totalHeats} {round.totalHeats === 1 ? 'Heat' : 'Heats'} Scheduled
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Round Summary Modal */}
            <Modal
                isOpen={!!roundSummary && isRoundSummaryOpen}
                onClose={flow.dismissSummary}
                title="Round Complete!"
            >
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" />
                    <p style={{ fontSize: '1.2rem', color: '#666', marginTop: '10px' }}>
                        {roundSummary?.requiresAdvancement
                            ? roundSummary.fromBottom
                                ? `The ${roundSummary.numRacers} slowest cars race in the next round.`
                                : `Top ${roundSummary.numRacers} racers advance to the next round.`
                            : "This round is complete."
                        }
                    </p>
                    {roundSummary?.source && (
                        <div style={{ fontSize: '0.9rem', color: '#888', fontStyle: 'italic' }}>
                            {/* Human words, not the raw source value — "PACK"
                                on a projector means nothing to the room. */}
                            Advancing from {roundSummary.source === 'PACK'
                                ? 'the whole pack'
                                : roundSummary.source === 'DEN'
                                ? 'each den'
                                : 'an earlier round'}
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
                                {roundSummary.advancingRacers
                                    .filter(ar => !roundSummary.requiresAdvancement || ar.isAdvancing)
                                    .map((ar) => (
                                    <tr key={ar.racerId} style={{ borderBottom: '1px solid #eee', background: ar.isAdvancing ? '#fff8e1' : 'white' }}>
                                        <td style={{ padding: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                {ar.rank <= 3 && <Icon path={mdiTrophy} size={0.7} color={ar.rank === 1 ? 'gold' : ar.rank === 2 ? 'silver' : '#cd7f32'} />}
                                                {ar.rank}
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
                title={`Edit Results - Heat ${activeExecutionHeat.globalHeatNumber ?? activeExecutionHeat.heatNumber}`}
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
                            {editingResults.map((r, idx) => (
                                <tr key={r.lane} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '8px' }}>{r.lane}</td>
                                    <td style={{ padding: '8px' }}>{getRacerName(r.racerId ?? (r.placeholderSlot ? -r.placeholderSlot : 0), slowestRoundIds?.has(activeExecutionHeat.roundId))}</td>
                                    <td style={{ padding: '8px' }}>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            value={r.timeText}
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

            {/* Hardware Timer Mole */}
            {showHardwareMole && trackId != null && (
                <HardwareTimerMole trackId={trackId} timerType={timerType} />
            )}
        </>
    );
};
