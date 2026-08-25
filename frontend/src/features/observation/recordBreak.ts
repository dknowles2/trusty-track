/**
 * The sentence the room hears when the track record falls.
 *
 * Pure, like the other display rules: the projector overlay and the timing
 * view both announce the same break, and two screens composing their own
 * sentences is how they end up disagreeing in front of an audience.
 */

export interface RecordBreak {
    newSeconds: number;
    newHolder: string;
    previousSeconds: number;
    previousHolder: string;
    previousRaceName: string | null;
}

/** "2.874s by Alice — beats 2.891s set by Jimmy Legend (Derby 2019)" */
export function recordBreakDetail(rb: RecordBreak): string {
    const previous = `${rb.previousSeconds.toFixed(3)}s set by ${rb.previousHolder}`;
    const where = rb.previousRaceName ? ` (${rb.previousRaceName})` : '';
    return `${rb.newSeconds.toFixed(3)}s by ${rb.newHolder} — beats ${previous}${where}`;
}
