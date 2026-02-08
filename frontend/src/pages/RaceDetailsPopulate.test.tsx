// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';
import { apiClient } from '../api/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../context/AlertContext';

const mockShowAlert = vi.fn();
const mockShowToast = vi.fn();
const mockShowConfirm = vi.fn();

vi.mock('../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showToast: mockShowToast,
        showConfirm: mockShowConfirm,
    }),
    AlertProvider: ({ children }: any) => <>{children}</>
}));

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Mock apiClient
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
    }
}));

describe('RaceDetails Populate', () => {
    it('opens modal and calls populate API when confirmed', async () => {
        const user = userEvent.setup();
        
        // Mock race data
        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP'
        };

        // Setup mock return values
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url.includes('/racers/')) return Promise.resolve([]);
            if (url.includes('/dens/')) return Promise.resolve([]);
            if (url.includes('/scores')) return Promise.resolve({ race_id: 1, scoring_strategy: 'TIMED', leaderboard: [] });
            if (url.includes('/config')) return Promise.resolve({ timer_type: 'FAKE' });
            return Promise.resolve({});
        });

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        // Wait for race details to load
        await waitFor(() => {
            expect(screen.getByText('Test Race')).toBeInTheDocument();
        });

        // 1. Open dropdown
        const arrowBtn = document.querySelector('.split-btn-arrow')!;
        await user.click(arrowBtn);

        // 2. Click Populate button
        const populateBtn = screen.getByText(/Populate Test Data/i);
        await user.click(populateBtn);

        // 3. Verify Modal Open
        // Check for the modal title (might be multiple if button has same text, so use GetAll or look for input)
        expect(screen.getByLabelText('Number of Racers:')).toBeInTheDocument();

        // 4. Change input to 15
        const input = screen.getByLabelText('Number of Racers:');
        await user.clear(input);
        await user.type(input, '15');

        // 5. Click Generate
        const generateBtn = screen.getByText('Generate');
        await user.click(generateBtn);

        // 6. Verify API call
        expect(apiClient.post).toHaveBeenCalledWith('/races/1/populate?count=15', {});

        // 7. Verify roster is refreshed
        expect(apiClient.get).toHaveBeenCalledWith('/racers/?race_id=1');
    });

    it('validates input in modal', async () => {
        const user = userEvent.setup();
        
        // Mock race data
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve({ id: 1, name: 'Test Race' });
            if (url.includes('/scores')) return Promise.resolve({ race_id: 1, scoring_strategy: 'TIMED', leaderboard: [] });
            if (url.includes('/config')) return Promise.resolve({ timer_type: 'FAKE' });
            return Promise.resolve([]);
        });

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => screen.getByText('Test Race'));

        await waitFor(() => screen.getByText('Test Race'));

        // Open dropdown and click
        await user.click(document.querySelector('.split-btn-arrow')!);
        await user.click(screen.getByText(/Populate Test Data/i));

        // Enter invalid input
        const input = screen.getByLabelText('Number of Racers:');
        await user.clear(input);
        await user.type(input, '0');

        // Click Generate
        await user.click(screen.getByText('Generate'));

        // Verify alert
        expect(mockShowAlert).toHaveBeenCalledWith("Please enter a valid count > 0", "Invalid Input");
        expect(apiClient.post).not.toHaveBeenCalled();
    });
});
