import { describe, expect, it } from 'vitest';
import {
    AUDIT_CATEGORIES,
    AUDIT_CATEGORY_HINTS,
    AUDIT_CATEGORY_LABELS,
    categoryTestId,
    matchesActivityFilter,
} from './activityCategories';
import type { AuditCategory } from '../../gql/schema';

describe('AUDIT_CATEGORY_LABELS / AUDIT_CATEGORY_HINTS', () => {
    it('has a label and a hint for every category', () => {
        for (const category of AUDIT_CATEGORIES) {
            expect(AUDIT_CATEGORY_LABELS[category]).toBeTruthy();
            expect(AUDIT_CATEGORY_HINTS[category]).toBeTruthy();
        }
    });
});

describe('categoryTestId', () => {
    it('lowercases the category for the data-testid', () => {
        expect(categoryTestId('RESULTS')).toBe('activity-category-results');
        expect(categoryTestId('ROSTER')).toBe('activity-category-roster');
    });
});

describe('matchesActivityFilter', () => {
    const allSelected = new Set<AuditCategory>(AUDIT_CATEGORIES);

    it('matches everything when every category is selected and Noteworthy is off', () => {
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: false }, allSelected, false)).toBe(
            true,
        );
        expect(matchesActivityFilter({ category: null, noteworthy: false }, allSelected, false)).toBe(true);
    });

    it('matches everything when the selection is empty too — the same "no filter" reading as all six', () => {
        expect(
            matchesActivityFilter({ category: 'RESULTS', noteworthy: false }, new Set(), false),
        ).toBe(true);
    });

    it('narrows to the selected categories once fewer than all six are chosen', () => {
        const selected = new Set<AuditCategory>(['RESULTS', 'SCHEDULE']);
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: false }, selected, false)).toBe(
            true,
        );
        expect(matchesActivityFilter({ category: 'ROSTER', noteworthy: false }, selected, false)).toBe(
            false,
        );
    });

    it('excludes an entry with no category once any category filter narrows the view', () => {
        const selected = new Set<AuditCategory>(['RESULTS']);
        expect(matchesActivityFilter({ category: null, noteworthy: false }, selected, false)).toBe(false);
    });

    it('Noteworthy only excludes an entry that is not noteworthy, regardless of category', () => {
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: false }, allSelected, true)).toBe(
            false,
        );
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: true }, allSelected, true)).toBe(
            true,
        );
    });

    it('both filters apply together', () => {
        const selected = new Set<AuditCategory>(['RESULTS']);
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: true }, selected, true)).toBe(true);
        expect(matchesActivityFilter({ category: 'SCHEDULE', noteworthy: true }, selected, true)).toBe(
            false,
        );
        expect(matchesActivityFilter({ category: 'RESULTS', noteworthy: false }, selected, true)).toBe(
            false,
        );
    });
});
