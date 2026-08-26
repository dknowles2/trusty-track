/**
 * Screenshots of the timer pages, for docs/hardware-timer.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-timers.spec.ts
 *
 * There is no real timer on a CI runner, so the pictures come from the next
 * best thing: a fake Micro Wizard speaking through the browser-proxy
 * WebSocket, exactly as `test_timer_ws.py` does. That path exercises the real
 * prober, the real profile and the real page — the only pretend part is the
 * device on the far end of the wire, which answers the probe with a genuine
 * K2 banner and reports results in the genuine format.
 *
 * Adds its own proxy-mode track, which is global state on this shared
 * backend: this spec sorts after screenshot-settings (which scopes everything
 * to track-card-0), and the free-race spec already set the precedent of a
 * spec bringing its own track.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCREENSHOT_BACKEND_URL } from '../environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/timers');
const BACKEND_URL = SCREENSHOT_BACKEND_URL;

async function gql(
    page: Page,
    query: string,
    variables: Record<string, unknown> = {},
) {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

/**
 * A Micro Wizard that lives at the end of the proxy WebSocket.
 *
 * Speaks the wire protocol the browser normally speaks — `configure` answered
 * with `ready`, probe commands answered with the banner a real K2 sends —
 * and hands the test a way to inject result bytes.
 */
class FakeMicroWizard {
    private ws!: WebSocket;
    readonly commandsSeen: string[] = [];

    async connect(trackId: number): Promise<void> {
        this.ws = new WebSocket(
            `${BACKEND_URL.replace('http', 'ws')}/ws/timer/${trackId}`,
        );
        this.ws.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data));
            if (message.type === 'configure') {
                this.ws.send(JSON.stringify({ type: 'ready' }));
                return;
            }
            if (message.type === 'serial_tx') {
                const command = Buffer.from(message.data, 'base64').toString();
                this.commandsSeen.push(command);
                if (command === 'RV') {
                    // The banner a real K2 sends, both lines. The prober needs
                    // the whole thing (some firmware writes the serial number
                    // with a space), which is why it is quoted verbatim.
                    this.reply(
                        'Copyright (c) Micro Wizard 2002-2009\r' +
                            'K2 Version 2.3A  Serial Number29284\r',
                    );
                }
            }
        });
        await new Promise<void>((resolve, reject) => {
            this.ws.addEventListener('open', () => resolve());
            this.ws.addEventListener('error', () =>
                reject(new Error('timer websocket refused')),
            );
        });
    }

    reply(text: string): void {
        this.ws.send(
            JSON.stringify({
                type: 'serial_rx',
                data: Buffer.from(text).toString('base64'),
            }),
        );
    }

    close(): void {
        this.ws.close();
    }
}

test('screenshot the timer pages', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    // First-run gate, for whichever spec goes first.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill('Pack 42');
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }

    // A two-lane proxy-mode track of our own. Two lanes, so the bench test
    // finishes with two hand-tripped results rather than needing six.
    const created = await gql(
        page,
        `mutation ($track: TrackInput!) { createTrack(track: $track) { id } }`,
        {
            track: {
                name: 'Timer Demo Track',
                laneCount: 2,
                timerType: 'AUTO_DETECT_PROXY',
            },
        },
    );
    const trackId: number = created.createTrack.id;

    // 01: where the timer settings live — the track card's connection and
    // model controls on System Settings.
    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');
    // The name lives in an <input>, which `hasText` cannot see — but this
    // track was created last, so it is the last card.
    const demoCard = page.getByTestId(/track-card-\d+/).last();
    await expect(demoCard.locator('input[value="Timer Demo Track"]')).toBeVisible();
    await page.waitForTimeout(300);
    await demoCard.screenshot({
        path: path.join(SCREENSHOT_DIR, '01-timer-settings.png'),
    });

    // The diagnostics page, before anything is connected.
    await page.goto('/timer-check');
    await page.waitForLoadState('networkidle');
    const timerCard = page
        .locator('section')
        .filter({ hasText: 'Timer Demo Track' });
    await expect(timerCard.getByText('Not connected')).toBeVisible();

    // The fake device dials in; the prober identifies it; the page goes green.
    const device = new FakeMicroWizard();
    await device.connect(trackId);
    await expect(timerCard.getByText('Ready', { exact: true })).toBeVisible({
        timeout: 20000,
    });
    await expect(timerCard.getByText(/Micro Wizard/i).first()).toBeVisible();
    await page.waitForTimeout(500);

    // 02: the whole card as an operator with a healthy timer sees it —
    // Ready, the identified device, its provenance note, the serial traffic.
    await timerCard.screenshot({
        path: path.join(SCREENSHOT_DIR, '02-timer-check-ready.png'),
    });

    // 03: the bench test, armed and waiting for a human hand on the gate.
    await timerCard.getByTestId(`start-timer-test-${trackId}`).click();
    await expect(
        timerCard.getByTestId(`timer-test-instruction-${trackId}`),
    ).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);
    await timerCard.getByTestId(`timer-test-panel-${trackId}`).screenshot({
        path: path.join(SCREENSHOT_DIR, '03-test-run-armed.png'),
    });

    // Two lanes finish, in the K2's own result format.
    device.reply('A=3.101! B=3.402" \r\n');
    await expect(timerCard.getByText('3.101s')).toBeVisible({ timeout: 10000 });
    await expect(
        timerCard.getByTestId(`download-timer-report-${trackId}`),
    ).toBeVisible();
    await page.waitForTimeout(300);

    // 04: the finished test — times per lane, the download, and the road to
    // an issue. This is the picture the "Testing your timer" section makes
    // its promise with.
    await timerCard.getByTestId(`timer-test-panel-${trackId}`).screenshot({
        path: path.join(SCREENSHOT_DIR, '04-test-run-results.png'),
    });

    device.close();

    // Leave no proxy track behind for later specs to trip on: the main
    // screenshots spec seeds races against tracks[0] and must keep finding
    // the original.
    await gql(page, `mutation { deleteTrack(id: ${trackId}) }`);
});
