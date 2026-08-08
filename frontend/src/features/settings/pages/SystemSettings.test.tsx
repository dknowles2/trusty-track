// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SystemSettings from './SystemSettings';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { print } from 'graphql';

/**
 * The document a `useMutation` mock was handed, as text.
 *
 * This page's own documents are plain template literals; the Lane outage panel
 * it renders uses urql's `gql` tag, which yields a DocumentNode with no
 * `.includes`. Normalising here rather than at each call site.
 */
const documentText = (query: unknown): string =>
    typeof query === 'string' ? query : print(query as Parameters<typeof print>[0]);
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

        // AlertProvider because the Backup panel reports a failed download or
        // restore through it; the app wraps every route the same way.
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
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

        // AlertProvider because the Backup panel reports a failed download or
        // restore through it; the app wraps every route the same way.
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
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

        // AlertProvider because the Backup panel reports a failed download or
        // restore through it; the app wraps every route the same way.
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
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
                    // A fake timer carries no model: it is chosen by transport, and a model
                    // travelling with one would linger unseen if the operator switched back.
                    { name: 'Fast Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                    { name: 'Slow Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false }
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

        // AlertProvider because the Backup panel reports a failed download or
        // restore through it; the app wraps every route the same way.
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
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

describe('a saved track with no length', () => {
    it('stays editable rather than blocking the whole form', async () => {
        // `lengthFeet` is nullable on the server and `createTrack` does not
        // require it, so a track can legitimately have none. The input is
        // `required`, so a null rendered an empty box and the form silently
        // refused to submit — every other setting on the page along with it,
        // and nothing on screen naming the track at fault.
        //
        // The submit handler already treated a missing length as 40. The form
        // now shows that rather than contradicting it.
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    groupName: 'Pack 42',
                    debugMode: false,
                    tracks: [
                        { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                        // Created through the API, which does not ask for a length.
                        { id: 2, name: 'Second Track', laneCount: 6, lengthFeet: null, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                    ],
                },
            },
            fetching: false,
            error: null,
        }, vi.fn()]);

        const mockUpdate = vi.fn().mockResolvedValue({ data: { updateInitialConfig: { initialized: true } } });
        (useMutation as any).mockImplementation((query: any) =>
            documentText(query).includes('mutation UpdateInitialConfig')
                ? [{ fetching: false }, mockUpdate]
                : [{ fetching: false }, vi.fn()],
        );

        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );

        const lengths = await screen.findAllByLabelText('Length (Feet)');
        expect((lengths[1] as HTMLInputElement).value).toBe('40');
        // The whole point: nothing on the form is blocking submission.
        expect(document.querySelector('form')!.checkValidity()).toBe(true);

        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        expect(mockUpdate.mock.calls[0][0].config.tracks[1].lengthFeet).toBe(40);
    });
});

describe('lanes out of service', () => {
    afterEach(cleanup);

    // It belongs to a track, so it lives in that track's card. It was briefly
    // its own section at the foot of the page, which meant repeating the
    // track's name to say which track it meant.

    const configuredWith = (tracks: unknown[]) => {
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    groupName: 'Pack 42',
                    debugMode: false,
                    tracks,
                },
            },
            fetching: false,
            error: null,
        }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );
    };

    it('offers a control per lane of a saved track', async () => {
        configuredWith([
            { id: 1, name: 'Main Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false, laneOutages: [2] },
        ]);

        expect(await screen.findByLabelText('Lane 1 works')).toBeChecked();
        expect(screen.getByLabelText('Lane 2 works')).not.toBeChecked();
        expect(screen.getByLabelText('Lane 3 works')).toBeChecked();
    });

    it('leads with how many lanes are left', async () => {
        configuredWith([
            { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false, laneOutages: [3] },
        ]);

        expect(
            await screen.findByText(/3 of 4 lanes in use — Lane 3 out of service/),
        ).toBeInTheDocument();
    });

    it('is absent from a track that has not been saved yet', async () => {
        // No id, so nothing to set an outage against — and a track that does
        // not exist cannot have a broken lane.
        configuredWith([
            { id: 1, name: 'Main Track', laneCount: 2, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false, laneOutages: [] },
        ]);
        const user = (await import('@testing-library/user-event')).default.setup();

        await user.click(await screen.findByText('+ Add Another Track'));

        // Still only the saved track's two lanes.
        expect(screen.getAllByLabelText(/^Lane \d+ works$/)).toHaveLength(2);
    });
});

describe('the Backup panel', () => {
    afterEach(cleanup);

    // Rendered here rather than only in its own file because the failure this
    // guards against is the panel not reaching the page at all — a bad import
    // or a wrong condition, which #15 showed passes tsc, eslint and every unit
    // test while the screen shows nothing.

    it('is offered once there is something to back up', async () => {
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    groupName: 'Pack 42',
                    debugMode: false,
                    tracks: [
                        { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                    ],
                },
            },
            fetching: false,
            error: null,
        }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );

        expect(
            await screen.findByRole('button', { name: /download a backup/i }),
        ).toBeInTheDocument();
    });

    it('is absent on the first run, when there is nothing to replace', async () => {
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { initialized: false, tracks: [] } },
            fetching: false,
            error: null,
        }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );

        await screen.findByPlaceholderText('e.g. Main Track');
        expect(screen.queryByRole('button', { name: /restore from a backup/i })).toBeNull();
    });
});
