import { describe, expect, it } from 'vitest';
import { CATEGORY_PRESETS } from './categoryPresets';

describe('CATEGORY_PRESETS', () => {
    it('offers the traditional Cub Scout ranks, in the order a Scout meets them', () => {
        expect(CATEGORY_PRESETS).toEqual([
            'Lion',
            'Tiger',
            'Wolf',
            'Bear',
            'Webelos',
            'Arrow of Light',
            'Other',
        ]);
    });
});
