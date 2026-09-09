/**
 * What every documentation screenshot spec shares.
 *
 * Data directory cleanup is handled by the webServer command in
 * `playwright.screenshots.config.ts` so the clean happens before the backend
 * process starts, guaranteeing a fresh database on every run.
 *
 * The rest of this file exists to stop the images churning. A checked-in
 * screenshot that differs on every run is not a picture, it is a binary file
 * that rewrites itself: a change to one page rewrote roughly fifty of them,
 * and two branches touching the documentation conflicted on all fifty. Nothing
 * about that is visible in a diff, so it reads as noise rather than as a
 * problem with a cause.
 *
 * The data the app invents — the fake timer's lane times and the roster
 * `populateRace` makes up — is dealt with on the backend, by the
 * `TRUSTYTRACK_DEMO_SEED` the config sets. What is left is the version stamp
 * in the navigation bar, which is built from the git hash and so changes on
 * literally every commit, and the audience display's own id, which a fresh
 * Playwright browser profile mints a new UUID for on every run. Both are
 * handled here.
 *
 * The display id matters because #495's default name is *derived* from it
 * (`domain/display_names.whimsical_name`) — deterministic given the id, but
 * the id itself is not, so `observation/08-displays-panel.png` and
 * `11-ceremony-controls.png` would show a different animal every run without
 * this.
 *
 * Import `test` and `expect` from this file rather than from `@playwright/test`.
 */

import { test as base, expect, type Locator } from '@playwright/test';

/** Hidden rather than removed, so nothing reflows around the gap it leaves. */
const HIDE_UNSTABLE = `[data-testid="app-version"] { visibility: hidden !important; }`;

/**
 * A fixed instant, so anything computed from `new Date()`/`Date.now()` reads
 * the same on every run rather than drifting with however long the suite
 * takes to reach it.
 *
 * `RaceExecution.tsx`'s Round Progress panel is the one that made this
 * necessary: "Est. finish: {formatClockTime(estimatedFinishTime(...,
 * new Date()))}" is computed at render time from the real clock, so any
 * screenshot of an unraced round's Round Progress panel showed a genuinely
 * different minute depending on how far into the run it was taken —
 * `race-day/12`, `race-day/13` and `race-day/31` all carry it. Freezing
 * `Date` is a better fix than documenting a third clock-dependent exception
 * alongside the activity log and the check-in scanner, because — unlike
 * those two — nothing here needs the *real* clock: the value only has to be
 * stable, not current.
 *
 * `setTimeout`/`setInterval`/`requestAnimationFrame` are deliberately left
 * alone (this is not `page.clock.install()`, which virtualizes those too) —
 * freezing them would risk hanging anything that waits on a real timer
 * firing (a WebSocket reconnect backoff, `raceFlow.ts`'s countdown), and
 * nothing here needs that. Only `Date` reads the frozen instant; a timer
 * still fires on the real wall clock, it just reads the same `Date.now()`
 * every time it does.
 */
const FIXED_NOW = new Date('2026-01-15T16:00:00.000Z').getTime();

/**
 * The key `displayIdentity.ts` reads and writes — kept in step with it here
 * rather than imported, since this file runs outside the app's build.
 */
const DISPLAY_ID_KEY = 'trustytrack.displayId';
/** Mirrors `FakeTimerMole`'s own key; the panel reads it on mount. */
const FAKE_TIMER_COLLAPSED_KEY = 'trustytrack.fakeTimerMole.collapsed';

/**
 * Fixed rather than left to mint itself, so the default name #495 derives
 * from it (`whimsical_name`) is the same animal on every run.
 */
const FIXED_DISPLAY_ID = 'trustytrack-docs-screenshot-display';

export const test = base.extend({
    page: async ({ page }, use) => {
        // Recharts' `<Bar isAnimationActive="auto">` (the default, and what
        // `RaceStats.tsx` uses for both bar charts) checks
        // `prefers-reduced-motion` itself and skips its JS-driven mount
        // animation when it is set — so this alone, with no production code
        // change, is what stops `race-stats/01-stats-tab-nav.png` (and any
        // other bar chart photographed shortly after it mounts) from
        // sometimes catching a bar mid-grow. `page.screenshot({ animations:
        // 'disabled' })` does not reach this: that option finishes CSS
        // transitions and Web Animations, but Recharts drives its bars with
        // its own `requestAnimationFrame` loop, which is invisible to it.
        await page.emulateMedia({ reducedMotion: 'reduce' });

        // An init script rather than `addStyleTag`, because the specs navigate
        // many times and a style added to one document does not survive the
        // next one. This runs on every document, before the app renders, so no
        // screenshot can catch the stamp on its way out.
        await page.addInitScript((css: string) => {
            const inject = () => {
                const style = document.createElement('style');
                style.setAttribute('data-screenshot-stability', '');
                style.textContent = css;
                document.head.appendChild(style);
            };
            if (document.head) inject();
            else document.addEventListener('DOMContentLoaded', inject);
        }, HIDE_UNSTABLE);

        // Freezes `Date` (constructor and `.now()`) to `FIXED_NOW`, leaving
        // every real timer alone — see the constant's own comment for why
        // this is not `page.clock.install()`. `Reflect.construct` rather than
        // `super(...args)`, so the constructor does not have to match one of
        // `Date`'s several overloaded signatures at the type level — it only
        // has to forward whatever arguments it received, none when called as
        // `new Date()` and whatever was given otherwise. `new Date(x)` with an
        // argument still behaves normally, so a component formatting a
        // *stored* timestamp (a heat's `recordedAt`, say) is unaffected.
        await page.addInitScript((fixedNow: number) => {
            const RealDate = window.Date;
            function FrozenDate(...args: unknown[]): Date {
                return Reflect.construct(RealDate, args.length === 0 ? [fixedNow] : args) as Date;
            }
            FrozenDate.prototype = RealDate.prototype;
            Object.setPrototypeOf(FrozenDate, RealDate);
            (FrozenDate as unknown as { now: () => number }).now = () => fixedNow;
            window.Date = FrozenDate as unknown as DateConstructor;
        }, FIXED_NOW);

        // Seeded before the app ever asks `displayIdentity.displayId()` for
        // one, so it never mints its own UUID. `localStorage.setItem` is a
        // no-op the first time — nothing has navigated to the app's origin
        // yet — so this alone would not survive; `addInitScript` runs again
        // on every navigation, which is what makes it stick.
        await page.addInitScript(
            ({ key, id }: { key: string; id: string }) => {
                try {
                    window.localStorage.setItem(key, id);
                } catch {
                    // Some browser profiles refuse storage; the app already
                    // tolerates that (see `displayIdentity.ts`), and a
                    // screenshot spec that never opens a display panel does
                    // not care either way.
                }
            },
            { key: DISPLAY_ID_KEY, id: FIXED_DISPLAY_ID },
        );

        // The Fake Timer Controls panel starts collapsed in every docs run.
        //
        // Every race in these specs is on a fake timer, because no CI runner
        // has a finish line — so the panel floats over the corner of every
        // Race Control and Free Race screenshot, covering the lanes and the
        // round progress behind it. It is a debugging aid, and a reader of
        // these guides is looking at a screen that in their hall has a real
        // timer and no panel at all.
        //
        // Seeded rather than clicked, for #48's reason: the first attempt
        // collapsed it with a click in `race-day.spec.ts`, which fixed the one
        // picture somebody happened to be looking at and left the free-race
        // shots — and every future spec — exactly as they were. The panel
        // reads this key on mount, so setting it here reaches all of them.
        //
        // `race-day.spec.ts` expands it explicitly for the one screenshot that
        // is *of* the panel.
        await page.addInitScript((key: string) => {
            try {
                window.localStorage.setItem(key, 'true');
            } catch {
                // Storage refused: the panel opens expanded, which is only a
                // worse picture, never a failed run.
            }
        }, FAKE_TIMER_COLLAPSED_KEY);

        // Every screenshot waits for the pictures, the webfonts, and freezes
        // the animation.
        //
        // These were what was left moving once the version stamp and the
        // invented data were pinned, and all three were being handled by
        // sleeping: `waitForTimeout(500)` after opening a modal,
        // `waitForTimeout(3000)` after populating a roster. A sleep is a
        // guess about a machine — too short on a loaded CI runner, always too
        // long on a fast laptop — and it is why a run still rewrote a dozen
        // images with nothing behind it.
        //
        // The font wait is the one that made the *machine* matter, not just
        // the run: `index.css` declares both bundled faces `font-display:
        // swap`, which is right for an operator (never block first paint on a
        // font load from local disk) and wrong for a screenshot taken inside
        // that swap window, which captures the browser's fallback system font
        // instead of the bundled one — a different picture on every host,
        // simply because the shutter can fire before the font finishes
        // parsing. `document.fonts.ready` is what `branding.spec.ts` already
        // waits on to assert the fonts loaded at all; waiting on it here too
        // is what makes every screenshot wait for the same thing that test
        // does before it is willing to call the page "ready".
        //
        // `animations: 'disabled'` fast-forwards CSS transitions to their end
        // state, so a modal is photographed where it is going to settle rather
        // than wherever it had got to. Both waits are soft: a page with a
        // genuinely broken image, or a font that never loads, should produce
        // the picture that shows that, not a timeout with no picture at all.
        const takeScreenshot = page.screenshot.bind(page);
        page.screenshot = (async (options = {}) => {
            // The navigation bar's race selector pill (#843). It reads
            // `GET_RACES_NAV`, a query with no dependency on whatever the
            // rest of the page is waiting for — so on a page whose own
            // content settles first, a screenshot taken the moment that
            // content is ready can still catch the pill between a fresh
            // navigation (or a `createRace`-triggered cache invalidation)
            // and that query's own response landing. The window is normally
            // a handful of milliseconds, wide enough to matter once many
            // specs are creating races on the same shared backend at once —
            // `Navigation.tsx` no longer claims "Select a Race" while that
            // request is still in flight (see `raceContextUnresolved`
            // there), but the pill can still read blank in that window, and
            // a screenshot of blank-then-named is exactly as nondeterministic
            // as "Select a Race"-then-named. Skipped when there is no race in
            // the URL (the steady "Select a Race" state on Home is correct
            // and must not be waited past) or no nav bar at all (projector
            // mode, the ceremony route, the voting ballot — none render one).
            if (/\/race\/\d+/.test(page.url())) {
                await page
                    .waitForFunction(
                        () => {
                            const pill = document.querySelector('[data-testid="race-selector-pill"]');
                            if (!pill) return true;
                            const text = pill.textContent ?? '';
                            return text.trim().length > 0 && !text.includes('Select a Race');
                        },
                        undefined,
                        { timeout: 5000 },
                    )
                    .catch(() => {});
            }
            await page
                .waitForFunction(
                    () => Array.from(document.images).every((image) => image.complete),
                    undefined,
                    { timeout: 5000 },
                )
                .catch(() => {});
            await page
                .evaluate(() => document.fonts.ready)
                .catch(() => {});
            // `Modal.tsx`'s dialog element is itself the scrollable container
            // (`overflowY: 'auto'`), not some inner div — so whenever an
            // action inside it (filling a field near the foot of a tall form,
            // clicking a control that was off-screen) makes Playwright scroll
            // the *target* into view, it leaves the *dialog's own* `scrollTop`
            // at whatever that took, and nothing ever puts it back. The next
            // `page.screenshot()` then shows the dialog scrolled to a position
            // that depends on exactly how much scrolling that click needed —
            // itself a function of image-load timing and font metrics, which
            // is why this reproduced under load and not in a quiet run. Two
            // real captures of `race-day/02-check-in-modal-inspected.png`
            // differed only in this: one scrolled past the "Racer Check In"
            // heading, one not. Resetting every open dialog to the top before
            // every page-level screenshot is what `settleTransitions` cannot
            // do on its own — a scroll offset is not an `Animation` — and a
            // locator-scoped screenshot (`dialog.screenshot()`, used where a
            // spec wants only the dialog rather than the whole page) has to
            // reset its own, since this hook never runs for it.
            await page
                .evaluate(() => {
                    document.querySelectorAll('[role="dialog"]').forEach((el) => {
                        el.scrollTop = 0;
                    });
                })
                .catch(() => {});
            // A defence against a specific, plausible-but-unconfirmed cause
            // of #843's reopened residual — not a fix proven to work, and
            // said so here rather than left to read as one.
            //
            // Every failing pixel across all 40 of the reopened issue's
            // images sat tightly inside the navigation bar race selector
            // pill's own text glyphs — including on the Home page, where the
            // pill's text ("Select a Race") is a static string that never
            // changes at all. That shape (edges of anti-aliased text, not
            // the pill's flat background or border) is what a background
            // colour caught mid-transition looks like, which pointed at
            // `Navigation.tsx`'s pill: it sets its background from
            // `onMouseEnter`/`onMouseLeave` against `transition: all 0.2s
            // ease`, the same shape `.settings-nav button`'s CSS `:hover`
            // already needed `settleTransitions` for, and nothing called it
            // here. No spec hovers or clicks the pill directly, but
            // Playwright's virtual cursor is never reset between actions or
            // navigations within one spec, so a click on anything else
            // earlier in the same flow could in principle leave it resting
            // inside the pill's bounding box once a later page renders it in
            // the same screen position.
            //
            // That hypothesis did not survive verification: two bootstrap
            // passes against fresh CI runs, each rebuilding the baseline
            // from that run's own output, reproduced the identical ~40-image
            // signature both times with the total pixel count moving from
            // 1,510 to 5,714 between passes rather than shrinking toward
            // zero — not what a real fix converging on noise looks like, and
            // consistent with `settleTransitions` finding nothing to await
            // (no spec triggers the handler, so there is no in-flight
            // transition here to catch). The mechanism remains open; see
            // `.claude/rules/documentation.md`'s screenshot section for the
            // full record, including the leading unconfirmed hypothesis
            // (Chromium rendering non-determinism specific to this element's
            // anti-aliased text over a semi-transparent, alpha-blended
            // background). Left in rather than reverted because it is a
            // correct defence against the class of bug it targets even
            // though it is not sufficient on its own, and because removing
            // it would not shrink the residual it did not cause.
            await page.mouse.move(-1, -1).catch(() => {});
            await settleTransitions(page.locator('body')).catch(() => {});
            return takeScreenshot({ animations: 'disabled', ...options });
        }) as typeof page.screenshot;

        // Playwright's fixture callback, not React's `use`. The lint rule
        // cannot tell them apart, and there is nothing to rename — the
        // parameter position is the API.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use(page);
    },
});

export { expect };

/**
 * Waits for CSS transitions and animations running on this element or its
 * descendants to reach their end state, then resolves.
 *
 * `page.screenshot({ animations: 'disabled' })` only finishes an animation
 * that already exists (`Element.getAnimations()`) at the moment the
 * screenshot is taken — a CSS transition triggered by a click does not
 * necessarily exist yet at that instant, because the browser has not always
 * run the style recalc that instantiates it. That is what made
 * `race-setup/11-edit-race-settings.png` non-deterministic even with
 * `animations: 'disabled'` already in play: `.settings-nav button`'s
 * `transition: background-color 0.2s` (from the plain `button` rule in
 * `index.css`) sometimes had not started by the time the screenshot's own
 * "finish what's running" step looked for it, so the screenshot captured a
 * genuinely in-flight frame — a real color, not noise, and worse under load
 * (a busier machine gives the recalc longer to be still pending).
 *
 * The two `requestAnimationFrame` ticks give that recalc a chance to run
 * before asking what is animating; by two frames after a click has already
 * been awaited (this project's specs always `await` a `click()` and then an
 * `expect(...).toBeVisible()` before calling this), the transition this
 * exists for is reliably instantiated. Awaiting every animation's own
 * `finished` promise then settles it exactly, rather than guessing its
 * duration the way a `waitForTimeout` would.
 */
export async function settleTransitions(locator: Locator): Promise<void> {
    await locator.evaluate(async (el) => {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const animations = el.getAnimations({ subtree: true });
        await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    });
}

/**
 * A small, repeatable number in `[0, span)` for `key`.
 *
 * For a spec that needs its fake data to look unpatterned in a picture and to
 * be the same picture next time. `Math.random()` is what the specs used, and
 * it was the last thing making every standings, stats and observation image
 * differ on every run.
 *
 * FNV-1a: no cryptographic claim, only the two properties above.
 */
export function jitter(key: string, span = 0.05): number {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) / 4294967296) * span;
}
