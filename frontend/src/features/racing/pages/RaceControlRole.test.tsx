import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';

/**
 * #892: the second half of the issue's reproduction — a check-in tablet's
 * Race Control screen rendered "Edit race" fully enabled and only found out
 * it could not save from a refused `updateRace`. The scheduling controls
 * (Add Round, Delete, Regenerate, Re-Run) are `ScheduleManagement`'s own
 * concern, pinned by `ScheduleManagementRole.test.tsx`; this is the one
 * control `RaceControl.tsx` itself renders.
 */
vi.mock('../components/ScheduleManagement', () => ({
    ScheduleManagement: () => <div data-testid="schedule-management">Schedule Management</div>,
}));

vi.mock('../components/RaceExecution', () => ({
    RaceExecution: () => <div data-testid="race-execution">Race Execution</div>,
}));

vi.mock('../components/FreeRaceTab', () => ({
    FreeRaceTab: () => <div data-testid="free-race-tab">Free Race Tab</div>,
}));

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

const mockRaceData = {
    race: {
        id: 1,
        name: 'Test Race',
        championshipTrophies: 3,
        scoringStrategy: 'TIMED',
        track: { id: 1, laneCount: 4, timerType: 'FAKE' },
        racingGroups: [],
        racers: [],
        heats: [],
    },
};

/**
 * Distinguishes by query document, like `RaceDetailsRole.test.tsx`'s
 * `mockQueries` — `useRole()` reads `INITIAL_CONFIG_QUERY` through the same
 * `useQuery`, and a mock returning the race payload for every call would
 * leave `data?.initialConfig` undefined and every role test defaulting to
 * `OPERATOR`.
 */
function mockQueries(role: 'VIEWER' | 'CHECKIN' | 'OPERATOR') {
    (useQuery as any).mockImplementation((args: { query: unknown }) => {
        if (args.query === INITIAL_CONFIG_QUERY) {
            return [
                { data: { initialConfig: { role } }, fetching: false, error: null },
                vi.fn(),
            ];
        }
        return [{ data: mockRaceData, fetching: false, error: null }, vi.fn()];
    });
}

function renderRaceControl() {
    return render(
        <MemoryRouter initialEntries={['/race/1/control']}>
            <AlertProvider>
                <Routes>
                    <Route path="/race/:raceId/control" element={<RaceControl />} />
                </Routes>
            </AlertProvider>
        </MemoryRouter>,
    );
}

describe('RaceControl "Edit race" reflects the caller role (#892)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
        (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
    });

    it('disables Edit race for a check-in device', async () => {
        mockQueries('CHECKIN');
        renderRaceControl();

        await waitFor(() => {
            expect(screen.getByTestId('race-control-edit-race')).toBeInTheDocument();
        });

        const editButton = screen.getByTestId('race-control-edit-race');
        expect(editButton).toBeDisabled();
        expect(editButton).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('leaves Edit race enabled for the operator', async () => {
        mockQueries('OPERATOR');
        renderRaceControl();

        await waitFor(() => {
            expect(screen.getByTestId('race-control-edit-race')).toBeInTheDocument();
        });

        expect(screen.getByTestId('race-control-edit-race')).toBeEnabled();
    });
});
