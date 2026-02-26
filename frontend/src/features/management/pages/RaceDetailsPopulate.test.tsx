// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../../../context/AlertContext';
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

const mockShowAlert = vi.fn();
const mockShowToast = vi.fn();
const mockShowConfirm = vi.fn();

vi.mock('../../../context/AlertContext', () => ({
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

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('RaceDetails Populate', () => {
    it('opens modal and calls populate mutation when confirmed', async () => {
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

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
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

        const genericMutationMock = vi.fn().mockResolvedValue({ data: {} });
        (useMutation as any).mockReturnValue([{ fetching: false }, genericMutationMock]);

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
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        // 1. Open dropdown
        const arrowBtn = document.querySelector('.split-btn-arrow')!;
        await user.click(arrowBtn);

        // 2. Click Populate button
        const populateBtn = screen.getByText(/Populate Test Data/i);
        await user.click(populateBtn);

        // 3. Verify Modal Open
        expect(screen.getByLabelText('Number of Racers:')).toBeInTheDocument();

        // 4. Change input to 15
        const input = screen.getByLabelText('Number of Racers:');
        await user.clear(input);
        await user.type(input, '15');

        // 5. Click Generate
        const generateBtn = screen.getByText('Generate');
        await user.click(generateBtn);

        // 6. Verify Mutation call
        expect(genericMutationMock).toHaveBeenCalledWith(expect.objectContaining({
            raceId: 1,
            config: expect.objectContaining({
                count: 15,
                addRacerPhotos: true,
                addCarPhotos: true,
                assignDens: true,
                checkIn: false
            })
        }));
    });

    it('validates input in modal', async () => {
        const user = userEvent.setup();
        
        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: 1, 
                    name: 'Test Race',
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
        }, vi.fn()]);
        
        const genericMutationMock = vi.fn().mockResolvedValue({ data: {} });
        (useMutation as any).mockReturnValue([{ fetching: false }, genericMutationMock]);

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => screen.getByText('Race Settings'));

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
        expect(genericMutationMock).not.toHaveBeenCalled();
    });
});
