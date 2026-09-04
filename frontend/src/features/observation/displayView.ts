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
    | 'SLIDESHOW'
    | 'STANDINGS_ONLY'
    | 'CHECKIN'
    | 'QRCODE'
    | 'OVERLAY';

/**
 * Which page `QRCODE` points a phone at (#614) — mirrors
 * `backend/domain/displays.py::QRTarget` exactly, the same relationship
 * `DisplayView` has with its own backend enum.
 */
export type QRTarget = 'STANDINGS' | 'VOTE';

/** The live audience display over the voting ballot — every race has
 * standings to point at, and only some ever turn voting on. */
export const DEFAULT_QR_TARGET: QRTarget = 'STANDINGS';

/**
 * How the `STANDINGS_ONLY` view gets through a list too long for one screen
 * (#663) — mirrors `backend/domain/displays.py::ScrollBehavior` exactly, the
 * same relationship `DisplayView` has with its own backend enum.
 */
export type ScrollBehavior = 'PAGING' | 'SMOOTH';

/** Paging over smooth-scrolling — the more familiar of the two. */
export const DEFAULT_SCROLL_BEHAVIOR: ScrollBehavior = 'PAGING';

/** Whether `CHECKIN` lists everybody or only the racers still pending —
 * `CHECKIN`'s own rider, the same shape as `ScrollBehavior` for
 * `STANDINGS_ONLY`. Defaults to listing everybody. */
export const DEFAULT_SHOW_CHECKED_IN = true;

/** Whether `OVERLAY` shows its compact top-5 standings ticker alongside
 * its lower-third bar (#616) — `OVERLAY`'s own rider, the same shape as
 * `DEFAULT_SHOW_CHECKED_IN`. Defaults to on: a lower-third bar alone
 * leaves the screen blank between heats, and the ticker is what fills it. */
export const DEFAULT_SHOW_STANDINGS_TICKER = true;

/** What the observation page actually does, once everything is resolved. */
export interface ViewBehaviour {
    tab: 'standings' | 'timing';
    projector: boolean;
    cycle: boolean;
    /** The racers' photographs, rotating (#175). */
    slideshow: boolean;
    /**
     * The leaderboard alone, filling the whole screen (#663) — no Now
     * Racing / On Deck panels.
     */
    standingsOnly: boolean;
    /**
     * Who has checked in and who has not, grouped by racing group (#612) —
     * the "Please Check-In" kiosk.
     */
    checkin: boolean;
    /**
     * A large, high-contrast QR code that opens this race on a phone
     * (#614) — the answer to "how do I get fifty parents in a gym onto the
     * right address" that shouting an IP address never was.
     */
    qrcode: boolean;
    /**
     * A transparent broadcast graphic for an OBS Studio Browser Source
     * (#616) — a lower-third bar plus a finish banner, meant to be
     * composited over camera video rather than shown on its own.
     */
    overlay: boolean;
    cycleMs: number;
    /** How `standingsOnly` gets through a list too long for one screen. */
    scrollBehavior: ScrollBehavior;
    /** Whether `checkin` lists everybody, or only who is still pending. */
    showCheckedIn: boolean;
    /** Which page `qrcode` points a phone at. */
    qrTarget: QRTarget;
    /** Whether `overlay` shows its compact top-5 standings ticker. */
    showStandingsTicker: boolean;
    /** The ceremony is its own route, so the page redirects rather than renders. */
    redirectTo: string | null;
}

/** What the URL asked for, if anything. */
export interface UrlIntent {
    view: string | null;
    projector: boolean;
    cycle: boolean;
    cycleMs: number;
    scrollBehavior: ScrollBehavior;
    showCheckedIn: boolean;
    qrTarget: QRTarget;
    showStandingsTicker: boolean;
}

export function readUrl(params: URLSearchParams): UrlIntent {
    return {
        view: params.get('view'),
        projector: params.get('projector') === 'true',
        cycle: params.get('cycle') === 'true',
        cycleMs: parseInt(params.get('cycle_interval') || '10000'),
        scrollBehavior: params.get('scroll') === 'smooth' ? 'SMOOTH' : DEFAULT_SCROLL_BEHAVIOR,
        showCheckedIn: params.get('checkin_show') !== 'pending',
        qrTarget: params.get('qr_target') === 'vote' ? 'VOTE' : DEFAULT_QR_TARGET,
        // Named after what it hides, the same shape as `checkin_show=pending`
        // above — a streamer who wants the bar alone types one word.
        showStandingsTicker: params.get('overlay_standings') !== 'hidden',
    };
}

export function behaviourFor(
    view: DisplayView,
    cycleSeconds: number,
    raceId: number,
    scrollBehavior: ScrollBehavior = DEFAULT_SCROLL_BEHAVIOR,
    showCheckedIn: boolean = DEFAULT_SHOW_CHECKED_IN,
    qrTarget: QRTarget = DEFAULT_QR_TARGET,
    showStandingsTicker: boolean = DEFAULT_SHOW_STANDINGS_TICKER,
): ViewBehaviour {
    const base = {
        projector: false,
        cycle: false,
        slideshow: false,
        standingsOnly: false,
        checkin: false,
        qrcode: false,
        overlay: false,
        cycleMs: cycleSeconds * 1000,
        scrollBehavior,
        showCheckedIn,
        qrTarget,
        showStandingsTicker,
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
        case 'STANDINGS_ONLY':
            return { ...base, tab: 'standings', standingsOnly: true };
        case 'CHECKIN':
            return { ...base, tab: 'standings', checkin: true };
        case 'QRCODE':
            return { ...base, tab: 'standings', qrcode: true };
        case 'OVERLAY':
            return { ...base, tab: 'standings', overlay: true };
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
    assignment: {
        view: DisplayView;
        cycleSeconds: number;
        scrollBehavior?: ScrollBehavior;
        showCheckedIn?: boolean;
        qrTarget?: QRTarget;
        showStandingsTicker?: boolean;
    } | null,
    url: UrlIntent,
    raceId: number,
): ViewBehaviour {
    if (assignment) {
        return behaviourFor(
            assignment.view,
            assignment.cycleSeconds,
            raceId,
            assignment.scrollBehavior ?? DEFAULT_SCROLL_BEHAVIOR,
            assignment.showCheckedIn ?? DEFAULT_SHOW_CHECKED_IN,
            assignment.qrTarget ?? DEFAULT_QR_TARGET,
            assignment.showStandingsTicker ?? DEFAULT_SHOW_STANDINGS_TICKER,
        );
    }
    return {
        tab: url.view === 'timing' ? 'timing' : 'standings',
        projector: url.projector,
        cycle: url.cycle,
        // Reachable by URL too, so a display nobody assigns can still be a
        // photo kiosk — the fallback stays complete rather than gaining a view
        // only the operator's list can select.
        slideshow: url.view === 'slideshow',
        standingsOnly: url.view === 'standings_only',
        checkin: url.view === 'checkin',
        qrcode: url.view === 'qrcode',
        overlay: url.view === 'overlay',
        cycleMs: url.cycleMs,
        scrollBehavior: url.scrollBehavior,
        showCheckedIn: url.showCheckedIn,
        qrTarget: url.qrTarget,
        showStandingsTicker: url.showStandingsTicker,
        redirectTo: null,
    };
}

/**
 * The choices the operator is offered, in the order they are offered.
 *
 * `cycles` marks the views that advance on a timer the operator can set —
 * the tab cycle, the photo slideshow, and the standings-only view. The
 * seconds control on the Displays panel reads this rather than naming
 * views, so a future view that cycles gets its control by declaring it
 * here.
 */
export const VIEW_OPTIONS: readonly {
    view: DisplayView;
    label: string;
    cycles: boolean;
}[] = [
    { view: 'STANDINGS', label: 'Standings', cycles: false },
    { view: 'TIMING', label: "Last heat's times", cycles: false },
    { view: 'CYCLE', label: 'Cycle between both', cycles: true },
    { view: 'PROJECTOR', label: 'Projector', cycles: false },
    { view: 'SLIDESHOW', label: 'Racer photos', cycles: true },
    { view: 'STANDINGS_ONLY', label: 'Standings only', cycles: true },
    { view: 'CHECKIN', label: 'Check-in progress', cycles: false },
    { view: 'QRCODE', label: 'QR code', cycles: false },
    { view: 'OVERLAY', label: 'Broadcast overlay (OBS)', cycles: false },
    { view: 'AWARDS', label: 'Awards ceremony', cycles: false },
];

/** Whether a view advances on a timer whose interval the operator can set. */
export function viewCycles(view: DisplayView): boolean {
    return VIEW_OPTIONS.some((option) => option.view === view && option.cycles);
}

/** Whether a view offers the paging/smooth-scroll choice (#663). Only
 * `STANDINGS_ONLY` does today — a list that fills the whole screen is the
 * one place "how do I get through more than fits" is a real question; every
 * other cycling view already fits in one screenful and just alternates. */
export function viewScrolls(view: DisplayView): boolean {
    return view === 'STANDINGS_ONLY';
}

/** Whether a view offers the "list everybody / pending only" choice (#612).
 * Only `CHECKIN` does — it is the one view a large pack might want trimmed
 * to save screen room, the same reasoning `viewScrolls` gives
 * `STANDINGS_ONLY`. */
export function viewHasCheckedInToggle(view: DisplayView): boolean {
    return view === 'CHECKIN';
}

/** Whether a view offers the "which page does it open" choice (#614). Only
 * `QRCODE` does — it is the one view with a page to choose between. */
export function viewHasQrTargetToggle(view: DisplayView): boolean {
    return view === 'QRCODE';
}

/** Whether a view offers the "show the standings ticker" choice (#616). Only
 * `OVERLAY` does — it is the one view whose lower-third bar leaves room
 * between heats for something else to fill. */
export function viewHasStandingsTickerToggle(view: DisplayView): boolean {
    return view === 'OVERLAY';
}

/**
 * The views to offer for one screen.
 *
 * The ceremony is left out of a race that has no awards. Choosing it there
 * sends the screen to a page whose only content is a line saying there is
 * nothing to announce — and most races never have any, since the awards are
 * optional. An option that can only disappoint is worse than one that is not
 * there.
 *
 * It is kept when the screen is already showing it, whatever the race holds.
 * A row whose current view is missing from its own list renders a select with
 * nothing chosen, so the operator cannot see what the screen is doing — which
 * is reachable by deleting the last award while a ceremony is up.
 *
 * This is an *offer*, not a permission. The server still accepts the
 * assignment, and the ceremony page still says for itself when a race has no
 * awards; a second copy of the rule on the server would be one more thing to
 * keep in step for no gain.
 *
 * `STANDINGS_ONLY`, `CHECKIN`, `QRCODE` and `OVERLAY` need no such gating —
 * unlike the ceremony none of the four has anything it can be missing (there
 * is always a leaderboard, always a roster, this race's own address always
 * resolves to something even before voting is ever turned on, and a heat can
 * always be armed even before the first one has run), so all four are
 * offered unconditionally like every other ordinary view.
 */
export function viewOptionsFor(
    hasAwards: boolean,
    current: DisplayView,
): readonly (typeof VIEW_OPTIONS)[number][] {
    if (hasAwards || current === 'AWARDS') return VIEW_OPTIONS;
    return VIEW_OPTIONS.filter((option) => option.view !== 'AWARDS');
}
