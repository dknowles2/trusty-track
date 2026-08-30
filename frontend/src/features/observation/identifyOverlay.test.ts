import { describe, expect, it } from 'vitest';
import { observeIdentify } from './identifyOverlay';

describe('observeIdentify', () => {
    it('shows the connect badge, not the flash, on the very first payload', () => {
        // Plugging a screen in is the cheapest moment for somebody to learn
        // its name, but it must not read as an Identify command nobody sent.
        const result = observeIdentify(null, 3);

        expect(result.showConnectBadge).toBe(true);
        expect(result.showFlash).toBe(false);
        expect(result.seen).toBe(3);
    });

    it('shows the connect badge even when the seq starts at zero', () => {
        // A display nobody has ever identified still connects and still
        // deserves the badge — zero is an ordinary value, not "nothing here".
        const result = observeIdentify(null, 0);

        expect(result.showConnectBadge).toBe(true);
        expect(result.showFlash).toBe(false);
    });

    it('flashes when the seq rises after the opening payload', () => {
        const opening = observeIdentify(null, 3);
        const identified = observeIdentify(opening.seen, 4);

        expect(identified.showFlash).toBe(true);
        expect(identified.showConnectBadge).toBe(false);
        expect(identified.seen).toBe(4);
    });

    it('does not flash again for the same seq', () => {
        const opening = observeIdentify(null, 3);
        const again = observeIdentify(opening.seen, 3);

        expect(again.showFlash).toBe(false);
        expect(again.showConnectBadge).toBe(false);
    });

    it('re-badges rather than flashes on a genuine remount', () => {
        // A page reload (not a reconnect: the component itself is gone and
        // comes back) starts a fresh `seen` history from `null`, exactly like
        // the very first connect. Whatever `identifySeq` it arrives holding —
        // even one this display already obeyed before the reload — is history.
        const opening = observeIdentify(null, 3);
        const identified = observeIdentify(opening.seen, 4);
        const remounted = observeIdentify(null, 4);

        expect(identified.showFlash).toBe(true);
        expect(remounted.showFlash).toBe(false);
        expect(remounted.showConnectBadge).toBe(true);
    });

    it('does not flash when the seq falls — the server restarted (#520)', () => {
        // Presence lives in memory (services/displays.py), so a restart mid-
        // event rebuilds every display's identifySeq at zero. The page never
        // unmounted — liveConnection.ts just reconnects it — so `seen` still
        // holds whatever this screen last obeyed, and the counter arrives
        // *lower* than that. A falling counter must read as history, the same
        // as a fresh connection, never as a command that flashes every screen
        // in the room the moment the Pi comes back.
        const opening = observeIdentify(null, 3);
        const identified = observeIdentify(opening.seen, 4);
        const restarted = observeIdentify(identified.seen, 0);

        expect(identified.showFlash).toBe(true);
        expect(restarted.showFlash).toBe(false);
        expect(restarted.showConnectBadge).toBe(false);
        expect(restarted.seen).toBe(0);
    });

    it('does not flash when a forgotten display reconnects at zero (#520)', () => {
        // A row goes quiet, the operator clears it with the ✕, and the wifi
        // comes back. The page never unmounted, so it still holds `seen`;
        // `registry.connect` built a fresh Display with identify_seq = 0.
        const opening = observeIdentify(null, 5);
        const identified = observeIdentify(opening.seen, 6);
        const reconnectedAfterForget = observeIdentify(identified.seen, 0);

        expect(reconnectedAfterForget.showFlash).toBe(false);
        expect(reconnectedAfterForget.seen).toBe(0);

        // And a real Identify command afterwards still works.
        const identifiedAgain = observeIdentify(reconnectedAfterForget.seen, 1);
        expect(identifiedAgain.showFlash).toBe(true);
    });

    it('does nothing before any payload has arrived', () => {
        const result = observeIdentify(null, null);

        expect(result.showConnectBadge).toBe(false);
        expect(result.showFlash).toBe(false);
        expect(result.seen).toBe(null);
    });

    it('does nothing on a payload that carries no seq yet', () => {
        const opening = observeIdentify(null, 3);
        const stillNothing = observeIdentify(opening.seen, null);

        expect(stillNothing.showFlash).toBe(false);
        expect(stillNothing.seen).toBe(3);
    });
});
