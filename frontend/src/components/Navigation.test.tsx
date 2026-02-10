import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../context/AlertContext';
import Navigation from './Navigation';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
        post: vi.fn(),
    }
}));

describe('Navigation Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (apiClient.get as any).mockResolvedValue([
            { id: 1, name: 'Race 1' },
            { id: 2, name: 'Race 2' }
        ]);
        // Reset innerWidth
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
    });

    it('renders desktop navigation by default', async () => {
        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        expect(screen.getByText('Trusty Track')).toBeInTheDocument();
        expect(screen.getByText('Select a Race')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.queryByLabelText('Open Menu')).not.toBeInTheDocument();
    });

    it('renders mobile navigation when viewport is small', async () => {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
        window.dispatchEvent(new Event('resize'));

        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Open Menu')).toBeInTheDocument();
        });
        expect(screen.queryByText('Select a Race')).not.toBeInTheDocument();
        expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('opens and closes the mobile menu', async () => {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
        window.dispatchEvent(new Event('resize'));

        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Open Menu')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Open Menu'));

        await waitFor(() => {
            expect(screen.getByText('Races')).toBeInTheDocument();
            expect(screen.getByText('Race 1')).toBeInTheDocument();
            expect(screen.getByText('System Settings')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Close Menu'));

        await waitFor(() => {
            expect(screen.queryByText('Races')).not.toBeVisible();
        });
    });

    it('displays race sub-links in mobile menu when a race is active', async () => {
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
        window.dispatchEvent(new Event('resize'));

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={['/race/1']}>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            fireEvent.click(screen.getByLabelText('Open Menu'));
        });

        await waitFor(() => {
            expect(screen.getByText('Details')).toBeInTheDocument();
            expect(screen.getByText('Control')).toBeInTheDocument();
            expect(screen.getByText('Live')).toBeInTheDocument();
        });
    });
});
