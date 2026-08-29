// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    // No test in this file asserts on a specific mutation — it exercises the
    // scan-to-check-in flow reaching the check-in form — but a shared spy
    // across all ten of `RaceDetails.tsx`'s `useMutation` calls is still the
    // wrong default, so a test added later inherits a discriminating mock
    // rather than a blanket one. Each call gets its own inert spy.
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => [
        { fetching: false },
        vi.fn(),
    ]);
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        {
            data: {
                race: {
                    id: 1,
                    name: 'Test Race',
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'MANUAL',
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
                    racingGroups: [],
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

function openRoster() {
    render(
        <MemoryRouter initialEntries={['/race/1']}>
            <Routes>
                <Route path="/race/:raceId" element={<RaceDetails />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('scanning from the roster', () => {
    it('opens the scanner', async () => {
        openRoster();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: /Scan/ }));

        expect(screen.getByText('Scan to Check In')).toBeInTheDocument();
    });

    it('lands on the racer’s check-in, not just their row', async () => {
        // The point of scanning: one action gets the operator to the form they
        // would otherwise have to find in a list of sixty.
        openRoster();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: /Scan/ }));

        // No camera in jsdom, so this goes in by the car-number entry — the
        // same path a Safari operator takes.
        await userEvent.type(screen.getByLabelText('Car number'), '102');
        await userEvent.click(screen.getByRole('button', { name: /Find/ }));

        expect(screen.getByText('Racer Check In')).toBeInTheDocument();
        expect(screen.queryByText('Scan to Check In')).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('Beta')).toBeInTheDocument();
    });
});
