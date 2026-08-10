/**
 * The timer test: bench-exercising a timer and reporting what happened (#235).
 *
 * Every timer profile ships with the caveat that nobody has run a heat
 * through it on real hardware. This is the road from "I own one" to "here is
 * exactly what it said": a test run on the diagnostics page, a downloadable
 * report, and a prefilled issue to attach it to.
 *
 * The rules live here, out of the component, so the instructions for each
 * state and the shape of the issue can be tested without rendering anything.
 * The download half follows `backupClient.ts` — same PIN header, same
 * filename-from-header rule.
 */

import { pinHeaders } from '../../api/pin';

/** Where the endpoint lives. The Vite dev proxy strips the `/api` prefix. */
const REPORT_URL = (trackId: number) => `/api/timer-test/${trackId}/report`;

const REPO_ISSUES_URL = 'https://github.com/dknowles2/trusty-track/issues/new';

/**
 * What the operator should do next, by the timer's state during a test.
 *
 * Written for the person standing at the track, not for us: each is the one
 * physical action that moves the test forward.
 */
export function testInstruction(state: string): string | null {
    switch (state) {
        case 'ARMED':
            return 'The timer is armed. Close the start gate, as if staging cars.';
        case 'READY':
            return 'Gate closed. Open it, as if starting a heat.';
        case 'RUNNING':
            return 'Racing! Trip each finish-line sensor by hand — a wave over ' +
                'each lane works. Times appear below as the timer reports them.';
        case 'RESULTS_OVERDUE':
            return 'The timer never reported a finish. That itself is worth ' +
                'reporting — download the report as it stands.';
        default:
            return null;
    }
}

/**
 * The prefilled issue, as a URL.
 *
 * Short on purpose: the report file carries the detail, and asking the owner
 * to describe serial traffic in prose is the failure this feature replaces.
 * GitHub truncates very long bodies out of a URL, which is one more reason
 * the file is the payload.
 */
export function issueUrl(args: {
    deviceName: string | null;
    state: string;
    lastError: string | null;
    resultsSeen: boolean;
}): string {
    const device = args.deviceName ?? 'Unknown timer';
    const title = `Timer report: ${device}`;
    const body = [
        `**Timer:** ${device}`,
        `**What the test showed:** ${
            args.resultsSeen
                ? 'results arrived (details in the attached report)'
                : `no results arrived (last state: ${args.state}${
                      args.lastError ? `, error: ${args.lastError}` : ''
                  })`
        }`,
        '',
        '**What happened at the track, in your own words:**',
        '',
        '',
        '---',
        'Please attach the report file downloaded from the timer check page — ',
        'it holds the full conversation with the timer, which is what a fix ',
        'is built from.',
    ].join('\n');
    const params = new URLSearchParams({ title, body, labels: 'timer-report' });
    return `${REPO_ISSUES_URL}?${params}`;
}

/** Pull the filename out of a `Content-Disposition` header. */
export function filenameFrom(header: string | null, trackId: number): string {
    const match = header?.match(/filename="?([^";]+)"?/);
    return match ? match[1] : `trusty-track-timer-report-track-${trackId}.json`;
}

/**
 * Download the report for a track, handing back the object URL and filename
 * for an anchor to click. Throws with the server's reason on refusal.
 */
export async function fetchTimerReport(
    trackId: number,
): Promise<{ url: string; filename: string }> {
    const response = await fetch(REPORT_URL(trackId), { headers: pinHeaders() });
    if (!response.ok) {
        let reason = `The server said no (${response.status}).`;
        try {
            const body = await response.json();
            if (typeof body?.detail === 'string') reason = body.detail;
        } catch {
            // keep the fallback
        }
        throw new Error(reason);
    }
    const blob = await response.blob();
    return {
        url: URL.createObjectURL(blob),
        filename: filenameFrom(response.headers.get('Content-Disposition'), trackId),
    };
}
