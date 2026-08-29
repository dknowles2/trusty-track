import { useState } from 'react';
import { RacingGroup } from './RacerForm';
import { COMMON_COLORS } from '../../../utils/colors';
import { useAlert } from '../../../context/AlertContext';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiPencil, mdiDelete } from '@mdi/js';
import { useMutation, useQuery } from 'urql';
import { CREATE_RACING_GROUP, UPDATE_RACING_GROUP, DELETE_RACING_GROUP, GET_RACE_DETAILS } from '../graphql/queries';
import { RANKS, rankLabel } from '../rankText';

const RACING_GROUP_COLORS = COMMON_COLORS;

interface RacingGroupManagerProps {
    raceId: number;
    onUpdate: () => void;
}

export default function RacingGroupManager({ raceId, onUpdate }: RacingGroupManagerProps) {
    const { showAlert, showConfirm } = useAlert();

    const [{ data }, reexecuteQuery] = useQuery({
        query: GET_RACE_DETAILS,
        variables: { raceId }
    });

    const racingGroups: RacingGroup[] = (data?.race?.racingGroups || []).map((d: {
        id: number;
        name: string;
        color: string;
        rank?: string;
        carNumberRangeStart?: number;
        carNumberRangeEnd?: number;
    }) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        rank: d.rank,
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
    const [newRacingGroupRank, setNewRacingGroupRank] = useState<string | undefined>(undefined);
    const [newRacingGroupStart, setNewRacingGroupStart] = useState<number | undefined>(undefined);
    const [newRacingGroupEnd, setNewRacingGroupEnd] = useState<number | undefined>(undefined);

    // Edit Racing Group State
    const [editingRacingGroupId, setEditingRacingGroupId] = useState<number | null>(null);
    const [editRacingGroupName, setEditRacingGroupName] = useState('');
    const [editRacingGroupColor, setEditRacingGroupColor] = useState(RACING_GROUP_COLORS[0]);
    const [editRacingGroupRank, setEditRacingGroupRank] = useState<string | undefined>(undefined);
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
                    rank: newRacingGroupRank,
                    carNumberRangeStart: newRacingGroupStart,
                    carNumberRangeEnd: newRacingGroupEnd
                }
            });
            if (result.error) throw result.error;

            setNewRacingGroupName('');
            setNewRacingGroupColor(RACING_GROUP_COLORS[0]);
            setNewRacingGroupRank(undefined);
            setNewRacingGroupStart(undefined);
            setNewRacingGroupEnd(undefined);
            setIsAddingRacingGroup(false);
            refreshRacingGroups();
        } catch (e) {
            console.error("Failed to add racing group", e);
            showAlert("Failed to add racing group", "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRacingGroup = async (racingGroupId: number) => {
        const confirmed = await showConfirm("Are you sure? Racers in this racing group will be unassigned.", "Delete Racing Group");
        if (!confirmed) return;

        try {
            const result = await deleteRacingGroupMutation({ id: racingGroupId });
            if (result.error) throw result.error;
            if (!result.data?.deleteRacingGroup) {
                showAlert(
                    "This racing group can't be deleted while a round is scoped to it. Remove or reassign that round first.",
                    "Error"
                );
                return;
            }
            refreshRacingGroups();
        } catch (e) {
            console.error("Failed to delete racing group", e);
            showAlert("Failed to delete racing group", "Error");
        }
    };

    const handleEditRacingGroupClick = (racingGroup: RacingGroup) => {
        setEditingRacingGroupId(racingGroup.id);
        setEditRacingGroupName(racingGroup.name);
        setEditRacingGroupColor(racingGroup.color);
        setEditRacingGroupRank(racingGroup.rank);
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
                    rank: editRacingGroupRank,
                    carNumberRangeStart: editRacingGroupStart,
                    carNumberRangeEnd: editRacingGroupEnd
                }
            });
            if (result.error) throw result.error;

            setEditingRacingGroupId(null);
            refreshRacingGroups();
        } catch (e) {
            console.error("Failed to update racing group", e);
            showAlert("Failed to update racing group", "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingRacingGroupId(null);
    };

    const getSuggestedRange = (racingGroups: RacingGroup[]) => {
        if (racingGroups.length === 0) {
            return { start: 100, end: 199 };
        }

        // Find the maximum end number
        let maxEnd = 0;
        racingGroups.forEach(d => {
            if (d.car_number_range_end && d.car_number_range_end > maxEnd) {
                maxEnd = d.car_number_range_end;
            }
        });

        // If no ranges set, start at 100
        if (maxEnd === 0) {
             return { start: 100, end: 199 };
        }

        // Start at the next 100 block
        const nextStart = Math.ceil((maxEnd + 1) / 100) * 100;
        // If simply maxEnd is 199, nextStart is 200.
        // If maxEnd is 150, (151/100) = 1.51 => ceil = 2 => 200.

        // However, if maxEnd is exactly 199, (200/100)=2 => 200. Correct.
        // If maxEnd is 200 (weird but possible), (201/100)=2.01 => 3 => 300. Correct.

        return { start: nextStart, end: nextStart + 99 };
    };

    const handleAddRacingGroupClick = () => {
        const { start, end } = getSuggestedRange(racingGroups);
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
                    <Icon path={mdiPlus} size={0.8} /> Add New Racing Group
                    </button>
            ) : (
                <form onSubmit={handleAddRacingGroup} style={{ marginBottom: '20px', padding: '15px', background: 'var(--surface-tint-color)', borderRadius: '8px', border: '1px solid var(--divider-color)' }}>
                    <h4 style={{ marginTop: 0 }}>Add New Racing Group</h4>
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
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Rank (optional)</label>
                            <select
                            value={newRacingGroupRank || ''}
                            onChange={e => setNewRacingGroupRank(e.target.value || undefined)}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        >
                            <option value="">None</option>
                            {RANKS.map((rank) => (
                                <option key={rank.value} value={rank.value}>
                                    {rank.label}
                                </option>
                            ))}
                            </select>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="submit" disabled={loading} className="primary-btn" style={{ flex: 1 }}>
                            {loading ? 'Adding...' : 'Add Racing Group'}
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
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Rank</label>
                                        <select value={editRacingGroupRank || ''} onChange={e => setEditRacingGroupRank(e.target.value || undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                    <option value="">None</option>
                                    {RANKS.map((rank) => (
                                        <option key={rank.value} value={rank.value}>
                                            {rank.label}
                                        </option>
                                    ))}
                                </select>
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
                                    {/* The rank as a pack says it. This showed
                                        the stored value, so a racingGroup of Arrow of
                                        Light scouts was labelled
                                        "(ARROW_OF_LIGHT)". */}
                                    {racingGroup.rank && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>({rankLabel(racingGroup.rank)})</span>}
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
                                        title="Edit Racing Group"
                                    >
                                        <Icon path={mdiPencil} size={0.7} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteRacingGroup(racingGroup.id)}
                                        style={{ color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                                        title="Delete Racing Group"
                                    >
                                        <Icon path={mdiDelete} size={0.7} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
                {visibleRacingGroups.length === 0 && <li style={{ padding: '10px', color: 'var(--text-faint-color)', textAlign: 'center' }}>No racing groups found.</li>}
            </ul>
            )}
        </div>
    );
}
