import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLAIM_HEARTBEAT_MS,
    displayId,
    newDisplayWindowUrl,
    qrCodeWindowUrl,
    startDeviceClaimHeartbeat,
} from './displayIdentity';

const DEVICE_KEY = 'trustytrack.displayId';
const SESSION_KEY = 'trustytrack.displayId.session';
const CLAIM_KEY = 'trustytrack.displayId.claim';

/** Simulates leaving this tab and opening a brand-new one on the same
 * computer: `sessionStorage` is tab-scoped and does not carry over, but
 * `localStorage` — the shared device id, and the claim heartbeat — does. */
function newTab() {
    window.sessionStorage.clear();
}

describe('displayId', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    });
    afterEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    it('claims this computer\'s device id when it is the only tab', () => {
        const id = displayId();
        expect(id).toBe(window.localStorage.getItem(DEVICE_KEY));
        expect(id).toBeTruthy();
    });

    it('keeps its id across a reload of the same tab', () => {
        const first = displayId();
        // A reload keeps sessionStorage, unlike closing the tab — nothing in
        // this simulates a reload beyond calling the function again with
        // storage exactly as the browser would leave it.
        const second = displayId();
        expect(second).toBe(first);
    });

    it('gives a second tab on the same computer a different id', () => {
        const first = displayId();

        newTab();
        const second = displayId();

        expect(second).not.toBe(first);
        // The first tab's id is still the device id; the second minted its
        // own rather than colliding with a claim that is still warm.
        expect(first).toBe(window.localStorage.getItem(DEVICE_KEY));
    });

    it('a query parameter always wins, and is remembered for the rest of the tab', () => {
        // Pre-existing state from an earlier resolution in this tab, to prove
        // the parameter overrides it rather than merely being tried first.
        window.sessionStorage.setItem(SESSION_KEY, 'session-id');

        const withParam = displayId('url-id');
        expect(withParam).toBe('url-id');

        // The next call in the same tab carries no parameter — the redirect
        // from Observation to the awards ceremony drops the query string —
        // and still resolves to what the URL named.
        const withoutParam = displayId();
        expect(withoutParam).toBe('url-id');
    });

    it('a third tab reclaims the device id once the claim goes stale', () => {
        vi.useFakeTimers();
        try {
            displayId();
            newTab();
            vi.advanceTimersByTime(6000); // past CLAIM_STALE_MS with nobody renewing
            const third = displayId();
            expect(third).toBe(window.localStorage.getItem(DEVICE_KEY));
        } finally {
            vi.useRealTimers();
        }
    });

    it('degrades to a fresh id when storage throws', () => {
        const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        try {
            expect(displayId()).toBeTruthy();
        } finally {
            getItem.mockRestore();
        }
    });
});

describe('startDeviceClaimHeartbeat', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    it('renews the claim for the tab holding the device id', () => {
        const id = displayId();
        const before = JSON.parse(window.localStorage.getItem(CLAIM_KEY) || '{}').ts;

        vi.advanceTimersByTime(CLAIM_HEARTBEAT_MS + 10);
        const stop = startDeviceClaimHeartbeat(id);
        vi.advanceTimersByTime(CLAIM_HEARTBEAT_MS + 10);

        const after = JSON.parse(window.localStorage.getItem(CLAIM_KEY) || '{}').ts;
        expect(after).toBeGreaterThan(before);
        stop();
    });

    it('does nothing for a tab that lost the claim', () => {
        displayId(); // the first tab claims the device id
        newTab();
        const second = displayId(); // this tab minted its own id instead

        const claimBefore = window.localStorage.getItem(CLAIM_KEY);
        const stop = startDeviceClaimHeartbeat(second);
        vi.advanceTimersByTime(CLAIM_HEARTBEAT_MS * 3);
        expect(window.localStorage.getItem(CLAIM_KEY)).toBe(claimBefore);
        stop();
    });

    it('stops renewing once the returned cleanup runs', () => {
        const id = displayId();
        const stop = startDeviceClaimHeartbeat(id);
        stop();

        const before = window.localStorage.getItem(CLAIM_KEY);
        vi.advanceTimersByTime(CLAIM_HEARTBEAT_MS * 3);
        expect(window.localStorage.getItem(CLAIM_KEY)).toBe(before);
    });
});

describe('newDisplayWindowUrl', () => {
    it('names a fresh screen for the given race, as a displayId query parameter', () => {
        const url = newDisplayWindowUrl(42);
        expect(url).toMatch(/^\/race\/42\/observation\?displayId=.+$/);
    });

    it('mints a different id on every call, so two windows never share one', () => {
        const a = newDisplayWindowUrl(1);
        const b = newDisplayWindowUrl(1);
        expect(a).not.toBe(b);
    });
});

describe('qrCodeWindowUrl', () => {
    it('opens the QR code view pointed at this races standings', () => {
        const url = qrCodeWindowUrl(42, 'STANDINGS');
        expect(url).toMatch(/^\/race\/42\/observation\?displayId=.+&view=qrcode$/);
    });

    it('opens the QR code view pointed at the voting ballot', () => {
        const url = qrCodeWindowUrl(42, 'VOTE');
        expect(url).toContain('view=qrcode');
        expect(url).toContain('qr_target=vote');
    });

    it('mints a different id on every call, so two windows never share one', () => {
        const a = qrCodeWindowUrl(1, 'STANDINGS');
        const b = qrCodeWindowUrl(1, 'STANDINGS');
        expect(a).not.toBe(b);
    });
});
