/**
 * How many heats a growing round (Balanced or Elimination) will end up
 * running, before the racing decides it for real (#1022).
 *
 * `pace.ts`'s `estimatePace` learns *how long* a heat takes; this answers
 * a different question the schedule and Race Control screens both ask —
 * *how many* heats are left — which for a growing round is not simply
 * "the pending rows", because a growing round has no pending heats at all
 * until the recorded-result cascade appends the next wave or phase
 * (`.claude/rules/scheduling.md`'s "Balanced racing" / "Ladderless
 * elimination"). Reading the row count there answers "how many heats exist
 * right now", not "how many will this round need" — a 7-car, 2-loss
 * elimination round shows 2 heats before racing starts and can end up
 * running 6, and a screen that estimates from the 2 undersells the evening
 * by two-thirds.
 *
 * Pure, no React and no GraphQL — a caller supplies the round's own
 * scheduling fields (already on the `Round` GraphQL type) plus the racer
 * and lane counts it has to hand.
 */

export interface GrowingRoundShape {
    schedulingStrategy: string;
    /** Ladderless elimination only — how many losses knock a car out. */
    eliminationLosses: number | null;
    /** Balanced racing only — how many phases the round runs. */
    balancedPhases: number | null;
}

/**
 * The expected heat count for a round of this shape, or `null` when there
 * is nothing to estimate beyond the schedule itself.
 *
 * `PPC` ("Everyone races in every lane") always returns `null` — its whole
 * schedule is built up front, so the rows *are* the truth and an estimate
 * would only be a second, potentially disagreeing answer next to the first.
 *
 * `racerCount` is the number of racers this round actually fields — the
 * distinct real racer ids the round's own heats have already scheduled is
 * the caller's best source for this (every eligible racer appears in the
 * round's first wave or phase), not a fresh count of the whole roster,
 * since a general round can be scoped to one racing group.
 *
 * `BALANCED`'s answer is exact; `ELIMINATION`'s is an estimate that can
 * fall short once heats stop running full — see `eliminationHeatCountEstimate`
 * for why, and word it "at least" rather than "up to" for that reason.
 */
export function expectedHeatCount(
    round: GrowingRoundShape,
    racerCount: number,
    laneCount: number
): number | null {
    if (racerCount < 2 || laneCount < 2) return null;

    if (round.schedulingStrategy === 'BALANCED') {
        return balancedHeatCount(racerCount, laneCount, round.balancedPhases);
    }
    if (round.schedulingStrategy === 'ELIMINATION') {
        return eliminationHeatCountEstimate(
            racerCount,
            laneCount,
            round.eliminationLosses
        );
    }
    return null;
}

/**
 * Balanced racing runs a fixed number of phases (default: the track's own
 * lane count, GPRM's own advice — matching `crud.extend_balanced_round`'s
 * `target = round_obj.balanced_phases or len(usable) or 1`), and every
 * phase fields every racer once, chunked to at most `laneCount` per heat
 * (`domain/balanced.next_phase`, `chunk_heats`) — so each phase is exactly
 * `ceil(racerCount / laneCount)` heats. This is exact, not an estimate:
 * nobody is added or removed mid-round the way elimination's field shrinks.
 */
function balancedHeatCount(
    racerCount: number,
    laneCount: number,
    balancedPhases: number | null
): number {
    const phases = balancedPhases ?? laneCount;
    return phases * Math.ceil(racerCount / laneCount);
}

/**
 * An *estimate* of how many heats an elimination round will run — there is
 * no exact answer before the racing happens, since a wave's shape depends
 * on how many cars are still alive when it is drawn.
 *
 * Reasoned from the total number of losses the round will eventually hand
 * out, which *is* bounded exactly: every eliminated car is retired at
 * `losses`, never more, and there are `racerCount - 1` of them, so the
 * round hands out at most `racerCount * losses` losses in total (the
 * eventual winner's own tally only adds to that bound, never exceeds it).
 * Every *full* heat retires up to `laneCount - 1` losers at once — every
 * lane but the winner's (`domain/elimination.losses_by_racer`) — so
 * dividing the total by that count is the fewest heats a fully-laned field
 * could possibly need to hand out that many losses, which is what this
 * function returns.
 *
 * It only matches the real total when every heat happens to run full,
 * which `chunk_heats` cannot promise once the field has thinned to fewer
 * than `laneCount` cars still alive — a wave that size runs smaller heats,
 * each retiring fewer losers, so the round can need more of them than this
 * predicts. Simulating the real `domain/elimination` wave logic across a
 * wide spread of racer counts, lane counts and loss thresholds
 * (`growingRounds.test.ts`) shows the gap is real but modest — typically
 * within 10-20% once `laneCount > 2` — and it disappears entirely at
 * `laneCount == 2`, where every heat is a pair by construction and this
 * value is a genuine ceiling that is never exceeded. Callers word this
 * "at least ~N heats" rather than "up to": undercounting a schedule that
 * is about to grow again is worse than a number that occasionally reads a
 * little conservative, and single-loss formats on a wide track can in
 * fact finish a little under this estimate, which "at least" still covers
 * honestly (the round is done when it is done, whatever this said).
 */
function eliminationHeatCountEstimate(
    racerCount: number,
    laneCount: number,
    eliminationLosses: number | null
): number {
    const losses = eliminationLosses ?? 1;
    const lossesPerFullHeat = Math.max(laneCount - 1, 1);
    return Math.ceil((racerCount * losses) / lossesPerFullHeat);
}
