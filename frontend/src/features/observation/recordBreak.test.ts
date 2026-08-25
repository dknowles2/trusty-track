import { describe, expect, it } from 'vitest';
import { recordBreakDetail } from './recordBreak';

describe('recordBreakDetail', () => {
    it('says who beat what, and where the old record came from', () => {
        expect(
            recordBreakDetail({
                newSeconds: 2.874,
                newHolder: 'Alice T',
                previousSeconds: 2.891,
                previousHolder: 'Jimmy Legend',
                previousRaceName: 'Derby 2019',
            }),
        ).toBe('2.874s by Alice T — beats 2.891s set by Jimmy Legend (Derby 2019)');
    });

    it('drops the event when the old record has none', () => {
        expect(
            recordBreakDetail({
                newSeconds: 2.874,
                newHolder: 'Alice T',
                previousSeconds: 2.891,
                previousHolder: 'Jimmy Legend',
                previousRaceName: null,
            }),
        ).toBe('2.874s by Alice T — beats 2.891s set by Jimmy Legend');
    });
});
