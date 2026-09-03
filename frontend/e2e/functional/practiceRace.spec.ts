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

    const times = page.getByText(/^\d+\.\d{4}s$/);
    await expect(times).toHaveCount(0);

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
