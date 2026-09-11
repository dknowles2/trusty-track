import { describe, expect, it } from 'vitest';
import { raceSummaryLine, type RaceSummaryInput } from './raceSummary';

const race = (over: Partial<RaceSummaryInput> = {}): RaceSummaryInput => ({
    scoring_strategy: 'TIMED',
    car_numbering_strategy: 'PER_GROUP',
    championship_trophies: 3,
    track_name: 'Main Track',
    ...over,
});

describe('raceSummaryLine', () => {
    it('joins scoring, numbering, trophies and track in reading order', () => {
        expect(raceSummaryLine(race(), 'Den')).toBe('Timed (average) · Per Den · 3 trophies · Main Track');
    });

    it('resolves the numbering label against the caller-supplied group word, not a hardcoded one', () => {
        expect(raceSummaryLine(race(), 'Class')).toContain('Per Class');
    });

    it('singularizes exactly one trophy', () => {
        expect(raceSummaryLine(race({ championship_trophies: 1 }), 'Den')).toContain('1 trophy ');
        expect(raceSummaryLine(race({ championship_trophies: 1 }), 'Den')).not.toContain('1 trophies');
    });

    it('falls back to the 3-trophy default a race saved before the field existed would have raced with', () => {
        expect(raceSummaryLine(race({ championship_trophies: null }), 'Den')).toContain('3 trophies');
    });

    it('says Unknown for a track that cannot be resolved, same as the grid it replaces', () => {
        expect(raceSummaryLine(race({ track_name: null }), 'Den')).toContain('Unknown');
    });
});
