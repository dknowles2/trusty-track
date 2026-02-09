// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

describe('RaceDetails Bulk Actions', () => {
    const mockRace = { id: 1, name: 'Test Race', date_time: '2024-03-15T10:00:00' };
    const mockRacers = [
        { id: 1, first_name: 'Alpha', last_name: 'One', car_number: 101, den_id: 1 },
        { id: 2, first_name: 'Beta', last_name: 'Two', car_number: 102, den_id: 1 },
    ];
    const mockDens = [{ id: 1, name: 'Tigers', color: 'orange' }];

    const setupMocks = () => {
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url.includes('/racers/')) return Promise.resolve(mockRacers);
            if (url.includes('/dens/')) return Promise.resolve(mockDens);
            if (url.includes('/scores')) return Promise.resolve({ leaderboard: [] });
            if (url === '/tracks/') return Promise.resolve([]);
            return Promise.resolve({});
        });
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

        // Select first racer using data-testid
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
        (apiClient.post as any).mockResolvedValue({ message: 'Success', updated_count: 2 });
        
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        // Select All
        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);

        // Open Bulk Menu
        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        await user.click(bulkMenuBtn);

        // Click Auto Number - use data-testid and findBy
        const autoNumBtn = await screen.findByTestId('bulk-auto-number-btn');
        await user.click(autoNumBtn);

        expect(apiClient.post).toHaveBeenCalledWith('/racers/bulk_auto_number', {
            racer_ids: [1, 2]
        });
        await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith('Success', 'Bulk Auto-Number Result'));
    });

    it('triggers bulk delete action after confirmation', async () => {
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);
        (apiClient.post as any).mockResolvedValue({ message: 'Deleted' });
        
        const user = (await import('@testing-library/user-event')).default.setup();
        
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        // Select ONLY Alpha
        const alphaCheckbox = screen.getByTestId('racer-select-1');
        await user.click(alphaCheckbox);

        const bulkMenuBtn = screen.getByRole('button', { name: /Bulk Actions/i });
        await user.click(bulkMenuBtn);

        const deleteBtn = await screen.findByTestId('bulk-delete-btn');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(apiClient.post).toHaveBeenCalledWith('/racers/bulk_delete', {
            racer_ids: [1]
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

        // Hover to expand "Move to den"
        const expandBtn = await screen.findByTestId('bulk-move-to-den-expand-btn');
        await user.hover(expandBtn);

        // Check if den "Tigers" is visible in the submenu - need to wait for the timeout
        const tigerOption = await screen.findByTestId('bulk-move-to-den-1');
        expect(tigerOption).toHaveTextContent('Tigers');
        
        // Check if "Unassigned" is visible
        expect(screen.getByTestId('bulk-move-to-unassigned')).toBeInTheDocument();
    });
});
