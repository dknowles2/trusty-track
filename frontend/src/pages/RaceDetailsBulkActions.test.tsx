// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import * as GQL from '../graphql/raceDetails';

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



describe('RaceDetails Bulk Actions', () => {
    const mockRace = { id: 1, name: 'Test Race', date_time: '2024-03-15T10:00:00' };
    const mockRacers = [
        { id: 1, first_name: 'Alpha', last_name: 'One', car_number: 101, den_id: 1 },
        { id: 2, first_name: 'Beta', last_name: 'Two', car_number: 102, den_id: 1 },
    ];
    const mockDens = [{ id: 1, name: 'Tigers', color: 'orange' }];

    // Prepare mutation mocks
    const mockBulkAutoNumber = vi.fn().mockResolvedValue({ data: { bulkAutoNumber: 2 } });
    const mockBulkDelete = vi.fn().mockResolvedValue({ data: { bulkDeleteRacers: true } });
    const mockBulkMoveToDen = vi.fn().mockResolvedValue({ data: { bulkMoveToDen: true } });
    const mockBulkCheckIn = vi.fn().mockResolvedValue({ data: { bulkCheckIn: true } });

    const setupMocks = () => {
        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
                    racers: mockRacers.map(r => ({ 
                        id: r.id,
                        firstName: r.first_name,
                        lastName: r.last_name,
                        carNumber: r.car_number,
                        denId: r.den_id,
                        carPassedInspection: false,
                    })),
                    dens: mockDens.map(d => ({ ...d, racerCount: 0 })),
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        (useMutation as any).mockImplementation((query: any) => {
            if (query === GQL.BULK_AUTO_NUMBER) return [{ fetching: false }, mockBulkAutoNumber];
            if (query === GQL.BULK_DELETE_RACERS) return [{ fetching: false }, mockBulkDelete];
            if (query === GQL.BULK_MOVE_TO_DEN) return [{ fetching: false }, mockBulkMoveToDen];
            if (query === GQL.BULK_CHECK_IN) return [{ fetching: false }, mockBulkCheckIn];
            return [{ fetching: false }, vi.fn()];
        });

        // Mock tracks fetch for RaceForm

    };

    it('enables bulk actions menu after selecting racers', async () => {
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        expect(bulkMenuBtn).toBeDisabled();

        const alphaCheckbox = screen.getByTestId('racer-select-1');
        fireEvent.click(alphaCheckbox);

        expect(bulkMenuBtn).not.toBeDisabled();
        expect(screen.getByText('Bulk Actions (1)')).toBeInTheDocument();
    });

    it('toggles all racers with select all checkbox', async () => {
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        fireEvent.click(selectAllCheckbox);

        expect(screen.getByText('Bulk Actions (2)')).toBeInTheDocument();

        fireEvent.click(selectAllCheckbox);
        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        expect(bulkMenuBtn).toBeDisabled();
    });

    it('triggers bulk auto-number action', async () => {
        setupMocks();
        
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);

        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        await user.click(bulkMenuBtn);

        const autoNumBtn = await screen.findByTestId('bulk-auto-number-btn');
        await user.click(autoNumBtn);

        expect(mockBulkAutoNumber).toHaveBeenCalledWith({
            racerIds: [1, 2]
        });
        await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith('Successfully auto-numbered 2 racers', 'Bulk Auto-Number Result'));
    });

    it('triggers bulk delete action after confirmation', async () => {
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);
        
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const alphaCheckbox = screen.getByTestId('racer-select-1');
        await user.click(alphaCheckbox);

        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        await user.click(bulkMenuBtn);

        const deleteBtn = await screen.findByTestId('bulk-delete-btn');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockBulkDelete).toHaveBeenCalledWith({
            racerIds: [1]
        });
    });

    it('renders den options in Move to den submenu', async () => {
        setupMocks();
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        await user.click(screen.getByTestId('racer-select-1'));
        await user.click(screen.getByRole('button', { name: /Bulk Actions/i }));

        const expandBtn = await screen.findByTestId('bulk-move-to-den-expand-btn');
        await user.hover(expandBtn);

        const tigerOption = await screen.findByTestId('bulk-move-to-den-1');
        expect(tigerOption).toHaveTextContent('Tigers');
        expect(screen.getByTestId('bulk-move-to-unassigned')).toBeInTheDocument();
    });

    it('triggers bulk check-in action after confirmation', async () => {
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);
        
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);

        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        await user.click(bulkMenuBtn);

        const checkInBtn = await screen.findByTestId('bulk-check-in-btn');
        await user.click(checkInBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockBulkCheckIn).toHaveBeenCalledWith({
            racerIds: [1, 2],
            passedInspection: true
        });
    });
});
