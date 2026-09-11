// @vitest-environment jsdom
/**
 * #892: a VIEWER or CHECKIN device opening the roster used to see every
 * control fully enabled — Edit race, Add Racer, Scan, a Check In button
 * on every row — and find out what it could not do only by pressing a
 * button and reading a refusal written for a developer. This is the
 * screen's own half: which controls are disabled for which role. Backend
 * enforcement is `backend/tests/test_auth_policy.py`'s job.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

function mockMutations(overrides: [unknown, ReturnType<typeof vi.fn>][] = []) {
    (useMutation as any).mockImplementation((query: unknown) => {
        const match = overrides.find(([doc]) => doc === query);
        return [{ fetching: false }, match ? match[1] : vi.fn()];
    });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }),
}));

const RACE_QUERY_RESULT = {
    data: {
        race: {
            id: 1,
            name: 'Open Derby',
            dateTime: null,
            location: null,
            trackId: 1,
            scoringStrategy: 'TIMED',
            carNumberingStrategy: 'MANUAL',
            racers: [],
            racingGroups: [],
            leaderboard: [],
            isLocked: false,
        },
        tracks: [{ id: 1, name: 'Main Track' }],
    },
    fetching: false,
    error: null,
};

/**
 * Unlike `RaceDetailsLock.test.tsx`'s `mockLockedRaceQuery`, this
 * distinguishes by query document — `useRole()` reads `INITIAL_CONFIG_QUERY`
 * through the same `useQuery`, and a mock that returned the race payload for
 * every call would leave `data?.initialConfig` undefined and every test
 * defaulting to `OPERATOR` regardless of what it meant to test.
 */
function mockQueries(role: 'VIEWER' | 'CHECKIN' | 'OPERATOR') {
    (useQuery as any).mockImplementation((args: { query: unknown }) => {
        if (args.query === INITIAL_CONFIG_QUERY) {
            return [
                {
                    data: { initialConfig: { role, isOperator: role === 'OPERATOR' } },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ];
        }
        return [RACE_QUERY_RESULT, vi.fn()];
    });
}

function renderRaceDetails() {
    return render(
        <MemoryRouter initialEntries={['/races/1']}>
            <Routes>
                <Route path="/races/:raceId" element={<RaceDetails />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('the roster screen reflects the caller role', () => {
    it('disables every check-in-and-above control for a viewer', async () => {
        mockQueries('VIEWER');
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /Add Racer/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Scan' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Edit race' })).toBeDisabled();
    });

    it('names the check-in PIN on a check-in-level control', async () => {
        mockQueries('VIEWER');
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Scan' })).toHaveAttribute(
            'title',
            'That needs the check-in PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('names the operator PIN on an operator-only control', async () => {
        mockQueries('VIEWER');
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Edit race' })).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('lets check-in add and scan racers, but not edit race details', async () => {
        mockQueries('CHECKIN');
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /Add Racer/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Edit race' })).toBeDisabled();
    });

    it('leaves every control enabled for the operator', async () => {
        mockQueries('OPERATOR');
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /Add Racer/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Edit race' })).toBeEnabled();
    });
});
