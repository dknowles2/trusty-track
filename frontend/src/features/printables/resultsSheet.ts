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
import { roundTitle, type SheetRound } from './heatSheet';

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
    /**
     * A shared competition rank (1, 1, 3), never renumbered to hide a tie
     * (#883, mirroring #226's rule for the screen). On the overall table
     * this is `entry.rank` as `standings_ranks` stamped it, unchanged; on a
     * racingGroup table it is that same tie structure re-based to start at 1
     * within the group — a *different* question from collapsing a tie, and
     * `rowsFrom`'s own comment is what to read before touching either.
     */
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

/**
 * Re-based competition ranks for a *subset* of the standings (#883).
 *
 * `entries` is assumed already sorted the way the standings are (ascending
 * rank), which is what `resultsSections` hands it. Two entries carrying the
 * same `rank` in the pack scope are tied by definition — a score is a
 * numeric equality, invariant to which subset of racers you look at it
 * through — so re-basing preserves every tie in the pack's own rank column
 * while starting the *numbering* at 1 for this table. An entry that has not
 * raced keeps a strictly increasing pack rank (`domain.scoring.
 * standings_ranks`'s own rule, so unraced entries never falsely tie here
 * either), which this rides on rather than re-deriving.
 */
function rebasedPlaces(entries: readonly ResultsEntry[]): number[] {
    const places: number[] = [];
    entries.forEach((entry, index) => {
        places.push(index > 0 && entry.rank === entries[index - 1].rank ? places[index - 1] : index + 1);
    });
    return places;
}

function rowsFrom(
    entries: readonly ResultsEntry[],
    scoringStrategy: string,
    noGroupLabel: string,
    nameDisplay: NameDisplay | string,
    /**
     * Overall table: print the pack rank exactly as the screen shows it,
     * ties and all. RacingGroup table: re-base to 1 within the group, but
     * still collapse ties — different question from *whether* to collapse
     * them (#883). See `ResultRow.place`.
     */
    rebase: boolean,
): ResultRow[] {
    const places = rebase ? rebasedPlaces(entries) : entries.map((entry) => entry.rank);
    return entries.map((entry, index) => ({
        racerId: entry.racerId,
        place: places[index],
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
        { title: OVERALL, rows: rowsFrom(standings, scoringStrategy, noGroupLabel, nameDisplay, false) },
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
                rows: rowsFrom(entries, scoringStrategy, noGroupLabel, nameDisplay, true),
            });
        }
    }

    return sections;
}

/**
 * One championship round's own leaderboard entries, matched to that round
 * (#869) — the input `championshipSections` needs, since a championship
 * round's placings come off a *separate*, round-scoped query
 * (`championshipResultsQuery` in `graphql/queries.ts`) rather than the
 * prelim-scoped `standings` `resultsSections` reads.
 */
export interface ChampionshipRoundResult {
    round: SheetRound;
    entries: readonly ResultsEntry[];
}

/**
 * A table per championship round that has actually been raced (#869).
 *
 * Standings cover preliminary rounds only (#17) — a championship field is
 * *drawn from* them, so folding its own result back in is circular — which
 * is exactly why the results sheet used to leave the final out entirely:
 * `resultsSections` never sees it. This is the missing half, kept separate
 * on purpose rather than taught to `resultsSections`, since a championship
 * round's placings come from `leaderboard(roundId:)`, a different query
 * scope than the aggregate standings.
 *
 * **Nobody's raced yet is nobody's business here.** A round exists, and
 * carries placeholder entries, from the moment the wizard creates it —
 * printing it before a single heat has run would put blank names and zero
 * scores on the noticeboard, so a round with no entry showing at least one
 * completed heat is left out.
 *
 * **The round's own rank is printed exactly, with no re-basing.**
 * `leaderboard(roundId:)` already scopes `standings_ranks` to this round
 * alone (#226), so — unlike a racingGroup table, which narrows the
 * pack-wide standings and so must re-derive its own tie structure — there
 * is nothing to re-base here.
 */
export function championshipSections(
    rounds: readonly ChampionshipRoundResult[],
    scoringStrategy: string,
    /** How much of a racer's name this sheet prints (#552). Defaults to
     * `'FULL'`, today's only behaviour. */
    nameDisplay: NameDisplay | string = 'FULL',
): ResultsSection[] {
    return rounds
        .filter(({ entries }) => entries.some((entry) => entry.heatsCompleted > 0))
        .slice()
        .sort((a, b) => a.round.roundNumber - b.round.roundNumber)
        .map(({ round, entries }) => ({
            // A championship round's own table has no racingGroup column
            // (see `ResultsSheet.tsx`), so the fallback label is never
            // shown — passed through only because `rowsFrom` needs one.
            title: roundTitle(round),
            rows: rowsFrom(entries, scoringStrategy, '', nameDisplay, false),
        }));
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
