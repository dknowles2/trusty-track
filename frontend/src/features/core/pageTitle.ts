/**
 * What the browser tab is called.
 *
 * Every page was called "Trusty Track", because that is what `index.html`
 * says and nothing ever changed it. On race day an operator has several tabs
 * open at once — the schedule, the screen driving the projector, the
 * standings somebody asked to see — and a strip of identical tabs is no help
 * in finding any of them.
 *
 * Two rules shape the wording, and both are about how a tab strip is read:
 *
 * **What distinguishes this tab comes first.** A tab shows perhaps twenty
 * characters before it truncates, so a title beginning "Trusty Track" spends
 * all of them on the one thing every tab has in common.
 *
 * **The second half says what this page is about** — the race for a race
 * page, the application for everything else. So it is "Standings — 2026
 * Pinewood Derby" and "Settings — Trusty Track", which also means a pack
 * rehearsing on a practice race can tell the two events apart.
 *
 * The words are the ones on the screen itself: the navigation's labels, and
 * Race Control's own tabs for its sub-sections. A title nobody can trace back
 * to something they clicked is a second vocabulary to learn.
 */

const APP_NAME = 'Trusty Track';

/** The race page a path is on, in the words the navigation uses. */
function raceView(rest: string): string {
    // `rest` is what follows `/race/<id>`, so the roster is the empty string.
    if (rest === '' || rest === '/') return 'Roster';
    if (rest.startsWith('/control')) {
        // Race Control's own tabs, matching the buttons that switch them —
        // the sub-section is what the operator changed, so it is what the
        // tab should say.
        if (rest.startsWith('/control/free-race')) return 'Free Race';
        if (rest.startsWith('/control/race')) return 'Race';
        if (rest.startsWith('/control/displays')) return 'Displays';
        return 'Schedule';
    }
    if (rest.startsWith('/standings')) return 'Standings';
    if (rest.startsWith('/awards/present')) return 'Awards Ceremony';
    if (rest.startsWith('/awards')) return 'Awards';
    if (rest.startsWith('/stats')) return 'Stats';
    if (rest.startsWith('/print/heat-sheet')) return 'Heat Sheet';
    if (rest.startsWith('/print/results')) return 'Results Sheet';
    if (rest.startsWith('/print')) return 'Print';
    if (rest.startsWith('/observation')) return 'Live';
    return 'Race';
}

/**
 * The title for a path, given the name of the race it is about.
 *
 * `raceName` is null while the name is still being fetched, and the title is
 * then the view alone — "Standings" rather than "Standings — undefined". It
 * settles a moment later, which is invisible; the alternative is a tab that
 * announces a mistake.
 */
export function pageTitle(pathname: string, raceName?: string | null): string {
    const race = pathname.match(/^\/race\/(\d+)(.*)$/);
    if (race) {
        const view = raceView(race[2]);
        return raceName ? `${view} — ${raceName}` : view;
    }
    if (pathname.startsWith('/system-settings')) return `Settings — ${APP_NAME}`;
    if (pathname.startsWith('/timer-check')) return `Timer Check — ${APP_NAME}`;
    if (pathname.startsWith('/activity')) return `Activity — ${APP_NAME}`;
    // The home page, and anything unrecognised. There is nothing to add that
    // the reader cannot see, and a guessed view name would be worse than the
    // application's own.
    return APP_NAME;
}

/** The race a path belongs to, or null. Shared with the title rule above. */
export function raceIdIn(pathname: string): number | null {
    const match = pathname.match(/^\/race\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}
