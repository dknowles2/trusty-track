import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSubscription, useMutation } from 'urql';
import Modal from '../../../components/ui/Modal';
import { FakeTimerMole } from './FakeTimerMole';
import { HardwareTimerMole } from './HardwareTimerMole';
import { TimerStatusBadge } from './TimerStatusBadge';
import './TimerStatusBadge.css';
import { SerialProxyConnector } from './SerialProxyConnector';
import IntermissionControl from './IntermissionControl';
import { HEAT_SESSION_SUBSCRIPTION, PREPARE_HEAT, ABORT_HEAT, FORCE_RESULTS, START_INTERMISSION_MUTATION } from '../graphql/queries';
import { INTERMISSION_PRESETS } from '../intermission';
import { heatsEstimate } from '../../../utils/duration';
import { ESTIMATED_HEAT_DURATION_MIN } from '../../../utils/constants';
import { estimatedFinishTime, formatClockTime, paceLabel, type PaceEstimate } from '../pace';
import RacerAvatar from '../../management/components/RacerAvatar';
import LaneBadge from '../../../components/ui/LaneBadge';
import { colorForLane } from '../../settings/laneColors';
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
import { formatLaneTime, hasRun, hasTimes, isLaneEmpty, isTimeBasedStrategy, toInput, placeIssue, timeIssue, parseTimeText, tiedTimeGroups } from '../lanes';
import { chimeEnabled, setChimeEnabled, shouldChime } from '../chime';
import {
    playFinishSound,
    playGateReleaseSound,
    playStagingReadySound,
    readSoundSettings,
    shouldFinishSound,
    shouldGateReleaseSound,
    shouldStagingReadySound,
    writeSoundSettings,
    type SoundEffectsSettings,
} from '../../audio/soundEffects';
import SoundSettingsSection from '../../audio/components/SoundSettingsSection';
import { isTypingTarget, shortcutFor, SHORTCUT_HINTS } from '../shortcuts';
import { useRaceFlow } from '../useRaceFlow';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { useTerminology } from '../../../context/TerminologyContext';
import { advancingFromLabel, skippedHeatWarning } from '../roundSummaryText';
import { RACE_LOCKED_MESSAGE } from '../../core/raceLockMessage';

/**
 * A lane being edited by hand. `time` is held as text while the operator types
 * — "3." is not a number yet, and coercing on every keystroke would fight them
 * for the cursor. It becomes a number on save.
 */
type EditableLane = LaneInput & { timeText: string };

/**
 * The name to show for one lane of the current-heat card or the On Deck
 * panel, both of which already look a resolved `racer` up separately for the
 * avatar and the car-number badge. They used to fall back to their own
 * inline `racers[r.racerId || 0]` lookup for the *text* too (issue #1014):
 * `racerId` is `null` for two different lanes — an undecided championship
 * slot and one with nobody coming — and `|| 0` folded both into the same
 * wrong answer, a lookup on racer id 0, which does not exist, so the
 * fallback built a name out of the id itself ("Racer #0").
 *
 * `isLaneEmpty` is the one door for telling those two apart; a placeholder
 * still reads through `getRacerName`'s negative-id convention (`Slowest`/`Top`
 * N), same as the Schedule tab's own `laneRacerName`, and an empty lane reads
 * "Empty" — the word `ScheduleManagement.tsx`'s `getDisplayName` already uses
 * for the same case. The Override/Edit modal's table asks the identical
 * question but wants `getRacerName`'s car-number suffix in the cell text (it
 * renders no separate badge), so it applies `isLaneEmpty` inline instead of
 * going through this helper.
 */
const laneDisplayName = (
    lane: { racerId: number | null; placeholderSlot: number | null },
    racer: Racer | undefined,
    getRacerName: (id: number, fromBottom?: boolean) => string,
    fromBottom?: boolean,
): string => {
    if (racer) return `${racer.firstName} ${racer.lastName}`;
    if (isLaneEmpty(lane)) return 'Empty';
    return getRacerName(lane.racerId ?? -(lane.placeholderSlot ?? 0), fromBottom);
};

/**
 * The pace to show before the parent has learned one (#591) — a caller with
 * no heats recorded yet, or a caller (a test, mostly) that has not been
 * updated to pass one at all.
 */
const BASELINE_PACE: PaceEstimate = {
    minutesPerHeat: ESTIMATED_HEAT_DURATION_MIN,
    sampleCount: 0,
    isLearned: false,
};

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

function heatPhaseDisplay(phase: HeatPhase): { label: string; statusClass: string } {
    switch (phase) {
        case 'RECORDED':
            return { label: 'Recorded', statusClass: 'recorded' };
        case 'RUNNING':
            return { label: 'Racing\u2026', statusClass: 'running' };
        case 'NOT_READY':
            return { label: 'Not Ready', statusClass: 'not-ready' };
        case 'WAITING':
        default:
            return { label: 'Ready', statusClass: 'waiting' };
    }
}

interface RaceExecutionProps {
    /** For the round-summary modal's "Take a break" row (#592) — the only
     * thing here that calls an intermission mutation directly. */
    raceId: number;
    activeExecutionHeat: Heat | null;
    nextExecutionHeat: Heat | null;
    activeHeatId: number | null;
    onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
    onNextHeat: () => void;
    getRacerName: (id: number, fromBottom?: boolean) => string;
    /** Rounds whose field is the slowest cars — their undecided slots read
     * "Slowest N" rather than "Top N". */
    slowestRoundIds?: Set<number>;
    /** Resolves to whether the save landed (#765) — a Skip or an Edit/Override
     * must not act as though a refused save succeeded. */
    onUpdateResult: (heatId: number, lanes: LaneInput[]) => Promise<boolean>;
    /** Which columns the Override/Edit modal shows (#490): times for `TIMED`,
     * places for `POINTS`. */
    scoringStrategy?: string | null;
    timerType?: string | null;
    trackId?: number | null;
    /** This track's configured lane colours (#611), index 0 meaning lane 1.
     * Absent or short means "no colour configured for that lane" — see
     * `colorForLane` — and every lane badge falls back to the plain numbered
     * label every track has always shown. */
    laneColors?: readonly string[];
    racers: Record<number, Racer>;
    roundSummary: AdvancementStatus | null;
    /**
     * The earliest heat in `roundSummary`'s own round that was skipped and
     * never re-run (#1001) — `null` when there isn't one. Skipping a heat is
     * a legitimate way for a round to finish, but the advancement cascade
     * already ran without that heat's real result; this is what lets the
     * Round Complete! modal offer a way back if the cars turn up after all.
     */
    roundSkippedHeat?: Heat | null;
    /**
     * The earliest skipped-and-never-rerun heat anywhere in the race
     * (#1001), for the Race Complete! modal, which has no single round in
     * view.
     */
    raceSkippedHeat?: Heat | null;
    /**
     * Every heat the race will ever run has just run (#847) — sticky and
     * edge-detected upstream by `raceCompletion.ts`, the same shape
     * `roundSummary` already uses one level up. Raises the race summary
     * modal exactly once per genuine completion; see `raceFlow.ts`.
     */
    raceJustCompleted?: boolean;
    /**
     * Which completed schedule `raceJustCompleted` refers to (#916) — the
     * heat-id fingerprint `raceCompletion.ts` computed `raceJustCompleted`
     * from. Passed straight through to `raceFlow.ts`'s `raceSummaryKey`;
     * see that field's own docstring for why a level alone is not enough to
     * tell two completions of a *different* schedule apart.
     */
    raceSummaryKey?: string | null;
    /**
     * The schedule already holds a round that could only be a genuine
     * ending — a round drawing its field from another round's standings
     * (#874). Softens the summary's own wording, and offers a link to add
     * one, when this is false: "every heat that exists has run" is not
     * "the race is over" for a schedule built one round at a time, and
     * there is no way to tell that case apart from a race that really is
     * done after its one and only round — see `hasTerminalRound` in
     * `raceCompletion.ts`. Defaults to `true`, the same "don't second-guess
     * a caller that has not supplied one" shape `raceJustCompleted` uses.
     */
    hasChampionshipRound?: boolean;
    autoAdvanceHeat: boolean;
    onToggleAutoAdvance?: (value: boolean) => void;
    remainingHeatsInRound?: number;
    totalHeatsInRound?: number;
    /** This race's learned turnaround pace (#591), used for both the
     * remaining-time estimate and the estimated finish clock time below it.
     * Falls back to the static baseline when the caller has none to give. */
    pace?: PaceEstimate;
    upcomingRounds?: { roundNumber: number, roundName: string | null, totalHeats: number }[];
    /** The race runs one interleaved sequence across its rounds (#549), so
     * the next heat is usually another round's — the On Deck panel shows its
     * line-up rather than announcing "End of Round" between every heat. */
    masterRunningOrder?: boolean;
    debugMode?: boolean;
    /**
     * The race is locked against further edits (#585). Disables every
     * control here that would arm the timer, record, edit or skip a
     * result — the operator can still watch the heat, only not change it.
     */
    raceLocked?: boolean;
}

export const RaceExecution: React.FC<RaceExecutionProps> = ({
    raceId,
    activeExecutionHeat,
    nextExecutionHeat,
    onRunHeat,
    onNextHeat,
    getRacerName,
    slowestRoundIds,
    onUpdateResult,
    scoringStrategy,
    timerType,
    trackId,
    laneColors = [],
    racers,
    roundSummary,
    roundSkippedHeat = null,
    raceSkippedHeat = null,
    raceJustCompleted = false,
    raceSummaryKey = null,
    hasChampionshipRound = true,
    autoAdvanceHeat,
    onToggleAutoAdvance,
    remainingHeatsInRound,
    totalHeatsInRound,
    pace = BASELINE_PACE,
    upcomingRounds,
    masterRunningOrder,
    debugMode,
    raceLocked = false,
}) => {
    const lockedTitle = RACE_LOCKED_MESSAGE;
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingResults, setEditingResults] = useState<EditableLane[]>([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0.0);
    const [showAutoAdvanceTooltip, setShowAutoAdvanceTooltip] = useState(false);
    const { showConfirm, showAlert } = useAlert();
    const { orgLower, groupLower, vehicle, vehiclesLower } = useTerminology();

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
    const [, startIntermission] = useMutation(START_INTERMISSION_MUTATION);

    const handleTakeABreak = async (seconds: number) => {
        const result = await startIntermission({ raceId, durationSeconds: seconds, label: null });
        if (result.error) {
            showAlert(errorText(result.error, 'The intermission could not be started.'), 'Error');
        }
    };

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

    // A track configured with no timer (#490): arming is refused server-side,
    // hand entry through Override/Edit is the primary control, and nothing
    // here should imply a device is present or on its way.
    const hasTimer = timerType !== 'NONE';

    // Which column the Edit/Override modal shows (#490) — see `shouldDerivePlaces`
    // in `lanes.ts` for the matching save-time rule. Stated through
    // `isTimeBasedStrategy` rather than an inline `=== 'POINTS'` (#547): a
    // place column is what a *place*-based strategy needs, and today
    // `POINTS` is the only one, but a future strategy sharing that shape
    // must not silently fall through this test the way a hand-written
    // `'POINTS'` comparison would.
    const showsPlaceColumn = !isTimeBasedStrategy(scoringStrategy);

    // The race-day flow (#13). What used to be six mutually-guarding effects
    // with two refs, a mirror state and an `eslint-disable` is now one machine
    // in `raceFlow.ts`, tested without rendering. This component supplies what
    // it can see and performs what comes back.
    const flow = useRaceFlow(
        {
            heatId: activeExecutionHeat?.id ?? null,
            phase,
            timerState,
            hasTimer,
            hasRecordedTimes,
            hasNextHeat: !!nextExecutionHeat,
            autoAdvanceEnabled: autoAdvanceHeat,
            hasRoundSummary: !!roundSummary,
            roundSummaryId: roundSummary?.roundId ?? null,
            hasRaceSummary: raceJustCompleted,
            raceSummaryKey,
        },
        {
            // Fire-and-forget here used to mean silently: neither a GraphQL
            // error nor the #337 refusal (a different heat RUNNING) — which
            // answers `false` rather than throwing — said anything, leaving
            // the operator at "Waiting for Timer…" indefinitely (#765). The
            // command stays synchronous (`raceFlow.ts` performs no I/O and
            // does not wait on this), so the check happens in the handler
            // rather than by changing what the machine hands back.
            onPrepareHeat: (heatId) => {
                prepareHeat({ heatId }).then((result) => {
                    if (result.error || result.data?.prepareHeat === false) {
                        showAlert(
                            errorText(result.error, 'The timer could not be armed for the next heat.'),
                            'Error',
                        );
                    }
                });
            },
            onAdvance: onNextHeat,
        },
    );
    const autoAdvanceCountdown = flow.countdown;

    // Sound effects for race events (#208, #554). The edge, not the state:
    // transitions trigger audio only when crossing the boundary, never on
    // render or page reload.
    const [soundSettings, setSoundSettings] = useState<SoundEffectsSettings>(() => readSoundSettings(window.localStorage));
    const [chimeOn, setChimeOn] = useState(() => chimeEnabled(window.localStorage));
    const [isSoundModalOpen, setIsSoundModalOpen] = useState(false);
    const previousPhase = useRef<HeatPhase | null>(null);

    useEffect(() => {
        if (soundSettings.master) {
            if (soundSettings.finish && shouldFinishSound(previousPhase.current, phase)) {
                playFinishSound();
            } else if (soundSettings.gateRelease && shouldGateReleaseSound(previousPhase.current, phase)) {
                playGateReleaseSound();
            } else if (soundSettings.stagingReady && shouldStagingReadySound(previousPhase.current, phase)) {
                playStagingReadySound();
            }
        } else if (chimeOn && shouldChime(previousPhase.current, phase)) {
            playFinishSound();
        }
        previousPhase.current = phase;
    }, [phase, soundSettings, chimeOn]);


    const isRoundSummaryOpen = flow.screen.kind === 'ROUND_SUMMARY';
    const isRaceSummaryOpen = flow.screen.kind === 'RACE_SUMMARY';

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
                {/* #1008: a locked race is done, and "Take a break" invites
                    an action there is nothing left to take a break from —
                    the same `raceLocked` source that already disables every
                    result control on this tab. */}
                {!raceLocked && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                        <IntermissionControl raceId={raceId} compact />
                    </div>
                )}
                <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" style={{ marginBottom: '20px' }} />
                <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Race Execution</h2>
                <p style={{ fontSize: '1.2rem', color: 'var(--text-muted-color)' }}>
                    {nextExecutionHeat ? "Select a heat to begin." : "All heats have been run."}
                </p>
            </div>
        );
    }

    if (hasPlaceholders) {
        return (
            <div style={{ textAlign: 'center', padding: '100px 50px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                    <IntermissionControl raceId={raceId} compact />
                </div>
                <Icon path={mdiCalendarRange} size={4} color="var(--input-border-color)" style={{ marginBottom: '20px' }} />
                <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Round Not Ready</h2>
                <p style={{ fontSize: '1.2rem', color: 'var(--text-muted-color)', maxWidth: '600px', margin: '0 auto' }}>
                    The racers for <strong>{activeExecutionHeat.roundName || `Round ${activeExecutionHeat.roundNumber}`}</strong> haven't been determined yet.
                </p>
                <p style={{ color: 'var(--text-subtle-color)', marginTop: '10px' }}>
                    Please complete the previous rounds to advance racers into this round.
                </p>
            </div>
        );
    }

    const handleResultChange = (index: number, field: 'time' | 'place', value: string) => {
        const newResults = [...editingResults];
        if (field === 'time') {
            newResults[index].timeText = value;
            newResults[index].time = parseTimeText(value);
        } else if (field === 'place') {
            // `min="1"` on the input below is not a fourth layer of
            // validation (#524): the field lives outside a <form> and Save is
            // a plain button, so the browser never runs constraint
            // validation against it. A cleared field and "0" both parse to
            // falsy, so `|| null` used to treat them alike by accident; "-1"
            // parsed straight through untouched. This makes the same
            // outcome — not a positive whole number is not a place — a
            // deliberate check rather than a coincidence of falsiness, and
            // the server (`crud.validate_lane_replacement`) is the backstop
            // for anything that still reaches it, e.g. a duplicate place or
            // one past the field.
            const parsed = parseInt(value, 10);
            newResults[index].place = Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
        }
        setEditingResults(newResults);
    };



    // #766: the first problem with what's on screen, checked live rather
    // than only after a refused Save round-trips through the server. Only
    // meaningful when the Place column is actually shown — a TIMED heat has
    // no way for the operator to type a place at all, so there is nothing
    // here to collide (the places `editingResults` carries are whatever the
    // heat was last recorded with, and `RaceControl.tsx`'s `assignPlaces`
    // recomputes every one of them from the times on save regardless).
    const placeError = showsPlaceColumn ? placeIssue(editingResults) : null;

    // #1008: the same shape as `placeError` above, for the Time column —
    // `min="0"` on the input below is decorative for the identical reason
    // `min="1"`'s comment gives for Place: this field lives outside a
    // <form> and Save is a plain button, so the browser's own constraint
    // validation never runs against it. Checked whether or not the Place
    // column is showing, since every heat has a Time column.
    const timeError = timeIssue(editingResults);

    // The equal-time-tie note (#766's other half): informational, not a
    // block on Save. Only meaningful where a time actually decides the
    // finishing order — under POINTS the typed place wins regardless of
    // what the optional Time column holds (#525), so two matching times
    // there mean nothing about who placed where.
    const tiedTimes = !showsPlaceColumn
        ? tiedTimeGroups(editingResults.map((r) => ({ lane: r.lane, time: parseTimeText(r.timeText) })))
        : [];

    const handleSaveResults = async () => {
        const edited = editingResults.map(({ timeText, ...rest }) => ({
            ...rest,
            time: parseTimeText(timeText),
        }));
        // A refused save (e.g. two lanes given the same place under POINTS)
        // must not close the modal on the way out — that discards everything
        // the operator just typed, with the only signal a transient alert
        // `onUpdateResult` has already shown (#765). Leave it open so they can
        // fix the value and try again. `placeError` catches the common case
        // before Save is even clickable; this stays the backstop for
        // anything it can't see (a lane set out of step with the schedule,
        // say).
        //
        // `onUpdateResult` (`handleUpdateResult` in RaceControl.tsx) already
        // catches its own errors and resolves `false` rather than rejecting
        // — that is the whole point of #765's `Promise<boolean>` contract —
        // but an unguarded `await` is one violation of that contract away
        // from an uncaught rejection that silently drops the operator's
        // typed values with no alert at all. This `catch` is the backstop.
        try {
            const saved = await onUpdateResult(activeExecutionHeat.id, edited);
            if (saved) setIsEditModalOpen(false);
        } catch (err) {
            showAlert(errorText(err, 'The result could not be saved.'), 'Error');
        }
    };

    const handleSkipHeat = async () => {
        if (await showConfirm(
            "Are you sure you want to skip this heat? No results will be recorded.",
            "Skip Heat",
            "Skip Heat",
            "danger",
        )) {
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

            // Wait for the server to hold the skip before moving the screen
            // on (#765; #7 — the server owns the live heat view, so the fix
            // is to not get ahead of it rather than to hold a client-side
            // "skipped" state it might disagree with). This used to advance
            // first ("Move UI forward IMMEDIATELY to prevent 'flash back' race
            // conditions"), so a refused save — a network blip, the race
            // locked mid-click — left the operator on the next heat with the
            // old one never actually marked skipped, unsettled for
            // `is_round_complete` and everything downstream of it.
            // `raceDay.spec.ts`'s skipped-heat test already had to poll the
            // server before navigating away for exactly this reason.
            //
            // Same backstop as `handleSaveResults`: `onUpdateResult` is
            // contracted to resolve `false` rather than reject (#765), but an
            // unguarded `await` would otherwise let a violation of that
            // contract crash this handler with the heat left dangling and no
            // alert shown.
            let saved: boolean;
            try {
                saved = await onUpdateResult(currentHeatId, skippedResults);
            } catch (err) {
                showAlert(errorText(err, 'The heat could not be skipped.'), 'Error');
                return;
            }
            if (!saved) return; // `onUpdateResult` has already alerted why.

            onNextHeat();
            if (trackId) {
                const aborted = await abortHeat({ trackId });
                if (aborted.error) {
                    showAlert(
                        errorText(aborted.error, 'The heat was skipped, but the timer could not be released.'),
                        'Error',
                    );
                }
            }
        }
    };

    const showFakeControls = timerType === 'FAKE';
    const showProxyControls = timerType === 'AUTO_DETECT_PROXY';
    const showHardwareMole = timerType != null && timerType !== 'FAKE' && hasTimer && debugMode;

    return (
        <>
            <div className="race-execution-layout">

                {/* LEFT COLUMN: Active Heat */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Active Heat Card */}
                    <div className="race-execution-active-card" data-testid="race-execution-active-card" style={{ background: 'var(--surface-color)', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--cub-scouting-gold)' }}>
                        {showProxyControls && trackId != null && (
                            <SerialProxyConnector trackId={trackId} />
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.heatNumber}</h2>
                                    <span className="heat-phase-badge" data-testid="heat-phase-badge">
                                        <span className={`heat-phase-dot heat-phase-dot--${heatPhaseDisplay(phase).statusClass}`} />
                                        <span>{heatPhaseDisplay(phase).label}</span>
                                    </span>
                                    {trackId != null && hasTimer && <TimerStatusBadge trackId={trackId} />}
                                </div>
                                <div style={{ color: 'var(--text-muted-color)', fontSize: '1.1rem' }}>
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
                                                background: 'var(--success-color)',
                                                color: 'var(--on-primary-color)',
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
                                                    color: 'var(--danger-strong-color)',
                                                    border: '1px solid var(--danger-strong-color)',
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
                                            background: timerState === 'RESULTS_OVERDUE' ? 'var(--error)' : 'orange',
                                            color: 'var(--on-primary-color)',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}>
                                            <span className="pulse-dot" style={{ width: '12px', height: '12px', background: 'var(--surface-color)', borderRadius: '50%' }} />
                                            {timerState === 'RESULTS_OVERDUE' ? 'Overdue' : 'Racing'}... {elapsedSeconds.toFixed(1)}s
                                        </div>
                                        <style>{`
                                        .pulse-dot { animation: pulse 1s infinite; }
                                        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
                                    `}</style>
                                    </div>
                                ) : timerState === 'IDLE' && trackId != null && !isCompleted && hasTimer ? (
                                    <div style={{ padding: '8px 20px', color: 'var(--text-muted-color)', fontStyle: 'italic', background: 'var(--background-color)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                        Waiting for Timer...
                                    </div>
                                ) : !isCompleted && hasTimer ? (
                                    <div style={{
                                        padding: '8px 20px',
                                        fontSize: '1.15rem',
                                        background: 'var(--background-color)',
                                        color: 'var(--text-muted-color)',
                                        borderRadius: '4px',
                                        fontWeight: 'bold',
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        Waiting for Timer...
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="race-execution-controls-bottom" data-testid="race-execution-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--divider-color)' }}>
                            {/* BOTTOM LEFT: Controls */}
                            <div className="race-execution-controls-left" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                {isCompleted ? (
                                    <>
                                        <button
                                            onClick={handleEditOpen}
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={{
                                                padding: '6px 14px',
                                                fontSize: '0.9rem',
                                                background: 'var(--surface-soft-color)',
                                                color: 'var(--text-emphasis-color)',
                                                border: '1px solid var(--input-border-color)',
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
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={{
                                                padding: '6px 14px',
                                                fontSize: '0.9rem',
                                                background: 'var(--cub-scouting-gold)',
                                                color: 'var(--text-emphasis-color)',
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
                                            onClick={async () => {
                                                // Same check as the auto-prepare
                                                // handler above and RunOffControl's
                                                // own `handlePrepare` (#765): a
                                                // refused re-arm otherwise leaves
                                                // the operator's own deliberate
                                                // click looking like it worked.
                                                const result = await prepareHeat({ heatId: activeExecutionHeat.id });
                                                if (result.error || result.data?.prepareHeat === false) {
                                                    showAlert(
                                                        errorText(result.error, 'The timer could not be re-armed for this heat.'),
                                                        'Error',
                                                    );
                                                }
                                            }}
                                            className="secondary-btn"
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: 'var(--background-color)', color: 'var(--text-emphasis-color)', border: '1px solid var(--input-border-color)', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiRefresh} size={0.7} /> Reset Heat
                                        </button>
                                        {trackId != null && (
                                            <button
                                                onClick={() => forceResults({ trackId })}
                                                className="secondary-btn"
                                                disabled={raceLocked}
                                                title={raceLocked ? lockedTitle : undefined}
                                                style={{ padding: '6px 14px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                            >
                                                <Icon path={mdiAlertCircleOutline} size={0.7} /> Force Results
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSkipHeat}
                                            className="secondary-btn"
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: 'var(--danger-bg-color)', color: 'var(--danger-strong-color)', border: '1px solid var(--danger-border-color)', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiCloseOctagon} size={0.7} /> Skip Heat
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {/* On a track with no timer, arming never happens (#490) — this
                                            is the only control that records a result, so it takes the
                                            primary spot rather than sitting secondary to an "Override"
                                            of something that was never going to run automatically. */}
                                        <button
                                            onClick={handleEditOpen}
                                            className={hasTimer ? 'secondary-btn' : 'primary-btn'}
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={hasTimer ? {
                                                padding: '6px 14px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px'
                                            } : {
                                                padding: '6px 14px', fontSize: '0.9rem', background: 'var(--cub-scouting-gold)', color: 'var(--text-emphasis-color)', border: 'none', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px'
                                            }}
                                        >
                                            <Icon path={mdiPencil} size={0.7} /> {hasTimer ? 'Override' : 'Enter Results'}
                                            <kbd style={KBD_STYLE}>{SHORTCUT_HINTS.EDIT}</kbd>
                                        </button>
                                        <button
                                            onClick={handleSkipHeat}
                                            className="secondary-btn"
                                            disabled={raceLocked}
                                            title={raceLocked ? lockedTitle : undefined}
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', background: 'var(--danger-bg-color)', color: 'var(--danger-strong-color)', border: '1px solid var(--danger-border-color)', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '6px', height: '36px' }}
                                        >
                                            <Icon path={mdiCloseOctagon} size={0.7} /> Skip Heat
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* BOTTOM RIGHT: sound, then auto-advance */}
                            <div className="race-execution-controls-right" style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                            {/* The finish chime (#208). Off until somebody asks
                                for it, and remembered per device — the
                                operator's laptop wants it, a wall display does
                                not. */}
                            <label
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: 'var(--text-strong-muted-color)', cursor: 'pointer', userSelect: 'none' }}
                                title="Play a short sound when a heat's results are recorded."
                            >
                                <input
                                    type="checkbox"
                                    data-testid="finish-chime-toggle"
                                    checked={chimeOn}
                                    onChange={(e) => {
                                        const nextChime = e.target.checked;
                                        setChimeEnabled(window.localStorage, nextChime);
                                        setChimeOn(nextChime);
                                        const current = readSoundSettings(window.localStorage);
                                        const updated: SoundEffectsSettings = {
                                            ...current,
                                            finish: nextChime,
                                        };
                                        writeSoundSettings(window.localStorage, updated);
                                        setSoundSettings(updated);
                                        // Played on the way on, never on the way
                                        // off: it is the only way to find out
                                        // whether the machine's sound is muted
                                        // without waiting for a heat to finish.
                                        if (nextChime) playFinishSound();
                                    }}
                                />
                                Finish sound
                            </label>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                                onClick={() => setIsSoundModalOpen(true)}
                                title="Configure race sound effects"
                                data-testid="sound-effects-modal-trigger"
                            >
                                Sound options
                            </button>
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
                                            background: 'var(--text-color)',
                                            color: 'var(--on-primary-color)',
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
                                    {/* One `<label>` around the word and the pill
                                        toggle (#998) — they used to be siblings, a
                                        `<span>` beside a `<label>` wrapping only the
                                        44px control, so clicking the word "Auto-advance"
                                        did nothing. A `<label>` toggles its control from
                                        anywhere inside it, not only a direct child, so
                                        nesting the pill's own visuals in a `<span>`
                                        (never another `<label>` — nested labels are
                                        invalid HTML) here is enough. */}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-strong-muted-color)', userSelect: 'none' }}>Auto-advance</span>
                                    <span style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
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
                                            background: autoAdvanceHeat ? 'var(--scouting-blue)' : 'var(--input-border-color)',
                                            borderRadius: '24px',
                                            transition: 'background 0.2s',
                                        }} />
                                        <div style={{
                                            position: 'absolute',
                                            height: '18px', width: '18px',
                                            left: autoAdvanceHeat ? '23px' : '3px',
                                            bottom: '3px',
                                            background: 'var(--surface-color)',
                                            borderRadius: '50%',
                                            transition: 'left 0.2s',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                        }} />
                                    </span>
                                    </label>
                                </div>
                            )}
                            </div>
                        </div>
                        {/* Tightened to one line per lane, a 48px avatar rather
                            than 80px (#940) — four lanes fit in well under
                            400px now instead of the ~600px the old two-line
                            card took, which is most of what put the result
                            controls below the fold on a 4-lane track. At
                            five-plus lanes and 1100px or wider,
                            `race-execution-lanes--many` (see index.css) goes
                            to two columns rather than growing the list
                            taller still. */}
                        <div
                            className={`race-execution-lanes${liveLanes.length >= 5 ? ' race-execution-lanes--many' : ''}`}
                            style={{ display: 'grid', gap: '8px' }}
                        >
                            {liveLanes.map((r) => {
                                const racer = r.racerId != null ? racers[r.racerId] : undefined;
                                const empty = isLaneEmpty(r);
                                const isFirst = r.place === 1;
                                return (
                                    <div
                                        key={r.lane}
                                        className="race-execution-lane-row"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '8px 12px',
                                            background: isFirst ? 'var(--highlight-gold-tint-color)' : 'var(--surface-tint-color)',
                                            borderRadius: '8px',
                                            borderLeft: isFirst ? '4px solid var(--cub-scouting-gold)' : '4px solid var(--border-color)',
                                            // #1008: this row is a `display:
                                            // grid` item (the list above it)
                                            // holding its own `display: flex`
                                            // children — a grid item's
                                            // automatic minimum size defaults
                                            // to its content's own width, so
                                            // without this a long enough name
                                            // grew this row's own track past
                                            // the phone's width instead of
                                            // being confined to it. Same fix
                                            // `RaceControl.tsx`'s Previous
                                            // Heats rows need for the
                                            // identical reason.
                                            minWidth: 0,
                                        }}
                                    >
                                        <LaneBadge
                                            color={colorForLane(laneColors, r.lane)}
                                            className="race-execution-lane-badge"
                                            style={{ fontSize: '0.9rem', fontWeight: 'bold', width: '54px', flexShrink: 0, color: 'var(--text-muted-color)' }}
                                        >
                                            Lane {r.lane}
                                        </LaneBadge>

                                        <div className="race-execution-avatar-wrap" style={{ width: '48px', height: '48px', flexShrink: 0, borderRadius: '50%', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                            {!empty && (
                                                <RacerAvatar
                                                    racer={{
                                                        id: racer?.id || r.racerId || 0,
                                                        first_name: racer?.firstName || '',
                                                        last_name: racer?.lastName || '',
                                                        racer_image_url: racer?.racerImageUrl
                                                    }}
                                                    size="48px"
                                                />
                                            )}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px', overflow: 'hidden' }}>
                                            <span className="race-execution-racer-name" style={{ fontSize: '1.05rem', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {laneDisplayName(r, racer, getRacerName, slowestRoundIds?.has(activeExecutionHeat.roundId))}
                                            </span>
                                            {racer?.carNumber && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)', flexShrink: 0 }}>#{racer.carNumber}</span>}
                                        </div>

                                        <div className="race-execution-time-place" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                            <div className="race-execution-time" style={{ fontSize: '1.1rem', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold', minWidth: '54px', textAlign: 'right' }}>
                                                {formatLaneTime(r.time) ?? '--'}
                                            </div>
                                            {r.place !== null && (
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    padding: '2px 7px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 'bold',
                                                    whiteSpace: 'nowrap',
                                                    background: r.place === 1 ? 'var(--cub-scouting-gold)' :
                                                        r.place === 2 ? 'var(--surface-strong-color)' :
                                                            r.place === 3 ? 'var(--rank-bronze-color)' : 'transparent',
                                                    color: r.place === 1 ? 'var(--scouting-blue)' : 'inherit',
                                                }}>
                                                    {r.place <= 3 && (
                                                        <Icon
                                                            path={mdiTrophy}
                                                            size={0.6}
                                                            color={r.place === 1 ? 'var(--scouting-blue)' :
                                                                r.place === 2 ? 'var(--rank-silver-icon-color)' : 'var(--rank-bronze-icon-color)'}
                                                        />
                                                    )}
                                                    {r.place === 1 ? '1st' : r.place === 2 ? '2nd' : r.place === 3 ? '3rd' : `${r.place}th`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* The fake timer's start/finish buttons, directly under
                            the lane list they act on rather than at the foot of
                            the sidebar (#940) — the docs already described this
                            as "below the current heat", and during a rehearsal
                            it is the only way to run one. */}
                        <FakeTimerMole
                            isOpen={showFakeControls}
                            heatId={activeExecutionHeat.id}
                            trackId={trackId ?? 0}
                            docked={true}
                        />
                    </div>
                </div>

                {/* RIGHT COLUMN: On Deck */}
                <div
                    data-testid="race-execution-right-column"
                >
                    <h3 style={{ marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-heading-alt-color)' }}>
                        <Icon path={mdiChevronDoubleRight} size={1} /> On Deck
                    </h3>
                    <div style={{ background: 'var(--surface-color)', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                        {!nextExecutionHeat || (!masterRunningOrder && nextExecutionHeat.roundId !== activeExecutionHeat.roundId) ? (
                            <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-strong-muted-color)' }}>
                                <Icon path={mdiTrophy} size={2} color="var(--cub-scouting-gold)" style={{ marginBottom: '10px' }} />
                                <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>End of Round</div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-subtle-color)', marginTop: '5px' }}>
                                    {nextExecutionHeat
                                        ? `Next: ${nextExecutionHeat.roundName || `Round ${nextExecutionHeat.roundNumber}`}`
                                        : "Race Complete!"}
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <span style={{ fontSize: '1.1rem' }}>Heat {nextExecutionHeat.heatNumber}</span>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle-color)', fontWeight: 'normal' }}>{nextExecutionHeat.roundName || `Round ${nextExecutionHeat.roundNumber}`}</span>
                                </div>
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    {nextExecutionHeat.lanes.map((r: Lane) => {
                                        const racer = r.racerId != null ? racers[r.racerId] : undefined;
                                        const empty = isLaneEmpty(r);
                                        return (
                                                                                        <div key={r.lane} className="race-execution-ondeck-lane-row" style={{ display: 'flex', alignItems: 'center', gap: '15px', paddingBottom: '12px', borderBottom: '1px solid var(--background-color)', minWidth: 0 }}>
                                                                                            <LaneBadge
                                                                                                color={colorForLane(laneColors, r.lane)}
                                                                                                style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-faint-color)', width: '30px' }}
                                                                                            >
                                                                                                L{r.lane}
                                                                                            </LaneBadge>

                                                                                            <div className="race-execution-ondeck-avatar-wrap" style={{ width: '60px', height: '60px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                                {!empty && (
                                                                                                    <RacerAvatar
                                                                                                        racer={{
                                                                                                            id: racer?.id || r.racerId || 0,
                                                                                                            first_name: racer?.firstName || '',
                                                                                                            last_name: racer?.lastName || '',
                                                                                                            racer_image_url: racer?.racerImageUrl
                                                                                                        }}
                                                                                                        size="60px"
                                                                                                    />
                                                                                                )}
                                                                                            </div>

                                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                                <div style={{ fontWeight: '600', fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                                                    {laneDisplayName(r, racer, getRacerName, slowestRoundIds?.has(nextExecutionHeat?.roundId ?? -1))}
                                                                                                </div>
                                                                                                {racer?.carNumber && (
                                                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-subtle-color)' }}>{vehicle} #{racer.carNumber}</div>
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
                        <div style={{ marginTop: '15px', padding: '10px 15px', background: 'var(--surface-alt-color)', borderRadius: '8px', border: '1px solid var(--progress-panel-border-color)', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--progress-label-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Round Progress</div>
                                {/* Folded into one button with the presets in a
                                    popover (#940) — this used to be a bar that
                                    permanently held the Race tab's first row. */}
                                <IntermissionControl raceId={raceId} compact />
                            </div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--progress-value-color)' }}>
                                {totalHeatsInRound - remainingHeatsInRound} of {totalHeatsInRound} Heats Completed
                            </div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--success-color)', fontWeight: 600 }}>
                                {remainingHeatsInRound} {remainingHeatsInRound === 1 ? 'Heat' : 'Heats'} Remaining
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', marginTop: '4px' }}>
                                Estimated time remaining: {heatsEstimate(remainingHeatsInRound, pace.minutesPerHeat)}
                            </div>
                            {remainingHeatsInRound > 0 && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', marginTop: '2px' }}>
                                    Est. finish: {formatClockTime(estimatedFinishTime(remainingHeatsInRound, pace, new Date()))}{' '}
                                    ({paceLabel(pace)})
                                </div>
                            )}
                        </div>
                    )}
                    {upcomingRounds && upcomingRounds.length > 0 && (
                        <div style={{ marginTop: '20px' }}>
                            <h3 style={{ fontSize: '1rem', color: 'var(--text-heading-alt-color)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Icon path={mdiCalendarRange} size={0.8} /> Upcoming Rounds
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {upcomingRounds.map((round) => (
                                    <div key={round.roundNumber} style={{ background: 'var(--surface-color)', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderLeft: '4px solid var(--border-color)' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '4px' }}>
                                            {round.roundName || `Round ${round.roundNumber}`}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                                            {round.totalHeats} {round.totalHeats === 1 ? 'Heat' : 'Heats'} Scheduled
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {showHardwareMole && trackId != null && (
                        <HardwareTimerMole trackId={trackId} timerType={timerType} docked={true} />
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
                    <p style={{ fontSize: '1.2rem', color: 'var(--text-muted-color)', marginTop: '10px' }}>
                        {roundSummary?.requiresAdvancement
                            ? roundSummary.fromBottom
                                ? `The ${roundSummary.numRacers} slowest ${vehiclesLower} race in the next round.`
                                : `Top ${roundSummary.numRacers} racers advance to the next round.`
                            : "This round is complete."
                        }
                    </p>
                    {roundSummary?.source && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-subtle-color)', fontStyle: 'italic' }}>
                            {/* Human words, not the raw source value — "ALL"
                                on a projector means nothing to the room, and
                                the resolved terminology rather than the
                                internal EACH_GROUP name (#532). */}
                            Advancing from {advancingFromLabel(roundSummary.source, { orgLower, groupLower })}
                        </div>
                    )}
                </div>

                {/* A skipped heat in this round settled without a real
                    result (#1001) — the advancement cascade above already
                    ran against it once, so an operator who finds out the
                    cars did turn up needs a way back to it before trusting
                    this line-up. */}
                {roundSkippedHeat && (
                    <div
                        data-testid="round-summary-skipped-heat"
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            background: 'var(--warning-bg-color)',
                            color: 'var(--warning-strong-color)',
                            border: '1px solid var(--warning-strong-border-color)',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            marginBottom: '20px',
                            fontSize: '0.9rem',
                            textAlign: 'center',
                        }}
                    >
                        <span>{skippedHeatWarning(roundSkippedHeat.heatNumber, vehiclesLower, true)}</span>
                        <button
                            type="button"
                            className="secondary-btn"
                            data-testid="round-summary-run-skipped-heat"
                            onClick={() => {
                                flow.dismissSummary();
                                onRunHeat(roundSkippedHeat);
                            }}
                            style={{ padding: '4px 10px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                        >
                            Run heat {roundSkippedHeat.heatNumber}
                        </button>
                    </div>
                )}

                {roundSummary && (
                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--divider-color)', borderRadius: '8px', marginBottom: '20px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: 'var(--background-color)', position: 'sticky', top: 0 }}>
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
                                    <tr key={ar.racerId} style={{ borderBottom: '1px solid var(--divider-color)', background: ar.isAdvancing ? 'var(--warning-bg-color)' : 'var(--surface-color)' }}>
                                        <td style={{ padding: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                {ar.rank <= 3 && <Icon path={mdiTrophy} size={0.7} color={ar.rank === 1 ? 'gold' : ar.rank === 2 ? 'silver' : '#cd7f32'} />}
                                                {ar.rank}
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                            <div style={{ fontWeight: 'bold' }}>{ar.firstName} {ar.lastName}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>{ar.racingGroupName} #{ar.carNumber}</div>
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums' }}>
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
                            background: 'var(--success-color)',
                            color: 'var(--on-primary-color)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
                        }}
                    >
                        Start Next Round <Icon path={mdiArrowRight} size={1} />
                    </button>
                </div>

                {/* A round finishing is exactly when a break is most often
                    called (#592) — this is a button on the modal already
                    here, not new machine state in `raceFlow.ts`: nothing
                    about "a round just ended" needs to survive a refresh
                    that `IntermissionControl` on the Race tab does not
                    already cover. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--divider-color)' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>Or take a break:</span>
                    {INTERMISSION_PRESETS.map((preset) => (
                        <button
                            key={preset.seconds}
                            type="button"
                            className="secondary-btn"
                            data-testid={`round-summary-break-${preset.seconds}`}
                            onClick={() => handleTakeABreak(preset.seconds)}
                            style={{ padding: '5px 10px', fontSize: '0.8rem' }}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            </Modal>

            {/* Race Complete Modal (#847) — the seam the operator used to be
                left at with nothing pointing anywhere: every heat has run,
                and the roster's checklist stops well short of what happens
                next. The three routes below already exist; this is only the
                prompt at the moment they become relevant.

                "Every heat that exists has run" is not "the race is over"
                (#874) for a schedule built one round at a time — there is no
                stored fact that tells a prelims-only race, genuinely done,
                apart from one whose championship round has not been added
                yet. Rather than guess (and get it wrong for one of the two,
                as the reverted fix did — see `hasChampionshipRound`'s own
                docstring in `raceCompletion.ts`), this softens what it says
                and offers the other path, instead of trying to suppress
                itself. */}
            <Modal
                isOpen={isRaceSummaryOpen}
                onClose={flow.dismissSummary}
                title={hasChampionshipRound ? 'Race Complete!' : 'No More Heats Scheduled'}
            >
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" />
                    <p style={{ fontSize: '1.2rem', color: 'var(--text-muted-color)', marginTop: '10px' }}>
                        {hasChampionshipRound
                            ? "Every heat has been run or skipped. Here's where to go next:"
                            : "Every heat that's currently scheduled has been run or skipped. If you're not done yet, add a championship round below — otherwise, here's where to go next:"}
                    </p>
                </div>

                {/* Mirrors the Round Complete! modal's own line (#1001) — a
                    skip settles a heat without a result, so "every heat is
                    done" is true and "nothing is missing" is not. */}
                {raceSkippedHeat && (
                    <div
                        data-testid="race-summary-skipped-heat"
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            background: 'var(--warning-bg-color)',
                            color: 'var(--warning-strong-color)',
                            border: '1px solid var(--warning-strong-border-color)',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            marginBottom: '20px',
                            fontSize: '0.9rem',
                            textAlign: 'center',
                        }}
                    >
                        <span>{skippedHeatWarning(raceSkippedHeat.heatNumber, vehiclesLower, false)}</span>
                        <button
                            type="button"
                            className="secondary-btn"
                            data-testid="race-summary-run-skipped-heat"
                            onClick={() => {
                                flow.dismissSummary();
                                onRunHeat(raceSkippedHeat);
                            }}
                            style={{ padding: '4px 10px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                        >
                            Run heat {raceSkippedHeat.heatNumber}
                        </button>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    {!hasChampionshipRound && (
                        <Link
                            to={`/race/${raceId}/control`}
                            className="primary-btn"
                            style={{ textAlign: 'center', textDecoration: 'none' }}
                        >
                            Add a Championship Round
                        </Link>
                    )}
                    <Link
                        to={`/race/${raceId}/standings`}
                        className={hasChampionshipRound ? 'primary-btn' : 'secondary-btn'}
                        style={{ textAlign: 'center', textDecoration: 'none' }}
                    >
                        See Final Standings
                    </Link>
                    <Link
                        to={`/race/${raceId}/awards`}
                        className="secondary-btn"
                        style={{ textAlign: 'center', textDecoration: 'none' }}
                    >
                        Awards &amp; Ceremony
                    </Link>
                    <Link
                        to={`/race/${raceId}/print/results`}
                        className="secondary-btn"
                        style={{ textAlign: 'center', textDecoration: 'none' }}
                    >
                        Print Results Sheet
                    </Link>
                </div>

                {/* Optional, per the issue: a pointer at wrapping up, not a
                    new feature — locking lives on the race's own edit form
                    (Roster's "Edit race"), and a backup is one click in
                    System Settings. Both are one click away already; this
                    only says so. */}
                <div
                    style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-subtle-color)',
                        textAlign: 'center',
                        borderTop: '1px solid var(--divider-color)',
                        paddingTop: '12px',
                    }}
                >
                    Wrapping up? <Link to={`/race/${raceId}?edit=true`}>Lock this race</Link> and take a{' '}
                    <Link to="/system-settings">backup</Link> before you go.
                </div>
            </Modal>

            {/* Edit Results Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Edit Results - Heat ${activeExecutionHeat.heatNumber}`}
            >
                <div className="form-group">
                    {/* Which column is *required* follows the race's scoring
                        strategy (#490) rather than being a fourth thing for
                        the operator to decide: `TIMED` averages times, so
                        that is what gets typed in and turned into places on
                        save (see `shouldDerivePlaces` in `lanes.ts`) — no
                        Place column, since nothing is ever typed into one.
                        `POINTS` sums places, so the finishing order is what
                        somebody at the line actually has to report by hand —
                        that stays the primary column. But a `POINTS` race can
                        still have a timer (#525): it records a time nothing
                        else in the app can correct once this modal hides the
                        column, and that time still feeds the track record
                        board, the record-break banner and the Stats page
                        regardless of how the race scores. So a `POINTS` heat
                        shows Time too — optional, for fixing or clearing a
                        stored or spurious one — while `shouldDerivePlaces`
                        keeps it from ever overwriting the hand-typed places. */}
                    <p className="form-help">
                        {showsPlaceColumn
                            ? 'Manually enter finishing order for this heat. If a time was recorded, you can correct or clear it below too — it will not change the finishing order.'
                            : 'Manually update times for this heat.'}
                    </p>
                    {/* #766/#816: two identical hand-typed times are a real tie —
                        they share a place (competition ranking, e.g. 1, 1, 3).
                        Informational note for the operator; does not block Save. */}
                    {tiedTimes.length > 0 && (
                        <p
                            data-testid="tied-times-note"
                            className="form-help"
                            style={{ color: 'var(--warning-strong-color)' }}
                        >
                            {tiedTimes
                                .map(
                                    (group) =>
                                        `Lanes ${group.lanes.join(' and ')} recorded the same time (${formatLaneTime(group.time)}) — they share a place.`,
                                )
                                .join(' ')}
                        </p>
                    )}

                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '8px' }}>Lane</th>
                                <th style={{ textAlign: 'left', padding: '8px' }}>Racer</th>
                                {showsPlaceColumn && <th style={{ textAlign: 'left', padding: '8px' }}>Place</th>}
                                <th style={{ textAlign: 'left', padding: '8px' }}>
                                    {showsPlaceColumn ? 'Time (s) — optional' : 'Time (s)'}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {editingResults.map((r, idx) => (
                                <tr key={r.lane} style={{ borderBottom: '1px solid var(--divider-color)' }}>
                                    <td style={{ padding: '8px' }}>{r.lane}</td>
                                    <td style={{ padding: '8px' }}>
                                        {isLaneEmpty(r)
                                            ? 'Empty'
                                            : getRacerName(r.racerId ?? (r.placeholderSlot ? -r.placeholderSlot : 0), slowestRoundIds?.has(activeExecutionHeat.roundId))}
                                    </td>
                                    {showsPlaceColumn && (
                                        <td style={{ padding: '8px' }}>
                                            <input
                                                type="number"
                                                step="1"
                                                min="1"
                                                value={r.place ?? ''}
                                                onChange={(e) => handleResultChange(idx, 'place', e.target.value)}
                                                className="form-control"
                                                style={{ width: '100px' }}
                                            />
                                        </td>
                                    )}
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
                    {/* #766: the same rule `crud.validate_lane_replacement`
                        would refuse Save for, checked here instead so the
                        operator finds out before losing the edit to a round
                        trip — not a replacement for that check, which stays
                        the backstop for anything this can't see. */}
                    {placeError && (
                        <p
                            data-testid="place-validation-error"
                            className="form-help"
                            style={{ color: 'var(--danger-strong-color)' }}
                        >
                            {placeError}
                        </p>
                    )}
                    {/* #1008: the same "catch it before Save round-trips to
                        the server" shape as `placeError`, mirroring
                        `crud.validate_lane_replacement`'s negative-time
                        refusal. */}
                    {timeError && (
                        <p
                            data-testid="time-validation-error"
                            className="form-help"
                            style={{ color: 'var(--danger-strong-color)' }}
                        >
                            {timeError}
                        </p>
                    )}
                    <div className="form-actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button className="secondary-btn" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
                        <button className="primary-btn" onClick={handleSaveResults} disabled={!!placeError || !!timeError}>Save Results</button>
                    </div>
                </div>
            </Modal>

            {/* Sound Effects Modal (#554) */}
            <Modal
                isOpen={isSoundModalOpen}
                onClose={() => {
                    setIsSoundModalOpen(false);
                    const refreshed = readSoundSettings(window.localStorage);
                    setSoundSettings(refreshed);
                    setChimeOn(refreshed.master && refreshed.finish);
                }}
                title="Race Sound Effects"
            >
                <SoundSettingsSection />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                            setIsSoundModalOpen(false);
                            const refreshed = readSoundSettings(window.localStorage);
                            setSoundSettings(refreshed);
                            setChimeOn(refreshed.master && refreshed.finish);
                        }}
                    >
                        Done
                    </button>
                </div>
            </Modal>
        </>
    );
};
