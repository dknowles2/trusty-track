// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useQuery } from 'urql';
import HeatSheet from './HeatSheet';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const RACE = {
    id: 1,
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: 'St Anne’s Hall',
    trackId: 5,
    resolvedNameDisplay: 'FULL',
    rounds: [{ id: 1, name: null, roundNumber: 1, advancementSource: null }],
    heats: [
        {
            id: 100,
            heatNumber: 1,
            roundId: 1,
            lanes: [
                { lane: 1, racerId: 1, placeholderSlot: null },
                { lane: 2, racerId: 2, placeholderSlot: null },
            ],
        },
    ],
    racers: [
        { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
        { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
    ],
};

function mockData(track: { id: number; laneCount: number; laneColors?: string[] }) {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        {
            data: { race: RACE, tracks: [track], initialConfig: { printablesTheme: null } },
            fetching: false,
            error: undefined,
        },
        vi.fn(),
    ]);
}

function open() {
    return render(
        <MemoryRouter initialEntries={['/race/1/print/heat-sheet']}>
            <Routes>
                <Route path="/race/:raceId/print/heat-sheet" element={<HeatSheet />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('HeatSheet', () => {
    it('prints a lane header with no colour dot when the track has none configured', () => {
        mockData({ id: 5, laneCount: 2, laneColors: [] });
        const { container } = open();
        expect(screen.getByText(/Lane 1/)).toBeInTheDocument();
        expect(container.querySelector('.lane-badge-dot')).toBeNull();
    });

    it("shows the track's configured lane colours beside each lane header (#611)", () => {
        mockData({ id: 5, laneCount: 2, laneColors: ['#E53935', '#1E88E5'] });
        open();
        expect(screen.getByTitle('Red lane')).toBeInTheDocument();
        expect(screen.getByTitle('Blue lane')).toBeInTheDocument();
    });
});
