/**
 * What a new operator has to do next (#199, extended by #847 and #949).
 *
 * The operator is a parent volunteer who uses this app once a year. After the
 * first-run settings page they land on an empty roster, and the rest of the
 * path — racing groups, racers, check-in, a schedule — was discoverable only by opening
 * screens to see what was on them, or by reading the getting-started guide
 * under pressure on race morning.
 *
 * Pure, and deliberately derived from data the roster already has rather than
 * from anything the operator ticks off by hand. A checklist somebody has to
 * maintain is a second copy of the truth, and it is the copy that goes stale.
 *
 * `checklistFor` takes the resolved terminology words rather than reading
 * `useTerminology()` itself — same split as `raceFlow.ts`, a rule here and
 * the one React hook that supplies it in `SetupChecklist.tsx` (#496 stage 4).
 *
 * **Awards and printables stayed out of the first four for a data reason,
 * not a taste one, and #847 is what supplied the missing signal.** Both are
 * genuinely optional — a pack that hands out no trophies, or prints nothing
 * because check-in is done by typing a car number — and every one of the
 * first four steps is satisfied either by the thing itself existing *or* by
 * a later step in the same sequence overtaking it (racing groups by a
 * roster, check-in by nobody having a number left to fear losing). Awards
 * and printables had no such "overtaken by" signal until a race can be
 * *locked* (#585): locking is the operator's own "I am done deciding this"
 * action, already the suggested wrap-up step in the end-of-race panel
 * (#855/#897), so it is the one fact that can quiet an award or a print run
 * nobody ever asked for without inventing a dismiss control the rest of this
 * module deliberately has none of. They stay in the same card, under the
 * same "Setting up this race" heading, rather than a second panel: setting
 * up an award and printing a pit pass are still setup — of the ceremony and
 * of the paper on the table — not race-day mechanics, and the issue's own
 * framing ("the same card that already teaches the order of the evening")
 * is the one place an operator is already looking.
 */

import type { TerminologyWords } from '../../context/TerminologyContext';

export interface SetupProgress {
    racingGroupCount: number;
    racerCount: number;
    checkedInCount: number;
    roundCount: number;
    /** Speed or special, whole-race — same count `awards { id }` gives the page (#170). */
    awardCount: number;
    /** Locked against further edits (#585) — the "I am done" signal that quiets
     *  the two steps below when nothing else would. */
    isLocked: boolean;
}

export type StepKey = 'racingGroups' | 'racers' | 'checkin' | 'schedule' | 'awards' | 'printables';

export interface ChecklistStep {
    key: StepKey;
    label: string;
    /** What this step is for, in one line — shown while it is outstanding. */
    hint: string;
    done: boolean;
    /**
     * The label for the button that gets it done, or null when the step is not
     * one click.
     *
     * Deliberately not a copy of the label on the control it opens. Two buttons
     * reading "Add Racer" on one screen is ambiguous to a screen reader and to
     * a person; and these are imperatives for somebody doing this for the first
     * time, which is not the same audience as the toolbar.
     */
    action: string | null;
}

/**
 * The six steps, and whether each is behind us.
 *
 * **Racing groups are optional, and that is the trap.** A pack that numbers cars some
 * other way never creates one, so a step that is done only when a racing group exists
 * would sit unfinished for the whole event — and a checklist that cannot be
 * completed is noise the operator learns to ignore, taking the other three
 * steps with it. So the racing groups step is also satisfied by having a roster: adding
 * racers without racing groups is a decision, and the checklist should not argue with
 * it.
 *
 * **Check-in is done at the first racer, not the last.** Check-in runs all
 * morning and the last car often arrives after the first heat; requiring the
 * whole roster would leave this on screen through the racing. The count in the
 * hint is what actually answers "are we ready to start", and it keeps counting
 * after the step is ticked.
 */
export function checklistFor(progress: SetupProgress, words: TerminologyWords): ChecklistStep[] {
    const { racingGroupCount, racerCount, checkedInCount, roundCount, awardCount, isLocked } = progress;
    const { groupsLower, vehiclesLower } = words;

    return [
        {
            key: 'racingGroups',
            label: `Set up ${groupsLower}`,
            hint: `Group racers into ${groupsLower} so they can be scored and awarded separately.`,
            done: racingGroupCount > 0 || racerCount > 0,
            action: `Set up ${groupsLower}`,
        },
        {
            key: 'racers',
            label: 'Add racers',
            hint: 'Enter them by hand, or import a spreadsheet you already have.',
            done: racerCount > 0,
            action: 'Add your first racer',
        },
        {
            key: 'checkin',
            label: `Check in ${vehiclesLower}`,
            hint:
                racerCount > 0
                    ? `${checkedInCount} of ${racerCount} checked in. Only checked-in ${vehiclesLower} are put into heats.`
                    : `Only checked-in ${vehiclesLower} are put into heats.`,
            done: checkedInCount > 0,
            // This step is only ever "next" while nobody at all is checked in
            // (`done` flips the moment one racer is), so "select" always
            // means the whole roster — there is nobody already checked in to
            // leave out. The button selects everyone and reveals the
            // roster's own bulk Check In control (#849) rather than opening
            // a per-racer dialog, since a den that has just arrived together
            // is the case this step exists for.
            action: `Select ${vehiclesLower} to check in`,
        },
        {
            key: 'schedule',
            label: 'Generate a schedule',
            hint: 'Race Control builds the heats and runs them.',
            done: roundCount > 0,
            action: 'Go to Race Control',
        },
        {
            key: 'awards',
            label: 'Set up awards',
            hint: 'Judged awards want photos and voting opened well before racing ends — do not leave this for the ceremony.',
            // A pack that hands out no trophies is a decision, and locking
            // the race (#585) is how that decision reaches this checklist —
            // the same shape the racingGroups step uses for a pack that
            // never creates one: satisfied by the thing itself, or by
            // whatever later fact means asking again would only argue with
            // a choice already made.
            done: awardCount > 0 || isLocked,
            action: 'Set up awards',
        },
        {
            key: 'printables',
            label: 'Print pit passes',
            hint: 'Pit passes and check-in codes are usually printed the night before check-in opens.',
            // There is no stored fact for "a sheet came out of a printer" —
            // printing is HTML the browser renders, never a server round
            // trip (see the Printables docs) — so this cannot be satisfied
            // the way the other five are, by something the database holds.
            // The nearest honest signal is the same one the checkin step
            // above uses: once check-in is under way, whatever printing was
            // going to help already has, so asking again offers nothing.
            done: checkedInCount > 0 || isLocked,
            action: 'Go to Printables',
        },
    ];
}

/**
 * Whether to show the checklist at all.
 *
 * It disappears on its own once every step is behind us, which is why there is
 * no dismiss control: every state in which it appears is a state where
 * something genuinely has not been done yet. A locked race has all six —
 * locking is itself what quiets awards and printables, above — so revisiting
 * an old race does not get lectured.
 */
export function shouldShowChecklist(steps: readonly ChecklistStep[]): boolean {
    return steps.some((step) => !step.done);
}

/** The first thing still outstanding — the one worth pointing at. */
export function nextStep(steps: readonly ChecklistStep[]): ChecklistStep | null {
    return steps.find((step) => !step.done) ?? null;
}

/**
 * Whether the checklist should default to its one-line form (#949).
 *
 * The desk works a queue on race morning, on a tablet — the checklist's
 * expanded six rows (~230px) sit above the roster table for as long as the
 * last two steps stay outstanding, and they usually do: **Set up awards**
 * and **Print pit passes** are the two steps `checklistFor` above can only
 * quiet with a *lock*, which does not happen until the event is over.
 *
 * The trigger is `checkedInCount > 0`, not "the first four steps are
 * done". The two read the same on the tidy path — racingGroups and racers
 * are already behind a checked-in racer, since check-in needs a roster —
 * but they diverge on `schedule`: plenty of packs start checking cars in
 * before a round exists, admitting late arrivals into the schedule as they
 * come rather than scheduling first and checking in second (see
 * `domain/latecomers.py`). Requiring `schedule` too would leave the
 * checklist expanded through exactly the queue this collapses it for.
 * `checkedInCount` is also a number `setupProgress` already carries, so
 * there is nothing new to compute it from.
 */
export function shouldCollapseChecklist(progress: SetupProgress): boolean {
    return progress.checkedInCount > 0;
}

/** The steps still outstanding, in order — what a collapsed line names. */
export function outstandingSteps(steps: readonly ChecklistStep[]): ChecklistStep[] {
    return steps.filter((step) => !step.done);
}
