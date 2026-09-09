import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINOLOGY } from './TerminologyContext';
import { CATEGORY_PRESETS } from './categoryPresets';
import { VEHICLE_ARTWORK_OPTIONS } from '../features/settings/terminologyDefaults';
import {
    DEFAULT_ANSWERS,
    EVENT_KINDS,
    ORGANIZATION_KINDS,
    categoryPresetsFor,
    organizationKindFor,
    wordsFor,
} from './organizationKinds';

describe('wordsFor', () => {
    it('opens on exactly the built-in words — a default install is unchanged', () => {
        expect(wordsFor(DEFAULT_ANSWERS)).toEqual(DEFAULT_TERMINOLOGY);
    });

    it('a Space Derby is rockets, and only the vehicle word changes', () => {
        expect(wordsFor({ ...DEFAULT_ANSWERS, eventKind: 'space' })).toEqual({
            ...DEFAULT_TERMINOLOGY,
            vehicleSingular: 'Rocket',
            vehiclePlural: 'Rockets',
            vehicleArtworkKey: 'rocket',
        });
    });

    it('a district derby is still Cub Scouts, but its groups are ranks, not dens', () => {
        const w = wordsFor({ ...DEFAULT_ANSWERS, scale: 'tournament' });
        expect(w.organizationSingular).toBe('District');
        expect(w.racingGroupSingular).toBe('Rank');
        expect(w.vehicleSingular).toBe('Car');
    });

    it('the scale is ignored where the organization kind asks no such question', () => {
        expect(wordsFor({ eventKind: 'pinewood', organizationKind: 'school', scale: 'tournament' }))
            .toEqual(wordsFor({ eventKind: 'pinewood', organizationKind: 'school', scale: 'own' }));
    });

    it('every event kind names an artwork the picker knows', () => {
        const known = VEHICLE_ARTWORK_OPTIONS.map((o) => o.value);
        for (const kind of EVENT_KINDS) {
            expect(known).toContain(kind.vehicleArtworkKey);
        }
    });
});

describe('organizationKindFor / ORGANIZATION_KINDS', () => {
    it('every organization kind has a singular and a plural for both words', () => {
        for (const kind of ORGANIZATION_KINDS) {
            for (const w of [kind, ...(kind.scales ?? [])]) {
                expect(w.organizationSingular).not.toBe('');
                expect(w.organizationPlural).not.toBe('');
                expect(w.racingGroupSingular).not.toBe('');
                expect(w.racingGroupPlural).not.toBe('');
            }
        }
    });

    it('falls back to the first kind for an unknown key', () => {
        // @ts-expect-error — exercising the fallback a stale key would hit.
        expect(organizationKindFor('nonsense')).toBe(ORGANIZATION_KINDS[0]);
    });
});

describe('categoryPresetsFor (#928, part 1)', () => {
    it('offers the Cub Scout ranks for the built-in Pack/Den words', () => {
        expect(categoryPresetsFor({ organizationSingular: 'Pack', racingGroupSingular: 'Den' }))
            .toBe(CATEGORY_PRESETS);
    });

    it('offers the same ranks for a district derby — "Rank" grouping is exactly the categories', () => {
        expect(categoryPresetsFor({ organizationSingular: 'District', racingGroupSingular: 'Rank' }))
            .toBe(CATEGORY_PRESETS);
    });

    it('offers the Awana age groups for Club/Group', () => {
        expect(categoryPresetsFor({ organizationSingular: 'Club', racingGroupSingular: 'Group' }))
            .toEqual(['Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
    });

    it('offers nothing for a school — grades have no natural fixed list', () => {
        expect(categoryPresetsFor({ organizationSingular: 'School', racingGroupSingular: 'Grade' })).toEqual([]);
    });

    it('offers nothing for "something else"', () => {
        expect(categoryPresetsFor({ organizationSingular: 'Organization', racingGroupSingular: 'Group' })).toEqual([]);
    });

    it('offers nothing for a custom vocabulary that matches no kind', () => {
        expect(categoryPresetsFor({ organizationSingular: 'Troop', racingGroupSingular: 'Patrol' })).toEqual([]);
    });
});
