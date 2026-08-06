import React, { useState, useMemo } from 'react';

export interface RaceFormData {
    name: string;
    date_time: string;
    location: string;
    group_id?: number;
    track_id: number;
    scoring_strategy: string;
    car_numbering_strategy: string;
    global_start_number: number;
    championship_trophies: number;
}


interface RaceFormProps {
    initialData?: Partial<RaceFormData>;
    onSubmit: (data: RaceFormData) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
    submitLabel?: string;
}

import { useQuery } from 'urql';
import { GET_TRACKS } from '../../core/graphql/queries';

export default function RaceForm({ initialData, onSubmit, onCancel, onDelete, submitLabel = 'Save' }: RaceFormProps) {
    const [formData, setFormData] = useState<RaceFormData>({
        name: '',
        date_time: '',
        location: '',
        group_id: 1, // Default
        track_id: 0,
        scoring_strategy: 'TIMED',
        car_numbering_strategy: 'GLOBAL',
        global_start_number: 1,
        championship_trophies: 3,
        ...initialData
    });
    const [loading, setLoading] = useState(false);
    const [tracksResult] = useQuery({ query: GET_TRACKS });
    const tracks = useMemo(() => tracksResult.data?.tracks || [], [tracksResult.data?.tracks]);
    const fetchingTracks = tracksResult.fetching;

    // The track defaults to the first one, derived rather than written back
    // into state by an effect. Nothing needs storing: until the operator picks
    // a track there is no choice to remember, and a effect that patched state
    // after the query resolved cost a second render to say the same thing.
    const trackId = formData.track_id || tracks[0]?.id || 0;

    const handleChange = (field: keyof RaceFormData, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSubmit({
                ...formData,
                track_id: trackId,
                name: formData.name.trim()
            });
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        fontSize: '1rem',
        marginBottom: '1rem',
        boxSizing: 'border-box' as const
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.9rem',
        marginBottom: '0.5rem',
        color: '#555',
        fontWeight: 'bold'
    };

    return (
        <form onSubmit={handleSubmit}>
            <div>
                <label style={labelStyle}>Event Name</label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={e => handleChange('name', e.target.value)}
                    placeholder="e.g. 2024 Pinewood Derby"
                    required
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle}>Date & Time</label>
                <input
                    type="datetime-local"
                    value={formData.date_time}
                    onChange={e => handleChange('date_time', e.target.value)}
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle}>Location</label>
                <input
                    type="text"
                    value={formData.location}
                    onChange={e => handleChange('location', e.target.value)}
                    placeholder="e.g. School Gym"
                    style={inputStyle}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                    <label style={labelStyle}>Scoring</label>
                    <select
                        value={formData.scoring_strategy}
                        onChange={e => handleChange('scoring_strategy', e.target.value)}
                        style={inputStyle}
                    >
                        <option value="TIMED">Timed (Fastest Avg Time)</option>
                        <option value="POINTS">Points (1st=1pt, 2nd=2pts...)</option>
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Championship Trophies</label>
                    <input
                        type="number"
                        value={formData.championship_trophies || 3}
                        onChange={e => handleChange('championship_trophies', parseInt(e.target.value) || 3)}
                        min="1"
                        max="10"
                        style={inputStyle}
                    />
                    <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                        Number of trophies to award for the championship.
                    </p>
                </div>
            </div>
            <div>
                <label style={labelStyle}>Track / Timer</label>
                {fetchingTracks ? (
                    <p style={{ fontSize: '0.8rem', color: '#666' }}>Loading tracks...</p>
                ) : (
                <select
                    value={trackId}
                    onChange={e => handleChange('track_id', parseInt(e.target.value))}
                    style={inputStyle}
                    required
                >
                    {Array.isArray(tracks) && tracks.map(track => (
                        <option key={track.id} value={track.id}>{track.name}</option>
                    ))}
                </select>
                )}
            </div>

            <div>
                <label style={labelStyle}>Car Numbering</label>
                <select
                    value={formData.car_numbering_strategy}
                    onChange={e => handleChange('car_numbering_strategy', e.target.value)}
                    style={inputStyle}
                >
                    <option value="MANUAL">Manual</option>
                    <option value="PER_GROUP">Per Den</option>
                    <option value="GLOBAL">Global</option>
                </select>
            </div>
             {formData.car_numbering_strategy === 'GLOBAL' && (
                <div>
                     <label style={labelStyle}>Global Start Number</label>
                    <input
                        type="number"
                        value={formData.global_start_number}
                        onChange={e => handleChange('global_start_number', parseInt(e.target.value))}
                        style={inputStyle}
                        placeholder="e.g. 1"
                    />
                </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
                     <button type="submit" disabled={loading} className="primary-btn" style={{ flex: 1, padding: '12px' }}>
                        {loading ? 'Saving...' : submitLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="secondary-btn"
                        style={{ background: 'transparent', border: '1px solid #ddd', color: '#666' }}
                    >
                        Cancel
                    </button>
                </div>

                {onDelete && (
                     <button
                        type="button"
                        onClick={onDelete}
                        className="secondary-btn"
                        style={{
                            backgroundColor: '#ffebee',
                            color: '#c62828',
                            border: '1px solid #ffcdd2',
                            marginLeft: 'auto'
                        }}
                    >
                        Delete Race
                    </button>
                )}
            </div>
        </form>
    );
}
