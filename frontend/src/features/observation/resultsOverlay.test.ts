import { describe, expect, it } from 'vitest';
import { observeHeatResult } from './resultsOverlay';

describe('observeHeatResult', () => {
    it('treats the opening payload as history, not news', () => {
        // A projector opened (or reconnecting) mid-event gets the
        // subscription's opening snapshot for a heat that finished minutes
        // ago — it must not pop the overlay for it.
        const result = observeHeatResult(null, { heatId: 7, recordedAt: '2026-01-01T00:00:00Z' });
        expect(result.isNew).toBe(false);
        expect(result.seen).toBe('7:2026-01-01T00:00:00Z');
    });

    it('is news the first time a heat is seen after the opening payload', () => {
        const opening = observeHeatResult(null, { heatId: 7, recordedAt: '2026-01-01T00:00:00Z' });
        const next = observeHeatResult(opening.seen, { heatId: 8, recordedAt: '2026-01-01T00:05:00Z' });
        expect(next.isNew).toBe(true);
        expect(next.seen).toBe('8:2026-01-01T00:05:00Z');
    });

    it('is not news when the same result arrives again', () => {
        const opening = observeHeatResult(null, { heatId: 7, recordedAt: '2026-01-01T00:00:00Z' });
        const again = observeHeatResult(opening.seen, { heatId: 7, recordedAt: '2026-01-01T00:00:00Z' });
        expect(again.isNew).toBe(false);
    });

    it('is news when the same heat is re-recorded with a new timestamp', () => {
        // The old key was `${roundName}-${heatNumber}`, identical for a
        // re-run heat, so the overlay never fired a second time.
        const opening = observeHeatResult(null, { heatId: 7, recordedAt: '2026-01-01T00:00:00Z' });
        const rerecorded = observeHeatResult(opening.seen, { heatId: 7, recordedAt: '2026-01-01T00:10:00Z' });
        expect(rerecorded.isNew).toBe(true);
        expect(rerecorded.seen).toBe('7:2026-01-01T00:10:00Z');
    });

    it('does nothing when there is no result yet', () => {
        const result = observeHeatResult(null, null);
        expect(result.isNew).toBe(false);
        expect(result.seen).toBe(null);
    });

    it('treats a missing recordedAt as its own stable key', () => {
        // Rows recorded before the column existed hold null; two payloads for
        // the same heat with no timestamp must not be treated as new.
        const opening = observeHeatResult(null, { heatId: 3, recordedAt: null });
        const again = observeHeatResult(opening.seen, { heatId: 3, recordedAt: null });
        expect(again.isNew).toBe(false);
    });
});
