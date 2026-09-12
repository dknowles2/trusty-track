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
 * `BALANCED`'s answer is exact — word it plainly ("N heats"/"~X mins"),
 * never "at least". `ELIMINATION`'s is a genuine floor that can still run
 * long — see `eliminationHeatCountEstimate` for why, and word *that one*
 * "at least" rather than "up to".
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
 * A genuine *floor* on how many heats an elimination round will run — there
 * is no exact answer before the racing happens, since a wave's shape
 * depends on how many cars are still alive when it is drawn, but this
 * number is never exceeded by the real schedule, on either side of a call.
 *
 * Reasoned from the *least* total losses the round could possibly hand out
 * before deciding, which is a real lower bound rather than a guess:
 * exactly `racerCount - 1` cars must be eliminated (everyone but the
 * champion), each retired at precisely `losses` — never more, since a
 * car leaves the instant it reaches the threshold — and the champion's own
 * tally can be as low as zero (a car that never loses a single heat is a
 * legitimate outcome). So the round hands out **at least**
 * `(racerCount - 1) * losses` losses no matter how it actually plays out.
 * Using `racerCount * losses` here — the champion's own count *included*
 * — was the earlier, wrong version of this reasoning: it bounds the total
 * from *above*, not below, and a bound on the wrong side of the total can
 * round a whole extra heat past what the real minimum could ever need,
 * which is exactly how it stopped being a floor (`4` racers, `4` lanes,
 * `1` loss gave an estimate of `2` when the real minimum is `1` — a single
 * four-way heat retires all three non-champions in one heat and decides
 * the round on the spot).
 *
 * Every *full* heat retires up to `laneCount - 1` losers at once — every
 * lane but the winner's (`domain/elimination.losses_by_racer`) — so
 * dividing the minimum total by that count is the fewest heats a
 * fully-laned field could possibly need to reach it, which is what this
 * function returns. Because the numerator is now the least the round
 * could ever hand out rather than an upper estimate of it, and the
 * denominator is the most any single heat could ever retire, no
 * combination of real outcomes can need fewer heats than this — confirmed
 * by simulating the real `domain/elimination` wave logic against the
 * adversarial case that minimises the heat count (the eventual champion
 * winning every heat it is ever in, so it never contributes a loss) across
 * a wide sweep of racer counts, lane counts and loss thresholds
 * (`growingRounds.test.ts`), with zero counter-examples.
 *
 * The real round usually still runs a few heats *past* this floor, for a
 * different reason than the one the floor itself protects against: once
 * the field has thinned to fewer than `laneCount` cars still alive,
 * `chunk_heats` cannot fill every heat, so a late heat retires fewer than
 * `laneCount - 1` losers and the round needs more of them to reach the
 * same total — and in practice the actual champion usually does take a
 * loss or two along the way, which raises the real total above this
 * floor's own minimum. Both are genuine reasons the schedule commonly
 * needs more heats than this predicts, never fewer — which is why callers
 * word this "at least ~N heats" rather than "up to" or a bare figure.
 */
function eliminationHeatCountEstimate(
    racerCount: number,
    laneCount: number,
    eliminationLosses: number | null
): number {
    const losses = eliminationLosses ?? 1;
    const lossesPerFullHeat = Math.max(laneCount - 1, 1);
    return Math.ceil(((racerCount - 1) * losses) / lossesPerFullHeat);
}
