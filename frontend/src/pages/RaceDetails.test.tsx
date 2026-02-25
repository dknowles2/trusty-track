// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Default no-op subscription mock (overridden in individual tests as needed)
beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

const { mockShowAlert, mockShowConfirm } = vi.hoisted(() => {
    return {
        mockShowAlert: vi.fn(),
        mockShowConfirm: vi.fn(),
    }
})

vi.mock('../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showConfirm: mockShowConfirm,
    }),
}))

describe('RaceDetails', () => {
    it('displays human-readable race settings', async () => {
        // Mock race data
        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP',
            group_id: 1,
            track_id: 1,
            global_start_number: 1,
            championship_trophies: 3
        };

        // Setup mock return values for useQuery
        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    location: mockRace.location,
                    schedulingStrategy: mockRace.scheduling_strategy,
                    scoringStrategy: mockRace.scoring_strategy,
                    carNumberingStrategy: mockRace.car_numbering_strategy,
                    trackId: mockRace.track_id,
                    groupId: mockRace.group_id,
                    globalStartNumber: mockRace.global_start_number,
                    championshipTrophies: mockRace.championship_trophies,
                    track: { name: 'Main Track' },
                    racers: [],
                    dens: [],
                    leaderboard: []
                },
                tracks: [{ id: 1, name: 'Main Track' }]
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        // Wait for race details to load
        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        // Verify human-readable settings are displayed
        expect(screen.getByText('Timed')).toBeInTheDocument();
        expect(screen.getByText('Per Den')).toBeInTheDocument();
        expect(screen.getByText('Main Track')).toBeInTheDocument();
    });

    it('filters racers by search term', async () => {
        const mockRacers = [
            { id: 1, first_name: 'John', last_name: 'Doe', car_number: 101, den_id: 1, car_passed_inspection: false },
            { id: 2, first_name: 'Jane', last_name: 'Smith', car_number: 102, den_id: 2, car_passed_inspection: true },
        ];
        
        const mockDens = [
            { id: 1, name: 'Tigers', color: 'orange' },
            { id: 2, name: 'Wolves', color: 'red' },
        ];

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: 1, 
                    name: 'Test Race', 
                    dateTime: '2024-03-15T10:00:00',
                    racers: mockRacers.map(r => ({ 
                        id: r.id,
                        firstName: r.first_name,
                        lastName: r.last_name,
                        carNumber: r.car_number,
                        carPassedInspection: r.car_passed_inspection,
                        denId: r.den_id
                    })),
                    dens: mockDens.map(d => ({ ...d, racerCount: 0 })),
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('John')).toBeInTheDocument();
        });

        // Search for "Jane"
        const searchInput = screen.getByPlaceholderText('Search racers...');
        const user = (await import('@testing-library/user-event')).default.setup();
        await user.type(searchInput, 'Jane');

        expect(screen.getByText('Jane')).toBeInTheDocument();
        expect(screen.queryByText('John')).not.toBeInTheDocument();
    });

    it('allows deleting a race', async () => {
        const mockLocation = { href: '' };
        Object.defineProperty(window, 'location', {
            value: mockLocation,
            writable: true
        });

        mockShowConfirm.mockResolvedValue(true);

        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP',
            group_id: 1,
            global_start_number: 1
        };

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    location: mockRace.location,
                    schedulingStrategy: mockRace.scheduling_strategy,
                    scoringStrategy: mockRace.scoring_strategy,
                    carNumberingStrategy: mockRace.car_numbering_strategy,
                    racers: [],
                    dens: [],
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        const mockDeleteRace = vi.fn().mockResolvedValue({ data: { deleteRace: { success: true } } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockDeleteRace]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
             expect(screen.getByText('Race Settings')).toBeInTheDocument();
             expect(screen.getByText('Edit Details')).toBeInTheDocument();
        });

        const user = (await import('@testing-library/user-event')).default.setup();
        await user.click(screen.getByText('Edit Details'));

        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockDeleteRace).toHaveBeenCalledWith({ id: 1 });
        expect(window.location.href).toBe('/');
    });

    it('calls reexecuteRaceDetails when raceStateChanged subscription fires', async () => {
        const mockReExecute = vi.fn();
        let capturedHandler: ((prev: any, data: any) => any) | undefined;

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: 1,
                    name: 'Subscription Test Race',
                    dateTime: null,
                    location: '',
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
                    racers: [],
                    dens: [],
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, mockReExecute]);

        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

        (useSubscription as any).mockImplementation(
            (_opts: any, handler: (prev: any, data: any) => any) => {
                capturedHandler = handler;
                return [{ data: undefined }, vi.fn()];
            }
        );

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
            expect(capturedHandler).toBeDefined();
        });

        act(() => {
            capturedHandler!(undefined, { raceStateChanged: { raceId: 1, changedAt: '2026-01-01T00:00:00Z' } });
        });

        expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });
});
