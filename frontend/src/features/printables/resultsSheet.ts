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

export interface ResultsEntry {
    racerId: number;
    rank: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    denName?: string | null;
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
    /** Place within *this* section, which is not the pack rank in a den table. */
    place: number;
    name: string;
    carNumber: string;
    denName: string;
    score: string;
    heats: number;
}

export interface ResultsSection {
    /** `PACK` for the overall table, or the den's name. */
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

/** A racer with no den still belongs in the overall table. */
export const NO_DEN = 'No den';

export const OVERALL = 'Overall standings';

function nameOf(entry: { firstName: string; lastName: string }): string {
    return `${entry.firstName} ${entry.lastName}`.trim();
}

function rowsFrom(
    entries: readonly ResultsEntry[],
    scoringStrategy: string,
): ResultRow[] {
    return entries.map((entry, index) => ({
        racerId: entry.racerId,
        // Numbered from 1 within the section rather than carrying the pack
        // rank across. A den table headed 4, 9, 17 is a table of pack ranks,
        // and the person reading it wants to know who won the den.
        place: index + 1,
        name: nameOf(entry),
        carNumber: entry.carNumber == null ? '' : String(entry.carNumber),
        denName: entry.denName || NO_DEN,
        score: scoreValue(entry.score, scoringStrategy),
        heats: entry.heatsCompleted,
    }));
}

/**
 * The overall table and one per den.
 *
 * **A den's table is the pack standings narrowed, not a separate scoring
 * pass.** That is the same rule a den-scoped award follows — "fastest Wolf" is
 * the pack standings with everybody else removed — so the sheet and the
 * trophies cannot disagree about who won a den.
 *
 * Dens appear in the order their fastest racer does, which puts the winning
 * den first. Alphabetical would be arbitrary here; the sheet is about results.
 */
export function resultsSections(
    standings: readonly ResultsEntry[],
    scoringStrategy: string,
): ResultsSection[] {
    if (standings.length === 0) return [];

    const sections: ResultsSection[] = [
        { title: OVERALL, rows: rowsFrom(standings, scoringStrategy) },
    ];

    const byDen = new Map<string, ResultsEntry[]>();
    for (const entry of standings) {
        // Racers in no den are deliberately left out of the per-den tables
        // rather than gathered into one: "No den" is not a den anybody wins,
        // and they are already in the overall table above.
        if (!entry.denName) continue;
        const existing = byDen.get(entry.denName);
        if (existing) existing.push(entry);
        else byDen.set(entry.denName, [entry]);
    }

    // A single den is the whole pack, so its table would repeat the one above.
    if (byDen.size > 1) {
        for (const [denName, entries] of byDen) {
            sections.push({ title: denName, rows: rowsFrom(entries, scoringStrategy) });
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
export function awardLines(awards: readonly ResultsAward[]): AwardLine[] {
    return [...awards]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
        .map((award) => ({
            id: award.id,
            name: award.name,
            winner: award.recipient
                ? `${nameOf(award.recipient)}${
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
