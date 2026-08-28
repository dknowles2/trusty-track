import React, { useState, useMemo } from 'react';

import { DEFAULT_LIMIT_OZ, formatOunces } from '../weightCheck';

export interface RaceFormData {
    name: string;
    date_time: string;
    location: string;
    group_id?: number;
    // Optional because a race need not name a track, and because the form
    // itself supplies one when it does not. Declaring it required meant a
    // missing value had to be smuggled through as `undefined` anyway, which is
    // how it reached `tracks[0]` unnoticed.
    track_id?: number;
    scoring_strategy: string;
    car_numbering_strategy: string;
    global_start_number: number;
    championship_trophies: number;
    /** The pack's weight limit in ounces, or null for no check (#205). */
    weight_limit_oz?: number | null;
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
        // New races are offered the near-universal pack rule; an existing race
        // keeps whatever it has, including nothing. The column has no server
        // default on purpose — see the model.
        weight_limit_oz: DEFAULT_LIMIT_OZ,
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

    // A race must name a track, and until this query answers there is nothing
    // to name. The form used to be submittable in that window: `trackId` was 0,
    // the insert failed the foreign key on `races.track_id`, and the operator
    // was told only "Failed to create race". Rare by hand and reliable on a
    // slow machine at a venue, which is what this app runs on.
    //
    // Nought is also what an install with no tracks at all gives — deleting the
    // last track is allowed while no race uses it — so the same test covers
    // both, and the field below says which of the two it is.
    const hasTrack = trackId !== 0;

    const handleChange = (field: keyof RaceFormData, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // The submit button is disabled without a track, but a form can still
        // be submitted by pressing Enter in a text field, and browsers differ
        // on whether a disabled default button stops that.
        if (!hasTrack) return;
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
                <label style={labelStyle} htmlFor="race-name">Event Name</label>
                <input
                    id="race-name"
                    type="text"
                    value={formData.name}
                    onChange={e => handleChange('name', e.target.value)}
                    placeholder="e.g. 2024 Pinewood Derby"
                    required
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle} htmlFor="race-date-time">Date & Time</label>
                <input
                    id="race-date-time"
                    type="datetime-local"
                    value={formData.date_time}
                    onChange={e => handleChange('date_time', e.target.value)}
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle} htmlFor="race-location">Location</label>
                <input
                    id="race-location"
                    type="text"
                    value={formData.location}
                    onChange={e => handleChange('location', e.target.value)}
                    placeholder="e.g. School Gym"
                    style={inputStyle}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                    <label style={labelStyle} htmlFor="race-scoring">Scoring</label>
                    <select
                        id="race-scoring"
                        value={formData.scoring_strategy}
                        onChange={e => handleChange('scoring_strategy', e.target.value)}
                        style={inputStyle}
                    >
                        <option value="TIMED">Timed (Fastest Avg Time)</option>
                        <option value="POINTS">Points (1st=1pt, 2nd=2pts...)</option>
                    </select>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="race-trophies">Championship Trophies</label>
                    <input
                        id="race-trophies"
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

            {/* The weight limit (#205). A checkbox as well as a number,
                because "no limit" and "a limit of nothing" are different
                answers and an empty box cannot tell them apart. */}
            <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                    <input
                        type="checkbox"
                        id="race-check-weights"
                        checked={formData.weight_limit_oz != null}
                        onChange={e =>
                            setFormData(prev => ({
                                ...prev,
                                weight_limit_oz: e.target.checked ? DEFAULT_LIMIT_OZ : null,
                            }))
                        }
                    />
                    <span>Check car weights at inspection</span>
                </label>
                {formData.weight_limit_oz != null && (
                    <>
                        <label style={labelStyle} htmlFor="race-weight-limit">Weight Limit (oz)</label>
                        <input
                            id="race-weight-limit"
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={formatOunces(formData.weight_limit_oz)}
                            onChange={e =>
                                handleChange('weight_limit_oz', parseFloat(e.target.value) || DEFAULT_LIMIT_OZ)
                            }
                            style={inputStyle}
                        />
                    </>
                )}
                <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                    Check-in warns when a car is over this. It is a warning, not a refusal —
                    the inspector decides.
                </p>
            </div>
            <div>
                <label style={labelStyle} htmlFor="race-track">Track / Timer</label>
                {fetchingTracks ? (
                    <p style={{ fontSize: '0.8rem', color: '#666' }}>Loading tracks...</p>
                ) : !hasTrack ? (
                    <p data-testid="no-tracks" style={{ fontSize: '0.9rem', color: '#c62828' }}>
                        You have no tracks yet. Add one in System Settings, then come back
                        and create your race.
                    </p>
                ) : (
                <select
                    id="race-track"
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
                <label style={labelStyle} htmlFor="race-car-numbering">Car Numbering</label>
                <select
                    id="race-car-numbering"
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
                     <label style={labelStyle} htmlFor="race-global-start">Global Start Number</label>
                    <input
                        id="race-global-start"
                        type="number"
                        value={formData.global_start_number}
                        onChange={e => handleChange('global_start_number', parseInt(e.target.value) || 1)}
                        style={inputStyle}
                        placeholder="e.g. 1"
                    />
                </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
                     <button type="submit" disabled={loading || !hasTrack} className="primary-btn" style={{ flex: 1, padding: '12px' }}>
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
