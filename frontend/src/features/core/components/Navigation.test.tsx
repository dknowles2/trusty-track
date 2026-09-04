import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import Navigation from './Navigation';
import * as Urql from 'urql';

vi.mock('urql', async () => {
    const actual = await vi.importActual('urql');
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

describe('Navigation Component', () => {
    const mockUseQuery = Urql.useQuery as any;
    const mockUseMutation = Urql.useMutation as any;
    const mockUseSubscription = Urql.useSubscription as any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseQuery.mockReturnValue([{
            data: {
                races: [
                    { id: 1, name: 'Race 1' },
                    { id: 2, name: 'Race 2' }
                ]
            },
            fetching: false,
            error: undefined
        }]);

        mockUseMutation.mockReturnValue([{}, vi.fn()]);

        // No signal has arrived yet — the ordinary state for every test that
        // isn't specifically about #300.
        mockUseSubscription.mockReturnValue([{ data: undefined, fetching: false, error: undefined }]);

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
        // Race selector might show "Select a Race" or the active race name depending on logic
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
            // One row of race navigation, so every race view is here — the
            // per-page Roster/Standings/Awards/Stats toggle is gone.
            expect(screen.getByText('Roster')).toBeInTheDocument();
            expect(screen.getByText('Control')).toBeInTheDocument();
            expect(screen.getByText('Standings')).toBeInTheDocument();
            expect(screen.getByText('Awards')).toBeInTheDocument();
            expect(screen.getByText('Stats')).toBeInTheDocument();
            expect(screen.getByText('Live')).toBeInTheDocument();
        });
    });

    it('maps RaceFormData snake_case to camelCase when creating a race', async () => {
        const mockExecuteMutation = vi.fn().mockResolvedValue({
            data: { createRace: { id: 3 } },
            error: undefined,
        });
        mockUseMutation.mockReturnValue([{}, mockExecuteMutation]);
        mockUseQuery
            .mockReturnValueOnce([{ data: { races: [{ id: 1, name: 'Race 1' }] }, fetching: false, error: undefined }])
            .mockReturnValue([{ data: { tracks: [{ id: 1, name: 'Track A' }] }, fetching: false, error: undefined }]);

        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        // Open the create race dropdown and click "New Race..."
        fireEvent.click(screen.getByText('Select a Race'));
        await waitFor(() => expect(screen.getByText('New Race...')).toBeInTheDocument());
        fireEvent.click(screen.getByText('New Race...'));

        await waitFor(() => expect(screen.getByText('Create New Race Event')).toBeInTheDocument());

        // The setup wizard (#662) sits in front of the form: the mocked
        // context query answers with no races, so it opens on the questions,
        // and two Nexts — the default answers, the scaffolded dens — reach it.
        fireEvent.click(screen.getByTestId('setup-next'));
        fireEvent.click(screen.getByTestId('setup-next'));

        // Fill in the required name field and submit
        fireEvent.change(screen.getByPlaceholderText('e.g. 2024 Pinewood Derby'), { target: { value: 'Test Race' } });
        fireEvent.click(screen.getByText('Create Race'));

        await waitFor(() => {
            expect(mockExecuteMutation).toHaveBeenCalledWith({
                race: expect.objectContaining({
                    name: 'Test Race',
                    trackId: expect.any(Number),
                    dateTime: expect.any(String),
                    scoringStrategy: expect.any(String),
                    carNumberingStrategy: expect.any(String),
                    globalStartNumber: expect.any(Number),
                    championshipTrophies: expect.any(Number),
                    // The reported bug (#332): this handler used to build its
                    // own input object and left weightLimitOz out, so a race
                    // created from "New Race…" got no weight check while the
                    // form on screen showed one ticked.
                    weightLimitOz: expect.any(Number),
                    // The wizard's scaffolded dens ride along in the same
                    // mutation (#662).
                    racingGroups: expect.arrayContaining([expect.objectContaining({ name: 'Lion' })]),
                }),
            });
            // Ensure no snake_case keys are passed
            const callArg = mockExecuteMutation.mock.calls[0][0].race;
            expect(callArg).not.toHaveProperty('track_id');
            expect(callArg).not.toHaveProperty('date_time');
            expect(callArg).not.toHaveProperty('scoring_strategy');
            expect(callArg).not.toHaveProperty('car_numbering_strategy');
            expect(callArg).not.toHaveProperty('global_start_number');
            expect(callArg).not.toHaveProperty('championship_trophies');
            expect(callArg).not.toHaveProperty('weight_limit_oz');
        });
    });

    // #300: a race created, renamed or deleted in another tab left this list
    // stale until a reload — GET_RACES_NAV was fetched once on mount and
    // nothing here ever asked again.
    it('re-fetches the race list when racesChanged signals a change elsewhere', async () => {
        const reexecuteRacesNav = vi.fn();
        mockUseQuery
            .mockReturnValueOnce([
                { data: { races: [{ id: 1, name: 'Race 1' }] }, fetching: false, error: undefined },
                reexecuteRacesNav,
            ])
            .mockReturnValue([{ data: undefined, fetching: false, error: undefined }]);
        mockUseSubscription.mockReturnValue([{ data: { racesChanged: true }, error: undefined }]);

        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            expect(reexecuteRacesNav).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
        });
    });

    it('does not re-fetch the race list before racesChanged has fired', () => {
        const reexecuteRacesNav = vi.fn();
        mockUseQuery
            .mockReturnValueOnce([
                { data: { races: [{ id: 1, name: 'Race 1' }] }, fetching: false, error: undefined },
                reexecuteRacesNav,
            ])
            .mockReturnValue([{ data: undefined, fetching: false, error: undefined }]);
        mockUseSubscription.mockReturnValue([{ data: undefined, error: undefined }]);

        render(
            <AlertProvider>
                <MemoryRouter>
                    <Navigation />
                </MemoryRouter>
            </AlertProvider>
        );

        expect(reexecuteRacesNav).not.toHaveBeenCalled();
    });
});
