import { describe, expect, it } from 'vitest';
import { finalChampionshipRound, raceIsFinished, type FinishedHeat, type FinishedRound } from './raceFinished';

const heat = (over: Partial<FinishedHeat> = {}): FinishedHeat => ({ recordedAt: '2026-03-14T09:30:00', ...over });

describe('raceIsFinished', () => {
    it('is false before any heat has been scheduled', () => {
        // The pre-race state, which the audience display already showed
        // correctly — "No heat scheduled" before racing starts is not the
        // failure #869 is about.
        expect(raceIsFinished([], false, false, false)).toBe(false);
    });

    it('is false while something is on the track', () => {
        expect(raceIsFinished([heat()], true, false, false)).toBe(false);
    });

    it('is false while something is on deck', () => {
        expect(raceIsFinished([heat()], false, true, false)).toBe(false);
    });

    it('is false while a free race exhibition run is armed', () => {
        expect(raceIsFinished([heat()], false, false, true)).toBe(false);
    });

    it('is false while any scheduled heat still has no recorded result', () => {
        expect(raceIsFinished([heat(), heat({ recordedAt: null })], false, false, false)).toBe(false);
    });

    it('is true once every scheduled heat has a recorded result and nothing is next', () => {
        expect(raceIsFinished([heat(), heat()], false, false, false)).toBe(true);
    });
});

describe('finalChampionshipRound', () => {
    const round = (over: Partial<FinishedRound> & { id: number }): FinishedRound => ({
        roundNumber: 1,
        advancementSource: null,
        ...over,
    });

    it('is null when the race ran no championship round', () => {
        expect(finalChampionshipRound([round({ id: 1, advancementSource: null })])).toBeNull();
    });

    it('is the one championship round when there is exactly one', () => {
        const championship = round({ id: 2, roundNumber: 2, advancementSource: 'ALL' });
        expect(
            finalChampionshipRound([round({ id: 1, advancementSource: null }), championship]),
        ).toEqual(championship);
    });

    // A chained final (#549's wizard wires each round after the first to
    // `ROUND:<previous>`) — the room cares about the last one's result, not
    // an intermediate semifinal's.
    it('is the highest-numbered championship round when several chain together', () => {
        const semifinal = round({ id: 2, roundNumber: 2, advancementSource: 'ALL' });
        const final = round({ id: 3, roundNumber: 3, advancementSource: 'ROUND:2' });
        expect(finalChampionshipRound([round({ id: 1 }), final, semifinal])).toEqual(final);
    });
});
