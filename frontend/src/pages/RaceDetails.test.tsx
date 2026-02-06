// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';
import { apiClient } from '../api/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

// Mock apiClient
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
    }
}));

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
            global_start_number: 1,
            championship_trophies: 3
        };

        // Setup mock return values
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url.includes('/racers/')) return Promise.resolve([]);
            if (url.includes('/dens/')) return Promise.resolve([]);
            if (url.includes('/scores')) return Promise.resolve({ leaderboard: [] });
            return Promise.resolve({});
        });

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        // Wait for race details to load
        await waitFor(() => {
            expect(screen.getByText('Test Race')).toBeInTheDocument();
        });

        // Verify human-readable settings are displayed
        expect(screen.getByText('Timed')).toBeInTheDocument();
        expect(screen.getByText('Per Den')).toBeInTheDocument();
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

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve({ id: 1, name: 'Test Race', date_time: '2024-03-15T10:00:00' });
            if (url.includes('/racers/')) return Promise.resolve(mockRacers);
            if (url.includes('/dens/')) return Promise.resolve(mockDens);
            if (url.includes('/scores')) return Promise.resolve({ leaderboard: [] });
            return Promise.resolve({});
        });

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
        // Mock window.location
        const mockLocation = { href: '' };
        Object.defineProperty(window, 'location', {
            value: mockLocation,
            writable: true
        });

        mockShowConfirm.mockResolvedValue(true); // User confirms

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

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url.includes('/racers/')) return Promise.resolve([]);
            if (url.includes('/dens/')) return Promise.resolve([]);
            if (url.includes('/scores')) return Promise.resolve({ leaderboard: [] });
            return Promise.resolve({});
        });

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        // Wait for load
        await waitFor(() => {
             expect(screen.getByText('Test Race')).toBeInTheDocument();
             expect(screen.getByText('Edit Details')).toBeInTheDocument();
        });

        // Click Edit
        const user = (await import('@testing-library/user-event')).default.setup();
        await user.click(screen.getByText('Edit Details'));

        // Click Delete
        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        // Verify confirm called with correct args
        expect(mockShowConfirm).toHaveBeenCalledWith(
            expect.stringContaining('Are you sure'),
            'Delete Race',
            'Delete',
            'danger'
        );

        // Verify delete API called
        expect(apiClient.delete).toHaveBeenCalledWith('/races/1');

        // Verify redirect
        expect(window.location.href).toBe('/');
    });
});
