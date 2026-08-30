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
import { methodPhrase } from './tiebreakText';

export interface StandingsEntry {
    rank: number;
    carNumber: number | null;
    firstName: string;
    lastName: string;
    racingGroupName: string;
    score: number;
    heatsCompleted: number;
    /** How a shared score was broken, or null/undefined if it was never tied
     * or the tie did not resolve (#540). */
    resolvedBy?: string | null;
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

/**
 * The "Tie Broken By" cell for one row (#540) — capitalised, since a
 * spreadsheet is read on its own with no page around it to say the word is
 * an option label rather than a sentence fragment. Empty for a row that was
 * never tied, or was tied and the chain left it that way — the same
 * "nothing to say" the standings page itself shows.
 */
export function tieBrokenByValue(resolvedBy: string | null | undefined): string {
    const phrase = methodPhrase(resolvedBy ?? '');
    if (!phrase) return '';
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function standingsRows(
    standings: readonly StandingsEntry[],
    scoringStrategy: string,
    /** The singular racing-group word for the column header, defaulting to
     * the built-in Scouting one, `DEFAULT_TERMINOLOGY.racingGroupSingular`
     * (#496 stage 4). */
    groupWord = 'Den',
): CsvRow[] {
    const header: CsvRow = [
        'Rank',
        'Car #',
        'First Name',
        'Last Name',
        groupWord,
        scoreHeading(scoringStrategy),
        'Heats',
        // A blank column reads as "not tied" the same way it does on the
        // standings page itself — no separate "no" to type for every row
        // that was never in question (#540).
        'Tie Broken By',
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
            tieBrokenByValue(entry.resolvedBy),
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
