/**
 * What a display shows, and who decides it (#174).
 *
 * A screen used to take its view entirely from its own URL, so changing one
 * meant walking to it. It can now be told instead — but the URL still works,
 * and that fallback is what makes the feature safe to add: a display nobody
 * has assigned behaves exactly as it did before, so an operator who never
 * opens the list loses nothing.
 *
 * The precedence rule is the whole of this module, and it is not the obvious
 * one. See `resolveView`.
 */

export type DisplayView =
    | 'STANDINGS'
    | 'TIMING'
    | 'CYCLE'
    | 'PROJECTOR'
    | 'AWARDS'
    | 'SLIDESHOW';

/** What the observation page actually does, once everything is resolved. */
export interface ViewBehaviour {
    tab: 'standings' | 'timing';
    projector: boolean;
    cycle: boolean;
    /** The racers' photographs, rotating (#175). */
    slideshow: boolean;
    cycleMs: number;
    /** The ceremony is its own route, so the page redirects rather than renders. */
    redirectTo: string | null;
}

/** What the URL asked for, if anything. */
export interface UrlIntent {
    view: string | null;
    projector: boolean;
    cycle: boolean;
    cycleMs: number;
}

export function readUrl(params: URLSearchParams): UrlIntent {
    return {
        view: params.get('view'),
        projector: params.get('projector') === 'true',
        cycle: params.get('cycle') === 'true',
        cycleMs: parseInt(params.get('cycle_interval') || '10000'),
    };
}

export function behaviourFor(view: DisplayView, cycleSeconds: number, raceId: number): ViewBehaviour {
    const base = {
        projector: false,
        cycle: false,
        slideshow: false,
        cycleMs: cycleSeconds * 1000,
        redirectTo: null,
    };
    switch (view) {
        case 'TIMING':
            return { ...base, tab: 'timing' };
        case 'CYCLE':
            return { ...base, tab: 'standings', cycle: true };
        case 'PROJECTOR':
            return { ...base, tab: 'standings', projector: true };
        case 'SLIDESHOW':
            return { ...base, tab: 'standings', slideshow: true };
        case 'AWARDS':
            return { ...base, tab: 'standings', redirectTo: `/race/${raceId}/awards/present` };
        case 'STANDINGS':
        default:
            return { ...base, tab: 'standings' };
    }
}

/**
 * An assignment wins over the URL — but only once one has arrived.
 *
 * The obvious rule is "URL first, assignment as a default", and it is wrong.
 * The point of the feature is that the operator does not have to walk to the
 * screen, and a screen opened at `?view=timing` months ago would then be
 * permanently unassignable from across the room. So the assignment wins.
 *
 * The subtlety is *before* one arrives. The socket takes a moment, and a
 * display that ignored its URL in the meantime would flash the standings on
 * its way to whatever it was told — on a projector, in front of everybody. So
 * the URL is what it shows until the server says otherwise, which is also
 * exactly the behaviour of a display nobody ever assigns.
 */
export function resolveView(
    assignment: { view: DisplayView; cycleSeconds: number } | null,
    url: UrlIntent,
    raceId: number,
): ViewBehaviour {
    if (assignment) {
        return behaviourFor(assignment.view, assignment.cycleSeconds, raceId);
    }
    return {
        tab: url.view === 'timing' ? 'timing' : 'standings',
        projector: url.projector,
        cycle: url.cycle,
        // Reachable by URL too, so a display nobody assigns can still be a
        // photo kiosk — the fallback stays complete rather than gaining a view
        // only the operator's list can select.
        slideshow: url.view === 'slideshow',
        cycleMs: url.cycleMs,
        redirectTo: null,
    };
}

/** The choices the operator is offered, in the order they are offered. */
export const VIEW_OPTIONS: readonly { view: DisplayView; label: string }[] = [
    { view: 'STANDINGS', label: 'Standings' },
    { view: 'TIMING', label: "Last heat's times" },
    { view: 'CYCLE', label: 'Cycle between both' },
    { view: 'PROJECTOR', label: 'Projector' },
    { view: 'SLIDESHOW', label: 'Racer photos' },
    { view: 'AWARDS', label: 'Awards ceremony' },
];
