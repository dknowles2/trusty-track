/**
 * Configure the install, once, before anything else runs.
 *
 * A Playwright *setup project* every other project depends on, so it runs
 * first whatever is being filtered to.
 *
 * The first-run gate is the one piece of state these specs share that belongs
 * to the **install** rather than to a race, and it cannot be resolved by
 * "whichever spec happens to go first" once they run at once: several workers
 * open an unconfigured install together, every one of them fills in the
 * organization name and submits `createInitialConfig`, one wins and the rest
 * sit on a navigation that never comes. That was six tests each burning the
 * full two-minute timeout — and the failure named `ensureConfigured`, three
 * steps from the spec that had actually gone wrong.
 *
 * `ensureConfigured` stays in the specs themselves. It costs one request
 * against a configured install, and it is what lets a single spec still be run
 * on its own if the project graph is ever edited.
 *
 * It also builds the track pool. `TimerManager` is one per *track* (#9), so a
 * race that arms a heat holds a device exclusively — two races sharing a track
 * arm over the top of each other, and `_record_results` abandons the run when
 * the lane assignment no longer matches what it was armed with (#50). One
 * track per worker is the smallest thing that fixes it: only one test runs in a
 * worker at a time, so a worker's track is never contended.
 *
 * A pool rather than a track per race, which was the first attempt. Sixty
 * `createTrack` calls cost 26 seconds on a serial run, and inserting a race
 * that references a track committed microseconds earlier failed the foreign key
 * about one run in ten under seven concurrent writers.
 */

import { test as setup } from '@playwright/test';
import { ensureConfigured, gql, trackPoolName } from './support';

setup('configure the install', async ({ page }, testInfo) => {
    await ensureConfigured(page);

    const existing = await gql<{ tracks: { name: string }[] }>(
        page,
        `query PoolTracks { tracks { name } }`,
    );
    const have = new Set(existing.tracks.map((t) => t.name));

    for (let worker = 0; worker < testInfo.config.workers; worker++) {
        const name = trackPoolName(worker);
        if (have.has(name)) continue;
        await gql(
            page,
            `mutation PoolTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
            { track: { name, laneCount: 4, timerType: 'FAKE' } },
        );
    }
});
