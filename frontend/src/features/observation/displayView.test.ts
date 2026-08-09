import { describe, expect, it } from 'vitest';
import { behaviourFor, readUrl, resolveView, VIEW_OPTIONS } from './displayView';

const url = (query = '') => readUrl(new URLSearchParams(query));

describe('readUrl', () => {
    it('reads nothing from an empty query', () => {
        expect(url()).toEqual({ view: null, projector: false, cycle: false, cycleMs: 10000 });
    });

    it('reads the flags a display was launched with', () => {
        expect(url('view=timing&projector=true&cycle=true&cycle_interval=5000')).toEqual({
            view: 'timing',
            projector: true,
            cycle: true,
            cycleMs: 5000,
        });
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
            cycleMs: 4000,
            redirectTo: null,
        });
    });

    it('reaches the slideshow by URL as well as by assignment', () => {
        // The fallback stays complete: a view only the operator's list could
        // select would be unreachable on a display nobody assigns.
        expect(resolveView(null, url('view=slideshow'), 1)).toMatchObject({ slideshow: true });
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
            ['AWARDS', 'CYCLE', 'PROJECTOR', 'SLIDESHOW', 'STANDINGS', 'TIMING'].sort(),
        );
    });

    it('labels each one', () => {
        for (const option of VIEW_OPTIONS) expect(option.label).toBeTruthy();
    });
});
