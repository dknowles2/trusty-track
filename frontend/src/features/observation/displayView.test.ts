import { describe, expect, it } from 'vitest';
import {
    behaviourFor,
    readUrl,
    resolveView,
    VIEW_OPTIONS,
    viewCycles,
    viewHasCheckedInToggle,
    viewOptionsFor,
    viewScrolls,
} from './displayView';

const url = (query = '') => readUrl(new URLSearchParams(query));

describe('readUrl', () => {
    it('reads nothing from an empty query', () => {
        expect(url()).toEqual({
            view: null,
            projector: false,
            cycle: false,
            cycleMs: 10000,
            scrollBehavior: 'PAGING',
            showCheckedIn: true,
        });
    });

    it('reads the flags a display was launched with', () => {
        expect(url('view=timing&projector=true&cycle=true&cycle_interval=5000')).toEqual({
            view: 'timing',
            projector: true,
            cycle: true,
            cycleMs: 5000,
            scrollBehavior: 'PAGING',
            showCheckedIn: true,
        });
    });

    it('reads a smooth scroll off the URL', () => {
        expect(url('view=standings_only&scroll=smooth').scrollBehavior).toBe('SMOOTH');
    });

    it('defaults to paging when the URL says nothing about it', () => {
        expect(url('view=standings_only').scrollBehavior).toBe('PAGING');
    });

    it('reads pending-only check-in off the URL', () => {
        expect(url('view=checkin&checkin_show=pending').showCheckedIn).toBe(false);
    });

    it('defaults check-in to showing everybody', () => {
        expect(url('view=checkin').showCheckedIn).toBe(true);
    });
});

describe('behaviourFor', () => {
    it('shows the standings tab', () => {
        expect(behaviourFor('STANDINGS', 10, 1)).toMatchObject({ tab: 'standings', cycle: false });
    });

    it('shows the timing tab', () => {
        expect(behaviourFor('TIMING', 10, 1)).toMatchObject({ tab: 'timing' });
    });

    it('cycles at the interval it was given, in milliseconds', () => {
        expect(behaviourFor('CYCLE', 20, 1)).toMatchObject({ cycle: true, cycleMs: 20000 });
    });

    it('turns projector mode on', () => {
        expect(behaviourFor('PROJECTOR', 10, 1)).toMatchObject({ projector: true });
    });

    it('sends the ceremony to its own route', () => {
        // It is a separate page, not a tab: it is paced by whoever holds the
        // microphone rather than rotating on a timer.
        expect(behaviourFor('AWARDS', 10, 7).redirectTo).toBe('/race/7/awards/present');
    });

    it('never redirects for anything else', () => {
        for (const { view } of VIEW_OPTIONS.filter((o) => o.view !== 'AWARDS')) {
            expect(behaviourFor(view, 10, 1).redirectTo).toBeNull();
        }
    });

    it('fills the screen with the leaderboard alone', () => {
        expect(behaviourFor('STANDINGS_ONLY', 10, 1)).toMatchObject({
            tab: 'standings',
            standingsOnly: true,
        });
    });

    it('carries the scroll behavior through, defaulting to paging', () => {
        expect(behaviourFor('STANDINGS_ONLY', 10, 1).scrollBehavior).toBe('PAGING');
        expect(behaviourFor('STANDINGS_ONLY', 10, 1, 'SMOOTH').scrollBehavior).toBe('SMOOTH');
    });

    it('marks standingsOnly false for every other view', () => {
        for (const { view } of VIEW_OPTIONS.filter((o) => o.view !== 'STANDINGS_ONLY')) {
            expect(behaviourFor(view, 10, 1).standingsOnly).toBe(false);
        }
    });

    it('shows the check-in view', () => {
        expect(behaviourFor('CHECKIN', 10, 1)).toMatchObject({ tab: 'standings', checkin: true });
    });

    it('carries showCheckedIn through, defaulting to true', () => {
        expect(behaviourFor('CHECKIN', 10, 1).showCheckedIn).toBe(true);
        expect(behaviourFor('CHECKIN', 10, 1, 'PAGING', false).showCheckedIn).toBe(false);
    });

    it('marks checkin false for every other view', () => {
        for (const { view } of VIEW_OPTIONS.filter((o) => o.view !== 'CHECKIN')) {
            expect(behaviourFor(view, 10, 1).checkin).toBe(false);
        }
    });
});

describe('resolveView', () => {
    it('follows the URL until an assignment arrives', () => {
        // The socket takes a moment. A display that ignored its URL meanwhile
        // would flash the standings on its way to what it was told — on a
        // projector, in front of everybody.
        expect(resolveView(null, url('view=timing&projector=true'), 1)).toMatchObject({
            tab: 'timing',
            projector: true,
        });
    });

    it('lets an assignment override the URL', () => {
        // The obvious rule — URL first, assignment as a default — is wrong:
        // a screen opened at ?view=timing months ago would be permanently
        // unassignable from across the room, which is the whole point of #174.
        expect(
            resolveView({ view: 'PROJECTOR', cycleSeconds: 10 }, url('view=timing'), 1),
        ).toMatchObject({ tab: 'standings', projector: true });
    });

    it('lets an assignment turn projector mode off again', () => {
        // The operator has to be able to undo what they did, and the URL still
        // says projector.
        expect(
            resolveView({ view: 'STANDINGS', cycleSeconds: 10 }, url('projector=true'), 1),
        ).toMatchObject({ projector: false });
    });

    it('behaves exactly as before for a display nobody assigns', () => {
        // The fallback that makes this safe to add: an operator who never
        // opens the list loses nothing.
        const legacy = url('view=timing&cycle=true&cycle_interval=4000');
        expect(resolveView(null, legacy, 1)).toEqual({
            tab: 'timing',
            projector: false,
            cycle: true,
            slideshow: false,
            standingsOnly: false,
            checkin: false,
            cycleMs: 4000,
            scrollBehavior: 'PAGING',
            showCheckedIn: true,
            redirectTo: null,
        });
    });

    it('reaches the slideshow by URL as well as by assignment', () => {
        // The fallback stays complete: a view only the operator's list could
        // select would be unreachable on a display nobody assigns.
        expect(resolveView(null, url('view=slideshow'), 1)).toMatchObject({ slideshow: true });
    });

    it('reaches standings-only by URL as well as by assignment', () => {
        expect(resolveView(null, url('view=standings_only'), 1)).toMatchObject({
            standingsOnly: true,
        });
    });

    it('reaches check-in by URL as well as by assignment', () => {
        expect(resolveView(null, url('view=checkin'), 1)).toMatchObject({ checkin: true });
    });

    it('carries a scroll behavior for a display nobody assigns', () => {
        expect(
            resolveView(null, url('view=standings_only&scroll=smooth'), 1).scrollBehavior,
        ).toBe('SMOOTH');
    });

    it('defaults scroll behavior to paging when an assignment omits it', () => {
        // Older payloads / a display type without the field yet.
        expect(
            resolveView({ view: 'STANDINGS_ONLY', cycleSeconds: 10 }, url(), 1).scrollBehavior,
        ).toBe('PAGING');
    });

    it('lets an assignment carry its own scroll behavior', () => {
        expect(
            resolveView(
                { view: 'STANDINGS_ONLY', cycleSeconds: 10, scrollBehavior: 'SMOOTH' },
                url(),
                1,
            ).scrollBehavior,
        ).toBe('SMOOTH');
    });

    it('defaults showCheckedIn to true when an assignment omits it', () => {
        expect(
            resolveView({ view: 'CHECKIN', cycleSeconds: 10 }, url(), 1).showCheckedIn,
        ).toBe(true);
    });

    it('lets an assignment carry its own showCheckedIn', () => {
        expect(
            resolveView(
                { view: 'CHECKIN', cycleSeconds: 10, showCheckedIn: false },
                url(),
                1,
            ).showCheckedIn,
        ).toBe(false);
    });

    it('ignores an assignment nobody made', () => {
        // The caller passes null for an unassigned display; this asserts the
        // consequence, which the end-to-end spec caught the hard way: every
        // connected display receives a payload carrying the default view, and
        // acting on it overrides the URL on every screen in the room.
        expect(resolveView(null, url('view=timing'), 1)).toMatchObject({ tab: 'timing' });
    });

    it('ignores a view the URL does not recognise', () => {
        expect(resolveView(null, url('view=nonsense'), 1)).toMatchObject({ tab: 'standings' });
    });
});

describe('VIEW_OPTIONS', () => {
    it('offers every view the display understands', () => {
        expect(VIEW_OPTIONS.map((o) => o.view).sort()).toEqual(
            [
                'AWARDS',
                'CHECKIN',
                'CYCLE',
                'PROJECTOR',
                'SLIDESHOW',
                'STANDINGS',
                'STANDINGS_ONLY',
                'TIMING',
            ].sort(),
        );
    });

    it('labels each one', () => {
        for (const option of VIEW_OPTIONS) expect(option.label).toBeTruthy();
    });

    it('marks exactly the views that advance on a settable timer', () => {
        // The seconds control on the Displays panel follows this flag. The
        // slideshow missing from it was the bug: it cycled at an interval
        // nothing offered to change. Check-in progress is not a rotation —
        // it just reflects the roster live.
        expect(
            VIEW_OPTIONS.filter((o) => o.cycles)
                .map((o) => o.view)
                .sort(),
        ).toEqual(['CYCLE', 'SLIDESHOW', 'STANDINGS_ONLY']);
    });

    it('viewCycles reads the same flag', () => {
        expect(viewCycles('SLIDESHOW')).toBe(true);
        expect(viewCycles('CYCLE')).toBe(true);
        expect(viewCycles('STANDINGS_ONLY')).toBe(true);
        expect(viewCycles('STANDINGS')).toBe(false);
        // The ceremony is paced by a person; the projector's overlay timing
        // is its own, not the operator's.
        expect(viewCycles('AWARDS')).toBe(false);
        expect(viewCycles('PROJECTOR')).toBe(false);
        expect(viewCycles('CHECKIN')).toBe(false);
    });
});

describe('viewScrolls', () => {
    it('offers the paging/smooth-scroll choice only for standings-only', () => {
        expect(viewScrolls('STANDINGS_ONLY')).toBe(true);
        for (const { view } of VIEW_OPTIONS.filter((o) => o.view !== 'STANDINGS_ONLY')) {
            expect(viewScrolls(view)).toBe(false);
        }
    });
});

describe('viewHasCheckedInToggle', () => {
    it('offers the everybody/pending-only choice only for check-in', () => {
        expect(viewHasCheckedInToggle('CHECKIN')).toBe(true);
        for (const { view } of VIEW_OPTIONS.filter((o) => o.view !== 'CHECKIN')) {
            expect(viewHasCheckedInToggle(view)).toBe(false);
        }
    });
});

describe('viewOptionsFor', () => {
    const views = (hasAwards: boolean, current: Parameters<typeof viewOptionsFor>[1]) =>
        viewOptionsFor(hasAwards, current).map((o) => o.view);

    it('offers everything to a race with awards', () => {
        expect(views(true, 'STANDINGS')).toEqual(VIEW_OPTIONS.map((o) => o.view));
    });

    it('leaves the ceremony out of a race with none', () => {
        expect(views(false, 'STANDINGS')).not.toContain('AWARDS');
    });

    it('drops nothing else', () => {
        expect(views(false, 'STANDINGS')).toEqual(
            VIEW_OPTIONS.filter((o) => o.view !== 'AWARDS').map((o) => o.view),
        );
    });

    it('keeps it for a screen already showing it', () => {
        // Deleting the last award while a ceremony is up. A row whose current
        // view is missing from its own list shows nothing as chosen.
        expect(views(false, 'AWARDS')).toContain('AWARDS');
    });

    it('offers standings-only unconditionally, unlike the ceremony', () => {
        // There is always a leaderboard to show, even an empty one — nothing
        // about a race can make this option disappoint the way the ceremony
        // would for a race with no awards.
        expect(views(false, 'STANDINGS')).toContain('STANDINGS_ONLY');
        expect(views(true, 'STANDINGS')).toContain('STANDINGS_ONLY');
    });

    it('offers check-in progress unconditionally too', () => {
        // There is always a roster to show, even an empty one.
        expect(views(false, 'STANDINGS')).toContain('CHECKIN');
        expect(views(true, 'STANDINGS')).toContain('CHECKIN');
    });
});
