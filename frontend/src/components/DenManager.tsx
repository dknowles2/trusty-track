import { useState, useEffect } from 'react';
import { Den } from './RacerForm';
import { apiClient } from '../api/client';

const DEN_COLORS = [
    '#003F87', // Scouting Blue
    '#FCD116', // Cub Scout Gold
    '#D32F2F', // Red
    '#388E3C', // Green
    '#F57C00', // Orange
    '#7B1FA2', // Purple
    '#795548', // Brown
    '#212121', // Black
    '#009688', // Teal
];

interface DenManagerProps {
    raceId: number;
    onClose: () => void;
    onUpdate: () => void;
}

export default function DenManager({ raceId, onClose, onUpdate }: DenManagerProps) {
    const [dens, setDens] = useState<Den[]>([]);
    const [loading, setLoading] = useState(false);
    
    // New Den Form
    const [isAddingDen, setIsAddingDen] = useState(false);
    const [newDenName, setNewDenName] = useState('');
    const [newDenColor, setNewDenColor] = useState(DEN_COLORS[0]);
    const [newDenRank, setNewDenRank] = useState<string | undefined>(undefined);

    // Edit Den State
    const [editingDenId, setEditingDenId] = useState<number | null>(null);
    const [editDenName, setEditDenName] = useState('');
    const [editDenColor, setEditDenColor] = useState(DEN_COLORS[0]);
    const [editDenRank, setEditDenRank] = useState<string | undefined>(undefined);

    useEffect(() => {
        fetchDens();
    }, []);

    const fetchDens = async () => {
        try {
            const data = await apiClient.get(`/races/${raceId}/dens/`);
            setDens(data);
        } catch (e) {
            console.error("Failed to fetch dens", e);
        }
    };

    const handleAddDen = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await apiClient.post(`/races/${raceId}/dens/`, {
                name: newDenName,
                color: newDenColor,
                rank: newDenRank
            });
            setNewDenName('');
            setNewDenColor('#000000');
            setNewDenRank(undefined);
            setIsAddingDen(false); // Close form after adding
            await fetchDens();
            onUpdate();
        } catch (e) {
            console.error("Failed to add den", e);
            alert("Failed to add den");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteDen = async (denId: number) => {
        if (!confirm("Are you sure? Racers in this den will be unassigned.")) return;
        
        try {
            await apiClient.delete(`/dens/${denId}`);
            await fetchDens();
            onUpdate();
        } catch (e) {
            console.error("Failed to delete den", e);
            alert("Failed to delete den");
        }
    };

    const handleEditDenClick = (den: Den) => {
        setEditingDenId(den.id);
        setEditDenName(den.name);
        setEditDenColor(den.color);
        setEditDenRank(den.rank);
    };

    const handleUpdateDen = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await apiClient.put(`/dens/${editingDenId}`, {
                name: editDenName,
                color: editDenColor,
                rank: editDenRank
            });
            setEditingDenId(null);
            await fetchDens();
            onUpdate();
        } catch (e) {
            console.error("Failed to update den", e);
            alert("Failed to update den");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingDenId(null);
    };

    const visibleDens = editingDenId ? dens.filter(d => d.id === editingDenId) : dens;

    return (
        <div>
            {/* Add New Den */}
            {!editingDenId && (
                !isAddingDen ? (
                    <button 
                    onClick={() => setIsAddingDen(true)} 
                    className="secondary-btn" 
                    style={{ width: '100%', marginBottom: '20px', padding: '10px' }}
                >
                    + Add New Den
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
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '3px' }}>Rank Mapping (Optional)</label>
                            <select 
                            value={newDenRank || ''} 
                            onChange={e => setNewDenRank(e.target.value || undefined)}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                        >
                            <option value="">None</option>
                            <option value="LION">Lion</option>
                            <option value="TIGER">Tiger</option>
                            <option value="WOLF">Wolf</option>
                            <option value="BEAR">Bear</option>
                            <option value="WEBELOS">Webelos</option>
                            <option value="ARROW_OF_LIGHT">Arrow of Light</option>
                            <option value="OTHER">Other</option>
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
                                    <option value="LION">Lion</option>
                                    <option value="TIGER">Tiger</option>
                                    <option value="WOLF">Wolf</option>
                                    <option value="BEAR">Bear</option>
                                    <option value="WEBELOS">Webelos</option>
                                    <option value="ARROW_OF_LIGHT">Arrow of Light</option>
                                    <option value="OTHER">Other</option>
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
                                    {den.rank && <span style={{ fontSize: '0.8rem', color: '#666' }}>({den.rank})</span>}
                                </div>
                                <div>
                                    <button onClick={() => handleEditDenClick(den)} style={{ marginRight: '10px', background: 'none', border: 'none', color: 'blue', cursor: 'pointer' }}>Edit</button>
                                    <button 
                                        onClick={() => handleDeleteDen(den.id)}
                                        style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}
                                    >
                                        Delete
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
