/**
 * Telling the audience display the race is over (#869).
 *
 * `Observation.tsx`'s Now Racing / On Deck panels used to fall back to "No
 * heat scheduled" in two different situations that look identical to a
 * reader but mean opposite things: racing has not started yet, and racing
 * has finished. The screen "simply stops" in the second case, with no result
 * announced and no sign that anybody should stop watching — this decides
 * which situation it is, purely, so the component can swap in a proper
 * ending rather than the same placeholder either way.
 */

export interface FinishedHeat {
    /** Same field #59 already uses to say a heat has a result — `null` for
     * one still pending. */
    recordedAt?: string | null;
}

/**
 * Every officially scheduled heat has a recorded result, at least one
 * exists, and nothing is currently on the track, on deck, or armed as an
 * exhibition run.
 *
 * Deliberately not "the whole event is decided" — a race between rounds,
 * waiting on the operator to generate the next one, looks the same as a
 * genuinely finished one by this measure, and that is fine: a "here is how
 * things stand" panel is a strict improvement over "No heat scheduled" in
 * that gap too, and it is superseded the moment a new heat is scheduled and
 * `hasCurrentHeat`/`hasOnDeckHeat` go true again.
 */
export function raceIsFinished(
    heats: readonly FinishedHeat[],
    hasCurrentHeat: boolean,
    hasOnDeckHeat: boolean,
    hasActiveFreeRace: boolean,
): boolean {
    if (hasCurrentHeat || hasOnDeckHeat || hasActiveFreeRace) return false;
    if (heats.length === 0) return false;
    return heats.every((heat) => heat.recordedAt != null);
}

export interface FinishedRound {
    id: number;
    roundNumber: number;
    advancementSource?: string | null;
}

/**
 * The championship round whose placings should headline the "race
 * finished" panel — the *last* one by round number, so a chained final
 * (#549's wizard wires each round after the first to `ROUND:<previous>`)
 * shows the room the result it actually cares about rather than an
 * intermediate semifinal's. `null` when the race ran no championship round
 * at all, which is when the panel falls back to the overall standings.
 */
export function finalChampionshipRound<T extends FinishedRound>(rounds: readonly T[]): T | null {
    const championships = rounds.filter((round) => round.advancementSource != null);
    if (championships.length === 0) return null;
    return championships.reduce((latest, round) => (round.roundNumber > latest.roundNumber ? round : latest));
}
