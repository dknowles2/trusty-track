// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RaceStats from './RaceStats';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function statsPayload(overrides: object = {}) {
    return {
        raceId: 2,
        raceName: 'This Derby',
        scoringStrategy: 'TIMED',
        totalHeatsScheduled: 4,
        totalHeatsCompleted: 4,
        totalRacers: 4,
        laneStats: [],
        racerStats: [],
        highlights: [],
        denStats: [],
        heatResults: [],
        trackRecords: [],
        ...overrides,
    };
}

function renderStats(raceStats: object) {
    (useQuery as any).mockReturnValue([
        { data: { raceStats }, fetching: false, error: null },
        vi.fn(),
    ]);
    render(
        <MemoryRouter initialEntries={['/race/2/stats']}>
            <Routes>
                <Route path="/race/:raceId/stats" element={<RaceStats />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('the track record section', () => {
    const records = [
        {
            timeSeconds: 2.951,
            racerName: 'Ada Speed',
            carNumber: 7,
            raceId: 1,
            raceName: 'Derby 2025',
            raceDate: '2025-03-14T09:00:00',
        },
        {
            timeSeconds: 3.104,
            racerName: 'Bea Swift',
            carNumber: 12,
            raceId: 2,
            raceName: 'This Derby',
            raceDate: '2026-03-13T09:00:00',
        },
    ];

    it('shows the record holder, their race, and the all-time list', () => {
        renderStats(statsPayload({ trackRecords: records }));

        expect(screen.getByTestId('track-record-section')).toBeTruthy();
        // Once on the hero card, once in the all-time table.
        expect(screen.getAllByText('2.951s').length).toBe(2);
        expect(screen.getAllByText(/Ada Speed/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Derby 2025/).length).toBeGreaterThan(0);
        // The second-fastest car appears in the all-time table.
        expect(screen.getByText(/Bea Swift/)).toBeTruthy();
    });

    it('marks a record set at this event, and only then', () => {
        renderStats(statsPayload({ trackRecords: records }));

        // The record itself stands from an earlier race, so the hero card
        // carries no badge — but Bea's row, set at this race, is marked.
        expect(screen.queryByText('Set at this event!')).toBeNull();
        expect(screen.getByText('This event')).toBeTruthy();
    });

    it('celebrates a record set at this event on the card itself', () => {
        renderStats(
            statsPayload({
                trackRecords: [{ ...records[0], raceId: 2, raceName: 'This Derby' }],
            })
        );
        expect(screen.getByText('Set at this event!')).toBeTruthy();
    });

    it('is absent when the track has no records', () => {
        renderStats(statsPayload());
        expect(screen.queryByTestId('track-record-section')).toBeNull();
    });
});
