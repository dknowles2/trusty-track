import { describe, expect, it } from 'vitest';
import { describeValue } from './describeValue';

describe('describeValue', () => {
    it.each([
        ['scoring_strategy', 'TIMED', 'Timed (average)'],
        ['scoring_strategy', 'POINTS', 'Points (by finish)'],
        ['tiebreaker', 'SHARED', 'Leave it shared'],
        ['tiebreaker', 'HEAD_TO_HEAD', 'Head-to-head'],
        ['car_numbering_strategy', 'GLOBAL', 'Global'],
        ['car_numbering_strategy', 'PER_GROUP', 'Per Den'],
        ['car_numbering_strategy', 'MANUAL', 'Manual'],
        ['display_theme', 'MATCH_APP', 'Field Uniform (default)'],
        ['display_theme', 'old-glory', 'Old Glory'],
        ['printables_theme', 'newsprint', 'Newsprint'],
        ['name_display', 'LAST_INITIAL', 'First name and last initial'],
        ['name_display', 'FULL', 'Full name'],
        ['timer_type', 'AUTO_DETECT_BACKEND', 'Plugged into this machine'],
        ['timer_type', 'FAKE', 'Fake Timer (Manual Control)'],
    ])('maps %s: %s to %s', (field, value, expected) => {
        expect(describeValue(field, value)).toBe(expected);
    });

    it('leaves a field it has never heard of unchanged', () => {
        expect(describeValue('weight_limit_oz', '5')).toBe('5');
    });

    it('leaves a value none of its tables recognise unchanged', () => {
        expect(describeValue('scoring_strategy', 'SOME_FUTURE_STRATEGY')).toBe(
            'SOME_FUTURE_STRATEGY',
        );
    });

    it('does not touch a false rider — dropping it is detailPairs’ job, not this one’s', () => {
        expect(describeValue('clear_terminology', 'false')).toBe('false');
    });
});
