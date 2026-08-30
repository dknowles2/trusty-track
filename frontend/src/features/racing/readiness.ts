/**
 * Whether this race can actually be run yet (#200).
 *
 * The operator used to discover a missing prerequisite one error at a time:
 * arm a heat to find out the timer was never connected, open the schedule to
 * find out nobody generated one, look at the wall to find out the screens are
 * showing last year's race. Every one of those is knowable before the first
 * heat is armed, and every one of them is worse to discover with the pack
 * watching.
 *
 * Pure — no React, no urql. The caller loads the four answers and this decides
 * what they mean.
 */

/**
 * How much attention an item wants.
 *
 * `INFO` is a fourth level rather than a green tick because some of what is
 * worth reporting is not a verdict. A pack with no audience screen is not in a
 * worse state than a pack with three — it is a choice — so an amber dot would
 * be nagging and a green one would be asserting something nobody claimed.
 */
export type ReadinessLevel = 'BLOCKED' | 'ATTENTION' | 'OK' | 'INFO';

export type ReadinessKey = 'timer' | 'checkin' | 'schedule' | 'displays';

export interface ReadinessInput {
    /** The timer's own state, or null before the first payload arrives. */
    timerState: string | null;
    timerDeviceName: string | null;
    /** The profile's provenance line, if the device was identified. */
    timerProvenance: string | null;
    /** `Track.timerType` — `'NONE'` means this track has no timer at all
     * (#490), which is not a fault and needs no link to go check. */
    timerType: string | null;
    registeredCount: number;
    checkedInCount: number;
    /** Official heats that exist, in any round. */
    heatCount: number;
    /** Audience displays currently connected. */
    connectedDisplays: number;
}

export interface ReadinessItem {
    key: ReadinessKey;
    label: string;
    detail: string;
    level: ReadinessLevel;
    /** Where this is fixed, when it is fixed somewhere else. */
    href?: string;
    /** Secondary text — shown, but not part of the verdict. */
    note?: string;
}

/**
 * A timer state we can arm a heat from.
 *
 * `CONNECTED` is deliberately not in here. It means the port is open and the
 * device has not said what it is — the state `nudge_if_unidentified` exists to
 * get out of — so reporting it as ready is how an operator finds out at the
 * start line.
 */
const USABLE_TIMER_STATES = new Set(['IDLE', 'ARMED', 'READY', 'RUNNING', 'RESULTS_OVERDUE']);

function timerItem(input: ReadinessInput): ReadinessItem {
    const { timerState, timerDeviceName, timerProvenance, timerType } = input;
    const href = '/timer-check';

    // Not a fault, and nothing to check: this track was deliberately
    // configured with no timer (#490), so hand entry through Override is
    // how every heat gets recorded.
    if (timerType === 'NONE') {
        return {
            key: 'timer',
            label: 'Timer',
            detail: 'No timer — results are entered by hand.',
            level: 'OK',
        };
    }

    if (timerState === null) {
        return {
            key: 'timer',
            label: 'Timer',
            detail: 'Checking…',
            level: 'INFO',
            href,
        };
    }

    if (!USABLE_TIMER_STATES.has(timerState)) {
        return {
            key: 'timer',
            label: 'Timer',
            detail:
                timerState === 'CONNECTED'
                    ? 'Connected, but it has not said what it is yet.'
                    : 'Not connected. Heats cannot be armed until it is.',
            level: 'BLOCKED',
            href,
        };
    }

    const name = timerDeviceName ?? 'Connected';

    // Deliberately not amber for an untested profile, which is the first thing
    // this wanted to do. *Every* profile we ship says it has never been driven
    // live — including the MicroWizard, written from the manufacturer's own
    // documentation — so that amber would be on for every track every time, and
    // an indicator that is always on is an indicator nobody reads. The
    // provenance belongs where somebody is asking the question, which is the
    // diagnostics page this links to.
    return {
        key: 'timer',
        label: 'Timer',
        detail: name,
        level: 'OK',
        href,
        note: timerProvenance || undefined,
    };
}

function checkinItem(
    input: ReadinessInput,
    /** The lowercase plural vehicle word, mirroring the identical sentence in
     * `setupChecklist.ts`'s check-in step. Defaults to the built-in Scouting
     * word so a caller that has not been threaded through `useTerminology()`
     * yet still renders what it always did (#551). */
    vehicleWord = 'cars',
): ReadinessItem {
    const { registeredCount, checkedInCount } = input;

    if (registeredCount === 0) {
        return {
            key: 'checkin',
            label: 'Check-in',
            detail: 'Nobody on the roster yet.',
            level: 'BLOCKED',
        };
    }

    if (checkedInCount === 0) {
        return {
            key: 'checkin',
            label: 'Check-in',
            detail: `0 of ${registeredCount} checked in. Only checked-in ${vehicleWord} are put into heats.`,
            level: 'BLOCKED',
        };
    }

    // Some but not all is the ordinary state of a race morning, not a fault —
    // amber says "look at this", which is exactly right for a queue at the
    // desk, and red would be crying wolf for the whole of check-in.
    if (checkedInCount < registeredCount) {
        return {
            key: 'checkin',
            label: 'Check-in',
            detail: `${checkedInCount} of ${registeredCount} checked in.`,
            level: 'ATTENTION',
        };
    }

    return {
        key: 'checkin',
        label: 'Check-in',
        detail: `All ${registeredCount} checked in.`,
        level: 'OK',
    };
}

function scheduleItem(input: ReadinessInput): ReadinessItem {
    if (input.heatCount === 0) {
        return {
            key: 'schedule',
            label: 'Schedule',
            detail: 'No heats yet. Add a round to build them.',
            level: 'BLOCKED',
        };
    }
    return {
        key: 'schedule',
        label: 'Schedule',
        detail: `${input.heatCount} heat${input.heatCount === 1 ? '' : 's'} ready.`,
        level: 'OK',
    };
}

function displaysItem(input: ReadinessInput): ReadinessItem {
    const n = input.connectedDisplays;
    return {
        key: 'displays',
        label: 'Displays',
        detail:
            n === 0
                ? 'No audience screens connected.'
                : `${n} screen${n === 1 ? '' : 's'} connected.`,
        level: 'INFO',
    };
}

export function readinessItems(
    input: ReadinessInput,
    /** The lowercase plural vehicle word for the check-in item. Defaults to
     * the built-in Scouting word (#551). */
    vehicleWord = 'cars',
): ReadinessItem[] {
    return [timerItem(input), checkinItem(input, vehicleWord), scheduleItem(input), displaysItem(input)];
}

/** The worst thing on the list, which is what the strip as a whole says. */
export function overallLevel(items: readonly ReadinessItem[]): ReadinessLevel {
    if (items.some((item) => item.level === 'BLOCKED')) return 'BLOCKED';
    if (items.some((item) => item.level === 'ATTENTION')) return 'ATTENTION';
    return 'OK';
}

/**
 * Whether the strip can be a single line rather than a list.
 *
 * Once nothing wants attention the detail is just noise above the thing the
 * operator came here to do, so it collapses to one line. Anything amber or red
 * expands again — the list is where the fix is.
 */
export function isCompact(items: readonly ReadinessItem[]): boolean {
    return overallLevel(items) === 'OK';
}

/**
 * The one-line version, for when everything is fine.
 *
 * It still carries the three facts rather than only saying "ready", because
 * "ready" on its own is a claim the operator has no way to check — and the
 * three details are exactly what they would expand the list to read.
 */
export function summaryLine(items: readonly ReadinessItem[]): string {
    const detail = (key: ReadinessKey) => items.find((item) => item.key === key)?.detail;
    const parts = [detail('timer'), detail('checkin'), detail('schedule')].filter(
        (part): part is string => Boolean(part),
    );
    return parts.join(' · ');
}

/**
 * Whether to show the strip at all.
 *
 * This is a pre-flight check, so it goes as soon as the race is under way. The
 * timer badge and the execution screen report a mid-event problem far better
 * than a strip about getting started would, and a race that has begun has
 * answered all four questions by demonstration.
 */
export function shouldShowReadiness(anyHeatRecorded: boolean): boolean {
    return !anyHeatRecorded;
}
