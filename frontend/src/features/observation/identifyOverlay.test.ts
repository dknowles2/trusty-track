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

    it('ignores the seq a reconnect arrives holding', () => {
        // The whole reason this shape exists: a wifi hiccup must not flash
        // the name across the screen as though the operator pressed Identify.
        const opening = observeIdentify(null, 3);
        const identified = observeIdentify(opening.seen, 4);
        // The subscription drops and reopens; a fresh `seen` history starts.
        const reconnected = observeIdentify(null, 4);

        expect(identified.showFlash).toBe(true);
        expect(reconnected.showFlash).toBe(false);
        expect(reconnected.showConnectBadge).toBe(true);
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
