/**
 * The running order, on paper (#173).
 *
 * This is the one artefact that has to survive the network going down or the
 * operator's laptop going flat: the announcer's table needs to know which cars
 * are in which lane next, and a screen is not a plan for that.
 *
 * A table rather than a grid of cards, which is why it is not a `DocumentSpec`
 * — pit passes and licences are a card repeated, and this is one document per
 * round with a row per heat. The sheet-first convention still holds: nobody
 * prints one heat.
 *
 * Pure. What goes in a cell is a decision with three cases and they are worth
 * testing without a browser.
 */

import { formatDisplayName, type NameDisplay } from '../core/displayName';
import { ordinal } from '../awards/awardText';
import { executionComparator, type OrderedHeat } from '../racing/runningOrder';

export interface SheetLane {
    lane: number;
    racerId?: number | null;
    placeholderSlot?: number | null;
}

export interface SheetHeat {
    id: number;
    heatNumber: number;
    roundId?: number | null;
    lanes: readonly SheetLane[];
}

export interface SheetRound {
    id: number;
    name?: string | null;
    roundNumber: number;
    advancementSource?: string | null;
}

export interface SheetRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
}

/**
 * A run-off heat (#550) — a `Heat` with no `roundId` of its own, held to
 * settle a tie. `settlesRoundId` names the round it is racing off for, or is
 * null when it settles the race's overall standings, mirroring `Heat.
 * settlesRoundId` / `RunOffHeat.settlesRoundId` on the GraphQL side exactly.
 * `placement` is `RunOffHeat.placement` / `Heat.runOffPlacement` — the
 * standings rank it is deciding, computed fresh on every read, or `null`
 * once the tie it was created for has moved (#550, rule 4).
 */
export interface SheetRunOffHeat {
    id: number;
    settlesRoundId?: number | null;
    placement?: number | null;
    lanes: readonly SheetLane[];
}

/** What one lane of one heat says on the paper. */
export interface Cell {
    lane: number;
    /** Car number, as text. Empty when there is nobody or nobody yet. */
    carNumber: string;
    /** Who, or why not. */
    name: string;
}

export interface HeatRow {
    heatId: number;
    heatNumber: number;
    cells: Cell[];
    /** Which round this row's heat belongs to, printed only on the flat
     * master-running-order section (#890) — a round's own per-round table
     * already says which round it is in the section heading, so every other
     * row leaves this unset. */
    roundLabel?: string;
}

export interface RoundSection {
    roundId: number;
    title: string;
    rows: HeatRow[];
}

/** An unadvanced championship slot: the round exists, its field does not yet. */
export const TO_BE_DECIDED = 'To be decided';
/** A lane nobody is in — an odd field, or a racer deleted after scheduling. */
export const EMPTY_LANE = '—';

/**
 * The flat section's title when the master running order is on (#890) —
 * mirroring `ScheduleManagement.tsx`'s own "Master running order" panel,
 * the operator screen's answer to the same problem: a block per round is
 * unreadable as a running order once heats interleave across rounds, so a
 * flat table sorted the same way goes first and the per-round tables stay
 * underneath as detail.
 */
export const MASTER_RUNNING_ORDER_TITLE = 'Master running order';

/** A run-off heat with no matched tie to announce (#550, rule 4) — the heat
 * still ran and still belongs on paper, just with nothing left to say about
 * what it decided. */
export const RUN_OFF_UNTITLED = 'Run-off';

export function roundTitle(round: SheetRound): string {
    if (round.name) return round.name;
    return round.advancementSource
        ? `Championship round ${round.roundNumber}`
        : `Round ${round.roundNumber}`;
}

/**
 * "Run-off for 2nd place" — or the plain fallback once the tie it was
 * created for has moved and `placement` reads `null` (#550, rule 4). Mirrors
 * `features/racing/runOff.ts`'s `runOffAnnouncement`, which says the same
 * thing in the present tense for a heat racing right now; this sheet is
 * printed either before or after the fact, so the tense is neutral instead.
 */
export function runOffTitle(placement: number | null | undefined): string {
    if (placement == null) return RUN_OFF_UNTITLED;
    return `Run-off for ${ordinal(placement)} place`;
}

/**
 * One lane's cell.
 *
 * The three cases are different on paper in a way they are not in the data.
 * A placeholder is a lane that *will* have somebody in it, so the announcer
 * should expect to write a name in; an empty lane is one that will stay empty
 * and should not be waited for. Rendering both as blank loses that.
 */
export function cellFor(
    lane: SheetLane,
    racers: ReadonlyMap<number, SheetRacer>,
    nameDisplay: NameDisplay | string = 'FULL',
): Cell {
    if (lane.racerId != null) {
        const racer = racers.get(lane.racerId);
        if (racer) {
            return {
                lane: lane.lane,
                carNumber: racer.carNumber == null ? '' : String(racer.carNumber),
                name: formatDisplayName(nameDisplay, racer.firstName, racer.lastName),
            };
        }
        // A lane naming a racer the roster does not have. `ON DELETE SET NULL`
        // makes this rare, but a stale page is enough to produce it and a
        // crashed print page the morning of a race is the worst outcome here.
        return { lane: lane.lane, carNumber: '', name: EMPTY_LANE };
    }
    if (lane.placeholderSlot != null) {
        return { lane: lane.lane, carNumber: '', name: TO_BE_DECIDED };
    }
    return { lane: lane.lane, carNumber: '', name: EMPTY_LANE };
}

/**
 * A round id no real round can hold (ids come from the database and are
 * always positive), used as a stable, unique key for a section that is not
 * one round's own table.
 */
const MASTER_RUNNING_ORDER_ROUND_ID = -1;

/**
 * The sheet: one section per round, in schedule order (round number, then
 * heat number within it) — the shape a *schedule* has, not necessarily the
 * order heats are actually run in once the master running order interleaves
 * them (see the flat section below).
 *
 * ``lanes`` is the track's lanes, not the heat's, so every row has the same
 * columns even when a lane is out of service (#171) or a racer was deleted out
 * of one. A table whose rows have different widths is unreadable, and the gap
 * is the point — that lane is empty and the announcer should know.
 *
 * A run-off heat (#550) has no round of its own, so it cannot join one of
 * these tables; it gets a one-row section immediately after the round it
 * settles, or — when it settles the race's overall standings — right after
 * the last general round and before the first championship one, since it
 * decides who is in a championship field before that field can run (#1018).
 * Titled with what it is racing off to decide (#890).
 *
 * With the master running order on (#549), a block per round stops being a
 * running order the moment heats interleave across rounds — the same reason
 * `ScheduleManagement.tsx`'s own panel exists — so a flat section sorted
 * with `runningOrder.ts`'s comparator, matching exactly what the Race tab
 * and the wall displays are executing, is prepended ahead of the per-round
 * tables. Championship rounds are exempt from the interleave and are left
 * out of it, the same rule `execution_sort_key` states on the backend.
 */
export function buildHeatSheet(
    rounds: readonly SheetRound[],
    heats: readonly SheetHeat[],
    racers: readonly SheetRacer[],
    lanes: readonly number[],
    /** How much of a racer's name this sheet prints (#552). Defaults to
     * `'FULL'`, today's only behaviour. */
    nameDisplay: NameDisplay | string = 'FULL',
    /** Off by default, and every race that predates the flag (#549). */
    masterRunningOrder = false,
    /** Every run-off heat on this race (#550), matched to the round it
     * settles by `settlesRoundId`. Defaults to none, today's only
     * behaviour before #890. */
    runOffHeats: readonly SheetRunOffHeat[] = [],
): RoundSection[] {
    const byId = new Map(racers.map((racer) => [racer.id, racer]));
    const lanesInOrder = [...new Set(lanes)].sort((a, b) => a - b);
    const roundsById = new Map(rounds.map((round) => [round.id, round]));
    const ordered = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

    const cellsFor = (heatLanes: readonly SheetLane[]) => {
        const byLane = new Map(heatLanes.map((lane) => [lane.lane, lane]));
        return lanesInOrder.map((lane) => cellFor(byLane.get(lane) ?? { lane }, byId, nameDisplay));
    };

    const roundSections = ordered
        .map((round) => {
            const rows = heats
                .filter((heat) => heat.roundId === round.id)
                .sort((a, b) => a.heatNumber - b.heatNumber)
                .map((heat) => ({
                    heatId: heat.id,
                    heatNumber: heat.heatNumber,
                    cells: cellsFor(heat.lanes),
                }));
            return { roundId: round.id, title: roundTitle(round), rows };
        })
        .filter((section) => section.rows.length > 0);

    const runOffSection = (runOff: SheetRunOffHeat): RoundSection => ({
        // Negated so it cannot collide with a real (positive) round id, and
        // stable across calls for the same run-off heat.
        roundId: -runOff.id - 1,
        title: runOffTitle(runOff.placement),
        rows: [{ heatId: runOff.id, heatNumber: 0, cells: cellsFor(runOff.lanes) }],
    });

    // Settles the race's overall standings, not one round — sorted right
    // after the last general round and before the first championship one,
    // never after every round (#1018): it decides who is *in* a
    // championship field drawn from those standings, so it has to run
    // before that field does. The same rule `crud.heats_in_running_order`
    // states on the backend.
    const overallRunOffs = runOffHeats.filter((runOff) => runOff.settlesRoundId == null);
    let overallRunOffsPlaced = overallRunOffs.length === 0;

    const sections: RoundSection[] = [];
    for (const section of roundSections) {
        const round = roundsById.get(section.roundId);
        if (!overallRunOffsPlaced && round?.advancementSource != null) {
            sections.push(...overallRunOffs.map(runOffSection));
            overallRunOffsPlaced = true;
        }
        sections.push(section);
        for (const runOff of runOffHeats) {
            if (runOff.settlesRoundId === section.roundId) sections.push(runOffSection(runOff));
        }
    }
    if (!overallRunOffsPlaced) sections.push(...overallRunOffs.map(runOffSection));

    if (!masterRunningOrder) return sections;

    const championshipRoundIds = new Set(
        rounds.filter((round) => round.advancementSource != null).map((round) => round.id),
    );
    const compare = executionComparator(true, championshipRoundIds);
    const flatRows = heats
        .filter((heat): heat is SheetHeat & { roundId: number } => heat.roundId != null)
        .filter((heat) => !championshipRoundIds.has(heat.roundId))
        .map((heat) => {
            const round = roundsById.get(heat.roundId);
            const ordered: OrderedHeat = {
                roundId: heat.roundId,
                roundNumber: round?.roundNumber ?? 0,
                heatNumber: heat.heatNumber,
            };
            return { heat, ordered, roundLabel: round ? roundTitle(round) : undefined };
        })
        .sort((a, b) => compare(a.ordered, b.ordered))
        .map(({ heat, roundLabel }) => ({
            heatId: heat.id,
            heatNumber: heat.heatNumber,
            cells: cellsFor(heat.lanes),
            roundLabel,
        }));

    if (flatRows.length === 0) return sections;

    return [
        { roundId: MASTER_RUNNING_ORDER_ROUND_ID, title: MASTER_RUNNING_ORDER_TITLE, rows: flatRows },
        ...sections,
    ];
}

/** How many heats the sheet covers, for the "before you commit paper" line. */
export function totalHeats(sections: readonly RoundSection[]): number {
    return sections.reduce((sum, section) => sum + section.rows.length, 0);
}

/**
 * "12 heats · 2 rounds" — the summary line on the printed sheet, counting
 * each real heat and each real round exactly once (#1024).
 *
 * `totalHeats` sums every section's rows, which is right for a sheet with
 * no master running order and wrong the moment one is on: the flat
 * `MASTER_RUNNING_ORDER_TITLE` section is *prepended* to the per-round
 * sections, not a replacement for them (see `buildHeatSheet`'s own
 * docstring), so every non-championship heat is counted twice — once in
 * the flat section, once in its own round's table. `sections.length` has
 * the matching bug one level up: the flat section (and each run-off
 * heat's own one-row section) is not a round, so counting sections as
 * rounds overstates that figure too, master running order or not.
 *
 * The fix is to know what each section actually *is*, not just sum
 * whatever `buildHeatSheet` handed back: `roundId` is a real round's own
 * id for a round section, the fixed `MASTER_RUNNING_ORDER_ROUND_ID` (`-1`)
 * for the flat section, and a distinct negative id for a run-off's own
 * one-row section (`-runOff.id - 1`, never `-1`) — see `buildHeatSheet`'s
 * `runOffSection`. Heats count every section but the flat one (so a real
 * heat and a run-off heat both count, and a heat printed twice under
 * master running order counts once); rounds count only sections whose id
 * is a real round's.
 */
export function printedSummary(sections: readonly RoundSection[]): { heats: number; rounds: number } {
    let heats = 0;
    let rounds = 0;
    for (const section of sections) {
        if (section.roundId === MASTER_RUNNING_ORDER_ROUND_ID) continue;
        heats += section.rows.length;
        if (section.roundId >= 0) rounds += 1;
    }
    return { heats, rounds };
}
