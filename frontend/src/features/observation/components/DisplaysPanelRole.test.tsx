// @vitest-environment jsdom
/**
 * #892: every mutation this panel runs — assignDisplay, advanceDisplay,
 * renameDisplay, forgetDisplay, identifyDisplay — is operator-only
 * (backend/api/auth.py's OPERATOR_ONLY_MUTATIONS). A display registers by
 * *subscribing*, never by calling one of these itself, so this panel is only
 * ever reached from Race Control — but Race Control has no role gate of its
 * own, so a check-in tablet used to see every control here fully enabled.
 * This is the screen's own half: which controls are disabled for which
 * role. Backend enforcement is `backend/tests/test_auth_policy.py`'s job.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(),
        useClient: vi.fn(),
    };
});

const DISPLAY_ROW = {
    displayId: 'd-1',
    name: 'Gym north',
    view: 'STANDINGS',
    cycleSeconds: 10,
    scrollBehavior: 'PAGING',
    showCheckedIn: true,
    qrTarget: 'STANDINGS',
    showStandingsTicker: true,
    description: 'Standings',
    pacedByAPerson: false,
    connected: true,
};

function mockQueries(role: 'VIEWER' | 'CHECKIN' | 'OPERATOR') {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { query: unknown }) => {
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
            const asksForAwards =
                (args.query as { definitions: { name?: { value?: string } }[] }).definitions?.some(
                    (definition) => definition.name?.value === 'RaceAwardCount',
                );
            if (asksForAwards) {
                return [{ data: { race: { id: 1, awards: [] } }, fetching: false, error: null }, vi.fn()];
            }
            return [{ data: { displays: [DISPLAY_ROW] }, fetching: false, error: null }, vi.fn()];
        },
    );
}

function renderPanel() {
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(() => [
        { fetching: false },
        vi.fn().mockResolvedValue({ data: {} }),
    ]);
    (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });
    render(<DisplaysPanel raceId={1} />);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('the displays panel reflects the caller role', () => {
    it('disables every control on a display row for a viewer', async () => {
        mockQueries('VIEWER');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });

        expect(screen.getByLabelText('What Gym north shows')).toBeDisabled();
        expect(screen.getByLabelText(`Rename Gym north`)).toBeDisabled();
        expect(screen.getByLabelText('Identify Gym north')).toBeDisabled();
    });

    it('names the operator PIN on a disabled control', async () => {
        mockQueries('VIEWER');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });

        expect(screen.getByLabelText('What Gym north shows')).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('disables the same controls for check-in — displays are operator-only, not check-in-level', async () => {
        mockQueries('CHECKIN');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });

        expect(screen.getByLabelText('What Gym north shows')).toBeDisabled();
    });

    it('leaves every control enabled for the operator', async () => {
        mockQueries('OPERATOR');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });

        expect(screen.getByLabelText('What Gym north shows')).toBeEnabled();
        expect(screen.getByLabelText(`Rename Gym north`)).toBeEnabled();
        expect(screen.getByLabelText('Identify Gym north')).toBeEnabled();
    });

    it('does not disable "Open a new display window", which is not a mutation', async () => {
        mockQueries('VIEWER');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Open a new display window' })).toBeEnabled();
    });
});
