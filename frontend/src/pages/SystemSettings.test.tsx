// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SystemSettings from './SystemSettings';
import { apiClient } from '../api/client';
import { MemoryRouter } from 'react-router-dom';

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

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('SystemSettings', () => {
    it('allows adding and removing tracks', async () => {
        (apiClient.get as any).mockResolvedValue({ initialized: false });

        render(
            <MemoryRouter>
                <SystemSettings />
            </MemoryRouter>
        );

        // Initially one track - wait for loading to finish
        expect(await screen.findByPlaceholderText('e.g. Main Track')).toBeInTheDocument();
        
        // Add another track
        const addButton = screen.getByText('+ Add Another Track');
        fireEvent.click(addButton);

        // Should now have two track name inputs
        const trackInputs = screen.getAllByPlaceholderText('e.g. Main Track');
        expect(trackInputs.length).toBe(2);

        // Remove the first track
        const removeButtons = screen.getAllByTitle('Remove Track');
        fireEvent.click(removeButtons[0]);

        // Should be back to one
        expect(screen.getAllByPlaceholderText('e.g. Main Track').length).toBe(1);
    });

    it('enforces at least one track', async () => {
        (apiClient.get as any).mockResolvedValue({ initialized: false });

        render(
            <MemoryRouter>
                <SystemSettings />
            </MemoryRouter>
        );

        // Wait for loading
        await screen.findByPlaceholderText('e.g. Main Track');

        // Try to remove the only track - there should be no remove button if only one track
        expect(screen.queryByTitle('Remove Track')).not.toBeInTheDocument();
        
        // Add one, then remove one
        fireEvent.click(screen.getByText('+ Add Another Track'));
        expect(screen.getAllByTitle('Remove Track').length).toBe(2);
        
        fireEvent.click(screen.getAllByTitle('Remove Track')[0]);
        expect(screen.queryByTitle('Remove Track')).not.toBeInTheDocument();
    });

    it('submits correctly with multiple tracks', async () => {
        (apiClient.get as any).mockResolvedValue({ initialized: false });
        (apiClient.post as any).mockResolvedValue({ initialized: true });

        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter>
                <SystemSettings />
            </MemoryRouter>
        );

        await user.type(await screen.findByLabelText('Organization Name'), 'Test Pack');
        
        // Edit first track
        const trackNameInputs = screen.getAllByPlaceholderText('e.g. Main Track');
        await user.clear(trackNameInputs[0]);
        await user.type(trackNameInputs[0], 'Fast Track');

        // Add second track
        await user.click(screen.getByText('+ Add Another Track'));
        // Wait for new input to appear
        await waitFor(() => expect(screen.getAllByPlaceholderText('e.g. Main Track').length).toBe(2));
        
        const newTrackNameInputs = screen.getAllByPlaceholderText('e.g. Main Track');
        await user.clear(newTrackNameInputs[1]);
        await user.type(newTrackNameInputs[1], 'Slow Track');

        await user.click(screen.getByText('Save Settings'));

        expect(apiClient.post).toHaveBeenCalledWith('/config/initial', {
            group_name: 'Test Pack',
            tracks: [
                { name: 'Fast Track', lane_count: 4, length_feet: 40, timer_type: 'FAKE' },
                { name: 'Slow Track', lane_count: 4, length_feet: 40, timer_type: 'FAKE' }
            ]
        });
        
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });
});
