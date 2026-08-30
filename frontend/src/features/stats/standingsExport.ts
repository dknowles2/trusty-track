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
import { isTimeBasedStrategy } from '../racing/lanes';
import { methodPhrase } from './tiebreakText';
import { formatDisplayName, type NameDisplay } from '../core/displayName';

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
 * The number means different things under the four strategies (#547 stage 1)
 * and a column headed "Score" in a spreadsheet is unreadable a week later —
 * 4.2 is seconds, 4 is placement points, and nothing on the page says which
 * once it is a file. `CUMULATIVE_TIME` and `FASTEST_TIME` are both
 * time-based (`isTimeBasedStrategy`) but mean different things to an
 * operator — "total" and "best" are not "average" — so each gets its own
 * word here even though all three format the same way below.
 */
export function scoreHeading(scoringStrategy: string): string {
    switch (scoringStrategy) {
        case 'CUMULATIVE_TIME':
            return 'Total Time (s)';
        case 'FASTEST_TIME':
            return 'Best Time (s)';
        case 'TIMED':
            return 'Average Time (s)';
        default:
            return 'Points';
    }
}

/** A time keeps its milliseconds; points are whole numbers and should look
 * it. `isTimeBasedStrategy` is the one predicate for which is which — see
 * its own docstring on why it is not restated per site. */
export function scoreValue(score: number, scoringStrategy: string): string {
    return isTimeBasedStrategy(scoringStrategy) ? score.toFixed(3) : String(score);
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
    /** The singular vehicle word for the number column header, defaulting to
     * the built-in Scouting one, `DEFAULT_TERMINOLOGY.vehicleSingular`
     * (#551). */
    vehicleWord = 'Car',
    /** How much of a racer's name this export carries (#552). Defaults to
     * `'FULL'`, today's only behaviour — and under `'FULL'` the sheet is
     * byte-identical to what it always was: separate "First Name"/"Last
     * Name" columns. A resolved abbreviation collapses those into a single
     * "Name" column instead, rather than shortening the values within the
     * same two columns — a spreadsheet with a fixed First/Last shape that
     * sometimes carries a bare initial in the Last Name column would look
     * like corrupted data, where a differently-shaped sheet is an honest
     * export of what the operator asked this setting to do. */
    nameDisplay: NameDisplay | string = 'FULL',
): CsvRow[] {
    const nameColumns: CsvRow =
        nameDisplay === 'FULL' ? ['First Name', 'Last Name'] : ['Name'];
    const header: CsvRow = [
        'Rank',
        `${vehicleWord} #`,
        ...nameColumns,
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
        ...standings.map((entry) => {
            const nameCells: CsvRow =
                nameDisplay === 'FULL'
                    ? [entry.firstName, entry.lastName]
                    : [formatDisplayName(nameDisplay, entry.firstName, entry.lastName)];
            return [
                entry.rank,
                entry.carNumber,
                ...nameCells,
                entry.racingGroupName,
                scoreValue(entry.score, scoringStrategy),
                entry.heatsCompleted,
                tieBrokenByValue(entry.resolvedBy),
            ];
        }),
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
