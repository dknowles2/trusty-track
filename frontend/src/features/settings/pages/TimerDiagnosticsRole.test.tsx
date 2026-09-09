// @vitest-environment jsdom
/**
 * #892: `startTimerTest`, `forceResults`, `reconnectTimer` and `resetTimer`
 * are all operator-only (backend/api/auth.py's OPERATOR_ONLY_MUTATIONS).
 * `/timer-check` has no route-level role gate, so a check-in tablet or an
 * unauthenticated display can open this page the same as the operator. This
 * is the screen's own half: which controls are disabled for which role.
 * Backend enforcement is `backend/tests/test_auth_policy.py`'s job.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { useQuery, useSubscription, useMutation } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';
import TimerDiagnostics from './TimerDiagnostics';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(),
        useMutation: vi.fn(),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const TRACK = {
    id: 1,
    name: 'Main Track',
    timerType: 'AUTO_DETECT_BACKEND',
    serialPort: null,
    laneCount: 4,
};

const STATUS = {
    state: 'IDLE',
    deviceName: null,
    deviceProvenance: null,
    port: null,
    laneCount: null,
    lastError: null,
    testRun: false,
    indicatesTimingStarted: false,
    hasCountdownClock: false,
    hasPhotoFinishTrigger: false,
    pendingResults: [],
    serialLog: [],
};

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
        return [{ data: { tracks: [TRACK] }, fetching: false, error: null }, vi.fn()];
    });
    (useSubscription as any).mockReturnValue([
        { data: { timerStatus: { trackId: 1, status: STATUS } } },
    ]);
    (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/timer-check']}>
            <AlertProvider>
                <TimerDiagnostics />
            </AlertProvider>
        </MemoryRouter>,
    );
}

describe('the timer diagnostics page reflects the caller role', () => {
    it('disables Start a test run, Connect and Reset for a viewer', async () => {
        mockQueries('VIEWER');
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Main Track')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Start a test run' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Search for the timer' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    });

    it('names the operator PIN on a disabled control', async () => {
        mockQueries('VIEWER');
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Main Track')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Start a test run' })).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('disables the same controls for check-in — timer diagnostics is operator-only', async () => {
        mockQueries('CHECKIN');
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Main Track')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    });

    it('leaves every control enabled for the operator', async () => {
        mockQueries('OPERATOR');
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Main Track')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Start a test run' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Search for the timer' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    });
});
