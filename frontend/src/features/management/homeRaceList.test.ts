import { describe, expect, it } from 'vitest';
import { raceListSummary } from './homeRaceList';

describe('raceListSummary', () => {
    it('formats a date/time and falls back to a dash when absent', () => {
        expect(raceListSummary({
            dateTime: '2026-05-01T10:00:00',
            location: 'Main Gym',
            registeredCount: 24,
            checkedInCount: 18,
        })).toEqual({
            dateTimeLabel: new Date('2026-05-01T10:00:00').toLocaleString(),
            locationLabel: 'Main Gym',
            registeredCount: 24,
            checkedInCount: 18,
        });
    });

    it('falls back to a dash for a missing date or location, and 0 for missing counts', () => {
        expect(raceListSummary({
            dateTime: null,
            location: null,
            registeredCount: null,
            checkedInCount: undefined,
        })).toEqual({
            dateTimeLabel: '-',
            locationLabel: '-',
            registeredCount: 0,
            checkedInCount: 0,
        });
    });
});
