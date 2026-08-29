/**
 * What a new operator has to do next (#199).
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
 */

export interface SetupProgress {
    racingGroupCount: number;
    racerCount: number;
    checkedInCount: number;
    roundCount: number;
}

export type StepKey = 'racingGroups' | 'racers' | 'checkin' | 'schedule';

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
 * The four steps, and whether each is behind us.
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
export function checklistFor(progress: SetupProgress): ChecklistStep[] {
    const { racingGroupCount, racerCount, checkedInCount, roundCount } = progress;

    return [
        {
            key: 'racingGroups',
            label: 'Set up racing groups',
            hint: 'Group racers into racing groups so they can be scored and awarded separately.',
            done: racingGroupCount > 0 || racerCount > 0,
            action: 'Set up racing groups',
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
            label: 'Check in cars',
            hint:
                racerCount > 0
                    ? `${checkedInCount} of ${racerCount} checked in. Only checked-in cars are put into heats.`
                    : 'Only checked-in cars are put into heats.',
            done: checkedInCount > 0,
            action: null,
        },
        {
            key: 'schedule',
            label: 'Generate a schedule',
            hint: 'Race Control builds the heats and runs them.',
            done: roundCount > 0,
            action: 'Go to Race Control',
        },
    ];
}

/**
 * Whether to show the checklist at all.
 *
 * It disappears on its own once every step is behind us, which is why there is
 * no dismiss control: every state in which it appears is a state where
 * something genuinely has not been done yet. A race that is over has all four,
 * so revisiting an old race does not get lectured.
 */
export function shouldShowChecklist(steps: readonly ChecklistStep[]): boolean {
    return steps.some((step) => !step.done);
}

/** The first thing still outstanding — the one worth pointing at. */
export function nextStep(steps: readonly ChecklistStep[]): ChecklistStep | null {
    return steps.find((step) => !step.done) ?? null;
}
