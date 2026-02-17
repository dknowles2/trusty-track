// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Home from './Home';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../context/AlertContext';
import { useQuery, useMutation } from 'urql';

// Mock urql hooks
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Home Page', () => {
    // Helper to mock mutation (defaults to success)
    const mockMutation = vi.fn().mockResolvedValue({ data: {} });
    (useMutation as any).mockReturnValue([{}, mockMutation]);

    it('displays race registered and checked-in counts', async () => {
        const mockRaces = [
            {
                id: 1,
                name: 'Annual Derby',
                dateTime: '2026-05-01T10:00:00',
                location: 'Main Gym',
                registeredCount: 24,
                checkedInCount: 18
            }
        ];

        (useQuery as any).mockReturnValue([{
            data: { races: mockRaces },
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter>
                <AlertProvider>
                    <Home />
                </AlertProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Annual Derby')).toBeInTheDocument();
        });

        // Check for headers
        expect(screen.getByText('Registered')).toBeInTheDocument();
        expect(screen.getByText('Checked In')).toBeInTheDocument();

        // Check for values
        expect(screen.getByText('24')).toBeInTheDocument();
        expect(screen.getByText('18')).toBeInTheDocument();

        // Check for classes (mobile-hide)
        const registeredHeader = screen.getByText('Registered');
        expect(registeredHeader).toHaveClass('mobile-hide');

        const checkedInValue = screen.getByText('18');
        expect(checkedInValue).toHaveClass('mobile-hide');
    });

    it('shows empty state when no races found', async () => {
        (useQuery as any).mockReturnValue([{
            data: { races: [] },
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter>
                <AlertProvider>
                    <Home />
                </AlertProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('No races found. Create one to get started!')).toBeInTheDocument();
        });
        
        // Colspan should be 6
        const emptyCell = screen.getByText('No races found. Create one to get started!');
        expect(emptyCell).toHaveAttribute('colSpan', '6');
    });
});
