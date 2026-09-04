// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ScenesPanel from './ScenesPanel';
import { useQuery, useMutation } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
    };
});

const showToast = vi.fn();
const showConfirm = vi.fn().mockResolvedValue(true);
vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm, showToast }),
}));

const applyScenePreset = vi.fn().mockResolvedValue({
    data: { applyScenePreset: { sceneId: null, appliedCount: 2, skippedCount: 0, outcomes: [] } },
});
const applyScene = vi.fn().mockResolvedValue({
    data: { applyScene: { sceneId: 1, appliedCount: 1, skippedCount: 1, outcomes: [{ displayId: 'x', displayName: 'Lobby', applied: false }] } },
});
const createScene = vi.fn().mockResolvedValue({ data: { createScene: { id: 2, raceId: 1, name: 'New Scene', assignments: [] } } });
const renameScene = vi.fn().mockResolvedValue({ data: { renameScene: { id: 1, name: 'Renamed' } } });
const deleteScene = vi.fn().mockResolvedValue({ data: { deleteScene: true } });

const reexecuteScenes = vi.fn();

function mockQueries(scenes: { id: number; name: string; assignments: unknown[] }[] = []) {
    type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } };
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: QueryArgs) => {
        const isPresets = args.query.definitions.some((d) => d.name?.value === 'GetScenePresets');
        if (isPresets) {
            return [
                {
                    data: {
                        scenePresets: [
                            { key: 'CHECK_IN', label: 'Check-In' },
                            { key: 'RACING', label: 'Racing' },
                            { key: 'INTERMISSION', label: 'Intermission' },
                            { key: 'AWARDS', label: 'Awards' },
                        ],
                    },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ];
        }
        return [{ data: { scenes }, fetching: false, error: null }, reexecuteScenes];
    });
}

function mockMutations() {
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: { definitions: { name?: { value?: string } }[] }) => {
        const name = query.definitions[0]?.name?.value;
        const impls: Record<string, unknown> = {
            ApplyScenePreset: applyScenePreset,
            ApplyScene: applyScene,
            CreateScene: createScene,
            RenameScene: renameScene,
            DeleteScene: deleteScene,
        };
        return [{ fetching: false }, impls[name ?? ''] ?? vi.fn().mockResolvedValue({ data: {} })];
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    showConfirm.mockResolvedValue(true);
    mockMutations();
});

afterEach(() => cleanup());

describe('ScenesPanel', () => {
    it('offers all four built-in presets', () => {
        mockQueries();
        render(<ScenesPanel raceId={1} />);

        expect(screen.getByRole('button', { name: /Check-In/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Racing/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Intermission/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Awards/ })).toBeInTheDocument();
    });

    it('applies a preset and reports every screen updated', async () => {
        mockQueries();
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: /Racing/ }));

        await waitFor(() => {
            expect(applyScenePreset).toHaveBeenCalledWith({ raceId: 1, preset: 'RACING' });
        });
        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('all 2 screens'), 'success');
        });
    });

    it('lists saved scenes with an Apply button each', () => {
        mockQueries([{ id: 1, name: 'Front of house', assignments: [{ displayId: 'a' }, { displayId: 'b' }] }]);
        render(<ScenesPanel raceId={1} />);

        expect(screen.getByText('Front of house')).toBeInTheDocument();
        expect(screen.getByText(/2 screens/)).toBeInTheDocument();
    });

    it('applying a saved scene reports a skipped, no-longer-connected display', async () => {
        mockQueries([{ id: 1, name: 'Front of house', assignments: [{ displayId: 'a' }] }]);
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(() => {
            expect(applyScene).toHaveBeenCalledWith({ sceneId: 1 });
        });
        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Lobby'), 'info');
        });
    });

    it('saves the current layout as a new named scene', async () => {
        mockQueries();
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: /Save current layout as a scene/ }));
        fireEvent.change(screen.getByPlaceholderText('e.g. Front of house'), { target: { value: 'My Scene' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(createScene).toHaveBeenCalledWith({ raceId: 1, name: 'My Scene' });
        });
        await waitFor(() => {
            expect(reexecuteScenes).toHaveBeenCalled();
        });
    });

    it('deletes a scene after confirming', async () => {
        mockQueries([{ id: 1, name: 'Front of house', assignments: [] }]);
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Front of house' }));

        await waitFor(() => {
            expect(showConfirm).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(deleteScene).toHaveBeenCalledWith({ id: 1 });
        });
    });

    it('does not delete when the confirmation is declined', async () => {
        showConfirm.mockResolvedValue(false);
        mockQueries([{ id: 1, name: 'Front of house', assignments: [] }]);
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Front of house' }));

        await waitFor(() => expect(showConfirm).toHaveBeenCalled());
        expect(deleteScene).not.toHaveBeenCalled();
    });

    it('renames a scene', async () => {
        mockQueries([{ id: 1, name: 'Front of house', assignments: [] }]);
        render(<ScenesPanel raceId={1} />);

        fireEvent.click(screen.getByRole('button', { name: 'Rename Front of house' }));
        const input = screen.getByDisplayValue('Front of house');
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        await waitFor(() => {
            expect(renameScene).toHaveBeenCalledWith({ id: 1, name: 'Renamed' });
        });
    });
});
