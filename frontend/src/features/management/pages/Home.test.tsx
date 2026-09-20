// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import Home from './Home';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { useQuery, useMutation } from 'urql';
import { useRole } from '../../core/hooks/useRole';

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

/**
 * Same idea as `mockPracticeMutation` above, for the lock/unlock entry's own
 * `UpdateRace` mutation (#1239) — distinguished from `CreateRace` and
 * `CreatePracticeRace` by operation name so a test can assert on exactly
 * what `updateRace` was called with, without those other two mutations'
 * calls polluting the same spy.
 */
function mockLockMutation() {
    const updateFn = vi.fn().mockResolvedValue({ data: { updateRace: { id: 1 } } });
    const otherFn = vi.fn().mockResolvedValue({ data: {} });
    (useMutation as any).mockImplementation((doc: any) => {
        const opName = doc?.definitions?.[0]?.name?.value;
        if (opName === 'UpdateRace') {
            return [{ fetching: false }, updateFn];
        }
        return [{ fetching: false }, otherFn];
    });
    return { updateFn, otherFn };
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

// `useRole` reads `INITIAL_CONFIG_QUERY` through the same `useQuery` this
// file already mocks wholesale for `GetRaces` — a shared mock would leave
// `data?.initialConfig` undefined for every test (defaulting to OPERATOR,
// same as `RaceDetailsRole.test.tsx` warns against relying on by accident).
// Mocking the hook directly lets the one test that cares about role control
// it without disturbing every other test's `GetRaces` mock.
vi.mock('../../core/hooks/useRole', () => ({
    useRole: vi.fn(),
}));

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

/** Sets `window.innerWidth` and fires the `resize` event a real browser
 * would — `useNarrowViewport` only reads the width inside its listener. */
function resizeTo(width: number) {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
}

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resizeTo(1024);
});

describe('Home Page', () => {
    // Helper to mock mutation (defaults to success)
    const mockMutation = vi.fn().mockResolvedValue({ data: {} });
    (useMutation as any).mockReturnValue([{}, mockMutation]);
    // Every test defaults to OPERATOR; the one test that cares about a
    // lesser role overrides this itself.
    (useRole as any).mockReturnValue({ role: 'OPERATOR', isOperator: true, canCheckIn: true });

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

    it("badges each race with its schedule's own status (#847)", async () => {
        renderHome({
            races: [
                { id: 1, name: 'Done Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, status: 'FINISHED' },
                { id: 2, name: 'Racing Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, status: 'IN_PROGRESS' },
                { id: 3, name: 'Future Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, status: 'NOT_STARTED' },
            ],
        });

        await waitFor(() => {
            expect(screen.getByText('Done Derby')).toBeInTheDocument();
        });

        expect(screen.getByText('Finished')).toBeInTheDocument();
        expect(screen.getByText('In progress')).toBeInTheDocument();
        expect(screen.getByText('Not started')).toBeInTheDocument();
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

    it('offers a rehearsal from the empty state, with no chevron to open', async () => {
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
        const button = screen.getByTestId('practice-race');
        expect(button).toBeInTheDocument();
        // With no practice race there is nothing to be an alternative to
        // (#1238), so it's a plain button — no split-button chevron, and
        // therefore no "Start new" entry to find anywhere on the page.
        expect(button).not.toHaveClass('split-btn-main');
        expect(screen.queryByRole('button', { name: /More practice race options/ })).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();
    });

    describe('resuming an existing practice race (#588)', () => {
        it('offers to resume, as the main click of a split button', async () => {
            mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            const button = await screen.findByTestId('practice-race');
            expect(button).toHaveTextContent('Resume practice race');
            expect(button).toHaveClass('split-btn-main');
            expect(screen.getByRole('button', { name: /More practice race options/ })).toBeInTheDocument();
        });

        // #1238: "Start new" folded into the chevron of a split button on
        // Resume, mirroring the roster's own Add Racer split button — the
        // entry is not in the document until the chevron opens it, the same
        // shape Add Racer's own bulk-action menu tests already exercise.
        it('keeps the Start new entry off the page until the chevron opens it', async () => {
            mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            await screen.findByTestId('practice-race');
            expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /More practice race options/ }));

            expect(await screen.findByTestId('practice-race-start-new')).toBeInTheDocument();
        });

        it('resumes without opening the chevron', async () => {
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

        it('lets the operator deliberately start a fresh rehearsal from the chevron', async () => {
            const { practiceFn } = mockPracticeMutation();
            renderHome({
                races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                practiceRace: { id: 5, name: 'Practice Race' },
            });

            await screen.findByTestId('practice-race');
            fireEvent.click(screen.getByRole('button', { name: /More practice race options/ }));
            fireEvent.click(await screen.findByTestId('practice-race-start-new'));

            await waitFor(() => {
                expect(practiceFn).toHaveBeenCalledWith({ startNew: true });
            });
        });

        // Second-round review on #1238: the outside-click/Escape effect and
        // its `.split-btn-arrow` special case are behaviour this PR adds,
        // and nothing above exercised any of it — the effect could be
        // deleted whole and every test up to this point would still pass.
        describe('closing the chevron menu', () => {
            it('closes on Escape, removing the entry and flipping aria-expanded', async () => {
                mockPracticeMutation();
                renderHome({
                    races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                    practiceRace: { id: 5, name: 'Practice Race' },
                });

                await screen.findByTestId('practice-race');
                const chevron = screen.getByRole('button', { name: /More practice race options/ });
                fireEvent.click(chevron);
                expect(await screen.findByTestId('practice-race-start-new')).toBeInTheDocument();

                fireEvent.keyDown(document, { key: 'Escape' });

                await waitFor(() => {
                    expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();
                });
                expect(chevron).toHaveAttribute('aria-expanded', 'false');
            });

            it('closes on a click outside the dropdown', async () => {
                mockPracticeMutation();
                renderHome({
                    races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                    practiceRace: { id: 5, name: 'Practice Race' },
                });

                await screen.findByTestId('practice-race');
                fireEvent.click(screen.getByRole('button', { name: /More practice race options/ }));
                expect(await screen.findByTestId('practice-race-start-new')).toBeInTheDocument();

                fireEvent.mouseDown(document.body);

                await waitFor(() => {
                    expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();
                });
            });

            // A real click is mousedown-then-click. The mousedown half must
            // not let the outside-click handler close the menu ahead of the
            // chevron's own onClick toggle — if it did, the toggle would
            // read the now-false state and flip it back to true, leaving a
            // second click on the chevron re-opening the menu instead of
            // closing it. This is the `.split-btn-arrow` exclusion
            // `RaceDetails.tsx`'s own Add Racer split button already relies
            // on, mirrored here.
            it('a second click on the chevron toggles closed rather than being reopened by its own mousedown', async () => {
                mockPracticeMutation();
                renderHome({
                    races: [{ id: 5, name: 'Practice Race', dateTime: null, location: null, registeredCount: 12, checkedInCount: 12 }],
                    practiceRace: { id: 5, name: 'Practice Race' },
                });

                await screen.findByTestId('practice-race');
                const chevron = screen.getByRole('button', { name: /More practice race options/ });
                fireEvent.click(chevron);
                expect(await screen.findByTestId('practice-race-start-new')).toBeInTheDocument();

                fireEvent.mouseDown(chevron);
                fireEvent.click(chevron);

                await waitFor(() => {
                    expect(screen.queryByTestId('practice-race-start-new')).not.toBeInTheDocument();
                });
                expect(chevron).toHaveAttribute('aria-expanded', 'false');
            });
        });
    });

    describe('race row navigation (#589)', () => {
        // Home used to say "Control" and "View" for the same two
        // destinations the race navigation row calls "Control" and "Live" —
        // one vocabulary, not two. The row's own sixth link is Displays now,
        // not Live (#958), so this follows it there too.
        it('labels the two everyday actions the same as the race navigation row', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            expect(screen.getByRole('link', { name: /Control/ })).toHaveAttribute('href', '/race/7/control');
            expect(screen.getByRole('link', { name: /Displays/ })).toHaveAttribute('href', '/race/7/displays');
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

        it('offers Roster, Standings, Print and Edit race behind the row\'s overflow menu', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            expect(screen.queryByTestId('race-menu-roster-7')).not.toBeInTheDocument();
            expect(screen.queryByTestId('race-menu-standings-7')).not.toBeInTheDocument();
            expect(screen.queryByTestId('race-menu-print-7')).not.toBeInTheDocument();
            expect(screen.queryByTestId('race-menu-edit-7')).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('race-more-menu-7'));

            expect(screen.getByTestId('race-menu-roster-7')).toBeInTheDocument();
            expect(screen.getByTestId('race-menu-standings-7')).toBeInTheDocument();
            expect(screen.getByTestId('race-menu-print-7')).toBeInTheDocument();
            expect(screen.getByTestId('race-menu-edit-7')).toBeInTheDocument();
        });

        // #957: printing had four front doors and nothing on Home reached any
        // of them — a visitor back the next morning for certificates had to
        // start at the roster to find the hub at all.
        it('sends the Print action to that race\'s print hub', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-7'));
            fireEvent.click(screen.getByTestId('race-menu-print-7'));

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/race/7/print');
            });
        });

        // #847: Home used to offer only Control and Live, with no route to a
        // race's results at all — the gap named explicitly in the reopening
        // comment ("the finished race's row ... nothing distinguishes a
        // finished race from one that has not begun").
        it('sends the Standings action to that race\'s standings page', async () => {
            renderHome({
                races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
            });

            await screen.findByText('Annual Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-7'));
            fireEvent.click(screen.getByTestId('race-menu-standings-7'));

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/race/7/standings');
            });
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

    // #1239: lock/unlock without leaving Home — six steps through Edit race
    // down to two taps and a confirm.
    describe('locking and unlocking from the row menu (#1239)', () => {
        it('reads Lock race for an unlocked row and Unlock race for a locked one', async () => {
            renderHome({
                races: [
                    { id: 1, name: 'Open Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: false },
                    { id: 2, name: 'Closed Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: true },
                ],
            });

            await screen.findByText('Open Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-1'));
            expect(screen.getByTestId('race-menu-lock-1')).toHaveTextContent('Lock race');

            // Only one row's menu is open at a time, so opening the second
            // row's menu closes the first.
            fireEvent.click(screen.getByTestId('race-more-menu-2'));
            expect(screen.getByTestId('race-menu-lock-2')).toHaveTextContent('Unlock race');
        });

        it('confirms before locking, sending nothing but { id, race: { isLocked: true } }', async () => {
            const { updateFn } = mockLockMutation();
            renderHome({
                races: [{ id: 3, name: 'Ready Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: false }],
            });

            await screen.findByText('Ready Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-3'));
            fireEvent.click(screen.getByTestId('race-menu-lock-3'));

            // The confirm dialog is up, reusing RaceForm's own FieldHelp
            // summary as its body; the mutation has not fired yet.
            expect(await screen.findByText('Lock race?')).toBeInTheDocument();
            expect(screen.getByText(/Guards a finished race against accidental edits/)).toBeInTheDocument();
            expect(updateFn).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Lock race' }));

            await waitFor(() => {
                expect(updateFn).toHaveBeenCalledTimes(1);
            });
            // Deep equality on the whole variables object — a stray extra
            // field (a name, a track id, anything past `isLocked`) fails
            // this, which is what protects the lock-only payload shape
            // `is_lock_only_update` (`backend/api/race_lock.py`) requires.
            expect(updateFn).toHaveBeenCalledWith({ id: 3, race: { isLocked: true } });
        });

        it('cancelling the confirm sends no mutation', async () => {
            const { updateFn } = mockLockMutation();
            renderHome({
                races: [{ id: 4, name: 'Cancel Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: false }],
            });

            await screen.findByText('Cancel Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-4'));
            fireEvent.click(screen.getByTestId('race-menu-lock-4'));

            expect(await screen.findByText('Lock race?')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

            await waitFor(() => {
                expect(screen.queryByText('Lock race?')).not.toBeInTheDocument();
            });
            expect(updateFn).not.toHaveBeenCalled();
        });

        it('confirms before unlocking, sending nothing but { id, race: { isLocked: false } }', async () => {
            const { updateFn } = mockLockMutation();
            renderHome({
                races: [{ id: 5, name: 'Locked Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: true }],
            });

            await screen.findByText('Locked Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-5'));
            fireEvent.click(screen.getByTestId('race-menu-lock-5'));

            expect(await screen.findByText('Unlock race?')).toBeInTheDocument();
            expect(updateFn).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Unlock race' }));

            await waitFor(() => {
                expect(updateFn).toHaveBeenCalledWith({ id: 5, race: { isLocked: false } });
            });
        });

        it('cancelling the unlock confirm sends no mutation either', async () => {
            const { updateFn } = mockLockMutation();
            renderHome({
                races: [{ id: 6, name: 'Stay Locked Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: true }],
            });

            await screen.findByText('Stay Locked Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-6'));
            fireEvent.click(screen.getByTestId('race-menu-lock-6'));

            expect(await screen.findByText('Unlock race?')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

            await waitFor(() => {
                expect(screen.queryByText('Unlock race?')).not.toBeInTheDocument();
            });
            expect(updateFn).not.toHaveBeenCalled();
        });

        it('is not offered to a non-operator', async () => {
            (useRole as any).mockReturnValue({ role: 'VIEWER', isOperator: false, canCheckIn: false });
            renderHome({
                races: [{ id: 8, name: 'Viewer Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0, isLocked: false }],
            });

            await screen.findByText('Viewer Derby');
            fireEvent.click(screen.getByTestId('race-more-menu-8'));

            // The rest of the menu is unaffected — Home does not otherwise
            // gate this menu by role.
            expect(screen.getByTestId('race-menu-roster-8')).toBeInTheDocument();
            expect(screen.getByTestId('race-menu-edit-8')).toBeInTheDocument();
            expect(screen.queryByTestId('race-menu-lock-8')).not.toBeInTheDocument();
        });
    });

    // jsdom's default `innerWidth` (1024) keeps every test above on the
    // table path — this is the one unit test that mounts the card branch
    // (#1137), a faster signal than a full `homeRaceCards.spec.ts` run for
    // a regression that removes the card rendering entirely.
    it('renders a card per race, not the table, below the 900px breakpoint (#1137)', async () => {
        resizeTo(390);
        renderHome({
            races: [{ id: 7, name: 'Annual Derby', dateTime: null, location: null, registeredCount: 0, checkedInCount: 0 }],
        });

        await screen.findByText('Annual Derby');
        expect(screen.getByTestId('race-cards')).toBeInTheDocument();
        expect(screen.getByTestId('race-card-7')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
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
