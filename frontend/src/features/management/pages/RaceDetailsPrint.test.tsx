// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useSubscription } from 'urql';
import RaceDetails from './RaceDetails';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: undefined },
        vi.fn(),
    ]);
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{}, vi.fn()]);
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        {
            data: {
                race: {
                    id: 1,
                    name: 'Test Race',
                    dateTime: '2026-03-14T09:30:00',
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
                    racers: [
                        {
                            id: 1,
                            firstName: 'Alpha',
                            lastName: 'One',
                            carNumber: 101,
                            carPassedInspection: false,
                        },
                        {
                            id: 2,
                            firstName: 'Beta',
                            lastName: 'Two',
                            carNumber: 102,
                            carPassedInspection: false,
                        },
                    ],
                    dens: [],
                    leaderboard: [],
                },
                tracks: [],
            },
            fetching: false,
            error: null,
        },
        vi.fn(),
    ]);
});

/** Stands in for the print page, and reports where the roster sent us. */
function WhereAmI() {
    const location = useLocation();
    return <div data-testid="destination">{location.pathname + location.search}</div>;
}

function openRoster() {
    render(
        <MemoryRouter initialEntries={['/race/1']}>
            <Routes>
                <Route path="/race/:raceId" element={<RaceDetails />} />
                <Route path="/race/:raceId/print" element={<WhereAmI />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('printing from the roster', () => {
    it('prints the whole roster when nothing is selected', async () => {
        openRoster();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        // Print moved into the overflow menu: it is something an operator does
        // once before check-in opens, not repeatedly during the event.
        fireEvent.click(screen.getByTestId('roster-more-menu'));
        fireEvent.click(screen.getByRole('button', { name: /^Print$/ }));

        // No `racers=` at all, which the print page reads as everyone. A "0
        // selected" parameter would print an empty sheet.
        expect(screen.getByTestId('destination')).toHaveTextContent('/race/1/print');
        expect(screen.getByTestId('destination')).not.toHaveTextContent('racers=');
    });

    it('carries the selection to the print page', async () => {
        openRoster();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('racer-select-2'));
        fireEvent.click(screen.getByTestId('roster-more-menu'));
        fireEvent.click(screen.getByRole('button', { name: /Print \(1\)/ }));

        expect(screen.getByTestId('destination')).toHaveTextContent(
            '/race/1/print?racers=2',
        );
    });

    it('counts the selection on the button', async () => {
        openRoster();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('select-all-header'));

        fireEvent.click(screen.getByTestId('roster-more-menu'));
        expect(screen.getByRole('button', { name: /Print \(2\)/ })).toBeInTheDocument();
    });
});
