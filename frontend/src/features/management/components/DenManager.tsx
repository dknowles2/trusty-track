import { useState } from 'react';
import { Den } from './RacerForm';
import { COMMON_COLORS } from '../../../utils/colors';
import { useAlert } from '../../../context/AlertContext';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiPencil, mdiDelete } from '@mdi/js';
import { useMutation, useQuery } from 'urql';
import { CREATE_DEN, UPDATE_DEN, DELETE_DEN, GET_RACE_DETAILS } from '../graphql/queries';
import { RANKS, rankLabel } from '../rankText';

const DEN_COLORS = COMMON_COLORS;

interface DenManagerProps {
    raceId: number;
    onUpdate: () => void;
}

export default function DenManager({ raceId, onUpdate }: DenManagerProps) {
    const { showAlert, showConfirm } = useAlert();

    const [{ data }, reexecuteQuery] = useQuery({
        query: GET_RACE_DETAILS,
        variables: { raceId }
    });

    const dens: Den[] = (data?.race?.dens || []).map((d: {
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

    const [, createDenMutation] = useMutation(CREATE_DEN);
    const [, updateDenMutation] = useMutation(UPDATE_DEN);
    const [, deleteDenMutation] = useMutation(DELETE_DEN);

    const [loading, setLoading] = useState(false);

    // New Den Form
    const [isAddingDen, setIsAddingDen] = useState(false);
    const [newDenName, setNewDenName] = useState('');
    const [newDenColor, setNewDenColor] = useState(DEN_COLORS[0]);
    const [newDenRank, setNewDenRank] = useState<string | undefined>(undefined);
    const [newDenStart, setNewDenStart] = useState<number | undefined>(undefined);
    const [newDenEnd, setNewDenEnd] = useState<number | undefined>(undefined);

    // Edit Den State
    const [editingDenId, setEditingDenId] = useState<number | null>(null);
    const [editDenName, setEditDenName] = useState('');
    const [editDenColor, setEditDenColor] = useState(DEN_COLORS[0]);
    const [editDenRank, setEditDenRank] = useState<string | undefined>(undefined);
    const [editDenStart, setEditDenStart] = useState<number | undefined>(undefined);
    const [editDenEnd, setEditDenEnd] = useState<number | undefined>(undefined);

    const refreshDens = () => {
        reexecuteQuery({ requestPolicy: 'network-only' });
        onUpdate();
    };

    const handleAddDen = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const result = await createDenMutation({
                raceId,
                den: {
                    name: newDenName,
                    color: newDenColor,
                    rank: newDenRank,
                    carNumberRangeStart: newDenStart,
                    carNumberRangeEnd: newDenEnd
                }
            });
            if (result.error) throw result.error;

            setNewDenName('');
            setNewDenColor(DEN_COLORS[0]);
            setNewDenRank(undefined);
            setNewDenStart(undefined);
            setNewDenEnd(undefined);
            setIsAddingDen(false);
            refreshDens();
        } catch (e) {
            console.error("Failed to add den", e);
            showAlert("Failed to add den", "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteDen = async (denId: number) => {
        const confirmed = await showConfirm("Are you sure? Racers in this den will be unassigned.", "Delete Den");
        if (!confirmed) return;

        try {
            const result = await deleteDenMutation({ id: denId });
            if (result.error) throw result.error;
            if (!result.data?.deleteDen) {
                showAlert(
                    "This den can't be deleted while a round is scoped to it. Remove or reassign that round first.",
                    "Error"
                );
                return;
            }
            refreshDens();
        } catch (e) {
            console.error("Failed to delete den", e);
            showAlert("Failed to delete den", "Error");
        }
    };

    const handleEditDenClick = (den: Den) => {
        setEditingDenId(den.id);
        setEditDenName(den.name);
        setEditDenColor(den.color);
        setEditDenRank(den.rank);
        setEditDenStart(den.car_number_range_start);
        setEditDenEnd(den.car_number_range_end);
    };

    const handleUpdateDen = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const result = await updateDenMutation({
                id: editingDenId,
                den: {
                    name: editDenName,
                    color: editDenColor,
                    rank: editDenRank,
                    carNumberRangeStart: editDenStart,
                    carNumberRangeEnd: editDenEnd
                }
            });
            if (result.error) throw result.error;

            setEditingDenId(null);
            refreshDens();
        } catch (e) {
            console.error("Failed to update den", e);
            showAlert("Failed to update den", "Error");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingDenId(null);
    };

    const getSuggestedRange = (dens: Den[]) => {
        if (dens.length === 0) {
            return { start: 100, end: 199 };
        }

        // Find the maximum end number
        let maxEnd = 0;
        dens.forEach(d => {
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

    const handleAddDenClick = () => {
        const { start, end } = getSuggestedRange(dens);
        setNewDenStart(start);
        setNewDenEnd(end);
        setIsAddingDen(true);
    };

    const visibleDens = editingDenId ? dens.filter(d => d.id === editingDenId) : dens;

    return (
        <div>
            {/* Add New Den */}
            {!editingDenId && (
                !isAddingDen ? (
                    <button
                    onClick={handleAddDenClick}
                    className="secondary-btn"
                    style={{ width: '100%', marginBottom: '20px', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                    <Icon path={mdiPlus} size={0.8} /> Add New Den
                    </button>
            ) : (
                <form onSubmit={handleAddDen} style={{ marginBottom: '20px', padding: '15px', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
                    <h4 style={{ marginTop: 0 }}>Add New Den</h4>
                    <div style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Name</label>
                            <input
                                type="text"
                                value={newDenName}
                                onChange={e => setNewDenName(e.target.value)}
                                required
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Start Number</label>
                             <input
                                type="number"
                                placeholder="e.g. 100"
                                value={newDenStart || ''}
                                onChange={e => setNewDenStart(e.target.value ? parseInt(e.target.value) : undefined)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>End Number</label>
                             <input
                                type="number"
                                placeholder="e.g. 199"
                                value={newDenEnd || ''}
                                onChange={e => setNewDenEnd(e.target.value ? parseInt(e.target.value) : undefined)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '5px' }}>Color</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {DEN_COLORS.map(color => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setNewDenColor(color)}
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        backgroundColor: color,
                                        border: newDenColor === color ? '2px solid white' : '1px solid transparent',
                                        boxShadow: newDenColor === color ? '0 0 0 2px #333' : 'none',
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
                            value={newDenRank || ''}
                            onChange={e => setNewDenRank(e.target.value || undefined)}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
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
                            {loading ? 'Adding...' : 'Add Den'}
                        </button>
                        <button type="button" onClick={() => setIsAddingDen(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
                            Cancel
                        </button>
                    </div>
                </form>
                )
            )}

            {/* List Dens */}
            {!isAddingDen && (
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {visibleDens.map(den => (
                    <li key={den.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                        {editingDenId === den.id ? (
                            <form onSubmit={handleUpdateDen} style={{ display: 'grid', gap: '10px' }}>

                                    <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Name</label>
                                        <input type="text" value={editDenName} onChange={e => setEditDenName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }} required />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Start #</label>
                                            <input type="number" value={editDenStart || ''} onChange={e => setEditDenStart(e.target.value ? parseInt(e.target.value) : undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>End #</label>
                                            <input type="number" value={editDenEnd || ''} onChange={e => setEditDenEnd(e.target.value ? parseInt(e.target.value) : undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>Color</label>
                                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                            {DEN_COLORS.map(color => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() => setEditDenColor(color)}
                                                    style={{
                                                        width: '20px',
                                                        height: '20px',
                                                        borderRadius: '50%',
                                                        backgroundColor: color,
                                                        border: editDenColor === color ? '2px solid white' : '1px solid transparent',
                                                        boxShadow: editDenColor === color ? '0 0 0 1px #333' : 'none',
                                                        cursor: 'pointer',
                                                        padding: 0
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                <div>
                                        <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '2px' }}>Rank</label>
                                        <select value={editDenRank || ''} onChange={e => setEditDenRank(e.target.value || undefined)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}>
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
                                    <button type="button" onClick={handleCancelEdit} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: den.color, border: '1px solid #ddd' }}></div>
                                    <b>{den.name}</b>
                                    {/* The rank as a pack says it. This showed
                                        the stored value, so a den of Arrow of
                                        Light scouts was labelled
                                        "(ARROW_OF_LIGHT)". */}
                                    {den.rank && <span style={{ fontSize: '0.8rem', color: '#666' }}>({rankLabel(den.rank)})</span>}
                                    {(den.car_number_range_start || den.car_number_range_end) && (
                                        <span style={{ fontSize: '0.75rem', backgroundColor: '#eee', padding: '2px 6px', borderRadius: '4px' }}>
                                            #{den.car_number_range_start || '?'}-{den.car_number_range_end || '?'}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <button
                                        onClick={() => handleEditDenClick(den)}
                                        style={{ marginRight: '10px', background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', padding: '4px' }}
                                        title="Edit Den"
                                    >
                                        <Icon path={mdiPencil} size={0.7} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteDen(den.id)}
                                        style={{ color: '#d32f2f', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                                        title="Delete Den"
                                    >
                                        <Icon path={mdiDelete} size={0.7} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
                {visibleDens.length === 0 && <li style={{ padding: '10px', color: '#999', textAlign: 'center' }}>No dens found.</li>}
            </ul>
            )}
        </div>
    );
}
