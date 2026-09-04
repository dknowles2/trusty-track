/**
 * Display scenes: configuring every audience screen at once (#613).
 *
 * Sits above `DisplaysPanel` on Race Control's Displays tab. Four built-in
 * presets are always offered — code, applied live against whichever screens
 * this process currently knows for the race (connected or not), nothing
 * stored (see `backend/domain/scenes.py`).
 * Saved scenes are the operator's own layouts, captured from what the
 * screens are already showing and reapplied later; see
 * `.claude/rules/displays.md`'s "Scenes" section for why a saved entry
 * carries a whole assignment rather than just a view, and why applying one
 * is best-effort rather than all-or-nothing.
 */

import { useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiContentSaveOutline, mdiDelete, mdiPencil, mdiPlay } from '@mdi/js';

import {
    APPLY_SCENE,
    APPLY_SCENE_PRESET,
    CREATE_SCENE,
    DELETE_SCENE,
    RENAME_SCENE,
    SCENES_QUERY,
    SCENE_PRESETS_QUERY,
} from '../graphql/queries';
import { summarizeApplyResult, type ApplySceneSummary } from '../scenes';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';

interface ScenePresetRow {
    key: string;
    label: string;
}

interface SceneRow {
    id: number;
    name: string;
    assignments: { displayId: string }[];
}

export default function ScenesPanel({ raceId }: { raceId: number }) {
    const { showToast, showConfirm } = useAlert();

    const [presetsResult] = useQuery({ query: SCENE_PRESETS_QUERY, pause: !raceId });
    const [scenesResult, reexecuteScenes] = useQuery({
        query: SCENES_QUERY,
        variables: { raceId },
        pause: !raceId,
        requestPolicy: 'cache-and-network',
    });

    const [, applyScenePreset] = useMutation(APPLY_SCENE_PRESET);
    const [, applyScene] = useMutation(APPLY_SCENE);
    const [, createScene] = useMutation(CREATE_SCENE);
    const [, renameScene] = useMutation(RENAME_SCENE);
    const [, deleteScene] = useMutation(DELETE_SCENE);

    const [savingAs, setSavingAs] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameDraft, setRenameDraft] = useState('');

    const presets: ScenePresetRow[] = presetsResult.data?.scenePresets ?? [];
    const scenes: SceneRow[] = scenesResult.data?.scenes ?? [];

    // Graphcache does not know a new or deleted `Scene` belongs in this
    // root list (the same reason `Query.races` needs `forgetRaceList`), so
    // every write below re-asks rather than relying on the normalized cache
    // to notice on its own.
    const refetch = () => reexecuteScenes({ requestPolicy: 'network-only' });

    const reportOutcome = (result: ApplySceneSummary | null | undefined) => {
        if (!result) return;
        showToast(summarizeApplyResult(result), result.skippedCount > 0 ? 'info' : 'success');
    };

    const handleApplyPreset = async (preset: string) => {
        const { data, error } = await applyScenePreset({ raceId, preset });
        if (error) {
            showToast(errorText(error, 'Could not apply that scene.'), 'error');
            return;
        }
        reportOutcome(data?.applyScenePreset);
    };

    const handleApplyScene = async (sceneId: number) => {
        const { data, error } = await applyScene({ sceneId });
        if (error) {
            showToast(errorText(error, 'Could not apply that scene.'), 'error');
            return;
        }
        reportOutcome(data?.applyScene);
    };

    const handleSave = async () => {
        const name = draftName.trim();
        if (!name) return;
        const { error } = await createScene({ raceId, name });
        if (error) {
            showToast(errorText(error, 'Could not save that scene.'), 'error');
            return;
        }
        setDraftName('');
        setSavingAs(false);
        refetch();
    };

    const handleDelete = async (scene: SceneRow) => {
        const confirmed = await showConfirm(
            `Delete the scene "${scene.name}"? This does not change what any screen is currently showing.`,
            'Delete scene',
            'Delete',
            'danger',
        );
        if (!confirmed) return;
        await deleteScene({ id: scene.id });
        refetch();
    };

    const startRenaming = (scene: SceneRow) => {
        setRenamingId(scene.id);
        setRenameDraft(scene.name);
    };

    const handleRename = async (scene: SceneRow) => {
        const name = renameDraft.trim();
        if (!name) return;
        const { error } = await renameScene({ id: scene.id, name });
        if (error) {
            showToast(errorText(error, 'Could not rename that scene.'), 'error');
            return;
        }
        setRenamingId(null);
        refetch();
    };

    return (
        <div
            style={{
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                marginBottom: '0.75rem',
                display: 'grid',
                gap: '0.6rem',
            }}
        >
            <div style={{ fontWeight: 600 }}>Scenes</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                One click reconfigures every connected screen at once.
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                {presets.map((preset) => (
                    <button
                        key={preset.key}
                        type="button"
                        className="secondary-btn"
                        onClick={() => void handleApplyPreset(preset.key)}
                        style={{ padding: '0.4rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                        <Icon path={mdiPlay} size={0.65} />
                        {preset.label}
                    </button>
                ))}
            </div>

            {scenes.length > 0 && (
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {scenes.map((scene) => (
                        <div
                            key={scene.id}
                            data-testid={`scene-${scene.id}`}
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.5rem',
                                alignItems: 'center',
                                borderTop: '1px solid var(--border-color)',
                                paddingTop: '0.4rem',
                            }}
                        >
                            {renamingId === scene.id ? (
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleRename(scene);
                                    }}
                                    style={{ display: 'flex', gap: '0.4rem', flex: 1, minWidth: '160px' }}
                                >
                                    <input
                                        autoFocus
                                        value={renameDraft}
                                        onChange={(e) => setRenameDraft(e.target.value)}
                                        style={{ flex: 1, padding: '0.3rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                                    />
                                    <button type="submit" className="secondary-btn" style={{ padding: '0.3rem 0.7rem' }}>
                                        Save
                                    </button>
                                </form>
                            ) : (
                                <span style={{ flex: 1, minWidth: '120px' }}>
                                    {scene.name}{' '}
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                                        ({scene.assignments.length} screen{scene.assignments.length === 1 ? '' : 's'})
                                    </span>
                                </span>
                            )}

                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => void handleApplyScene(scene.id)}
                                style={{ padding: '0.3rem 0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                            >
                                <Icon path={mdiPlay} size={0.6} />
                                Apply
                            </button>
                            <button
                                type="button"
                                aria-label={`Rename ${scene.name}`}
                                onClick={() => startRenaming(scene)}
                                style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer' }}
                            >
                                <Icon path={mdiPencil} size={0.6} color="var(--text-subtle-color)" />
                            </button>
                            <button
                                type="button"
                                aria-label={`Delete ${scene.name}`}
                                onClick={() => void handleDelete(scene)}
                                style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer' }}
                            >
                                <Icon path={mdiDelete} size={0.65} color="var(--error)" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {savingAs ? (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave();
                    }}
                    style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                >
                    <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder="e.g. Front of house"
                        style={{ flex: 1, padding: '0.3rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                    />
                    <button type="submit" className="secondary-btn" style={{ padding: '0.3rem 0.7rem' }}>
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSavingAs(false);
                            setDraftName('');
                        }}
                        style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: 'var(--text-muted-color)' }}
                    >
                        Cancel
                    </button>
                </form>
            ) : (
                <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setSavingAs(true)}
                    style={{ justifySelf: 'start', padding: '0.4rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                    <Icon path={mdiContentSaveOutline} size={0.65} />
                    Save current layout as a scene
                </button>
            )}
        </div>
    );
}
