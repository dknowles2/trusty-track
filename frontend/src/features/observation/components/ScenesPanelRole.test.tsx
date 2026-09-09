// @vitest-environment jsdom
/**
 * #892: every mutation this panel runs — applyScenePreset, applyScene,
 * createScene, renameScene, deleteScene — is operator-only
 * (backend/api/auth.py's OPERATOR_ONLY_MUTATIONS), the same bucket as the
 * display mutations `DisplaysPanel` gates. A check-in tablet on Race
 * Control's Displays tab used to see every scene control fully enabled.
 * Backend enforcement is `backend/tests/test_auth_policy.py`'s job.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ScenesPanel from './ScenesPanel';
import { useQuery, useMutation } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
    };
});

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(true), showToast: vi.fn() }),
}));

const SCENE = { id: 1, name: 'Front of house', assignments: [{ displayId: 'd-1' }] };

function mockQueries(role: 'VIEWER' | 'CHECKIN' | 'OPERATOR') {
    type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } | unknown };
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: QueryArgs) => {
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
        const definitions = (args.query as { definitions: { name?: { value?: string } }[] }).definitions;
        const isPresets = definitions?.some((d) => d.name?.value === 'GetScenePresets');
        if (isPresets) {
            return [
                { data: { scenePresets: [{ key: 'RACING', label: 'Racing' }] }, fetching: false, error: null },
                vi.fn(),
            ];
        }
        return [{ data: { scenes: [SCENE] }, fetching: false, error: null }, vi.fn()];
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(() => [
        { fetching: false },
        vi.fn().mockResolvedValue({ data: {} }),
    ]);
});

afterEach(() => cleanup());

function renderPanel() {
    return render(<ScenesPanel raceId={1} />);
}

describe('the scenes panel reflects the caller role', () => {
    it('disables the preset, apply, rename and delete controls for a viewer', async () => {
        mockQueries('VIEWER');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Front of house')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Racing' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Rename Front of house' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete Front of house' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save current layout as a scene' })).toBeDisabled();
    });

    it('names the operator PIN on a disabled control', async () => {
        mockQueries('VIEWER');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Front of house')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Racing' })).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('disables the same controls for check-in — scenes are operator-only, not check-in-level', async () => {
        mockQueries('CHECKIN');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Front of house')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Racing' })).toBeDisabled();
    });

    it('leaves every control enabled for the operator', async () => {
        mockQueries('OPERATOR');
        renderPanel();

        await waitFor(() => {
            expect(screen.getByText('Front of house')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Racing' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Rename Front of house' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Delete Front of house' })).toBeEnabled();
    });
});
