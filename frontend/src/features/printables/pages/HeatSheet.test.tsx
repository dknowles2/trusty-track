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

interface RaceFixtureRound {
    id: number;
    name: string | null;
    roundNumber: number;
    advancementSource: string | null;
}

interface RaceFixtureHeat {
    id: number;
    heatNumber: number;
    roundId: number;
    lanes: { lane: number; racerId: number | null; placeholderSlot: number | null }[];
}

interface RaceFixtureRunOffHeat {
    id: number;
    settlesRoundId: number | null;
    placement: number | null;
    lanes: { lane: number; racerId: number | null; placeholderSlot: number | null }[];
}

interface RaceFixture {
    id: number;
    name: string;
    dateTime: string;
    location: string;
    trackId: number;
    resolvedNameDisplay: string;
    masterRunningOrder: boolean;
    rounds: RaceFixtureRound[];
    heats: RaceFixtureHeat[];
    runOffHeats: RaceFixtureRunOffHeat[];
    racers: { id: number; firstName: string; lastName: string; carNumber: number }[];
}

const RACE: RaceFixture = {
    id: 1,
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: 'St Anne’s Hall',
    trackId: 5,
    resolvedNameDisplay: 'FULL',
    masterRunningOrder: false,
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
    runOffHeats: [],
    racers: [
        { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
        { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
    ],
};

function mockData(
    track: { id: number; laneCount: number; laneColors?: string[] },
    raceOverrides: Partial<RaceFixture> = {},
) {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        {
            data: {
                race: { ...RACE, ...raceOverrides },
                tracks: [track],
                initialConfig: { printablesTheme: null },
            },
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

    // #890 — the printed sheet used to ignore the master running order and
    // never print a run-off heat.
    it('leads with a flat Master running order section when the race has the flag on', () => {
        mockData(
            { id: 5, laneCount: 2, laneColors: [] },
            {
                masterRunningOrder: true,
                rounds: [
                    { id: 1, name: null, roundNumber: 1, advancementSource: null },
                    { id: 2, name: null, roundNumber: 2, advancementSource: null },
                ],
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
                    {
                        id: 101,
                        heatNumber: 2,
                        roundId: 2,
                        lanes: [
                            { lane: 1, racerId: 2, placeholderSlot: null },
                            { lane: 2, racerId: 1, placeholderSlot: null },
                        ],
                    },
                ],
            },
        );
        open();

        // The toolbar's own "Heat sheet" <h2> comes first; the printed
        // sections follow, and the flat master-order section leads them.
        const sectionHeadings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
        expect(sectionHeadings.slice(1)).toEqual(['Master running order', 'Round 1', 'Round 2']);
        expect(screen.getByText('Round')).toBeInTheDocument();
    });

    it('prints a run-off heat after the round it settles, titled with the place it decides', () => {
        mockData(
            { id: 5, laneCount: 2, laneColors: [] },
            {
                runOffHeats: [
                    {
                        id: 900,
                        settlesRoundId: 1,
                        placement: 1,
                        lanes: [
                            { lane: 1, racerId: 1, placeholderSlot: null },
                            { lane: 2, racerId: 2, placeholderSlot: null },
                        ],
                    },
                ],
            },
        );
        open();

        expect(screen.getByRole('heading', { level: 2, name: 'Run-off for 1st place' })).toBeInTheDocument();
    });
});
