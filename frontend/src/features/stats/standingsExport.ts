/**
 * The standings, as rows somebody can take away (#173).
 *
 * `RaceStats` has exported heat results and per-racer statistics since stats
 * were built; the Standings page exported nothing, so a pack secretary writing
 * the newsletter transcribed the placings by hand.
 *
 * Pure, and separate from the component, because what belongs in the file is a
 * decision rather than a rendering: the score column is named for the scoring
 * strategy, and which standings were exported has to travel with them.
 */

import type { CsvRow } from '../../utils/csv';

export interface StandingsEntry {
    rank: number;
    carNumber: number | null;
    firstName: string;
    lastName: string;
    racingGroupName: string;
    score: number;
    heatsCompleted: number;
}

/**
 * What the score column is called.
 *
 * The number means different things under the two strategies and a column
 * headed "Score" in a spreadsheet is unreadable a week later — 4.2 is seconds,
 * 4 is placement points, and nothing on the page says which once it is a file.
 */
export function scoreHeading(scoringStrategy: string): string {
    return scoringStrategy === 'TIMED' ? 'Average Time (s)' : 'Points';
}

/** A time keeps its milliseconds; points are whole numbers and should look it. */
export function scoreValue(score: number, scoringStrategy: string): string {
    return scoringStrategy === 'TIMED' ? score.toFixed(3) : String(score);
}

export function standingsRows(
    standings: readonly StandingsEntry[],
    scoringStrategy: string,
    /** The singular racing-group word for the column header, defaulting to
     * the built-in Scouting one, `DEFAULT_TERMINOLOGY.racingGroupSingular`
     * (#496 stage 4). */
    groupWord = 'Den',
    /** The singular vehicle word for the number column header, defaulting to
     * the built-in Scouting one, `DEFAULT_TERMINOLOGY.vehicleSingular`
     * (#551). */
    vehicleWord = 'Car',
): CsvRow[] {
    const header: CsvRow = [
        'Rank',
        `${vehicleWord} #`,
        'First Name',
        'Last Name',
        groupWord,
        scoreHeading(scoringStrategy),
        'Heats',
    ];
    return [
        header,
        ...standings.map((entry) => [
            entry.rank,
            entry.carNumber,
            entry.firstName,
            entry.lastName,
            entry.racingGroupName,
            scoreValue(entry.score, scoringStrategy),
            entry.heatsCompleted,
        ]),
    ];
}

/**
 * The suffix naming which standings these are.
 *
 * A file called `standings` is ambiguous the moment a race has a final: the
 * overall standings and the championship's are both standings, and they
 * disagree on purpose (#17). The round's own name is what the operator picked
 * it by on screen.
 */
export function standingsSuffix(roundName: string | null): string {
    if (!roundName) return 'standings';
    const slug = roundName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return slug ? `standings-${slug}` : 'standings';
}
