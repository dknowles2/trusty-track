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

/**
 * Open one of the settings sections.
 *
 * A configured install shows one section at a time behind a nav down the left
 * (the first run does not — it is a wizard, and shows the lot). So a test
 * about a track, a lane or the backup panel has to say where it is looking.
 */
const openSection = async (id: 'general' | 'appearance' | 'access' | 'tracks' | 'backup') => {
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(await screen.findByTestId(`settings-nav-${id}`));
};

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
            data: { initialConfig: { initialized: false, organizationName: '', tracks: [] } },
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
            data: { initialConfig: { initialized: false, organizationName: '', tracks: [] } },
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
            data: { initialConfig: { initialized: false, organizationName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);

        const mockCreateMutation = vi.fn().mockResolvedValue({ data: { createInitialConfig: { initialized: true } } });
        (useMutation as any).mockImplementation((query: any) =>
            documentText(query).includes('mutation CreateInitialConfig')
                ? [{ fetching: false }, mockCreateMutation]
                : [{ fetching: false }, vi.fn()],
        );

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
                organizationName: 'Test Pack',
                debugMode: false,
                // Every picker's own default (#498) — Field Uniform never
                // needing to be picked, and Display/Printables "Match App".
                displayTheme: 'MATCH_APP',
                printablesTheme: 'MATCH_APP',
                // The terminology checkbox was never touched, so this is
                // "leave it null" said explicitly — the same shape as
                // `clearWeightLimit` (#496 stage 3).
                clearTerminology: true,
                tracks: [
                    // A fake timer carries no model: it is chosen by transport, and a model
                    // travelling with one would linger unseen if the operator switched back.
                    // Neither track has an id yet — both were added on this screen, before
                    // ever being saved (#318).
                    { id: null, name: 'Fast Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                    { id: null, name: 'Slow Track', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false }
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
            data: { initialConfig: { initialized: false, organizationName: '', tracks: [] } },
            fetching: false,
            error: null
        }, vi.fn()]);
        (useMutation as any).mockImplementation((query: any) =>
            documentText(query).includes('mutation CreateInitialConfig')
                ? [{ fetching: false }, mockCreateMutation]
                : [{ fetching: false }, vi.fn()],
        );

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

describe('the mutation matcher beside a gql-tagged mutation', () => {
    afterEach(cleanup);

    // A saved track mounts TrackRecords, which calls `useMutation` with a
    // `gql`-tagged DocumentNode rather than this page's own template-literal
    // strings. A matcher that calls `query.includes(...)` directly throws
    // `query.includes is not a function` the instant that mounts — normalising
    // through `documentText` first is what lets both kinds of document share a
    // fixture.

    it('still resolves the right mutation once a saved track joins the fixture', async () => {
        const mockUpdate = vi.fn().mockResolvedValue({ data: { updateInitialConfig: { initialized: true } } });
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    organizationName: 'Pack 42',
                    debugMode: false,
                    tracks: [
                        { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false, historicalRecords: [] },
                    ],
                },
            },
            fetching: false,
            error: null,
        }, vi.fn()]);
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

        await openSection('tracks');
        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
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
                    organizationName: 'Pack 42',
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

        await openSection('tracks');

        const lengths = await screen.findAllByLabelText('Length (Feet)');
        expect((lengths[1] as HTMLInputElement).value).toBe('40');
        // The whole point: nothing on the form is blocking submission.
        expect(document.querySelector('form')!.checkValidity()).toBe(true);

        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        expect(mockUpdate.mock.calls[0][0].config.tracks[1].lengthFeet).toBe(40);
    });
});

describe('removing a track from the middle of the list', () => {
    afterEach(cleanup);

    it('sends the surviving tracks by id, not by their new position (#318)', async () => {
        // The server matches a submitted track to its database row by id
        // (#318). Sending no id — the old, position-based behaviour — for a
        // track that already has one would have the server update whichever
        // row now sits at that position, silently renaming and
        // reconfiguring it.
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    organizationName: 'Pack 42',
                    debugMode: false,
                    tracks: [
                        { id: 1, name: 'Track A', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                        { id: 2, name: 'Track B', laneCount: 3, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
                        { id: 3, name: 'Track C', laneCount: 2, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
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

        await openSection('tracks');

        // Remove Track B, the middle one.
        const removeButtons = await screen.findAllByTitle('Remove Track');
        await user.click(removeButtons[1]);

        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        const sentTracks = mockUpdate.mock.calls[0][0].config.tracks;
        expect(sentTracks).toHaveLength(2);
        expect(sentTracks[0]).toMatchObject({ id: 1, name: 'Track A' });
        expect(sentTracks[1]).toMatchObject({ id: 3, name: 'Track C' });
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
                    organizationName: 'Pack 42',
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

        await openSection('tracks');

        expect(await screen.findByLabelText('Lane 1 works')).toBeChecked();
        expect(screen.getByLabelText('Lane 2 works')).not.toBeChecked();
        expect(screen.getByLabelText('Lane 3 works')).toBeChecked();
    });

    it('leads with how many lanes are left', async () => {
        configuredWith([
            { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false, laneOutages: [3] },
        ]);

        await openSection('tracks');

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

        await openSection('tracks');
        await user.click(await screen.findByText('+ Add Another Track'));

        // Still only the saved track's two lanes.
        expect(screen.getAllByLabelText(/^Lane \d+ works$/)).toHaveLength(2);
    });
});

describe('checking one track\'s timer', () => {
    afterEach(cleanup);

    const configuredWith = (tracks: unknown[]) => {
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    initialized: true,
                    organizationName: 'Pack 42',
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

    const saved = (over: Record<string, unknown> = {}) => ({
        id: 4, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE',
        serialPort: null, timerProfile: null, remoteStartInstalled: false, ...over,
    });

    it('links from the track to that track on the diagnostics page', async () => {
        // "Is my timer working" is about one timer, so the way in is on that
        // timer's card — and it carries the track, or a multi-track venue
        // lands on a page of panels and has to guess which is theirs.
        configuredWith([saved()]);
        await openSection('tracks');

        expect(screen.getByRole('link', { name: /check this timer/i })).toHaveAttribute(
            'href',
            '/timer-check#timer-4',
        );
    });

    it('is absent from a track that has not been saved yet', async () => {
        // No id, so nothing to point at — the same rule the lanes and records
        // panels follow.
        configuredWith([saved()]);
        const user = (await import('@testing-library/user-event')).default.setup();
        await openSection('tracks');

        await user.click(screen.getByText('+ Add Another Track'));

        expect(screen.getAllByRole('link', { name: /check this timer/i })).toHaveLength(1);
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
                    organizationName: 'Pack 42',
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

        await openSection('backup');

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

describe('the settings sections', () => {
    afterEach(cleanup);

    const renderWith = (initialConfig: Record<string, unknown>) => {
        (useQuery as any).mockReturnValue([{
            data: { initialConfig },
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

    const configured = {
        initialized: true,
        organizationName: 'Pack 42',
        debugMode: false,
        tracks: [
            { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
        ],
    };

    it('shows the whole form at once on the first run', async () => {
        // A wizard is not sectioned. Somebody who has never seen the app is
        // not going to go looking for the two fields they have not filled in.
        renderWith({ initialized: false, organizationName: '', tracks: [] });

        expect(await screen.findByLabelText('Organization Name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('e.g. Main Track')).toBeInTheDocument();
        expect(screen.getByLabelText('Operator PIN')).toBeInTheDocument();
        expect(screen.queryByTestId('settings-nav')).toBeNull();
    });

    it('shows one section at a time once the install is configured', async () => {
        renderWith(configured);

        expect(await screen.findByTestId('settings-nav')).toBeInTheDocument();
        // General is where it opens.
        expect(screen.getByLabelText('Organization Name')).toBeInTheDocument();
        expect(screen.queryByLabelText('Track Name')).toBeNull();
        expect(screen.queryByRole('button', { name: /download a backup/i })).toBeNull();

        await openSection('tracks');
        expect(screen.getByLabelText('Track Name')).toBeInTheDocument();
        expect(screen.queryByLabelText('Organization Name')).toBeNull();
    });

    it('keeps an edit made in a section that is no longer on screen', async () => {
        // The fields live on the page, not in the section, so switching is not
        // a discard — and one Save covers all three form sections.
        renderWith(configured);
        const user = (await import('@testing-library/user-event')).default.setup();

        const name = await screen.findByLabelText('Organization Name');
        await user.clear(name);
        await user.type(name, 'Pack 99');

        await openSection('tracks');
        await openSection('general');

        expect(screen.getByLabelText('Organization Name')).toHaveValue('Pack 99');
    });

    it('sends the operator to the section holding the problem', async () => {
        // The browser only validates what it is rendering, and with one
        // section on screen the offending field usually is not. Reporting
        // "Your organization needs a name" while showing the track form would
        // be a dead end.
        const mockUpdate = vi.fn().mockResolvedValue({ data: {} });
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { ...configured, organizationName: '' } },
            fetching: false,
            error: null,
        }, vi.fn()]);
        (useMutation as any).mockImplementation((query: any) =>
            documentText(query).includes('mutation UpdateInitialConfig')
                ? [{ fetching: false }, mockUpdate]
                : [{ fetching: false }, vi.fn()],
        );
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );
        const user = (await import('@testing-library/user-event')).default.setup();

        await openSection('tracks');
        await user.click(screen.getByText('Save Settings'));

        expect(await screen.findByText(/organization needs a name/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Organization Name')).toBeInTheDocument();
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

describe('the Appearance section (#498)', () => {
    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    const configured = {
        initialized: true,
        organizationName: 'Pack 42',
        debugMode: false,
        displayTheme: 'MATCH_APP',
        printablesTheme: 'MATCH_APP',
        tracks: [
            { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
        ],
    };

    it('opens on Field Uniform / Match App by default, with a live preview', async () => {
        (useQuery as any).mockReturnValue([{ data: { initialConfig: configured }, fetching: false, error: null }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );

        await openSection('appearance');

        expect(screen.getByTestId('app-theme-option-field-uniform')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('display-theme-option-MATCH_APP')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('printables-theme-option-MATCH_APP')).toHaveAttribute('aria-pressed', 'true');
        // The App picker itself has no "Match App theme" option — there is
        // nothing for the App surface to match.
        expect(screen.queryByTestId('app-theme-option-MATCH_APP')).toBeNull();
        expect(screen.getByTestId('appearance-preview')).toBeInTheDocument();
    });

    it('seeds the pickers from a saved install-wide theme', async () => {
        (useQuery as any).mockReturnValue([{
            data: { initialConfig: { ...configured, displayTheme: 'old-glory', printablesTheme: 'newsprint' } },
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

        await openSection('appearance');

        expect(screen.getByTestId('display-theme-option-old-glory')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('printables-theme-option-newsprint')).toHaveAttribute('aria-pressed', 'true');
    });

    it('sends the chosen Display/Printables theme on save, and stores the App theme only in localStorage', async () => {
        const mockUpdate = vi.fn().mockResolvedValue({ data: {} });
        (useQuery as any).mockReturnValue([{ data: { initialConfig: configured }, fetching: false, error: null }, vi.fn()]);
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

        await openSection('appearance');
        await user.click(screen.getByTestId('app-theme-option-old-glory'));
        await user.click(screen.getByTestId('display-theme-option-under-the-lights'));
        await user.click(screen.getByTestId('printables-theme-option-clear-sight'));

        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        const sent = mockUpdate.mock.calls[0][0].config;
        expect(sent.displayTheme).toBe('under-the-lights');
        expect(sent.printablesTheme).toBe('clear-sight');
        // Never sent — the App theme lives only on this device.
        expect(sent.appTheme).toBeUndefined();
        // Written after the mutation settles (there's a brief post-mutation
        // wait in handleSubmit before it), so this has to wait too.
        await waitFor(() =>
            expect(window.localStorage.getItem('trustytrack.appTheme')).toBe('old-glory'),
        );
    });
});

describe('Terminology (#496 stage 3; #551 adds the vehicle term)', () => {
    const configured = {
        initialized: true,
        organizationName: 'Pack 42',
        debugMode: false,
        displayTheme: 'MATCH_APP',
        printablesTheme: 'MATCH_APP',
        racingGroupSingular: null,
        racingGroupPlural: null,
        organizationSingular: null,
        organizationPlural: null,
        vehicleSingular: null,
        vehiclePlural: null,
        tracks: [
            { id: 1, name: 'Main Track', laneCount: 4, lengthFeet: 40, timerType: 'FAKE', serialPort: null, timerProfile: null, remoteStartInstalled: false },
        ],
    };

    it('opens unchecked with no fields when nothing has been customized', async () => {
        (useQuery as any).mockReturnValue([{ data: { initialConfig: configured }, fetching: false, error: null }, vi.fn()]);
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
        render(
            <MemoryRouter>
                <AlertProvider>
                    <SystemSettings />
                </AlertProvider>
            </MemoryRouter>,
        );

        await openSection('general');

        expect(screen.getByLabelText('Use different words for “Den”, “Pack” and “Car”')).not.toBeChecked();
        expect(screen.queryByLabelText('One racing group (was “Den”)')).toBeNull();
        expect(screen.queryByLabelText('One vehicle (was “Car”)')).toBeNull();
    });

    it('seeds the checkbox and fields from a saved override', async () => {
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    ...configured,
                    racingGroupSingular: 'Class',
                    racingGroupPlural: 'Classes',
                    organizationSingular: 'Club',
                    organizationPlural: 'Clubs',
                    vehicleSingular: 'Rocket',
                    vehiclePlural: 'Rockets',
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

        await openSection('general');

        expect(screen.getByLabelText('Use different words for “Den”, “Pack” and “Car”')).toBeChecked();
        expect(screen.getByLabelText('One racing group (was “Den”)')).toHaveValue('Class');
        expect(screen.getByLabelText('The organization itself (was “Pack”)')).toHaveValue('Club');
        expect(screen.getByLabelText('One vehicle (was “Car”)')).toHaveValue('Rocket');
    });

    it('seeds the checkbox when only the vehicle word has been customized', async () => {
        (useQuery as any).mockReturnValue([{
            data: {
                initialConfig: {
                    ...configured,
                    vehicleSingular: 'Boat',
                    vehiclePlural: 'Boats',
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

        await openSection('general');

        expect(screen.getByLabelText('Use different words for “Den”, “Pack” and “Car”')).toBeChecked();
        expect(screen.getByLabelText('One vehicle (was “Car”)')).toHaveValue('Boat');
    });

    it('sends clearTerminology when the box is left unchecked', async () => {
        const mockUpdate = vi.fn().mockResolvedValue({ data: {} });
        (useQuery as any).mockReturnValue([{ data: { initialConfig: configured }, fetching: false, error: null }, vi.fn()]);
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

        await openSection('general');
        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        const sent = mockUpdate.mock.calls[0][0].config;
        expect(sent.clearTerminology).toBe(true);
        expect(sent.racingGroupSingular).toBeUndefined();
        expect(sent.vehicleSingular).toBeUndefined();
    });

    it('sends the six words, and no clearTerminology, once the box is checked', async () => {
        const mockUpdate = vi.fn().mockResolvedValue({ data: {} });
        (useQuery as any).mockReturnValue([{ data: { initialConfig: configured }, fetching: false, error: null }, vi.fn()]);
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

        await openSection('general');
        await user.click(screen.getByLabelText('Use different words for “Den”, “Pack” and “Car”'));
        await user.clear(screen.getByLabelText('One racing group (was “Den”)'));
        await user.type(screen.getByLabelText('One racing group (was “Den”)'), 'Class');
        await user.clear(screen.getByLabelText('One vehicle (was “Car”)'));
        await user.type(screen.getByLabelText('One vehicle (was “Car”)'), 'Rocket');
        await user.click(screen.getByText('Save Settings'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        const sent = mockUpdate.mock.calls[0][0].config;
        expect(sent.racingGroupSingular).toBe('Class');
        // The other three were left at the seeded default rather than the
        // organization's own saved words, but they still travel — one box
        // controls all six together.
        expect(sent.racingGroupPlural).toBe('Dens');
        expect(sent.organizationSingular).toBe('Pack');
        expect(sent.organizationPlural).toBe('Packs');
        expect(sent.vehicleSingular).toBe('Rocket');
        expect(sent.vehiclePlural).toBe('Cars');
        expect(sent.clearTerminology).toBeUndefined();
    });
});
