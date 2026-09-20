/**
 * The rehearsal (#201).
 *
 * The unit tests cover what gets built. What only a real backend and a real
 * browser can show is the thing the feature actually promises: that one click
 * gets a volunteer to a screen where they can arm a heat and watch it run,
 * without touching hardware or filling in a single form.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql } from './support';

// A practice race is identified by name, not scoped to a test the way a
// seeded race is (#588's "The practice race" section in CLAUDE.md) — every
// test here is contending for the *same* "Practice Race" slot. Under the
// ordinary fully-parallel config two of these clicking at once would resume
// one another's rehearsal rather than each getting its own, which is exactly
// the bug #588 fixed and exactly what makes these tests non-deterministic
// together. Serial trades a few seconds of wall clock for that determinism.
test.describe.configure({ mode: 'serial' });

// A retry resumes whatever rehearsal the failed attempt left behind
// (`crud.existing_practice_race` — "resuming beats duplicating", CLAUDE.md's
// "The practice race" section via #588), heat and all, rather than starting
// fresh — the shape #1224 found: attempt 0 armed and ran a heat, its own
// read-back then died with `ECONNRESET`, and the retry's click resumed that
// same race, so a "no times yet" assertion saw the heat attempt 0 had
// already recorded. Clearing every race this naming scheme owns before each
// attempt (not just each test — `beforeEach` re-runs on a retry the same as
// on a first attempt) puts every attempt back at "no rehearsal yet", the
// state the first test's assertions describe.
//
// "Practice Race" is `PRACTICE_RACE_NAME` (`backend/domain/practice.py`) —
// matched here as a literal prefix rather than imported, since an e2e spec
// has no route to a backend module.
//
// The reused fake-timer track (`crud.practice_track`) is deliberately left
// alone: it is global state shared with the whole install — the same fact
// `.claude/rules/roster.md`'s "The practice race" (#201) and this file's own
// header comment already turn on — and it is one of the pool tracks
// `configure.setup.ts` built for every other spec in this suite to share.
test.beforeEach(async ({ page }) => {
    await ensureConfigured(page);

    const { races } = await gql<{ races: { id: number; name: string }[] }>(
        page,
        `query PracticeRaceCleanupList { races { id name } }`,
    );
    for (const race of races) {
        if (race.name.startsWith('Practice Race')) {
            await gql(page, `mutation PracticeRaceCleanup($id: Int!) { deleteRace(id: $id) }`, {
                id: race.id,
            });
        }
    }
});

test('one click reaches a heat that can be run', async ({ page }) => {
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();

    // Race Control, on the Race tab, with a heat armed and waiting. This runs
    // the heat rather than asserting a button exists, because "ready to arm a
    // heat" is the entire promise and a screen that merely looks ready is what
    // a volunteer would find out about at the start line.
    //
    // The navigation waits on the mutation building the whole rehearsal — a
    // dozen racers with photographs, a schedule, a final — which is well
    // past the default 5s assertion timeout; every `toHaveURL` below waiting
    // on the same click gets the same allowance.
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });

    // A positive assertion that this is genuinely the *first* heat of a
    // fresh rehearsal, armed and rendered — not merely that no times are
    // visible yet, which is also what a page that never rendered the heat
    // looks like (#428's "e2e read-backs that accept any answer"), and would
    // not by itself catch a retry that resumed a rehearsal a previous
    // attempt already ran a heat of: `RaceExecution.tsx` auto-arms whichever
    // heat is next, and an unraced heat 2 is just as "ready to start" as
    // heat 1 — the `beforeEach` above is what actually guarantees this is
    // heat 1. The Start Timer button is only enabled once the fake timer
    // reports ARMED (`FakeTimerMole`).
    const times = page.getByText(/^\d+\.\d{3}s$/);
    await expect(page.getByRole('heading', { name: 'Heat 1' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Start Timer' })).toBeEnabled({
        timeout: 30000,
    });

    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();

    await expect(times.first()).toBeVisible({ timeout: 30000 });
});

test('it never puts a practice race on real hardware', async ({ page }) => {
    // Arming a heat on a real timer sends a signal to a device in a room
    // somebody may be standing in.
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/(\d+)\/control\/race/, { timeout: 30000 });

    const raceId = Number(page.url().match(/\/race\/(\d+)\//)![1]);
    const data = await gql<{ race: { track: { timerType: string } } }>(
        page,
        `query PracticeTrack($id: Int!) { race(raceId: $id) { track { timerType } } }`,
        { id: raceId },
    );

    expect(data.race.track.timerType).toBe('FAKE');
});

test('it is built out enough to rehearse the whole day', async ({ page }) => {
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/(\d+)\/control\/race/, { timeout: 30000 });
    const raceId = Number(page.url().match(/\/race\/(\d+)\//)![1]);

    const data = await gql<{
        race: {
            racers: { id: number; carPassedInspection: boolean }[];
            rounds: { advancementSource: string | null }[];
            heats: { id: number }[];
        };
    }>(
        page,
        `query PracticeShape($id: Int!) {
            race(raceId: $id) {
                racers { id carPassedInspection }
                rounds { advancementSource }
                heats { id }
            }
        }`,
        { id: raceId },
    );

    expect(data.race.racers.length).toBeGreaterThan(0);
    expect(data.race.racers.every((r) => r.carPassedInspection)).toBe(true);
    expect(data.race.heats.length).toBeGreaterThan(0);
    // Advancement is the part of race day that surprises people, so a
    // rehearsal that stops before the final leaves out the bit worth
    // practising.
    expect(data.race.rounds.map((r) => r.advancementSource)).toContain('ALL');
});

test('clicking again resumes the same rehearsal rather than duplicating it (#588)', async ({
    page,
}) => {
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });
    const firstId = Number(page.url().match(/\/race\/(\d+)\//)![1]);

    await page.goto('/');
    // The button itself says so before it is even clicked.
    await expect(page.getByTestId('practice-race')).toHaveText(/Resume practice race/);
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });
    const secondId = Number(page.url().match(/\/race\/(\d+)\//)![1]);

    expect(secondId).toBe(firstId);
});

test('start new builds a genuinely fresh rehearsal instead', async ({ page }) => {
    // The deliberate escape hatch: an operator who really does want to start
    // over is not stuck reopening one they are done with. `races.name` is
    // unique, so this also proves the counted-up name still works once a
    // rehearsal is being resumed by default.
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });
    const firstId = Number(page.url().match(/\/race\/(\d+)\//)![1]);
    const firstName = (
        await gql<{ race: { name: string } }>(
            page,
            `query PracticeName($id: Int!) { race(raceId: $id) { name } }`,
            { id: firstId },
        )
    ).race.name;

    await page.goto('/');
    // Resume is now a split button and "Start new" folded into its chevron's
    // one entry (#1238), so it has to be opened before it can be clicked.
    await page.getByRole('button', { name: 'More practice race options' }).click();
    await page.getByTestId('practice-race-start-new').click();
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });
    const secondId = Number(page.url().match(/\/race\/(\d+)\//)![1]);
    const secondName = (
        await gql<{ race: { name: string } }>(
            page,
            `query PracticeName($id: Int!) { race(raceId: $id) { name } }`,
            { id: secondId },
        )
    ).race.name;

    // Both clicks matching the URL pattern proves nothing on its own — that
    // is also what landing on the *same* race twice would look like. Capture
    // and compare id and name, the way the track lookup above does.
    expect(secondId).not.toBe(firstId);
    expect(secondName).not.toBe(firstName);
});

test('the split button and Create New Race share a row wide, and stack narrow (#1238)', async ({
    page,
}) => {
    // "Start new" used to be a plain underlined word beside two real
    // buttons — the odd one out, and dropped from the phone-stacking rule
    // entirely since it carried neither `.secondary-btn` nor `.primary-btn`.
    // It is folded into Resume's own chevron now, the same split-button
    // shape the roster's Add Racer button already uses, so the header row
    // is back to two controls: the split button and Create New Race.
    await ensureConfigured(page);

    await page.goto('/');
    await page.getByTestId('practice-race').click();
    await expect(page).toHaveURL(/\/race\/\d+\/control\/race/, { timeout: 30000 });

    // Back on Home, the split button is on screen now that a practice race
    // exists.
    await page.goto('/');
    const splitContainer = page.locator('.split-btn-container');
    const create = page.getByRole('button', { name: /Create New Race/i });
    await expect(splitContainer).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    const splitWide = await splitContainer.boundingBox();
    const createWide = await create.boundingBox();
    if (!splitWide || !createWide) {
        throw new Error('the split button or Create New Race has no bounding box');
    }

    // Same row: level tops, and the whole split button the same height as
    // its neighbour.
    expect(Math.abs(splitWide.y - createWide.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(splitWide.height - createWide.height)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 390, height: 844 });
    const actions = page.locator('.home-races-header-actions');
    const actionsBox = await actions.boundingBox();
    const splitNarrow = await splitContainer.boundingBox();
    const createNarrow = await create.boundingBox();
    if (!actionsBox || !splitNarrow || !createNarrow) {
        throw new Error('the split button or Create New Race has no bounding box');
    }

    // Full-width, same as Create New Race — before #1238 "Start new" had
    // neither class and stayed at its natural (narrow) width beside them.
    expect(Math.abs(splitNarrow.width - actionsBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(createNarrow.width - actionsBox.width)).toBeLessThanOrEqual(2);

    // Stacked, split button first, in DOM order.
    expect(createNarrow.y).toBeGreaterThan(splitNarrow.y);

    // The chevron keeps its own content-sized width rather than being
    // stretched along with the container — the `:not(.split-btn-main):not(
    // .split-btn-arrow)` exclusion on the plain `.secondary-btn` full-width
    // rule is what keeps it out of that rule. Without it both halves of the
    // split button would each try to fill the container's width
    // independently: measured directly by removing the exclusion, the arrow
    // ballooned from ~37px to ~201px and the row nearly doubled in height
    // (41px to 77px) — a real, visible regression this bound catches.
    const mainNarrow = await page.locator('.split-btn-main').boundingBox();
    const arrowNarrow = await page.locator('.split-btn-arrow').boundingBox();
    if (!mainNarrow || !arrowNarrow) {
        throw new Error('the split button\'s own halves have no bounding box');
    }
    expect(arrowNarrow.width).toBeLessThanOrEqual(60);
    expect(mainNarrow.height).toBeLessThanOrEqual(50);

    // The chevron still opens the menu at this width, and it does not push
    // the page wider than the viewport — the dropdown hangs from the right
    // edge of a full-width container, which is exactly the geometry that
    // could overflow.
    await page.getByRole('button', { name: 'More practice race options' }).click();
    await expect(page.getByTestId('practice-race-start-new')).toBeVisible();
    const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflows).toBe(false);
});
