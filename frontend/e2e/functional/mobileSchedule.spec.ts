/**
 * The Schedule tab's per-round table on a phone (issue #1139).
 *
 * `ScheduleManagement.tsx` renders each round as a Heat · Lane 1…N · Actions
 * `<table>` inside an `overflowX: auto` div. At 390px on a 4-lane track the
 * table is 553px wide, so lanes 3 and 4 and the whole Actions column
 * (Run/Re-Run) sit off-screen with no scroll cue, and each visible lane cell
 * wraps to three lines — a 12-heat round ran roughly 1,300px tall while
 * showing half its lanes. Under 600px the round now renders one card per
 * heat instead (`SortableHeatCard`), one line per lane, with the drag handle
 * and Run/Re-Run in the header.
 *
 * `mobileRaceTab.spec.ts` is the shape this follows: seed through the API,
 * drive the one screen under test with a real browser, and measure the
 * geometry directly rather than trust that "it looks fine".
 */

import { expect, test, type Page } from '@playwright/test';

import { createSchedule, ensureConfigured, gql, readHeats, seedRace, type SeededRacer } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

/**
 * Twelve checked-in racers on a 4-lane track is the report's own "12-heat
 * round" shape — PPC seeds lane 1 with every racer once, so the heat count
 * equals the checked-in count. `seedRace` only creates six; these are the
 * other six, added the same way `seedRace` itself creates its own.
 */
async function addMoreRacers(
    page: Page,
    raceId: number,
    startCarNumber: number,
    count: number,
): Promise<SeededRacer[]> {
    const racers: SeededRacer[] = [];
    for (let i = 0; i < count; i++) {
        const carNumber = startCarNumber + i;
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation AddScheduleRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    firstName: `Reserve${carNumber}`,
                    lastName: 'Racer',
                    carNumber,
                },
            },
        );
        await gql(
            page,
            `mutation AddScheduleCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
        racers.push({ id: created.createRacer.id, firstName: `Reserve${carNumber}`, lastName: 'Racer', carNumber });
    }
    return racers;
}

test('a 4-lane heat 1 shows every lane and the Run button within a 390px viewport, and a 12-heat round is well short of ~1,300px (#1139)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Mobile Schedule Cards ' + Date.now());
    // seedRace's own six racers, plus six more — twelve checked-in racers on
    // this worker's 4-lane track produces the report's own 12-heat round.
    await addMoreRacers(page, raceId, 7, 6);
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/control/schedule`);
    await page.waitForLoadState('networkidle');

    // No sideways scroll at all — the table's own 553px-wide symptom on a
    // 390px screen, with nothing on screen to say more was off to the side.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // The table must not have rendered at all under 600px — only one of the
    // table/card branches is ever mounted.
    await expect(page.getByRole('table')).toHaveCount(0);

    const heats = await readHeats(page, raceId);
    expect(heats.length).toBe(12);

    const roundIds = [...new Set(heats.map((h) => h.roundId))];
    expect(roundIds.length).toBe(1);
    const roundId = roundIds[0];
    const cardsContainer = page.getByTestId(`schedule-heat-cards-${roundId}`);
    await expect(cardsContainer).toBeVisible();

    // Found by its own heat id, not by a "Heat 1" text filter — that text
    // is also a substring of "Heat 10"/"Heat 11"/"Heat 12" in a 12-heat
    // round, so a substring filter would resolve to more than one card.
    const heat1 = heats.find((h) => h.heatNumber === 1);
    expect(heat1).toBeDefined();
    const heat1Card = page.getByTestId(`schedule-heat-card-${heat1!.id}`);
    await expect(heat1Card).toBeVisible();

    // Every lane line for heat 1 is present, and its bounding box sits
    // fully inside the 390px viewport — the exact thing the table's lanes 3
    // and 4 failed at.
    const heat1Lanes = ['L1', 'L2', 'L3', 'L4'];
    for (const laneLabel of heat1Lanes) {
        const laneLine = heat1Card.getByText(laneLabel, { exact: true });
        await expect(laneLine).toBeVisible();
        const box = await laneLine.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    }

    // The Run button — the table's own Actions column, entirely off-screen
    // at 390px for a 4-lane track — is fully visible and inside the phone's
    // own width.
    const runButton = heat1Card.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeVisible();
    const runBox = await runButton.boundingBox();
    expect(runBox).not.toBeNull();
    expect(runBox!.x).toBeGreaterThanOrEqual(0);
    expect(runBox!.x + runBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // Every card in the 12-heat round stays well short of the report's own
    // "each visible lane cell wraps to three lines" symptom — a card holds
    // one *single* line per lane (ellipsised rather than wrapped), so its
    // height is bounded by its lane count rather than by how long a name
    // happens to be.
    const allCards = cardsContainer.locator('[data-testid^="schedule-heat-card-"]');
    const cardCount = await allCards.count();
    expect(cardCount).toBe(12);
    let totalCardHeight = 0;
    for (let i = 0; i < cardCount; i++) {
        const box = await allCards.nth(i).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThanOrEqual(160);
        totalCardHeight += box!.height;
    }
    // Twelve cards at up to 160px each bounds the round at 1,920px in the
    // worst case — the guarantee that matters is the per-card cap just
    // above, which is what stops one long name from blowing a card up the
    // way three lines of wrapped text did in the table; this is the
    // corresponding bound on the whole round.
    expect(totalCardHeight).toBeLessThanOrEqual(160 * cardCount);
});

test('the Schedule tab still renders the ordinary table at 1280px (#1139)', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Desktop Schedule Table ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/race/${raceId}/control/schedule`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-testid^="schedule-heat-card-"]')).toHaveCount(0);
});
