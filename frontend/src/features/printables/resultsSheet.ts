/**
 * The results, on paper, once the racing is over (#206).
 *
 * The heat sheet is the *pre*-race document — its Result column is blank on
 * purpose, for the moment the network drops. There was nothing to print
 * afterwards, so a pack secretary writing the newsletter or pinning the
 * placings to a noticeboard transcribed them off a screen.
 *
 * A table document like the heat sheet rather than a `DocumentSpec`: pit
 * passes and licences are one card repeated to a grid, and this is one
 * document with sections.
 *
 * Pure. What goes in a section, and which awards are worth printing, are
 * decisions with edge cases; the page only renders what this returns.
 */

import { scoreValue } from '../stats/standingsExport';
import { formatDisplayName, type NameDisplay } from '../core/displayName';

export interface ResultsEntry {
    racerId: number;
    rank: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    racingGroupName?: string | null;
    score: number;
    heatsCompleted: number;
}

export interface ResultsAward {
    id: number;
    name: string;
    kind: string;
    sortOrder?: number | null;
    recipient?: {
        firstName: string;
        lastName: string;
        carNumber?: number | null;
    } | null;
}

export interface ResultRow {
    racerId: number;
    /** Place within *this* section, which is not the pack rank in a racingGroup table. */
    place: number;
    name: string;
    carNumber: string;
    racingGroupName: string;
    score: string;
    heats: number;
}

export interface ResultsSection {
    /** `PACK` for the overall table, or the racingGroup's name. */
    title: string;
    rows: ResultRow[];
}

export interface AwardLine {
    id: number;
    name: string;
    /** The winner, or the standing phrase for one nobody has decided. */
    winner: string;
}

/** What an award with no recipient says. */
export const UNDECIDED = 'Not awarded';

/** A racer with no racing group still belongs in the overall table — the
 * built-in Scouting word, `DEFAULT_TERMINOLOGY.racingGroupSingular` lowercase
 * (#496 stage 4). `resultsSections` takes the resolved word and falls back to
 * this only when none is given. */
export const NO_DEN = 'No den';

export const OVERALL = 'Overall standings';

function nameOf(
    entry: { firstName: string; lastName: string },
    nameDisplay: NameDisplay | string = 'FULL',
): string {
    return formatDisplayName(nameDisplay, entry.firstName, entry.lastName);
}

function rowsFrom(
    entries: readonly ResultsEntry[],
    scoringStrategy: string,
    noGroupLabel: string,
    nameDisplay: NameDisplay | string,
): ResultRow[] {
    return entries.map((entry, index) => ({
        racerId: entry.racerId,
        // Numbered from 1 within the section rather than carrying the pack
        // rank across. A racingGroup table headed 4, 9, 17 is a table of pack ranks,
        // and the person reading it wants to know who won the racingGroup.
        place: index + 1,
        name: nameOf(entry, nameDisplay),
        carNumber: entry.carNumber == null ? '' : String(entry.carNumber),
        racingGroupName: entry.racingGroupName || noGroupLabel,
        score: scoreValue(entry.score, scoringStrategy),
        heats: entry.heatsCompleted,
    }));
}

/**
 * The overall table and one per racingGroup.
 *
 * **A racingGroup's table is the pack standings narrowed, not a separate scoring
 * pass.** That is the same rule a racing-group-scoped award follows — "fastest Wolf" is
 * the pack standings with everybody else removed — so the sheet and the
 * trophies cannot disagree about who won a racingGroup.
 *
 * Racing groups appear in the order their fastest racer does, which puts the winning
 * racingGroup first. Alphabetical would be arbitrary here; the sheet is about results.
 */
export function resultsSections(
    standings: readonly ResultsEntry[],
    scoringStrategy: string,
    /** The "no racing group" fallback, resolved from `useTerminology()`.
     * Defaults to the built-in Scouting word (#496 stage 4). */
    noGroupLabel: string = NO_DEN,
    /** How much of a racer's name this sheet prints (#552). Defaults to
     * `'FULL'`, today's only behaviour. */
    nameDisplay: NameDisplay | string = 'FULL',
): ResultsSection[] {
    if (standings.length === 0) return [];

    const sections: ResultsSection[] = [
        { title: OVERALL, rows: rowsFrom(standings, scoringStrategy, noGroupLabel, nameDisplay) },
    ];

    const byRacingGroup = new Map<string, ResultsEntry[]>();
    for (const entry of standings) {
        // Racers in no racingGroup are deliberately left out of the per-racing-group tables
        // rather than gathered into one: "No racingGroup" is not a racingGroup anybody wins,
        // and they are already in the overall table above.
        if (!entry.racingGroupName) continue;
        const existing = byRacingGroup.get(entry.racingGroupName);
        if (existing) existing.push(entry);
        else byRacingGroup.set(entry.racingGroupName, [entry]);
    }

    // A single racingGroup is the whole pack, so its table would repeat the one above.
    if (byRacingGroup.size > 1) {
        for (const [racingGroupName, entries] of byRacingGroup) {
            sections.push({
                title: racingGroupName,
                rows: rowsFrom(entries, scoringStrategy, noGroupLabel, nameDisplay),
            });
        }
    }

    return sections;
}

/**
 * The trophies, in the order the ceremony announces them.
 *
 * **An award nobody has decided is printed, not skipped.** The ceremony shows
 * one for the same reason — most are undecided right up until they are
 * announced — and on paper a missing line reads as an award that does not
 * exist, where "Not awarded" reads as one somebody still has to fill in.
 */
export function awardLines(
    awards: readonly ResultsAward[],
    /** How much of a winner's name this sheet prints (#552). Defaults to
     * `'FULL'`, today's only behaviour. */
    nameDisplay: NameDisplay | string = 'FULL',
): AwardLine[] {
    return [...awards]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
        .map((award) => ({
            id: award.id,
            name: award.name,
            winner: award.recipient
                ? `${nameOf(award.recipient, nameDisplay)}${
                      award.recipient.carNumber == null ? '' : ` (#${award.recipient.carNumber})`
                  }`
                : UNDECIDED,
        }));
}

/** Whether there is anything at all to print. */
export function hasResults(
    sections: readonly ResultsSection[],
    awards: readonly AwardLine[],
): boolean {
    return sections.length > 0 || awards.length > 0;
}
