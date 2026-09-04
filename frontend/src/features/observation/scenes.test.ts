import { describe, expect, it } from 'vitest';
import { summarizeApplyResult } from './scenes';

describe('summarizeApplyResult', () => {
    it('says nothing to apply to when there are no displays at all', () => {
        expect(summarizeApplyResult({ appliedCount: 0, skippedCount: 0, outcomes: [] })).toBe(
            'No displays to apply this to yet.',
        );
    });

    it('says every screen updated when nothing was skipped', () => {
        const outcomes = [
            { displayId: 'a', displayName: 'Main', applied: true },
            { displayId: 'b', displayName: 'Lobby', applied: true },
        ];
        expect(summarizeApplyResult({ appliedCount: 2, skippedCount: 0, outcomes })).toBe(
            'Applied to all 2 screens.',
        );
    });

    it('uses the singular for exactly one connected screen', () => {
        const outcomes = [{ displayId: 'a', displayName: 'Main', applied: true }];
        expect(summarizeApplyResult({ appliedCount: 1, skippedCount: 0, outcomes })).toBe(
            'Applied to the one connected screen.',
        );
    });

    it('names the skipped screens by their captured name, not a bare id', () => {
        const outcomes = [
            { displayId: 'a', displayName: 'Main', applied: true },
            { displayId: 'b', displayName: 'Lobby', applied: false },
        ];
        const summary = summarizeApplyResult({ appliedCount: 1, skippedCount: 1, outcomes });
        expect(summary).toContain('Applied to 1 of 2 screens');
        expect(summary).toContain('Lobby');
        expect(summary).not.toContain('"b"');
    });

    it('lists every skipped screen when more than one is missing', () => {
        const outcomes = [
            { displayId: 'a', displayName: 'Main', applied: false },
            { displayId: 'b', displayName: 'Lobby', applied: false },
        ];
        const summary = summarizeApplyResult({ appliedCount: 0, skippedCount: 2, outcomes });
        expect(summary).toContain('Main');
        expect(summary).toContain('Lobby');
    });
});
