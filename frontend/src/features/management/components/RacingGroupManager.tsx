import { useState } from 'react';
import { RacingGroup } from './RacerForm';
import { COMMON_COLORS } from '../../../utils/colors';
import { useAlert } from '../../../context/AlertContext';
import { useTerminology } from '../../../context/TerminologyContext';
import { errorText } from '../../../utils/errors';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiPencil, mdiDelete } from '@mdi/js';
import { useMutation, useQuery } from 'urql';
import { CREATE_RACING_GROUP, UPDATE_RACING_GROUP, DELETE_RACING_GROUP, GET_RACE_DETAILS } from '../graphql/queries';
import { categoryPresetsFor } from '../../../context/organizationKinds';
import { suggestedRange } from '../numberRanges';
import { shouldShowDivision } from '../../stats/racingGroupLabel';

const RACING_GROUP_COLORS = COMMON_COLORS;

interface RacingGroupManagerProps {
    raceId: number;
    onUpdate: () => void;
}

export default function RacingGroupManager({ raceId, onUpdate }: RacingGroupManagerProps) {
    const { showAlert, showConfirm } = useAlert();
    const { group, groupLower, groupsLower, org } = useTerminology();
    // Which category suggestions to offer (#928, part 1) — derived from
    // this race's own resolved words, not stored anywhere: nothing records
    // which `OrganizationKind` was chosen, so a school or an Awana club
    // gets its own list and a custom vocabulary gets none at all, rather
    // than everybody being offered Cub Scout ranks regardless of who is
    // actually holding the race. See `categoryPresetsFor`.
    const categoryPresets = categoryPresetsFor({ organizationSingular: org, racingGroupSingular: group });

    const [{ data }, reexecuteQuery] = useQuery({
        query: GET_RACE_DETAILS,
        variables: { raceId }
    });

    const racingGroups: RacingGroup[] = (data?.race?.racingGroups || []).map((d: {
        id: number;
        name: string;
        color: string;
        division?: string;
        carNumberRangeStart?: number;
        carNumberRangeEnd?: number;
    }) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        division: d.division,
        car_number_range_start: d.carNumberRangeStart,
        car_number_range_end: d.carNumberRangeEnd
    }));

    const [, createRacingGroupMutation] = useMutation(CREATE_RACING_GROUP);
    const [, updateRacingGroupMutation] = useMutation(UPDATE_RACING_GROUP);
    const [, deleteRacingGroupMutation] = useMutation(DELETE_RACING_GROUP);

    const [loading, setLoading] = useState(false);

    // New Racing Group Form
    const [isAddingRacingGroup, setIsAddingRacingGroup] = useState(false);
    const [newRacingGroupName, setNewRacingGroupName] = useState('');
    const [newRacingGroupColor, setNewRacingGroupColor] = useState(RACING_GROUP_COLORS[0]);
    const [newRacingGroupDivision, setNewRacingGroupDivision] = useState('');
    const [newRacingGroupStart, setNewRacingGroupStart] = useState<number | undefined>(undefined);
    const [newRacingGroupEnd, setNewRacingGroupEnd] = useState<number | undefined>(undefined);

    // Edit Racing Group State
    const [editingRacingGroupId, setEditingRacingGroupId] = useState<number | null>(null);
    const [editRacingGroupName, setEditRacingGroupName] = useState('');
    const [editRacingGroupColor, setEditRacingGroupColor] = useState(RACING_GROUP_COLORS[0]);
    const [editRacingGroupDivision, setEditRacingGroupDivision] = useState('');
    const [editRacingGroupStart, setEditRacingGroupStart] = useState<number | undefined>(undefined);
    const [editRacingGroupEnd, setEditRacingGroupEnd] = useState<number | undefined>(undefined);

    const refreshRacingGroups = () => {
        reexecuteQuery({ requestPolicy: 'network-only' });
        onUpdate();
    };

    const handleAddRacingGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const result = await createRacingGroupMutation({
                raceId,
                racingGroup: {
                    name: newRacingGroupName,
                    color: newRacingGroupColor,
                    division: newRacingGroupDivision || undefined,
                    carNumberRangeStart: newRacingGroupStart,
                    carNumberRangeEnd: newRacingGroupEnd
                }
            });
            if (result.error) throw result.error;

            setNewRacingGroupName('');
            setNewRacingGroupColor(RACING_GROUP_COLORS[0]);
            setNewRacingGroupDivision('');
            setNewRacingGroupStart(undefined);
            setNewRacingGroupEnd(undefined);
            setIsAddingRacingGroup(false);
            refreshRacingGroups();
        } catch (e) {
            console.error(`Failed to add ${groupLower}`, e);
            showAlert(`Failed to add ${groupLower}`, "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRacingGroup = async (racingGroupId: number) => {
        // #755: deletion is refused (not a silent loss) when a round or an
        // award is still scoped to this racing group — the confirm dialog
        // says so up front so a refusal is not a surprise. `deleteRacingGroup`
        // used to report a refusal as a plain `false` with no message
        // reaching the client, so the alert named only the two possible
        // causes rather than the specific round or award. The mutation now
        // lets the backend's own `ValueError` through as a GraphQL error
        // naming exactly which one is blocking the delete (#823), so
        // `errorText` below shows that message over the generic fallback.
        const confirmed = await showConfirm(
            `Are you sure? Racers in this ${groupLower} will be unassigned. ` +
            `If a round or an award is scoped to this ${groupLower}, it can't be deleted until that is reassigned or removed.`,
            `Delete ${group}`,
        );
        if (!confirmed) return;

        try {
            const result = await deleteRacingGroupMutation({ id: racingGroupId });
            if (result.error) {
                showAlert(
                    errorText(
                        result.error,
                        `This ${groupLower} can't be deleted while a round or an award is scoped to it. Remove or reassign that first.`,
                    ),
                    "Error"
                );
                return;
            }
            refreshRacingGroups();
        } catch (e) {
            console.error(`Failed to delete ${groupLower}`, e);
            showAlert(`Failed to delete ${groupLower}`, "Error");
        }
    };

    const handleEditRacingGroupClick = (racingGroup: RacingGroup) => {
        setEditingRacingGroupId(racingGroup.id);
        setEditRacingGroupName(racingGroup.name);
        setEditRacingGroupColor(racingGroup.color);
        setEditRacingGroupDivision(racingGroup.division ?? '');
        setEditRacingGroupStart(racingGroup.car_number_range_start);
        setEditRacingGroupEnd(racingGroup.car_number_range_end);
    };

    const handleUpdateRacingGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const result = await updateRacingGroupMutation({
                id: editingRacingGroupId,
                racingGroup: {
                    name: editRacingGroupName,
                    color: editRacingGroupColor,
                    division: editRacingGroupDivision || undefined,
                    carNumberRangeStart: editRacingGroupStart,
                    carNumberRangeEnd: editRacingGroupEnd
                }
            });
            if (result.error) throw result.error;

            setEditingRacingGroupId(null);
            refreshRacingGroups();
        } catch (e) {
            console.error(`Failed to update ${groupLower}`, e);
            showAlert(`Failed to update ${groupLower}`, "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingRacingGroupId(null);
    };

    const handleAddRacingGroupClick = () => {
        const { start, end } = suggestedRange(racingGroups);
        setNewRacingGroupStart(start);
        setNewRacingGroupEnd(end);
        setIsAddingRacingGroup(true);
    };

    const visibleRacingGroups = editingRacingGroupId ? racingGroups.filter(d => d.id === editingRacingGroupId) : racingGroups;

    return (
        <div>
            {/* Add New Racing Group */}
            {!editingRacingGroupId && (
                !isAddingRacingGroup ? (
                    <button
                    onClick={handleAddRacingGroupClick}
                    className="secondary-btn"
                    style={{ width: '100%', marginBottom: '20px', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                    <Icon path={mdiPlus} size={0.8} /> Add New {group}
                    </button>
            ) : (
                <form onSubmit={handleAddRacingGroup} style={{ marginBottom: '20px', padding: '15px', background: 'var(--surface-tint-color)', borderRadius: '8px', border: '1px solid var(--divider-color)' }}>
                    <h4 style={{ marginTop: 0 }}>Add New {group}</h4>
                    <div style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Name</label>
                            <input
                                type="text"
                                value={newRacingGroupName}
                                onChange={e => setNewRacingGroupName(e.target.value)}
                                required
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Start Number</label>
                             <input
                                type="number"
                                placeholder="e.g. 100"
                                value={newRacingGroupStart || ''}
                                onChange={e => setNewRacingGroupStart(e.target.value ? parseInt(e.target.value) : undefined)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>End Number</label>
                             <input
                                type="number"
                                placeholder="e.g. 199"
                                value={newRacingGroupEnd || ''}
                                onChange={e => setNewRacingGroupEnd(e.target.value ? parseInt(e.target.value) : undefined)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '5px' }}>Color</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {RACING_GROUP_COLORS.map(color => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setNewRacingGroupColor(color)}
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        backgroundColor: color,
                                        border: newRacingGroupColor === color ? '2px solid var(--on-primary-color)' : '1px solid transparent',
                                        boxShadow: newRacingGroupColor === color ? '0 0 0 2px var(--text-color)' : 'none',
                                        cursor: 'pointer',
                                        padding: 0
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Category (optional)</label>
                            <select
                            value=""
                            onChange={e => { if (e.target.value) setNewRacingGroupDivision(e.target.value); }}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', marginBottom: '6px' }}
                        >
                            <option value="">Choose a category, or type your own</option>
                            {categoryPresets.map((preset) => (
                                <option key={preset} value={preset}>
                                    {preset}
                                </option>
                            ))}
                            </select>
                            <input
                                type="text"
                                value={newRacingGroupDivision}
                                onChange={e => setNewRacingGroupDivision(e.target.value)}
                                placeholder="e.g. Wolf, 3rd Grade"
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="submit" disabled={loading} className="primary-btn" style={{ flex: 1 }}>
                            {loading ? 'Adding...' : `Add ${group}`}
                        </button>
                        <button type="button" onClick={() => setIsAddingRacingGroup(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>
                            Cancel
                        </button>
                    </div>
                </form>
                )
            )}

            {/* List RacingGroups */}
            {!isAddingRacingGroup && (
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {visibleRacingGroups.map(racingGroup => (
                    <li key={racingGroup.id} style={{ padding: '10px', borderBottom: '1px solid var(--divider-color)' }}>
                        {editingRacingGroupId === racingGroup.id ? (
                            <form onSubmit={handleUpdateRacingGroup} style={{ display: 'grid', gap: '10px' }}>

                                    <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Name</label>
                                        <input type="text" value={editRacingGroupName} onChange={e => setEditRacingGroupName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} required />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Start #</label>
                                            <input type="number" value={editRacingGroupStart || ''} onChange={e => setEditRacingGroupStart(e.target.value ? parseInt(e.target.value) : undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>End #</label>
                                            <input type="number" value={editRacingGroupEnd || ''} onChange={e => setEditRacingGroupEnd(e.target.value ? parseInt(e.target.value) : undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>Color</label>
                                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                            {RACING_GROUP_COLORS.map(color => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() => setEditRacingGroupColor(color)}
                                                    style={{
                                                        width: '20px',
                                                        height: '20px',
                                                        borderRadius: '50%',
                                                        backgroundColor: color,
                                                        border: editRacingGroupColor === color ? '2px solid var(--on-primary-color)' : '1px solid transparent',
                                                        boxShadow: editRacingGroupColor === color ? '0 0 0 1px var(--text-color)' : 'none',
                                                        cursor: 'pointer',
                                                        padding: 0
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Category</label>
                                        <select
                                            value=""
                                            onChange={e => { if (e.target.value) setEditRacingGroupDivision(e.target.value); }}
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', marginBottom: '6px' }}
                                        >
                                    <option value="">Choose a category, or type your own</option>
                                    {categoryPresets.map((preset) => (
                                        <option key={preset} value={preset}>
                                            {preset}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={editRacingGroupDivision}
                                    onChange={e => setEditRacingGroupDivision(e.target.value)}
                                    placeholder="e.g. Wolf, 3rd Grade"
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                />
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button type="submit" disabled={loading} className="primary-btn" style={{ flex: 1 }}>
                                        {loading ? 'Saving...' : 'Save Changes'}
                                    </button>
                                    <button type="button" onClick={handleCancelEdit} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: racingGroup.color, border: '1px solid var(--border-color)' }}></div>
                                    <b>{racingGroup.name}</b>
                                    {/* The stored value is already the label
                                        an operator typed or picked (#496 stage
                                        2) — nothing left to translate. Suppressed
                                        when it only repeats the group's own name,
                                        the same `shouldShowDivision` rule the
                                        standings already apply (#774) — reused
                                        rather than copied, so there is one home
                                        for it. */}
                                    {shouldShowDivision(racingGroup.name, racingGroup.division) && (
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>({racingGroup.division})</span>
                                    )}
                                    {(racingGroup.car_number_range_start || racingGroup.car_number_range_end) && (
                                        <span style={{ fontSize: '0.75rem', backgroundColor: 'var(--divider-color)', padding: '2px 6px', borderRadius: '4px' }}>
                                            #{racingGroup.car_number_range_start || '?'}-{racingGroup.car_number_range_end || '?'}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <button
                                        onClick={() => handleEditRacingGroupClick(racingGroup)}
                                        style={{ marginRight: '10px', background: 'none', border: 'none', color: 'var(--link-color)', cursor: 'pointer', padding: '4px' }}
                                        title={`Edit ${group}`}
                                    >
                                        <Icon path={mdiPencil} size={0.7} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteRacingGroup(racingGroup.id)}
                                        style={{ color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                                        title={`Delete ${group}`}
                                    >
                                        <Icon path={mdiDelete} size={0.7} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
                {visibleRacingGroups.length === 0 && <li style={{ padding: '10px', color: 'var(--text-faint-color)', textAlign: 'center' }}>No {groupsLower} found.</li>}
            </ul>
            )}
        </div>
    );
}
