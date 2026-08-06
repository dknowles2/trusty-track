// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SystemSettings from './SystemSettings';
import { MemoryRouter } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
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
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { initialized: false, groupName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

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
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { initialized: false, groupName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

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
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { initialized: false, groupName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);

        const mockCreateMutation = vi.fn().mockResolvedValue({ data: { createInitialConfig: { initialized: true } } });
        (useMutation as any).mockImplementation((query: any) => {
            if (query.includes('mutation CreateInitialConfig')) {
                return [{ fetching: false }, mockCreateMutation];
            }
            return [{ fetching: false }, vi.fn()];
        });

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

        expect(mockCreateMutation).toHaveBeenCalledWith({
            config: {
                groupName: 'Test Pack',
                debugMode: false,
                tracks: [
                    { name: 'Fast Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, remoteStartInstalled: false },
                    { name: 'Slow Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, remoteStartInstalled: false }
                ]
            }
        });

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });
    it('saves a backend-connected track with no serial port, so the server can find it', async () => {
        // The serial port field used to be `required`, which made the whole
        // auto-detection path unreachable from the UI: the operator could not
        // submit the form without typing a device path, which is the thing
        // probing exists to avoid (issue #89).
        const user = (await import('@testing-library/user-event')).default.setup();
        const mockCreateMutation = vi.fn().mockResolvedValue({ data: {} });

        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { initialized: false, groupName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);
        (useMutation as any).mockImplementation((query: any) => {
            if (query.includes('mutation CreateInitialConfig')) {
                return [{ fetching: false }, mockCreateMutation];
            }
            return [{ fetching: false }, vi.fn()];
        });

        render(
            <MemoryRouter>
                <SystemSettings />
            </MemoryRouter>
        );

        await user.type(await screen.findByLabelText('Organization Name'), 'Test Pack');

        const timerType = screen.getByDisplayValue('Fake Timer (Manual Control)');
        await user.selectOptions(timerType, 'AUTO_DETECT_BACKEND');

        // The field appears, and is left empty.
        const port = await screen.findByPlaceholderText('Leave blank to detect automatically');
        expect(port).not.toBeRequired();
        expect(port).toHaveValue('');

        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockCreateMutation).toHaveBeenCalled());
        const { config } = mockCreateMutation.mock.calls[0][0];
        expect(config.tracks[0].timerType).toBe('AUTO_DETECT_BACKEND');
        expect(config.tracks[0].serialPort).toBeFalsy();
    });
});
