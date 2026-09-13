import { describe, expect, it, vi } from 'vitest';
import { pickLanePhoto, readLanePhotoPreference, writeLanePhotoPreference } from './lanePhoto';

function mockStorage(initial: Record<string, string> = {}) {
    const values = { ...initial };
    return {
        getItem: vi.fn((key: string) => values[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
            values[key] = value;
        }),
    };
}

describe('pickLanePhoto (#1075)', () => {
    const both = { racerImageUrl: 'portrait.jpg', carImageUrl: 'car.jpg' };
    const carOnly = { racerImageUrl: null, carImageUrl: 'car.jpg' };
    const portraitOnly = { racerImageUrl: 'portrait.jpg', carImageUrl: null };
    const neither = { racerImageUrl: null, carImageUrl: null };

    it.each([
        ['car', both, 'car'],
        ['car', carOnly, 'car'],
        ['car', portraitOnly, 'portrait'],
        ['car', neither, 'initials'],
        ['portrait', both, 'portrait'],
        ['portrait', portraitOnly, 'portrait'],
        ['portrait', carOnly, 'car'],
        ['portrait', neither, 'initials'],
    ] as const)('preference=%s, photos=%o -> %s', (preference, photos, expected) => {
        expect(pickLanePhoto(preference, photos)).toBe(expected);
    });

    it('treats an empty-string url the same as absent', () => {
        expect(pickLanePhoto('car', { racerImageUrl: 'portrait.jpg', carImageUrl: '' })).toBe('portrait');
        expect(pickLanePhoto('portrait', { racerImageUrl: '', carImageUrl: 'car.jpg' })).toBe('car');
    });
});

describe('lane photo preference storage (#1075)', () => {
    it('defaults to car when nothing is stored', () => {
        expect(readLanePhotoPreference(mockStorage())).toBe('car');
    });

    it('reads back what was written', () => {
        const store = mockStorage();
        writeLanePhotoPreference(store, 'portrait');
        expect(readLanePhotoPreference(store)).toBe('portrait');
    });

    it('treats an unrecognised stored value as the default', () => {
        expect(readLanePhotoPreference(mockStorage({ 'trustytrack.lanePhoto': 'garbage' }))).toBe('car');
    });
});
