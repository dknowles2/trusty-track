// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import Home from './Home';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { useQuery, useMutation } from 'urql';

/**
 * `useMutation` in Home.tsx backs two different mutations
 * (`CreatePracticeRace` and `CreateRace`); the plain
 * `(useMutation as any).mockReturnValue(...)` the other tests in this file
 * use answers both calls identically, which is fine for them but not for a
 * test that needs to tell the practice-race mutation's own state or
 * arguments apart from the other one's. This inspects the document's own
 * operation name — the same thing urql itself keys a request on — to answer
 * each call differently.
 */
function mockPracticeMutation(overrides: { fetching?: boolean; impl?: () => Promise<any> } = {}) {
    const { fetching = false, impl } = overrides;
    const practiceFn = vi.fn(impl ?? (() => Promise.resolve({
        data: { createPracticeRace: { id: 99, name: 'Practice Race' } },
    })));
    const otherFn = vi.fn().mockResolvedValue({ data: {} });
    (useMutation as any).mockImplementation((doc: any) => {
        const opName = doc?.definitions?.[0]?.name?.value;
        if (opName === 'CreatePracticeRace') {
            return [{ fetching }, practiceFn];
        }
        return [{}, otherFn];
    });
    return { practiceFn, otherFn };
}

function renderHome(overrides: { races?: any[]; practiceRace?: any } = {}) {
    const { races = [], practiceRace = null } = overrides;
    (useQuery as any).mockReturnValue([{
        data: { races, practiceRace },
        fetching: false,
        error: null,
    }, vi.fn()]);

    return render(
        <MemoryRouter>
            <AlertProvider>
                <Home />
            </AlertProvider>
        </MemoryRouter>
    );
}

// Mock urql hooks
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
    };
});

// Only `useNavigate` is mocked — everything else (MemoryRouter, Link) stays
// real, so the overflow menu's "Edit race" action can be checked by what it
// actually calls rather than by asserting on an `href` a `<button>` has none
// of.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
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

    it('badges a locked race, and only a locked one (#585)', async () => {
        renderHome({
            races: [
                { id: 1, name: 'Locked Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: true },
                { id: 2, name: 'Open Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: false },
            ],
        });

        await waitFor(() => {
            expect(screen.getByText('Locked Derby')).toBeInTheDocument();
        });

        expect(screen.getAllByText('Locked')).toHaveLength(1);
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
            expect(screen.getByText(/No races found/)).toBeInTheDocument();
        });

        // Colspan should be 6
        const emptyCell = screen.getByText(/No races found/).closest('td');
        expect(emptyCell).toHaveAttribute('colSpan', '6');
    });

    it('offers a rehearsal from the empty state', async () => {
        // The night before an event is when a volunteer wants this, and an
        // empty Home page is exactly where they are standing.
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
            expect(screen.getByTestId('practice-race-empty')).toBeInTheDocument();
        });
        expect(screen.getByTestId('practice-race')).toBeInTheDocument();
        // Nothing to resume yet, so there is nothing to "start over" from.
        expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();
    });

    describe('resuming an existing practice race (#588)', () => {
        it('offers to resume rather than inviting a fresh one', async () => {
            mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            const button = await screen.findByTestId('practice-race');
            expect(button).toHaveTextContent('Resume practice race');
            expect(screen.getByTestId('practice-race-start-new')).toBeInTheDocument();
        });

        it('resumes without asking to start a new one', async () => {
            const { practiceFn } = mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            fireEvent.click(await screen.findByTestId('practice-race'));

            await waitFor(() => {
                expect(practiceFn).toHaveBeenCalledWith({ startNew: false });
            });
        });

        it('lets the operator deliberately start a fresh rehearsal', async () => {
            const { practiceFn } = mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            fireEvent.click(await screen.findByTestId('practice-race-start-new'));

            await waitFor(() => {
                expect(practiceFn).toHaveBeenCalledWith({ startNew: true });
            });
        });
    });

    describe('race row navigation (#589)', () => {
        // Home used to say "Control" and "View" for the same two
        // destinations the race navigation row calls "Control" and "Live" —
        // one vocabulary, not two.
        it('labels the two everyday actions the same as the race navigation row', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            expect(screen.getByRole('link', { name: /Control/ })).toHaveAttribute('href', '/race/7/control');
            expect(screen.getByRole('link', { name: /Live/ })).toHaveAttribute('href', '/race/7/observation');
            expect(screen.queryByText('View')).not.toBeInTheDocument();
        });

        it('names the race title link\'s own destination', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            const titleLink = await screen.findByRole('link', { name: 'Annual Derby' });
            expect(titleLink).toHaveAttribute('href', '/race/7');
            expect(titleLink).toHaveAttribute('title', expect.stringMatching(/roster/i));
        });

        it('offers Roster and Edit race behind the row\'s overflow menu', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            expect(screen.queryByTestId('race-menu-roster-7')).not.toBeInTheDocument();
            expect(screen.queryByTestId('race-menu-edit-7')).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('race-more-menu-7'));

            expect(screen.getByTestId('race-menu-roster-7')).toBeInTheDocument();
            expect(screen.getByTestId('race-menu-edit-7')).toBeInTheDocument();
        });

        it('sends the Edit race action to the roster page with the edit modal requested', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-7'));
            fireEvent.click(screen.getByTestId('race-menu-edit-7'));

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/race/7?edit=true');
            });
        });
    });

    describe('guarding against duplicate clicks (#588)', () => {
        it('disables the button while the mutation is already in flight', async () => {
            mockPracticeMutation({ fetching: true });
            renderHome();

            const button = await screen.findByTestId('practice-race');
            expect(button).toBeDisabled();
            expect(button).toHaveTextContent('Setting up…');
        });

        it('does not fire the mutation twice for a rapid double click', async () => {
            let resolveMutation: (value: unknown) => void = () => {};
            const { practiceFn } = mockPracticeMutation({
                impl: () => new Promise((resolve) => { resolveMutation = resolve; }),
            });
            renderHome();

            const button = await screen.findByTestId('practice-race');
            // Two clicks in the same tick, before React (or urql's own
            // `fetching`) has had a chance to re-render the button as
            // disabled — the case the synchronous ref guard in
            // `handlePractice` exists to close.
            fireEvent.click(button);
            fireEvent.click(button);

            expect(practiceFn).toHaveBeenCalledTimes(1);

            resolveMutation({ data: { createPracticeRace: { id: 1, name: 'Practice Race' } } });
        });
    });
});
