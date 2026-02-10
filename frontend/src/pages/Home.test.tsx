// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Home from './Home';
import { apiClient } from '../api/client';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../context/AlertContext';

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
    }
}));

describe('Home Page', () => {
    it('displays race registered and checked-in counts', async () => {
        const mockRaces = [
            {
                id: 1,
                name: 'Annual Derby',
                date_time: '2026-05-01T10:00:00',
                location: 'Main Gym',
                registered_count: 24,
                checked_in_count: 18
            }
        ];

        (apiClient.get as any).mockResolvedValue(mockRaces);

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
        (apiClient.get as any).mockResolvedValue([]);

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
