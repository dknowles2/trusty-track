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

export function roundTitle(round: SheetRound): string {
    if (round.name) return round.name;
    return round.advancementSource
        ? `Championship round ${round.roundNumber}`
        : `Round ${round.roundNumber}`;
}

/**
 * One lane's cell.
 *
 * The three cases are different on paper in a way they are not in the data.
 * A placeholder is a lane that *will* have somebody in it, so the announcer
 * should expect to write a name in; an empty lane is one that will stay empty
 * and should not be waited for. Rendering both as blank loses that.
 */
export function cellFor(lane: SheetLane, racers: ReadonlyMap<number, SheetRacer>): Cell {
    if (lane.racerId != null) {
        const racer = racers.get(lane.racerId);
        if (racer) {
            return {
                lane: lane.lane,
                carNumber: racer.carNumber == null ? '' : String(racer.carNumber),
                name: `${racer.firstName} ${racer.lastName}`.trim(),
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
 * The sheet: one section per round, in running order.
 *
 * ``lanes`` is the track's lanes, not the heat's, so every row has the same
 * columns even when a lane is out of service (#171) or a racer was deleted out
 * of one. A table whose rows have different widths is unreadable, and the gap
 * is the point — that lane is empty and the announcer should know.
 */
export function buildHeatSheet(
    rounds: readonly SheetRound[],
    heats: readonly SheetHeat[],
    racers: readonly SheetRacer[],
    lanes: readonly number[],
): RoundSection[] {
    const byId = new Map(racers.map((racer) => [racer.id, racer]));
    const lanesInOrder = [...new Set(lanes)].sort((a, b) => a - b);
    const ordered = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

    return ordered
        .map((round) => {
            const rows = heats
                .filter((heat) => heat.roundId === round.id)
                .sort((a, b) => a.heatNumber - b.heatNumber)
                .map((heat) => {
                    const byLane = new Map(heat.lanes.map((lane) => [lane.lane, lane]));
                    return {
                        heatId: heat.id,
                        heatNumber: heat.heatNumber,
                        cells: lanesInOrder.map((lane) =>
                            cellFor(byLane.get(lane) ?? { lane }, byId),
                        ),
                    };
                });
            return { roundId: round.id, title: roundTitle(round), rows };
        })
        .filter((section) => section.rows.length > 0);
}

/** How many heats the sheet covers, for the "before you commit paper" line. */
export function totalHeats(sections: readonly RoundSection[]): number {
    return sections.reduce((sum, section) => sum + section.rows.length, 0);
}
