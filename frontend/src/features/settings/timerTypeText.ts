/**
 * Saying a track's `timerType` out loud (#942).
 *
 * `Track.timerType` crosses the GraphQL boundary as a plain string —
 * `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY` — which is exactly the wrong
 * thing to put in front of an operator. `TrackCard.tsx`'s Timer Type
 * `<select>` is the one place these were previously spelled out in words;
 * `TIMER_TYPE_LABELS` is that same wording, moved here so the activity log
 * (`activityLog.ts`'s `describeValue`) can read it too rather than growing a
 * second copy of the same four strings.
 */

export const TIMER_TYPE_LABELS: Readonly<Record<string, string>> = {
    FAKE: 'Fake Timer (Manual Control)',
    AUTO_DETECT_BACKEND: 'Plugged into this machine',
    AUTO_DETECT_PROXY: 'Plugged into the laptop running the browser',
    NONE: "No timer — I'll enter results by hand",
};

/** A short, human name for a timer type. Falls back to the raw string for a
 * value this module does not recognise, the same "print something rather
 * than throw" rule `strategyLabel` follows. */
export function timerTypeLabel(timerType: string | null | undefined): string {
    return (timerType && TIMER_TYPE_LABELS[timerType]) || timerType || '-';
}
