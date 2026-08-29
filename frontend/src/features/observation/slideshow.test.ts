import { describe, expect, it } from 'vitest';
import {
    clampIndex,
    hasAPhoto,
    nextIndex,
    slidesFor,
    type SlideshowRacer,
} from './slideshow';

const racer = (over: Partial<SlideshowRacer> = {}): SlideshowRacer => ({
    id: 1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    carNumber: 3,
    racerImageUrl: '/static/ada.png',
    ...over,
});

const RACING_GROUPS = [{ id: 10, name: 'Wolves', color: '#8B4513' }];

describe('hasAPhoto', () => {
    it('accepts a racer with only a headshot', () => {
        expect(hasAPhoto(racer({ carImageUrl: null }))).toBe(true);
    });

    it('accepts a racer with only a car photo', () => {
        expect(hasAPhoto(racer({ racerImageUrl: null, carImageUrl: '/static/car.png' }))).toBe(
            true,
        );
    });

    it('rejects a racer with neither', () => {
        expect(hasAPhoto(racer({ racerImageUrl: null, carImageUrl: null }))).toBe(false);
    });

    it('treats an empty string as no photo', () => {
        expect(hasAPhoto(racer({ racerImageUrl: '', carImageUrl: '' }))).toBe(false);
    });
});

describe('slidesFor', () => {
    it('leaves out racers with no photograph', () => {
        // A blank card on a projector reads as the app being broken, and the
        // child it belongs to gets nothing from it either way.
        const slides = slidesFor(
            [
                racer({ id: 1, carNumber: 1 }),
                racer({ id: 2, carNumber: 2, racerImageUrl: null, carImageUrl: null }),
            ],
            RACING_GROUPS,
        );

        expect(slides.map((s) => s.racerId)).toEqual([1]);
    });

    it('orders by car number rather than shuffling', () => {
        // A family watching for their own child has no idea, under a shuffle,
        // whether they have missed them or are about to see them — and with
        // sixty racers a shuffle can leave one child out for a long time.
        const slides = slidesFor(
            [
                racer({ id: 1, carNumber: 22 }),
                racer({ id: 2, carNumber: 3 }),
                racer({ id: 3, carNumber: 11 }),
            ],
            RACING_GROUPS,
        );

        expect(slides.map((s) => s.carNumber)).toEqual([3, 11, 22]);
    });

    it('puts unnumbered cars last rather than first', () => {
        const slides = slidesFor(
            [racer({ id: 1, carNumber: null }), racer({ id: 2, carNumber: 7 })],
            RACING_GROUPS,
        );

        expect(slides.map((s) => s.racerId)).toEqual([2, 1]);
    });

    it('breaks a tie by name, so the order does not depend on the API', () => {
        const slides = slidesFor(
            [
                racer({ id: 1, carNumber: null, lastName: 'Zephyr' }),
                racer({ id: 2, carNumber: null, lastName: 'Ahmed' }),
            ],
            RACING_GROUPS,
        );

        expect(slides.map((s) => s.racerId)).toEqual([2, 1]);
    });

    it('carries the racingGroup so a slide can be coloured', () => {
        const [slide] = slidesFor([racer({ racingGroupId: 10 })], RACING_GROUPS);

        expect(slide.racingGroupName).toBe('Wolves');
        expect(slide.racingGroupColor).toBe('#8B4513');
    });

    it('survives a racer in no racingGroup', () => {
        const [slide] = slidesFor([racer({ racingGroupId: null })], RACING_GROUPS);

        expect(slide.racingGroupName).toBeNull();
    });

    it('survives a racingGroup that no longer exists', () => {
        // Deleting a racingGroup leaves its racers behind; a slideshow that threw here
        // would take the audience screen down mid-event.
        const [slide] = slidesFor([racer({ racingGroupId: 999 })], RACING_GROUPS);

        expect(slide.racingGroupName).toBeNull();
    });

    it('does not mutate what it was given', () => {
        // It sorts, and the same array is the query result React is holding.
        const racers = [racer({ id: 1, carNumber: 9 }), racer({ id: 2, carNumber: 1 })];

        slidesFor(racers, RACING_GROUPS);

        expect(racers.map((r) => r.id)).toEqual([1, 2]);
    });

    it('produces nothing when nobody has a photo', () => {
        expect(
            slidesFor([racer({ racerImageUrl: null, carImageUrl: null })], RACING_GROUPS),
        ).toEqual([]);
    });
});

describe('nextIndex', () => {
    it('advances', () => {
        expect(nextIndex(0, 3)).toBe(1);
    });

    it('wraps rather than stopping', () => {
        // The opposite of the awards ceremony, for the opposite reason: this
        // runs unattended for an afternoon, and stopping would freeze a screen
        // on whoever happens to be last.
        expect(nextIndex(2, 3)).toBe(0);
    });

    it('stays at zero with nothing to show', () => {
        expect(nextIndex(0, 0)).toBe(0);
    });
});

describe('clampIndex', () => {
    it('leaves a valid index alone', () => {
        expect(clampIndex(2, 5)).toBe(2);
    });

    it('holds position when the list shrinks', () => {
        // The roster moves during an event. Resetting to zero every time a
        // photo is uploaded at the desk would mean never reaching the end of a
        // sixty-strong pack.
        expect(clampIndex(9, 5)).toBe(4);
    });

    it('handles an empty list', () => {
        expect(clampIndex(3, 0)).toBe(0);
    });

    it('refuses a negative index', () => {
        expect(clampIndex(-1, 5)).toBe(0);
    });
});
