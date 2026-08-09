/**
 * The racers' photographs, between heats (#175).
 *
 * The rules are unit-tested in `slideshow.test.ts` — who is in it, in what
 * order, and what happens when the roster moves. What only a real backend can
 * show is that the photographs *arrive*: they are uploaded through one
 * mutation, stored on disk, served from `/static/`, and read back by a query
 * that had never asked for `carImageUrl` before this change.
 *
 * It is also a display view, so it is reachable the two ways every other view
 * is — assigned from Race Control (#174), or asked for in the URL.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

/** A 1x1 PNG. Enough to exercise upload, storage and serving. */
const PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function givePhoto(
    page: import('@playwright/test').Page,
    racer: { id: number; firstName: string; lastName: string },
) {
    const uploaded = await gql<{ uploadImage: string }>(
        page,
        `mutation SlideshowPhoto($dataUrl: String!) { uploadImage(dataUrl: $dataUrl) }`,
        { dataUrl: PIXEL },
    );
    // `RacerInput` requires the names, so an update has to carry them even
    // when it is only setting a photo.
    await gql(
        page,
        `mutation SlideshowAssign($id: Int!, $racer: RacerInput!) {
            updateRacer(id: $id, racer: $racer) { id racerImageUrl }
        }`,
        {
            id: racer.id,
            racer: {
                firstName: racer.firstName,
                lastName: racer.lastName,
                racerImageUrl: uploaded.uploadImage,
            },
        },
    );
    return uploaded.uploadImage;
}

test('a racer with a photo appears in the slideshow', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Slideshow Photos Race');

    // One racer with a photo, the rest without. Only the one should appear:
    // a blank card on a projector reads as the app being broken.
    await givePhoto(page, racers[0]);

    await page.goto(`/race/${raceId}/observation?view=slideshow`);
    await expect(page.getByTestId('slideshow')).toBeVisible();

    await expect(page.getByText(`${racers[0].firstName} ${racers[0].lastName}`)).toBeVisible();
    await expect(page.getByText('1 of 1')).toBeVisible();
});

test('a race with no photos says so rather than showing a blank screen', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Slideshow Empty Race');

    await page.goto(`/race/${raceId}/observation?view=slideshow`);

    await expect(page.getByTestId('slideshow-empty')).toBeVisible();
    await expect(page.getByText(/add racer or car photos at check-in/i)).toBeVisible();
});

test('the operator can put a screen on the slideshow without walking to it', async ({
    browser,
    page,
}) => {
    // The reason #175 waited for #174: another view is worth little while
    // switching to it means finding the screen.
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Slideshow Assignment Race');
    await givePhoto(page, racers[0]);

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await display.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        ['trustytrack.displayId', 'spec-slideshow-1'],
    );
    await display.goto(`/race/${raceId}/observation`);
    await display.waitForLoadState('networkidle');

    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-slideshow-1');
    await expect(row).toBeVisible();
    await row.getByRole('combobox').selectOption('SLIDESHOW');

    await expect(display.getByTestId('slideshow')).toBeVisible({ timeout: 10000 });

    await displayContext.close();
});
